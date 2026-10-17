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
    <Box sx={{ display: "grid", gridTemplateColumns: { xs: "1fr", lg: "3fr 2fr" }, gap: 2, alignItems: "start" }}>
      <Stack spacing={2}>
        <CardSkeleton />
        <CardSkeleton />
      </Stack>
      <Stack spacing={2}>
        <CardSkeleton />
        <CardSkeleton height={140} />
      </Stack>
    </Box>
  );
}
