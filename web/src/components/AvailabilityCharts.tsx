import { Box, Stack, Typography, useTheme } from "@mui/material";
import type { AvailabilityResponse, AvailabilitySeries } from "../api";

export const SERVICE_LABELS: Record<string, string> = {
  discord_api: "Discord API",
  discord_gateway: "Discord bot",
  lavalink: "Lavalink",
  youtube: "YouTube",
  yandex: "Yandex Music",
  vk: "VK",
  radio: "Radio browser",
  archive: "Archive.org",
};

const GAP_HATCH = "repeating-linear-gradient(45deg, rgba(148,143,153,.4) 0 3px, transparent 3px 6px)";
// Before the first sample (and after the last one) there is nothing to
// report: the monitor was simply not running yet. Much lighter than a gap.
const YET_TRACK = "rgba(148,143,153,.14)";
// The dark theme's error.main is a pale blush — fine for text, but tiny
// down markers disappear among the green. Small marks need a saturated red.
export const DOWN_DARK = "#E5484D";

function segmentColor([up, degraded, down, na]: [number, number, number, number], dark: boolean): string | null {
  // No real samples at all = a gap (hatched). Only n/a = not configured.
  if (up + degraded + down === 0) return na > 0 ? "action.disabledBackground" : null;
  if (down > 0 && up === 0) return dark ? DOWN_DARK : "error.main";
  // Mixed outcomes or any degraded sample: the service was struggling.
  if (degraded > 0 || (down > 0 && up > 0)) return "warning.main";
  return "success.main";
}

function bucketTitle(range: string, values: [number, number, number, number, number]): string {
  const [ts, up, degraded, down, na] = values;
  const d = new Date(ts * 1000);
  const when =
    range === "month"
      ? d.toLocaleDateString()
      : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  if (up + degraded + down === 0) {
    return `${when} — ${na > 0 ? "not configured" : "no data (offline?)"}`;
  }
  return `${when} — up ${up}, degraded ${degraded}, down ${down}`;
}

function Strip({ range, series, dark }: { range: string; series: AvailabilitySeries; dark: boolean }) {
  // Zero-sample buckets before the first and after the last real sample
  // mean "not monitored yet", only the ones in between are true gaps
  // (the whole app was down) — they get the dense hatch.
  const first = series.values.findIndex((v) => v[1] + v[2] + v[3] + v[4] > 0);
  let last = -1;
  series.values.forEach((v, i) => {
    if (v[1] + v[2] + v[3] + v[4] > 0) last = i;
  });
  return (
    <Box
      sx={{
        display: "flex",
        gap: "1px",
        height: 16,
        minWidth: 0,
        // In the phone column layout a bare flex:1 makes the vertical main
        // axis start at basis 0 and the strip collapses; only the desktop
        // row parent should grow it horizontally.
        flex: { xs: "0 0 auto", sm: "1 1 0%" },
      }}
    >
      {series.values.map((values, index) => {
        const color = segmentColor([values[1], values[2], values[3], values[4]], dark);
        const yet = (index < first || index > last) && !color;
        return (
          <Box
            key={values[0]}
            title={bucketTitle(range, values)}
            sx={{
              flex: "1 1 0%",
              minWidth: 0,
              height: "100%",
              borderRadius: 0.5,
              ...(color
                ? { bgcolor: color }
                : yet
                  ? { bgcolor: YET_TRACK }
                  : { background: GAP_HATCH }),
            }}
          />
        );
      })}
    </Box>
  );
}

/** The overall availability as a step line: per bucket, the share of
    applicable services that were up or degraded. Zero-sample buckets are
    gaps the whole app was down for — hatched, line interrupted. */
function OverallSteps({ data }: { data: AvailabilityResponse }) {
  const w = 300;
  const h = 64;
  const values = data.overall.values;
  const n = values.length;
  const x = (i: number) => (n <= 1 ? 0 : (i / (n - 1)) * w);
  const y = (pct: number) => ((100 - pct) / 100) * h;

  type Pt = [number, number];
  const segments: Pt[][] = [];
  const gaps: { from: number; to: number }[] = [];
  let pts: Pt[] | null = null;
  let prevY = 0;
  let gapFrom: number | null = null;
  let firstIdx = -1;
  let lastIdx = -1;
  values.forEach(([, pct], i) => {
    if (pct != null) {
      if (firstIdx < 0) firstIdx = i;
      lastIdx = i;
    }
  });
  values.forEach(([, pct], i) => {
    const xi = x(i);
    if (pct == null) {
      if (pts) {
        segments.push(pts);
        pts = null;
      }
      // Zero buckets before/after the monitored span are "not yet",
      // only ones in between are true gaps.
      if (gapFrom == null && i > firstIdx && i <= lastIdx) gapFrom = xi;
      return;
    }
    if (gapFrom != null) {
      gaps.push({ from: gapFrom, to: xi });
      gapFrom = null;
    }
    const yi = y(pct);
    if (!pts) pts = [[xi, yi]];
    else pts.push([xi, prevY], [xi, yi]);
    prevY = yi;
  });
  if (pts) segments.push(pts);
  if (gapFrom != null && lastIdx >= 0) gaps.push({ from: gapFrom, to: x(lastIdx) });

  return (
    <svg
      viewBox={`0 0 ${w} ${h}`}
      preserveAspectRatio="none"
      style={{ width: "100%", height: 96, display: "block" }}
      aria-hidden
    >
      <defs>
        <pattern id="overall-gap" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
          <rect width="2.5" height="6" fill="rgba(148,143,153,.3)" />
        </pattern>
      </defs>
      <line x1="0" y1="0" x2={w} y2="0" stroke="rgba(148,143,153,.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      <line x1="0" y1={h} x2={w} y2={h} stroke="rgba(148,143,153,.35)" strokeWidth={1} vectorEffect="non-scaling-stroke" />
      {gaps.map((g, i) => (
        <rect key={i} x={g.from} y={0} width={Math.max(g.to - g.from, 1)} height={h} fill="url(#overall-gap)" />
      ))}
      {segments.map((pts, i) => (
        <path
          key={i}
          d={pts.map(([px, py], k) => `${k === 0 ? "M" : "L"} ${px} ${py}`).join(" ")}
          fill="none"
          stroke="#D0BCFF"
          strokeWidth={1.5}
          vectorEffect="non-scaling-stroke"
        />
      ))}
    </svg>
  );
}

/** Per-service uptime strips, the overall step chart and percentages. */
export function AvailabilityCharts({ data, range }: { data: AvailabilityResponse; range: string }) {
  const dark = useTheme().palette.mode === "dark";
  const legend: { label: string; style: Record<string, string> }[] = [
    { label: "operational", style: { bgcolor: "success.main" } },
    { label: "degraded / high load", style: { bgcolor: "warning.main" } },
    { label: "down", style: { bgcolor: dark ? DOWN_DARK : "error.main" } },
    { label: "not configured", style: { bgcolor: "action.disabledBackground" } },
    { label: "offline gap", style: { background: GAP_HATCH } },
    { label: "not monitored yet", style: { bgcolor: YET_TRACK } },
  ];
  return (
    <Box>
      <Typography variant="overline" sx={{ color: "text.secondary" }}>
        All services, %
      </Typography>
      <OverallSteps data={data} />
      <Stack spacing={1} sx={{ mt: 2 }}>
        {Object.entries(data.series).map(([key, series]) => {
          const pct = `${data.per_service[key]?.up_pct ?? "—"}%`;
          return (
            // Phones: the strip rides below the label row at full width;
            // sm and up keep the label | strip | percent line.
            <Stack
              key={key}
              spacing={0.5}
              direction={{ xs: "column", sm: "row" }}
              sx={{ alignItems: { sm: "center" } }}
            >
              {/* Phones: label left, percent right on one line, the strip
                  rides below at full width. */}
              <Stack direction="row" sx={{ alignItems: "baseline", width: "100%" }}>
                <Typography variant="body2" noWrap sx={{ color: "text.secondary", flex: 1, width: { sm: 120, xs: "auto" } }}>
                  {SERVICE_LABELS[key] ?? key}
                </Typography>
                <Typography
                  variant="body2"
                  sx={{ display: { xs: "inline", sm: "none" }, fontVariantNumeric: "tabular-nums" }}
                >
                  {pct}
                </Typography>
              </Stack>
              <Strip range={range} series={series} dark={dark} />
              <Typography
                variant="body2"
                sx={{
                  display: { xs: "none", sm: "inline" },
                  width: 52,
                  textAlign: "right",
                  flexShrink: 0,
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {pct}
              </Typography>
            </Stack>
          );
        })}
      </Stack>
      {/* Plain CSS gap instead of Stack spacing: Stack's negative margins
          indent every wrapped legend line. */}
      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          columnGap: 1.5,
          rowGap: 0.5,
          mt: 1.5,
          alignItems: "center",
        }}
      >
        {legend.map((item) => (
          <Stack key={item.label} direction="row" spacing={0.5} sx={{ alignItems: "center" }}>
            <Box sx={{ width: 10, height: 10, borderRadius: 0.5, ...item.style }} />
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {item.label}
            </Typography>
          </Stack>
        ))}
      </Box>
    </Box>
  );
}
