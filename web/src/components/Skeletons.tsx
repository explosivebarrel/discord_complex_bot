import { Box, Card, CardContent, Skeleton, Stack } from "@mui/material";

/** One MD3 card-shaped placeholder: title line plus two body lines. */
export function CardSkeleton({ height }: { height?: number | string }) {
  return (
    <Card>
      <CardContent>
        <Skeleton width="38%" height={28} sx={{ mb: 1.5 }} />
        <Skeleton width="82%" />
        <Skeleton width="58%" />
        {height !== undefined && <Skeleton width="100%" height={height} sx={{ mt: 1.5 }} />}
      </CardContent>
    </Card>
  );
}

/** A stack of list-row placeholders: avatar square plus two text lines. */
export function RowsSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <Stack spacing={1.25}>
      {Array.from({ length: rows }, (_, i) => (
        <Box key={i} sx={{ display: "flex", gap: 2, py: 0.75 }}>
          <Skeleton variant="rounded" width={40} height={40} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Skeleton width={`${72 - (i % 3) * 9}%`} />
            <Skeleton width={`${42 + (i % 2) * 12}%`} />
          </Box>
        </Box>
      ))}
    </Stack>
  );
}

/** Player page placeholder mimicking the real two-column layout. */
export function PlayerPageSkeleton() {
  return (
    <Stack direction={{ xs: "column", lg: "row" }} spacing={2} sx={{ alignItems: "flex-start" }}>
      <Stack spacing={2} sx={{ flex: 1, minWidth: 0, width: "100%" }}>
        <CardSkeleton />
        <CardSkeleton />
        <CardSkeleton />
      </Stack>
      <Stack spacing={2} sx={{ width: { xs: "100%", lg: 340 }, flexShrink: 0, minWidth: 0 }}>
        <CardSkeleton height={44} />
        <CardSkeleton height={180} />
      </Stack>
    </Stack>
  );
}
