# HANDOFF — SaanSLive Pre-Submission Stability Audit

> **Context checkpoint** for an LLM resuming this task mid-flight.
> Last updated: 2026-08-03 ~22:50 IST

---

## 1. The Task

The user is submitting this repo (`d:\ET Hackathon\ET-Hackathon`, SaanSLive) to the
**OpenAI Codex India Hackathon 2026**. **The deadline is TODAY (3 Aug 2026).**

Deployed link: **https://saanslive.vercel.app/**
GitHub remote: `https://github.com/SyedArmanAli2003/ET-Hackathon.git` (branch `main`)

Goal: make sure the project is stable and **every feature actually works** before
submission. Judges apply a pass/fail **Viability Gate** — the deployed link must
open, the core flow must run, and the repo must match the demo. Scoring weights:
Technical Execution 50%, Impact 20%, Use of Codex 15%, Creativity 10%, Demo 5%.

---

## 2. Environment Gotchas (learned the hard way)

| Gotcha | Detail |
|---|---|
| **Shell is PowerShell** (`pwsh.exe`), not cmd | `&&` chaining and `dir /b` fail. Use `;` and PowerShell cmdlets. |
| **`read_file` param is `path`** | Using `file_path` silently fails with "Missing value for required parameter 'path'". Same for `write_to_file`. |
| Frontend root | `frontend/saanslive` (`vercel.json` sets `rootDirectory`). `node_modules`, `.env.local`, `.next` already present locally. |
| Python venv | `.venv` is already active; `xgboost`/`lightgbm`/`pandas`/`sqlalchemy` all import fine. |
| `ingestion/.env` exists | Holds `SUPABASE_DB_URL` + `OPENAQ_API_KEY`. Root `.env` does **not** exist. |
| PowerShell date parsing | `[DateTime]::Parse()` on Supabase timestamps misreads locale. **Always fetch raw JSON** via `Invoke-WebRequest ... .Content` instead of `Invoke-RestMethod` when checking timestamps. |

---

## 3. Verified Working ✅

| Check | Result |
|---|---|
| `/`, `/dashboard`, `/about` on prod | all **HTTP 200** |
| `npx tsc --noEmit` | **exit 0**, zero type errors |
| `.env.local` — all 6 vars present | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `AGENT_RUN_TOKEN`, `NVIDIA_NIM_API_KEY`, `NVIDIA_NIM_MODEL` |
| NVIDIA NIM key valid | `GET /v1/models` → 200, 102 models |
| All 4 configured model IDs exist upstream | minimax-m3, gpt-oss-120b, deepseek-v4-flash, llama-3.3-70b |
| `readings` / `weather` freshness | fresh (~4.5h old) — **OpenAQ ingestion IS running fine** |
| `/api/advisory` degradation | returns HTTP 200 `{"polished":null,...}` → UI falls back to deterministic template. Fails *safely*, not a crash. |
| Model artifacts present locally | 76 `.pkl` files, incl. **18** `*_xgb_6h.pkl` (8.38 MB total) |

---

## 4. 🔴 Bugs Found

### BUG 1 — Stale forecasts (CRITICAL) — ✅ **DATA FIXED, ROOT CAUSE NOT YET FIXED**

**Symptom:** `0 of 199` forecast rows had `forecast_at` in the future. Every row
was created `2026-07-29`, i.e. ~5 days stale. The dashboard's headline feature
(24h AQI forecast chart) had nothing current to show.

**Root cause:** `.gitignore` contains the line:
```
model/artifacts/*.pkl
```
So CI (`.github/workflows/ingest.yml`) checks out **no current model artifacts**.
Only **20 legacy** `.pkl` files are tracked in git, and they use the *old* naming
convention with **no `_6h` suffix** (`delhi_xgb.pkl`, not `delhi_xgb_6h.pkl`).
`model/predict.py` looks for `{city}_xgb_6h.pkl`, finds zero matches in CI,
logs "artifact not found" for every city, and inserts 0 forecasts. The workflow
still reports SUCCESS because `run_ingestion.py` treats "no forecasts produced"
as a non-failure (by design, see `run_forecast()` line ~281).

**What was already done:** ran locally to repopulate the DB —
```powershell
python ingestion/run_ingestion.py --skip-stations --skip-readings --skip-weather
```
→ **51 forecasts inserted.** Verified: **40 rows now have `forecast_at` > now**,
newest `2026-08-03T18:30:00Z`, `predicted_aqi` 78.51 / 92.23 / 134.91.

**What still MUST be done:** commit the 18 `*_xgb_6h.pkl` artifacts so scheduled
CI runs keep producing forecasts after today. Suggested `.gitignore` change —
keep ignoring everything except the horizon-6 xgb models `predict.py` needs:
```
model/artifacts/*.pkl
!model/artifacts/*_xgb_6h.pkl
```
Then `git add -f model/artifacts/*_xgb_6h.pkl`. 8.38 MB is well within git limits.

> Note: 12 stations are legitimately skipped each run (NaN lag features, or
> `kochi_xgb_6h.pkl` genuinely never trained). This is **expected, honest
> behaviour** — the UI shows "Forecast pending". Do not try to "fix" it.

### BUG 2 — `/api/chat` returns 502 in production (HIGH)

**Symptom:**
```
POST https://saanslive.vercel.app/api/chat → 502
{"error":"AbortError: This operation was aborted"}
```
The floating AI chatbot — a headline feature present on every page — is
**completely broken in prod**.

**Root cause:** NVIDIA NIM's free pool has degraded badly since the numbers in
`lib/nimModels.ts` comments were measured. Live benchmark today (`"Say OK."`, 64
max_tokens):

| Model | Latency | Result |
|---|---|---|
| `openai/gpt-oss-20b` | **3.2–5.0 s** | ✅ 200 OK, **tool-calling verified working** |
| `minimaxai/minimax-m3` | **15.7–18.8 s** | ✅ 200 OK, tool-calling works, but far too slow |
| `openai/gpt-oss-120b` | **>120 s** | ❌ hard timeout |
| `deepseek-ai/deepseek-v4-flash` | 0.8–1.2 s | ❌ HTTP **529 "Service temporarily overloaded"** |
| `meta/llama-3.3-70b-instruct` | >60 s | ❌ hard timeout |

`app/api/chat/route.ts` sets `REQUEST_TIMEOUT_MS = 45_000` and
`MAX_TOOL_ROUNDS = 4` → worst case 4 × 18 s sequential calls. Vercel's serverless
function limit kills the request long before that, surfacing as `AbortError`.
There is also **no `maxDuration` export** on the route.

**Fix plan (not yet applied):**
1. In `lib/nimModels.ts`: switch `DEFAULT_NIM_MODEL` to `openai/gpt-oss-20b`
   (must be added to the `NIM_MODELS` array + `NIM_GENERATION_SETTINGS` map — it
   is **not currently listed**, though it is confirmed available upstream).
   Also drop `minimax-m3`'s `maxTokens: 8192` → ~1024; that alone cuts latency.
2. In `app/api/chat/route.ts`: add `export const maxDuration = 60;`, lower
   `REQUEST_TIMEOUT_MS` to ~20–25 s, reduce `MAX_TOOL_ROUNDS` 4 → 2.
3. Update the stale benchmark comments in `nimModels.ts` (they currently claim
   minimax-m3 runs in 1.3–2.2 s, which is no longer true) so the repo stays honest.

### BUG 3 — `/api/advisory` never produces AI text (MEDIUM)

**Symptom:** returns `{"polished":null,"reason":"no_provider_succeeded"}` after
16.6 s. All three cascade models fail, so the "AI-polished health advisory"
feature never actually fires — users only ever see the deterministic template.

**Root cause:** `REQUEST_TIMEOUT_MS = 8_000` (line 54 of
`app/api/advisory/route.ts`) is below every working model's real latency, and the
cascade order is `minimax-m3 → gpt-oss-120b → deepseek-v4-flash` — the two
fallbacks are exactly the models that hard-timeout / return 529.

**Fix plan:** reorder cascade to put `openai/gpt-oss-20b` **first**, raise
`REQUEST_TIMEOUT_MS` to ~15 s, add `export const maxDuration = 30;`. Keep the
template fallback intact — it is a genuinely good reliability design.

**Exact valid request body** (all 5 string/number fields required or you get
`400 invalid_body`):
```json
{"aqiValue":180,"aqiCategory":"Unhealthy","stationName":"Anand Vihar, Delhi",
 "timeLabel":"in 6 hours","guidanceClause":"limit outdoor exertion","preferredLanguage":"en"}
```

---

## 5. Remaining Work — Ordered Next Steps

- [ ] **Fix `.gitignore` + commit `*_xgb_6h.pkl`** (Bug 1 root cause) — highest
      value, prevents regression right after submission.
- [ ] **Fix `lib/nimModels.ts`** — add `openai/gpt-oss-20b` to `NIM_MODELS` and
      `NIM_GENERATION_SETTINGS`, make it `DEFAULT_NIM_MODEL`, refresh comments.
- [ ] **Fix `app/api/chat/route.ts`** — `maxDuration`, lower timeout, 2 rounds.
- [ ] **Fix `app/api/advisory/route.ts`** — reorder cascade, raise timeout,
      `maxDuration`.
- [ ] **Run `npm run build`** in `frontend/saanslive` — only `tsc --noEmit` has
      been run so far; a real production build has **not** been verified.
- [ ] **Commit + push to `main`** so Vercel redeploys (Vercel is git-connected).
- [ ] **Re-test prod endpoints** with the probes in §6 — confirm `/api/chat`
      returns 200 with a real reply and a `toolCalls` array.
- [ ] **Verify still-untested features:**
  - `/api/agent/run` (needs `x-agent-run-token` header matching `AGENT_RUN_TOKEN`)
  - Hotspot Prioritization tab → Supabase RPC `get_hotspot_ranking_stats`
  - Compare Cities tab, StationMap markers, Personal Air Action Plan tab
  - `frontend/components/` and `frontend/lib/` at repo root appear to be **empty
    leftover dirs** — confirm and consider deleting (repo cleanliness).
- [ ] **Update `README.md`** — it claims stats as of 2026-07-21 (47,310 readings /
      145 forecasts). Actual DB now: **71 stations**, ~100k+ readings, 199+
      forecasts. README also says 53 stations / 20 cities. Refresh for accuracy
      since judges compare repo claims against the live app.
- [ ] Confirm submission artifacts exist: public repo ✅, demo video, Google Doc.

---

## 6. Reusable Probes (PowerShell)

```powershell
# --- read a secret out of .env.local ---
cd "frontend/saanslive"
$key  = ((Get-Content .env.local | Where-Object { $_ -match '^NVIDIA_NIM_API_KEY=' }) -replace '^NVIDIA_NIM_API_KEY=','').Trim()
$url  = ((Get-Content .env.local | Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_URL=' }) -replace '^NEXT_PUBLIC_SUPABASE_URL=','').Trim()
$anon = ((Get-Content .env.local | Where-Object { $_ -match '^NEXT_PUBLIC_SUPABASE_ANON_KEY=' }) -replace '^NEXT_PUBLIC_SUPABASE_ANON_KEY=','').Trim()
$h = @{ apikey=$anon; Authorization="Bearer $anon"; Prefer="count=exact" }

# --- how many forecasts are actually in the future? (the key health metric) ---
$now = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
$r = Invoke-WebRequest -Uri "$url/rest/v1/forecasts?select=id&forecast_at=gt.$now&limit=1" -Headers $h
$r.Headers['Content-Range']    # want NON-zero, e.g. "0-0/40"

# --- raw latest timestamps (avoids PowerShell locale parsing bug) ---
(Invoke-WebRequest -Uri "$url/rest/v1/readings?select=timestamp&order=timestamp.desc&limit=1" -Headers $h).Content

# --- prod chat endpoint ---
$body = '{"messages":[{"role":"user","content":"What is the current AQI in Delhi?"}]}'
try { $r = Invoke-WebRequest -Uri "https://saanslive.vercel.app/api/chat" -Method POST -ContentType "application/json" -Body $body -TimeoutSec 90; $r.StatusCode; $r.Content }
catch { $_.ErrorDetails.Message }

# --- benchmark a NIM model end-to-end ---
$b = @{ model="openai/gpt-oss-20b"; messages=@(@{role="user"; content="Say OK."}); max_tokens=64; stream=$false } | ConvertTo-Json -Depth 5 -Compress
$sw=[Diagnostics.Stopwatch]::StartNew()
Invoke-RestMethod -Uri "https://integrate.api.nvidia.com/v1/chat/completions" -Method POST -Headers @{Authorization="Bearer $key"; "Content-Type"="application/json"} -Body $b -TimeoutSec 60
$sw.Elapsed.TotalSeconds

# --- regenerate forecasts (forecast step only; safe + idempotent) ---
cd "d:\ET Hackathon\ET-Hackathon"
python ingestion/run_ingestion.py --skip-stations --skip-readings --skip-weather
# add --dry-run first to preview without writing
```

---

## 7. Key Files

| File | Why it matters |
|---|---|
| `.gitignore` | Line `model/artifacts/*.pkl` is Bug 1's root cause. |
| `frontend/saanslive/lib/nimModels.ts` | Model registry, `DEFAULT_NIM_MODEL`, per-model gen settings. Comments hold **stale** benchmark data. |
| `frontend/saanslive/app/api/chat/route.ts` | Tool-calling loop. `REQUEST_TIMEOUT_MS=45_000`, `MAX_TOOL_ROUNDS=4`, no `maxDuration`. |
| `frontend/saanslive/app/api/advisory/route.ts` | 3-model cascade, `REQUEST_TIMEOUT_MS=8_000` (line 54). |
| `frontend/saanslive/lib/data.ts` | All Supabase queries (670 lines). `STALE_READING_THRESHOLD_HOURS = 12`. |
| `frontend/saanslive/app/dashboard/page.tsx` | 4 tabs: `overview` / `agent` / `hotspots` / `compare`. |
| `frontend/saanslive/components/AqiChatbot.tsx` | Reviewed — client-side error handling is **correct**; it surfaces `json.error` properly. No change needed. |
| `ingestion/run_ingestion.py` | 4-step fault-isolated orchestrator. `run_forecast()` treats 0 forecasts as SUCCESS (why CI stayed green). |
| `model/predict.py` | Loads `{city}_xgb_6h.pkl` — the naming that legacy tracked artifacts don't match. |
| `.github/workflows/ingest.yml` | Cron `17 */5 * * *`. Runs `run_ingestion.py` then `model/eval_agent.py`. |

---

## 8. Guiding Constraints

- **Deadline is today.** Prefer minimal, low-risk, high-impact changes
  (config/timeout/model-selection tuning + committing artifacts) over refactors.
- **Priority order:** (1) forecasts stay fresh after today, (2) chatbot stops
  502-ing, (3) advisory AI actually fires, (4) docs match reality.
- **The project's core design value is honesty** — it deliberately shows "Forecast
  pending" / staleness warnings instead of fabricating numbers. Preserve that.
  Never make a fallback silently invent data.
- The deployed app is **git-connected to Vercel**, so pushing to `main` triggers
  redeploy. Verify prod after the push, not just locally.
