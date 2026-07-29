"""
test_pm25_to_aqi.py — Regression tests for the US EPA PM2.5 → AQI conversion.

Why this file exists
--------------------
`_PM25_BREAKPOINTS` was originally transcribed straight from the published EPA
table, whose C_low values (12.1 / 35.5 / 55.5 / 150.5 / 250.5 / 350.5) assume
the input concentration has been TRUNCATED to one decimal place. OpenAQ returns
raw floats, so that transcription left six 0.1-wide dead zones where
`pm25_to_aqi()` returned None — and `parse_measurements_to_df()` then silently
discarded those rows via `dropna(subset=["aqi"])`. Real sensor readings were
lost with nothing in the logs.

The headline test here is `test_no_dead_zones_across_full_scale`, which sweeps
the whole scale and asserts that no valid concentration is ever unconvertible.

Run standalone:
    python ingestion/test_pm25_to_aqi.py

Or under pytest:
    pytest ingestion/test_pm25_to_aqi.py

Stdlib only — no new dependencies.
"""

from __future__ import annotations

import os
import sys
import unittest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

# ingest_readings imports pandas / requests / dotenv at module load. If the
# ingestion venv isn't installed we skip rather than fail for the wrong reason.
_IMPORT_ERROR: Exception | None = None
pm25_to_aqi = None
_PM25_BREAKPOINTS = None

try:  # pragma: no cover - environment dependent
    from ingest_readings import _PM25_BREAKPOINTS, pm25_to_aqi  # type: ignore
except Exception as exc:  # noqa: BLE001 - any import failure means "skip"
    _IMPORT_ERROR = exc


@unittest.skipIf(
    pm25_to_aqi is None,
    f"ingestion deps unavailable ({_IMPORT_ERROR}) — run pip install -r ingestion/requirements.txt",
)
class TestPm25ToAqi(unittest.TestCase):

    # ── the regression that mattered ─────────────────────────────────────────

    def test_no_dead_zones_across_full_scale(self):
        """
        No non-negative concentration up to the top of the scale may be
        unconvertible. Before the fix, 12.05 / 35.45 / 55.45 / 150.45 / 250.45 /
        350.45 µg/m³ all returned None and their rows were dropped.
        """
        unconvertible = []
        for i in range(0, 50041):        # 0.00 → 500.40 in 0.01 steps
            pm = i / 100.0
            if pm25_to_aqi(pm) is None:
                unconvertible.append(pm)

        self.assertEqual(
            unconvertible[:20],
            [],
            f"{len(unconvertible)} concentration(s) could not be converted to AQI; "
            f"first offenders: {unconvertible[:20]}",
        )

    def test_former_dead_zone_values_now_convert(self):
        """The six exact values that used to fall between breakpoint rows."""
        for pm in (12.05, 35.45, 55.45, 150.45, 250.45, 350.45):
            with self.subTest(pm25=pm):
                aqi = pm25_to_aqi(pm)
                self.assertIsNotNone(aqi, f"{pm} µg/m³ still returns None")
                self.assertGreater(aqi, 0)

    # ── published boundaries must not have moved ─────────────────────────────

    def test_published_boundary_values(self):
        """
        The EPA's documented breakpoint tops must still map to their documented
        AQI values — the fix must not have shifted the scale.
        """
        expected = {
            0.0: 0.0,
            12.0: 50.0,
            35.4: 100.0,
            55.4: 150.0,
            150.4: 200.0,
            250.4: 300.0,
            350.4: 400.0,
            500.4: 500.0,
        }
        for pm, aqi in expected.items():
            with self.subTest(pm25=pm):
                self.assertAlmostEqual(pm25_to_aqi(pm), aqi, places=2)

    def test_breakpoints_are_contiguous(self):
        """Each band's C_low must equal the previous band's C_high — that
        contiguity IS the fix, so assert the table keeps it."""
        for (prev_low, prev_high, _, _), (low, _, _, _) in zip(
            _PM25_BREAKPOINTS, _PM25_BREAKPOINTS[1:]
        ):
            self.assertAlmostEqual(
                low, prev_high, places=6,
                msg=f"gap between band ending {prev_high} and band starting {low}",
            )

    def test_monotonic_non_decreasing(self):
        """AQI must never go down as PM2.5 goes up."""
        previous = -1.0
        for i in range(0, 50041, 7):
            aqi = pm25_to_aqi(i / 100.0)
            self.assertIsNotNone(aqi)
            self.assertGreaterEqual(aqi, previous, f"AQI dropped at pm25={i / 100.0}")
            previous = aqi

    # ── edge cases ───────────────────────────────────────────────────────────

    def test_above_scale_is_capped_not_none(self):
        for pm in (500.41, 750.0, 10_000.0):
            with self.subTest(pm25=pm):
                self.assertEqual(pm25_to_aqi(pm), 500.0)

    def test_unusable_input_returns_none(self):
        for pm in (None, float("nan"), float("inf"), -0.1, -50.0, "abc"):
            with self.subTest(pm25=pm):
                self.assertIsNone(pm25_to_aqi(pm))

    def test_numeric_strings_are_accepted(self):
        self.assertAlmostEqual(pm25_to_aqi("12.0"), 50.0, places=2)


if __name__ == "__main__":
    unittest.main(verbosity=2)
