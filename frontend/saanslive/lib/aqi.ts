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
 * Map an AQI value to its severity band.
 *
 * IMPORTANT — why this matches on `max` only.
 * The band bounds above are the integer US EPA breakpoints (0-50, 51-100,
 * 101-150, ...), so they leave open intervals BETWEEN bands: nothing covers
 * 50 < aqi < 51, 100 < aqi < 101, and so on. This used to match on
 * `aqi >= b.min && aqi <= b.max`, which meant any value in one of those gaps
 * matched no band at all and fell through to the `??` fallback — the LAST
 * band, i.e. "Hazardous" in maroon. A 50.4 AQI rendered as Hazardous.
 *
 * That was not an edge case: `forecasts.predicted_aqi` is stored rounded to
 * 4 decimals, and Compare Cities averages AQI across a city's stations, so
 * fractional AQI is the normal case throughout the app.
 *
 * Matching on the upper bound alone makes the bands gap-free by construction:
 * the first band whose `max` the value does not exceed is the correct band,
 * because the array is ordered ascending and the final band ends at Infinity.
 * The `min` fields are kept for display/legend use.
 */
export function getAqiBand(aqi: number): SeverityBand {
    // Non-finite input (NaN from a missing reading, ±Infinity) has no
    // meaningful band. Treat it as the bottom of the scale rather than
    // silently falling through to "Hazardous", and make it loud in dev.
    if (!Number.isFinite(aqi)) {
        if (process.env.NODE_ENV !== "production") {
            console.warn(`[getAqiBand] non-finite AQI (${aqi}); callers should guard null/NaN upstream`);
        }
        return AQI_SEVERITY_BANDS[0];
    }

    // AQI is defined from 0 up. Models can predict slightly below zero;
    // clamp rather than misclassifying it as off-the-scale hazardous.
    const value = Math.max(0, aqi);

    return (
        AQI_SEVERITY_BANDS.find((b) => value <= b.max) ??
        AQI_SEVERITY_BANDS[AQI_SEVERITY_BANDS.length - 1]
    );
}
