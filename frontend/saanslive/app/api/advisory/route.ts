/**
 * app/api/advisory/route.ts — Server-side LLM rephrasing proxy for AdvisoryPanel.
 *
 * WHY A SERVER ROUTE
 * -------------------
 * AdvisoryPanel is a client component. The NVIDIA NIM API key must
 * never reach the browser bundle, so this route holds the secrets and the
 * client (lib/generateAdvisory.ts) POSTs the already-computed template data
 * here instead of calling NVIDIA directly.
 *
 * CASCADE STRATEGY
 * ----------------
 * Primary : openai/gpt-oss-20b    — measured fastest on the free pool (11.4s)
 * Fallback: minimaxai/minimax-m3  — works, slightly slower (14.0s)
 *
 * When no model is specified by the client, both are tried in order.
 * The first non-null response wins. Only if both fail does the route
 * return { polished: null } so the caller renders the deterministic template.
 *
 * The order and the timeout below are both driven by real measurements (see
 * lib/nimModels.ts). An earlier version paired an 8s timeout with a cascade
 * led by a model that takes 15-19s, so EVERY attempt aborted and the AI
 * polish silently never happened -- the template fallback masked it. Timeouts
 * here must stay above observed upstream latency or the feature is dead code.
 *
 * When the client explicitly picks a model via the UI picker, we honour that
 * selection with a single-model call (no cascade) — the picker is opt-in.
 *
 * SAFETY
 * ------
 * The LLM is instructed to only rephrase — never invent numbers, never
 * change the AQI value or category. Even so, this is model output and must
 * be treated as advisory only, not authoritative. We also strip the
 * response down to a single sentence server-side as a defensive measure in
 * case the model ignores the instruction.
 */

import { NextResponse } from "next/server";
import {
    isNimModelId,
    NIM_GENERATION_SETTINGS,
    type NimModelId,
} from "../../../lib/nimModels";

export const runtime = "nodejs";

// Must exceed the cascade budget below, or the platform kills the invocation
// before the route can return its template-fallback JSON.
export const maxDuration = 60;

type AdvisoryRequestBody = {
    aqiValue: number;
    aqiCategory: string;
    stationName: string;
    timeLabel: string;
    guidanceClause: string;
    preferredLanguage: string;
    model?: NimModelId;
};

const NVIDIA_NIM_URL = "https://integrate.api.nvidia.com/v1/chat/completions";

// Measured against THIS route's actual prompt (not a trivial one) on
// 2026-08-03: gpt-oss-20b returned a correct single sentence in 11.4s and
// minimax-m3 in 14.0s. A previous 8-9s ceiling sat below both, so every
// attempt aborted and the polish never once succeeded. Sized with headroom
// above the slower of the two.
const REQUEST_TIMEOUT_MS = 20_000;

// Total wall-clock ceiling for the whole cascade, so we always return JSON
// instead of being terminated by the runtime mid-cascade.
const CASCADE_BUDGET_MS = 45_000;

// Cascade order: primary → fallback.
// Both entries are verified to produce correct output for this prompt.
// Dropped from the cascade (still selectable via the explicit model picker):
//   - deepseek-v4-flash: returns HTTP 529 "Service temporarily overloaded"
//   - gpt-oss-120b / llama-3.3-70b: >60s, hard timeout
// Keeping known-dead models in the cascade only burned budget that the
// working models needed.
const CASCADE_MODELS: NimModelId[] = [
    "openai/gpt-oss-20b",   // primary  — 11.4s measured
    "minimaxai/minimax-m3", // fallback — 14.0s measured
];

function buildPrompt(body: AdvisoryRequestBody): string {
    return `You are rephrasing an air quality advisory sentence for a dashboard. Rewrite the following facts as ONE natural, plain sentence in ${body.preferredLanguage === "en" ? "English" : `the language with BCP-47 code "${body.preferredLanguage}"`}.

Facts (do not change these, do not invent any other numbers):
- Predicted AQI: ${body.aqiValue}
- Category: "${body.aqiCategory}"
- Station: ${body.stationName}
- Time: ${body.timeLabel}
- Guidance: ${body.guidanceClause}

Rules:
- Output ONLY the rewritten sentence, nothing else -- no preamble, no quotes, no explanation.
- Exactly one sentence.
- Keep the AQI value (${body.aqiValue}) and category ("${body.aqiCategory}") exactly as given -- do not change, round differently, or reinterpret them.
- Do not add alarmist language, exclamation points, or invented statistics.
- Do not invent any numbers not listed above.`;
}

async function callChatCompletions(
    url: string,
    apiKey: string,
    model: NimModelId,
    prompt: string,
    timeoutMs: number = REQUEST_TIMEOUT_MS
): Promise<string | null> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const settings = NIM_GENERATION_SETTINGS[model];
        const res = await fetch(url, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                Authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify({
                model,
                messages: [{ role: "user", content: prompt }],
                temperature: settings.temperature,
                top_p: settings.topP,
                max_tokens: settings.maxTokens,
                stream: false,
            }),
            signal: controller.signal,
        });

        if (!res.ok) {
            console.error(`[advisory-api] ${url} responded ${res.status} for model ${model}`);
            return null;
        }

        const json = await res.json();
        const content: string | undefined = json?.choices?.[0]?.message?.content;
        if (!content || typeof content !== "string") return null;

        // Defensive: collapse to a single sentence/line even if the model
        // ignored the "one sentence" instruction.
        const firstLine = content.trim().split("\n")[0].trim();
        return firstLine.length > 0 ? firstLine : null;
    } catch (err) {
        console.error(`[advisory-api] ${url} failed for model ${model}:`, err);
        return null;
    } finally {
        clearTimeout(timeout);
    }
}

export async function POST(request: Request) {
    let body: AdvisoryRequestBody;
    try {
        body = await request.json();
    } catch {
        return NextResponse.json({ polished: null, reason: "invalid_body" }, { status: 400 });
    }

    if (
        typeof body.aqiValue !== "number" ||
        typeof body.aqiCategory !== "string" ||
        typeof body.stationName !== "string" ||
        typeof body.timeLabel !== "string" ||
        typeof body.guidanceClause !== "string"
    ) {
        return NextResponse.json({ polished: null, reason: "invalid_body" }, { status: 400 });
    }

    const preferredLanguage =
        typeof body.preferredLanguage === "string" ? body.preferredLanguage : "en";

    // Validate client-supplied model if present
    const clientModel = body.model;
    if (clientModel !== undefined && !isNimModelId(clientModel)) {
        return NextResponse.json({ polished: null, reason: "invalid_model" }, { status: 400 });
    }

    const prompt = buildPrompt({ ...body, preferredLanguage });
    const nvidiaKey = process.env.NVIDIA_NIM_API_KEY;

    if (!nvidiaKey) {
        return NextResponse.json({ polished: null, reason: "no_provider_succeeded" });
    }

    // ── Single-model path (client explicitly picked a model via the picker) ─
    if (clientModel !== undefined) {
        console.info("[advisory-api] Single-model call", { model: clientModel, preferredLanguage });
        const polished = await callChatCompletions(NVIDIA_NIM_URL, nvidiaKey, clientModel, prompt);
        if (polished) {
            return NextResponse.json({ polished, provider: "nvidia_nim", model: clientModel });
        }
        return NextResponse.json({ polished: null, reason: "no_provider_succeeded" });
    }

    // ── Cascade path: GPT-OSS 20B → MiniMax M3 ─────────────────────────────
    const deadline = Date.now() + CASCADE_BUDGET_MS;

    for (const model of CASCADE_MODELS) {
        const remaining = deadline - Date.now();
        // Below the fastest observed success (~11s) there's no point starting
        // another attempt -- it would only abort partway.
        if (remaining < 10_000) {
            console.warn("[advisory-api] Cascade budget exhausted, falling back to template");
            break;
        }

        console.info("[advisory-api] Cascade attempt", { model, preferredLanguage });
        const polished = await callChatCompletions(
            NVIDIA_NIM_URL,
            nvidiaKey,
            model,
            prompt,
            Math.min(REQUEST_TIMEOUT_MS, remaining)
        );
        if (polished) {
            console.info("[advisory-api] Cascade succeeded", { model });
            return NextResponse.json({ polished, provider: "nvidia_nim", model });
        }
        console.warn("[advisory-api] Model failed, trying next in cascade", { model });
    }

    // Every model failed — caller renders the deterministic template. This is
    // a 200, not an error: the advisory itself is still fully available, just
    // in its template wording rather than LLM-rephrased.
    return NextResponse.json({ polished: null, reason: "no_provider_succeeded" });
}
