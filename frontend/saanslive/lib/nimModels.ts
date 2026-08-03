export const NIM_MODELS = [
    {
        id: "openai/gpt-oss-20b",
        label: "GPT-OSS 20B",
        description: "Fastest reliable option; default for chat and advisories",
    },
    {
        id: "meta/llama-3.3-70b-instruct",
        label: "Llama 3.3 70B",
        description: "Balanced multilingual advisory rewriting",
    },
    {
        id: "minimaxai/minimax-m3",
        label: "MiniMax M3",
        description: "General-purpose, detailed responses",
    },
    {
        id: "openai/gpt-oss-120b",
        label: "GPT-OSS 120B",
        description: "Advanced reasoning; may take longer",
    },
    {
        id: "deepseek-ai/deepseek-v4-flash",
        label: "DeepSeek V4 Flash",
        description: "Fast reasoning model; latency varies under shared-pool load",
    },
] as const;

export type NimModelId = (typeof NIM_MODELS)[number]["id"];

// DEFAULT MODEL SELECTION — measured, not assumed
// ------------------------------------------------
// RE-BENCHMARKED 2026-08-03 against NVIDIA's shared free-tier pool with real
// timed calls (trivial "Say OK." prompt, 64 max_tokens). The pool has
// degraded substantially since the original measurements, so the previous
// default (minimax-m3) no longer fits inside a serverless request budget:
//   - openai/gpt-oss-20b:            3.2-5.0s   OK, tool-calling verified
//   - minimaxai/minimax-m3:          15.7-18.8s OK but too slow to default to
//   - openai/gpt-oss-120b:           >120s      hard timeout
//   - deepseek-ai/deepseek-v4-flash: HTTP 529 "Service temporarily overloaded"
//   - meta/llama-3.3-70b-instruct:   >60s       hard timeout
//
// gpt-oss-20b is the default because it is the only model that both responds
// well inside the request budget AND correctly emits tool_calls (verified:
// returned a valid get_current_aqi call with {"city":"Delhi"} in 3.2s). The
// slower/flakier models stay in the picker so they remain selectable, but
// they are no longer relied on for the default path.
//
// These are live third-party latencies, not guarantees -- both API routes
// keep their own timeouts and fall back rather than hanging if the pool
// degrades again.
export const DEFAULT_NIM_MODEL: NimModelId = "openai/gpt-oss-20b";

export const NIM_GENERATION_SETTINGS: Record<
    NimModelId,
    { temperature: number; topP: number; maxTokens: number }
> = {
    "openai/gpt-oss-20b": {
        temperature: 1,
        topP: 1,
        // Deliberately small: both callers want either one rephrased sentence
        // or a short conversational answer, and a low cap directly bounds
        // worst-case latency.
        maxTokens: 1024,
    },
    "meta/llama-3.3-70b-instruct": {
        temperature: 0.2,
        topP: 0.7,
        maxTokens: 1024,
    },
    "minimaxai/minimax-m3": {
        temperature: 1,
        topP: 0.95,
        // Was 8192. Nothing in this app needs that many tokens (advisory =
        // one sentence, chat = a few sentences), and the oversized cap was a
        // direct contributor to this model's 15-19s response times.
        maxTokens: 1024,
    },
    "openai/gpt-oss-120b": {
        temperature: 1,
        topP: 1,
        maxTokens: 4096,
    },
    "deepseek-ai/deepseek-v4-flash": {
        temperature: 1,
        topP: 0.95,
        maxTokens: 4096,
    },
};

export function isNimModelId(value: unknown): value is NimModelId {
    return NIM_MODELS.some((model) => model.id === value);
}
