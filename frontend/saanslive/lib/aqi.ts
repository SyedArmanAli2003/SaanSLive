export type SeverityBand = {
    min: number;
    max: number; // inclusive upper bound, or Infinity
    label: string;
    color: string;
    areaColor: string; // Used for charts
};

export const AQI_SEVERITY_BANDS: SeverityBand[] = [
    { min: 0, max: 50, label: "Good", color: "#2e7d32", areaColor: "rgba(46,125,50,0.12)" }, // green
    { min: 51, max: 100, label: "Moderate", color: "#f2c94c", areaColor: "rgba(242,201,76,0.16)" }, // yellow
    {
        min: 101,
        max: 150,
        label: "Unhealthy for Sensitive Groups",
        color: "#f2994a",
        areaColor: "rgba(242,153,74,0.18)"
    }, // orange
    { min: 151, max: 200, label: "Unhealthy", color: "#eb5757", areaColor: "rgba(235,87,87,0.18)" }, // red
    { min: 201, max: 300, label: "Very Unhealthy", color: "#9b51e0", areaColor: "rgba(155,81,224,0.18)" }, // purple
    { min: 301, max: Infinity, label: "Hazardous", color: "#6b1b24", areaColor: "rgba(107,27,36,0.18)" }, // maroon
];

/**
 * Resolve an AQI value to its US EPA severity band.
 *
 * IMPORTANT — why the rounding is here and not at the call sites:
 *
 * The band table above uses INTEGER boundaries (...50 | 51...100 | 101...150 | ...)
 * because the EPA reports AQI as a whole number. The AQI values flowing through
 * this app are NOT whole numbers:
 *
 *   - `readings.aqi`            is stored as round(aqi, 2) by ingestion/ingest_readings.py
 *   - `forecasts.predicted_aqi` is raw XGBoost/LightGBM regression output
 *   - city averages in lib/data.ts divide a sum by a station count
 *
 * So values like 50.2, 100.3, 150.5 or 200.4 land in the 1-unit gap BETWEEN two
 * bands. Before this fix they matched no band at all and hit the
 * `?? AQI_SEVERITY_BANDS[last]` fallback, which is the Hazardous band — so a
 * perfectly Good AQI of 50.2 rendered as maroon "Hazardous" in every consumer
 * of this function (StationMap markers, ForecastChart, AdvisoryPanel,
 * HotspotPanel, CityComparisonView).
 *
 * Rounding to the nearest integer first — exactly how the EPA reports AQI —
 * closes every gap and keeps the published band table intact.
 */
export function getAqiBand(aqi: number): SeverityBand {
    // NaN / Infinity (e.g. Number(undefined) from a bad cast) has no meaningful
    // band. Fail toward the most cautious band rather than quietly telling
    // someone the air is "Good" based on a value we could not interpret.
    if (!Number.isFinite(aqi)) {
        return AQI_SEVERITY_BANDS[AQI_SEVERITY_BANDS.length - 1];
    }

    // AQI has no negative range; clamp rather than fall through to the fallback.
    const value = Math.round(Math.max(0, aqi));

    return (
        AQI_SEVERITY_BANDS.find((b) => value >= b.min && value <= b.max) ??
        AQI_SEVERITY_BANDS[AQI_SEVERITY_BANDS.length - 1]
    );
}
