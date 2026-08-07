# SaanSLive — AI Air Quality Forecasting for India

[![GitHub Actions](https://github.com/SyedArmanAli2003/SaanSLive/actions/workflows/ingest.yml/badge.svg)](https://github.com/SyedArmanAli2003/SaanSLive/actions/workflows/ingest.yml)
[![Built with OpenAI Codex](https://img.shields.io/badge/built%20with-OpenAI%20Codex-000000)](./openai-codex.md)

**SaanSLive** is a real-time air quality monitoring and 6-hour AQI forecasting system for 20 major Indian cities (71 monitoring stations). It ingests live PM2.5 readings from [OpenAQ](https://openaq.org), enriches them with weather data from [Open-Meteo](https://open-meteo.com), trains per-city XGBoost/LightGBM models, and serves forecasts, city-level comparisons, and a transparent hotspot-prioritization ranking on a Next.js dashboard — plus an AI chatbot and AI-polished health advisories, all grounded in real Supabase queries.

**Hackathon track:** AI for Societal Good. The project includes a transparent, personalized **Air Action Plan** for commutes, outdoor workouts, school runs, and delivery shifts, plus live data/model freshness and baseline-validation context. See [HACKATHON.md](./HACKATHON.md) for the project description, three-minute demo flow, and submission checklist.

---

## How This Was Built

> **Plan outside. Build inside.**

All ideation, MVP scoping, architecture design, and spec-writing were done in free external tools and committed to this repo as documents **before** any application code was generated. Those planning artifacts are [`saanslive-hackathon-upgrade-plan.md`](./saanslive-hackathon-upgrade-plan.md), [`report.md`](./report.md), and [`HACKATHON.md`](./HACKATHON.md).

**All application code in this repository was written, run, and debugged with OpenAI Codex.** The chronological session log lives in [`openai-codex.md`](./openai-codex.md), and the incremental commit history on `main` is the build record. Specs were pasted as single batched prompts rather than assembled turn by turn, so Codex spent its cycles generating code instead of clarifying requirements.

| Stage | Tool | Cost |
|-------|------|------|
| Idea validation & MVP scoping | Free chat-based AI assistant | Free |
| Architecture & data-flow design | Free diagramming (diagrams committed to repo) | Free |
| Build spec / acceptance criteria | Markdown docs in-repo (`saanslive-hackathon-upgrade-plan.md`, `report.md`) | Free |
| **Application code generation & debugging** | **OpenAI Codex** | required subscription |
| Data sources | OpenAQ v3 + Open-Meteo (public open APIs, no synthetic data) | Free |
| Database | Supabase Postgres free tier | Free |
| Hosting | Vercel free tier | Free |
| Scheduled jobs / CI | GitHub Actions free tier | Free |
| Version control | GitHub | Free |

No fake or generated sample data is used anywhere in this project. Every number on the dashboard traces back to a real sensor reading or a model trained on real readings; where data is missing, the UI says so instead of filling the gap.

---

## Live Dashboard

Served at `/dashboard` (six tabs, one route — no fragmented pages):

- **Overview** — interactive Leaflet map with 71 station markers colored by real-time AQI band, city selector, 24h forecast chart (model prediction vs. persistence baseline, dashed), and an AI-polished health advisory panel.
- **Personal Air Action Plan** — turns the selected station's real forecast into a transparent, activity-specific plan for a commute, workout, school run, or delivery shift. The user can copy the plan, see the best available forecast window, and inspect the exact threshold/sensitivity adjustment behind the recommendation.
- **Forecast Transparency** — shows the age of the underlying sensor reading and model run, number of forecast points, and stored model RMSE versus the no-change persistence baseline. Older and missing data stay visible rather than being presented as fresh AI output.
- **Civic AQI Alert Agent** — an auditable proactive run that plans from current readings and forecasts, applies published thresholds, writes station advisories, and self-reviews the prior run against the next observed AQI. Every decision is visible in an expandable activity log. Advisory text in the agent path uses a deterministic 3-level template rather than an LLM call — a deliberate reliability choice so a scheduled job never depends on external model availability or latency.
- **Hotspot Prioritization** — ranks every station across every city by urgency, using only real numbers from `readings`: current AQI severity (60% weight) + 7-day trend vs the prior week (40% weight). Both components are shown separately, not just a combined score, so the ranking is auditable. Carries an explicit disclaimer that it is *not* based on registered pollution-source data — that data doesn't exist in this schema.
- **Compare Cities** — current AQI vs next-24h forecast, averaged across all of a city's stations, side-by-side as a sortable table or a Recharts bar chart. Cities where no station has a trained model yet show "Forecast pending" — never a fabricated number. Stations whose latest reading is stale are flagged in place rather than silently averaged in as fresh.

A floating AI chatbot (bottom-right, every page) answers AQI/forecast questions by calling real Supabase-backed tools — it cannot invent numbers, only report what a tool actually returned.

---

## Architecture Overview

```
OpenAQ API  ──┐
              ├──► ingestion/run_ingestion.py ──► Supabase Postgres
Open-Meteo ──┘          (GitHub Actions, every 5h)        │
                                                           │
model/train.py ──► model/artifacts/*.pkl                  │
model/predict.py ◄─────────────────────────────────────────┘
      │
      └──► forecasts table ──► frontend/saanslive (Next.js 16)
                                      │
                                      ├─► lib/data.ts ──► dashboard tabs
                                      │      (Overview / Action Plan / Transparency /
                                      │       Civic Alert Agent / Hotspot / Compare)
                                      │
                                      ├─► lib/chatTools.ts ──► AI chatbot
                                      │      + app/api/advisory ──► AI advisory
                                      │
                                      └─► lib/agent/aqiAlertAgent.ts ──► agent_runs
                                             (triggered by .github/workflows/agent.yml)
```

### Pipeline Steps (run_ingestion.py)

| Step | Script | Table | Description |
|------|--------|-------|-------------|
| 1 | `setup_stations.py` | `stations` | Sync 20 cities from OpenAQ, idempotent upsert |
| 2 | `ingest_readings.py` | `readings` | Fetch last 24h PM2.5 → AQI (US EPA formula) |
| 3 | `ingest_weather.py` | `weather` | Fetch last 24h hourly weather from Open-Meteo |
| 4 | `predict.py` | `forecasts` | Load XGBoost artifacts, write 6h AQI forecasts |

Each step is fault-isolated — a failure in one step never aborts the others. Model *training* (`train.py`) is run manually/on-demand, not on every ingestion cycle; `predict.py` runs every cycle against whatever artifacts currently exist in `model/artifacts/`.

---

## Repository Structure

```
SaanSLive/
├── README.md                         # This file
├── HACKATHON.md                      # Track, problem, demo flow, submission checklist
├── openai-codex.md                   # Session-by-session OpenAI Codex build log
├── report.md                         # Full technical report & QA log
├── saanslive-hackathon-upgrade-plan.md  # Pre-build spec (written before opening Codex)
├── schema.sql                        # Supabase Postgres schema + RLS (reference copy)
├── vercel.json                       # rootDirectory=frontend/saanslive for GitHub builds
├── start.bat                         # Windows one-click dev launcher
├── docs/
│   └── SaanSLive_Project_Documentation.pdf   # Exported project documentation
│
├── .github/workflows/
│   ├── ingest.yml                    # Cron every 5h + manual dispatch
│   └── agent.yml                     # Scheduled Civic AQI Alert Agent trigger
│
├── ingestion/
│   ├── config.py                     # 20 tracked Indian cities with lat/lng
│   ├── db.py                         # SQLAlchemy singleton engine
│   ├── setup_stations.py             # OpenAQ → stations (ON CONFLICT DO UPDATE)
│   ├── ingest_readings.py            # OpenAQ sensors → readings (ON CONFLICT DO NOTHING)
│   ├── ingest_weather.py             # Open-Meteo → weather (ON CONFLICT DO NOTHING)
│   ├── run_ingestion.py              # Master orchestrator, fault-isolated, exact counts
│   ├── explore_data.py               # EDA: console report + AQI PNG plot
│   └── requirements.txt              # Locked Python deps
│
├── model/
│   ├── features.py                   # build_features / add_forecast_target / forecast_feasibility
│   ├── split.py                      # time_split(df, test_days=2) → train/test/meta (no leakage)
│   ├── train.py                      # Per-city XGBoost/LightGBM training + persistence-baseline eval
│   ├── predict.py                    # Load artifacts, run inference, write to forecasts
│   └── artifacts/                    # Trained .pkl files — one per city × model type × horizon
│
├── supabase/
│   ├── config.toml                   # Supabase CLI project config
│   └── migrations/                   # Schema + Postgres function migrations (source of truth)
│
└── frontend/saanslive/
    ├── .env.example                  # Template for all required env vars (safe to commit)
    ├── .env.local                    # Real values (gitignored — never committed)
    ├── lib/
    │   ├── data.ts                   # Data layer — the ONLY file that queries Supabase directly
    │   │                             #   getStations, getCurrentReading, getLatestForecasts,
    │   │                             #   getHotspotRanking, getCityComparison
    │   ├── aqi.ts                    # AQI band mapping — single source of truth for all UI
    │   ├── chatTools.ts              # Real Supabase-backed tool implementations for the chatbot
    │   ├── generateAdvisory.ts       # Client-side template + calls /api/advisory to polish it
    │   ├── nimModels.ts              # NVIDIA NIM model registry, default selection, settings
    │   ├── geolocation.ts            # Browser geolocation → nearest-station lookup
    │   ├── localPreferences.ts       # Per-device onboarding preferences (localStorage)
    │   ├── supabaseClient.ts         # Single shared Supabase client instance
    │   └── agent/
    │       ├── aqiAlertAgent.ts      # Server-side plan → decide → alert → self-review loop
    │       └── types.ts              # Shared agent-run types
    ├── components/
    │   ├── HeroSection.tsx           # Landing hero (canvas-free cursor-reveal effect)
    │   ├── StationMap.tsx            # Leaflet map with live AQI markers
    │   ├── ForecastChart.tsx         # Recharts 24h forecast + persistence baseline
    │   ├── AdvisoryPanel.tsx         # AI-polished health advisory with template fallback
    │   ├── HotspotPanel.tsx          # "Hotspot Prioritization" ranked table + disclaimer
    │   ├── CityComparisonView.tsx    # "Compare Cities" table / bar chart + staleness warnings
    │   ├── AqiChatbot.tsx            # Floating tool-calling AI chatbot
    │   ├── OnboardingModal.tsx       # First-visit personalization modal
    │   ├── AgentActivityLog.tsx      # Expandable public agent-run timeline
    │   └── Skeleton.tsx              # Shared loading placeholders
    └── app/
        ├── page.tsx                  # Homepage — hero only
        ├── about/page.tsx            # About page
        ├── dashboard/page.tsx        # Dashboard — all six tabs, one route
        └── api/
            ├── advisory/route.ts     # Server-side LLM cascade for advisory rephrasing
            ├── chat/route.ts         # Server-side tool-calling loop for the AI chatbot
            └── agent/run/route.ts    # Token-guarded, rate-limited Civic Alert Agent trigger
```

---

## Getting Started

### Prerequisites

- Node.js 20+
- Python 3.11+
- A Supabase project (see Environment Variables)

### 1. Frontend (Next.js dashboard)

```bash
cd frontend/saanslive
npm install
cp .env.example .env.local     # then fill in your own values
npm run dev
# Open http://localhost:3000
```

Environment variables (see `.env.example` for the canonical list):

| Variable | Exposure | Purpose |
|----------|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Public | `https://<project-ref>.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Public | Anon key — read-only via RLS |
| `NVIDIA_NIM_API_KEY` | **Server only** | Powers chatbot + advisory rephrasing |
| `SUPABASE_SERVICE_ROLE_KEY` | **Server only** | Agent writes to `agent_runs`. NEVER prefix with `NEXT_PUBLIC_` |
| `AGENT_RUN_TOKEN` | **Server only** | Shared secret authorizing scheduled agent runs. NEVER prefix with `NEXT_PUBLIC_` |

### 2. Ingestion Pipeline (Python)

```bash
cd ingestion
python -m venv venv
venv\Scripts\activate          # Windows
pip install -r requirements.txt

# Create .env with:
# SUPABASE_DB_URL=postgresql://postgres:<password>@db.<project-ref>.supabase.co:5432/postgres
# OPENAQ_API_KEY=<your-key>

python run_ingestion.py                    # Full run, last 24h
python run_ingestion.py --hours 48         # Backfill 48h
python run_ingestion.py --skip-stations    # Skip station sync
python run_ingestion.py --dry-run          # Preview, no writes
```

### 3. ML Model

```bash
cd model
python train.py --model both --horizon 6   # Train XGBoost + LightGBM, 6h forecast, all feasible cities
python predict.py --horizon 6 --model xgb   # Run inference on latest data, write to forecasts table
```

`train.py` automatically skips any city with fewer than 5 usable rows after the NaN drop and prints exactly why (e.g. a station with zero readings, or too little history for a 24h lag feature) — it never silently produces nothing for a city it can't train.

---

## GitHub Actions CI/CD

The ingestion pipeline runs automatically every 5 hours via cron (`17 */5 * * *`) and can be triggered manually from the Actions tab. Model **training** is a separate, manual step (`model/train.py`) — retrain whenever the station list or data volume changes meaningfully; `predict.py` alone runs on the automated schedule.

### Required Secrets

Go to **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value |
|--------|-------|
| `SUPABASE_DB_URL` | `postgresql://postgres.<project-ref>:<password>@aws-1-<region>.pooler.supabase.com:6543/postgres` |
| `OPENAQ_API_KEY` | Your OpenAQ v3 API key |
| `AGENT_RUN_URL` | Your deployed `/api/agent/run` endpoint, e.g. `https://<your-app>.vercel.app/api/agent/run` — used by `.github/workflows/agent.yml` to trigger scheduled Civic AQI Alert Agent runs |
| `AGENT_RUN_TOKEN` | Shared secret matching the server-side `AGENT_RUN_TOKEN` env var on the deployment — sent as the `x-agent-run-token` header so scheduled runs bypass the manual-run cooldown; must match exactly or the request is rejected with 401 |

> ⚠️ **Region matters:** The pooler hostname must match your Supabase project region (`aws-1-<region>.pooler.supabase.com`). Using the wrong region causes every run to fail with `ENOTFOUND`. Copy the exact string from **Supabase → Project Settings → Database → Connection pooling**.

> 🔐 **Never commit real connection strings, keys, or hostnames.** All secrets live in GitHub Actions secrets and Vercel environment variables only. `.env` and `.env.local` are gitignored; `.env.example` documents the shape without the values.

---

## Database Schema

| Table | Rows (2026-08-03) | Description |
|-------|-------------------|--------------|
| `stations` | 71 | Monitoring stations across 20 Indian cities |
| `readings` | 101,458 | PM2.5 / AQI readings |
| `weather` | 37,168 | Hourly temperature, wind, humidity |
| `forecasts` | 250 | XGBoost 6h AQI predictions |
| `user_profiles` | 0 | Per-Supabase-Auth-user onboarding preferences (reserved) |
| `agent_runs` | — | Public, read-only audit trail for Civic AQI Alert Agent runs |

All tables have RLS enabled. Sensor tables (`stations`, `readings`, `weather`, `forecasts`) and the auditable `agent_runs` log are publicly readable via the anon key. Write access to `agent_runs` is restricted to the server-side `service_role`; it is never exposed to the browser. A dedicated Postgres function, `get_hotspot_ranking_stats()` (`SECURITY INVOKER`, `search_path` locked), computes current/weekly AQI aggregates server-side for the Hotspot Prioritization tab and is `GRANT EXECUTE`'d to `anon`/`authenticated`.

Of the 20 tracked cities, **18 currently have live readings/forecasts**; **Kochi** and **Visakhapatnam** have zero ingested readings so far (a data-availability gap, not a modeling one) — both are excluded from `train.py` before training even starts, and the dashboard shows "Forecast pending" for them honestly rather than fabricating a value.

---

## AQI Color Scale

| AQI Range | Category | Color |
|-----------|----------|-------|
| 0 – 50 | Good | 🟢 Green |
| 51 – 100 | Moderate | 🟡 Yellow |
| 101 – 150 | Unhealthy for Sensitive Groups | 🟠 Orange |
| 151 – 200 | Unhealthy | 🔴 Red |
| 201 – 300 | Very Unhealthy | 🟣 Purple |
| 301+ | Hazardous | 🟤 Maroon |

All dashboard components (map markers, forecast chart, advisory panel, Hotspot Prioritization, Compare Cities) use `lib/aqi.ts` as the single source of truth for this mapping.

---

## Model Performance (XGBoost, 6h horizon)

Retrained on the full current dataset — 47,310 readings, 522h span, all 20 cities queried (18 trainable). Time-based train/test split (last 2 days held out), persistence baseline = "AQI won't change in the next 6h."

| Metric | XGBoost | Persistence Baseline |
|--------|---------|-----------------------|
| Median RMSE | 26.27 | 30.14 |
| Median improvement | **+12.3%** | — |
| Stations beating baseline | 13/18 | 5/18 |

Best improvements: Surat (+36.5%), Guwahati (+31.7%), Bhopal (+30.9%), Mumbai (+28.1%). Four cities (Hyderabad, Indore, Lucknow, Nagpur ≈ tie, Patna) currently underperform the naive baseline — reported honestly rather than hidden, and expected to improve as more history accumulates for those specific stations. **Kochi** and **Visakhapatnam** are skipped entirely (zero ingested readings); **Bidhannagar, Kolkata** and **Powai, Mumbai** are skipped at the individual-station level (zero readings / too little history for a 24h lag feature, respectively) — both logged explicitly by `predict.py`, never silently dropped.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TypeScript |
| Mapping | Leaflet + react-leaflet |
| Charts | Recharts |
| Database | Supabase (PostgreSQL, RLS, Postgres functions) |
| Data Client | @supabase/supabase-js |
| AI (chatbot + advisory) | NVIDIA NIM (GPT-OSS 20B default + MiniMax M3 fallback, both latency-benchmarked; GPT-OSS 120B / DeepSeek V4 Flash / Llama 3.3 70B also selectable via the picker) |
| ML Models | XGBoost, LightGBM, scikit-learn |
| Ingestion | Python, SQLAlchemy, pandas, psycopg2 |
| CI/CD | GitHub Actions |
| Deployment | Vercel |
| **Code generation** | **OpenAI Codex** |

---

## Full Technical Report & Build Log

- [`openai-codex.md`](./openai-codex.md) — chronological OpenAI Codex session log: every feature specified, generated, verified, and deployed, including the Hotspot Prioritization / Compare Cities builds and the full 18-city model retrain with before/after evidence.
- [`report.md`](./report.md) — schema design decisions, RLS policies, idempotency proofs, feature engineering rationale, CI/CD fix history, live data spot-checks.
- [`saanslive-hackathon-upgrade-plan.md`](./saanslive-hackathon-upgrade-plan.md) — the pre-build spec, written before any code was generated.

---

## Disclaimer

SaanSLive is a planning aid built on public sensor data, **not medical advice**. Forecasts are model estimates with published error bounds; always defer to official CPCB/SAFAR guidance for health decisions.

---

*Last updated: 2026-08-03*
