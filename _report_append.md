# _report_append.md — SYNCED

> This file has been fully merged into `report.md` (see sections §21–§25).
> It is kept here only as a marker. Do not add new content here — edit `report.md` directly.

Last synced: 2026-07-08 07:42 UTC

---

# LLM Context Handoff Summary

## Current Progress & Key Decisions
*   **Vercel Deployment Fixed**: The Next.js app is now properly building and auto-deploying from GitHub. The Vercel `rootDirectory` was successfully set to `frontend/saanslive` via the Vercel UI/API.
*   **End-to-End Backend Verification**: All Vercel environment variables (Supabase URL/Keys, Agent Token, NVIDIA NIM keys) are correctly configured. The DB, ML pipeline, Civic AQI Alert Agent, and LLM chatbot are all fully wired and operational in production (`https://saanslive.vercel.app`).
*   **Data Freshness & OpenAQ Investigation**: Investigated stale data (11-16h old) for specific stations (Ahmedabad Vatva, Chandigarh, Hyderabad). Queried OpenAQ v3 API directly and confirmed this is a **genuine upstream sensor gap**, not an ingestion bug. The frontend *Forecast Transparency* panel correctly and honestly reports this staleness with colored timestamps (amber/orange) and explanatory text.
*   **Git Branches Merged**: Cleaned up and merged `docs/codex-alignment`, `fix/aqi-banding-and-breakpoint-gaps`, and `qa/fix-aqi-band-gaps-and-latest-features` into `main`.
*   **AQI Fractional Banding Fixed**: Resolved fractional AQI misclassification (e.g., AQI 50.4 rendering as "Hazardous"). The fix in `frontend/saanslive/lib/aqi.ts` uses a gap-free `value <= b.max` approach without rounding. 
*   **ML Feature Backfilling Fixed**: In `model/features.py`, changed `.last()` to `.tail(1)` to correctly preserve `NaN`s for missing lagged features, preventing the model from silently backfilling stale data.

## Important Context & User Preferences
*   **Aesthetics & QA**: The user values high reliability and evidence-based verification. Always provide raw evidence (e.g., DB query results, direct API responses) rather than just stating conclusions.
*   **Agent Identity**: The Civic AQI Alert Agent advisory generation is deliberately deterministic (hardcoded translation template) for reliability, not an LLM call. This is documented in `HACKATHON.md`.
*   **Demo Considerations**: When recording a demo, use stations with genuinely fresh data (e.g., Delhi R K Puram, Mumbai Malad West) for the "happy path", but acknowledge the stale stations (e.g., Ahmedabad Vatva) as proof of the app's honest degradation capabilities.

## What Remains To Be Done (Clear Next Steps)
1.  **Mobile Layout QA**: Complete the remaining Mobile Layout QA tasks (390x844 viewport) which were previously queued but blocked by API quotas.
2.  **Ingestion Timeout Fix**: Address the `readings` ingestion timeout (`psycopg2.errors.QueryCanceled`) under high load. The Python script (`ingestion/ingest_readings.py`) needs chunking/batching optimizations for Supabase bulk inserts.
3.  **Final Demo Prep**: Guide the user through the final demo recording, ensuring they switch to a "fresh" station.

## Critical Data / References
*   **Live App URL**: `https://saanslive.vercel.app`
*   **OpenAQ API Key**: Managed via `.env` / GitHub Secrets. The pipeline uses v3 endpoints.
*   **Code Paths**: 
    *   Ingestion script: `ingestion/ingest_readings.py`
    *   Frontend AQI logic: `frontend/saanslive/lib/aqi.ts`
    *   ML Features logic: `model/features.py`
