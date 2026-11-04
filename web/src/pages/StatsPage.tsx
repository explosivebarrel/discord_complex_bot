import { useParams } from "react-router-dom";
import { Box, Card, CardContent, List, ListItem, ListItemText, Typography } from "@mui/material";
import { IconBarChart as BarChart } from "../components/icons";
import { useGuildStats } from "../queries";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { CardSkeleton, RowsSkeleton } from "../components/Skeletons";
import { SOURCE_LABELS } from "../components/player/labels";

function timeAgo(iso: string): string {
  // SQLite stores naive UTC; the api returns it without a zone suffix.
  const then = new Date(iso.endsWith("Z") ? iso : `${iso}Z`).getTime();
  const diff = Math.max(0, Date.now() - then);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

function StatTile({ label, value, unit }: { label: string; value: number; unit?: string }) {
  return (
    <Card sx={{ flex: 1, minWidth: 130 }}>
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="h4" sx={{ fontWeight: 500 }} component="span">
          {value}
          {unit && (
            <Typography component="span" variant="body2" sx={{ color: "text.secondary", ml: 0.5 }}>
              {unit}
            </Typography>
          )}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {label}
        </Typography>
      </CardContent>
    </Card>
  );
}

/** Horizontal bar list shared by the "by source" and "top artists" cards. */
function BarList({ rows, label }: { rows: { key: string; label: string; plays: number }[]; label: string }) {
  const max = Math.max(...rows.map((r) => r.plays), 1);
  return (
    <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
      {rows.map((r) => (
        <Box key={r.key}>
          <Box sx={{ display: "flex", justifyContent: "space-between", mb: 0.25 }}>
            <Typography variant="body2" noWrap sx={{ pr: 1 }}>
              {r.label}
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", flexShrink: 0 }}>
              {r.plays}
            </Typography>
          </Box>
          <Box sx={{ height: 6, borderRadius: 999, bgcolor: "action.hover", overflow: "hidden" }}>
            <Box
              sx={{
                width: `${(r.plays / max) * 100}%`,
                height: "100%",
                borderRadius: 999,
                bgcolor: "primary.main",
              }}
            />
          </Box>
        </Box>
      ))}
      {rows.length === 0 && (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {label}
        </Typography>
      )}
    </Box>
  );
}

export function StatsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const gid = guildId ?? "";
  const { me, loading } = useAuth();
  const { data: stats, isPending, error } = useGuildStats(gid);

  if (loading) {
    return (
      <AppShell me={me} back title="Stats">
        <CardSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell me={me} back title="Stats">
      {error && (
        <Typography variant="body2" sx={{ color: "error.main", mb: 2 }}>
          {(error as Error).message}
        </Typography>
      )}
      {isPending && (
        <Box sx={{ maxWidth: 760 }}>
          <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
            <CardSkeleton height={40} />
            <CardSkeleton height={40} />
            <CardSkeleton height={40} />
          </Box>
          <CardSkeleton />
          <Box sx={{ mt: 2 }}>
            <RowsSkeleton rows={5} />
          </Box>
        </Box>
      )}
      {stats && (
        <Box sx={{ maxWidth: 760 }}>
          <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
            <StatTile label="plays, last 30 days" value={stats.totals.plays_30d} />
            <StatTile label="unique tracks" value={stats.totals.unique_tracks} />
            <StatTile label="listening, 30 days" value={stats.totals.minutes_30d} unit="min" />
            <StatTile label="plays, all time" value={stats.totals.plays_total} />
            <StatTile label="listening, all time" value={stats.totals.minutes_total} unit="min" />
          </Box>

          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Top tracks (30 days)
              </Typography>
              {stats.top_tracks.length === 0 ? (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Nothing played yet.
                </Typography>
              ) : (
                <List disablePadding>
                  {stats.top_tracks.map((t, i) => (
                    <ListItem key={`${t.title}-${i}`} disableGutters dense>
                      <ListItemText
                        primary={`${i + 1}. ${t.title}`}
                        secondary={t.author}
                        slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                      />
                      <BarChart sx={{ color: "primary.main", fontSize: 20, mr: 1 }} />
                      <Typography variant="body2">{t.plays}</Typography>
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>

          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Who requests music (30 days)
              </Typography>
              {stats.top_requesters.length === 0 ? (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Nobody yet.
                </Typography>
              ) : (
                <List disablePadding>
                  {stats.top_requesters.map((r, i) => (
                    <ListItem key={`${r.name}-${i}`} disableGutters dense>
                      <ListItemText primary={`${i + 1}. ${r.name}`} />
                      <Typography variant="body2">{r.plays}</Typography>
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>

          <Box sx={{ display: "flex", gap: 2, mb: 2, flexDirection: { xs: "column", md: "row" } }}>
            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  By source (30 days)
                </Typography>
                <BarList
                  rows={stats.by_source.map((r) => ({
                    key: r.source,
                    label: SOURCE_LABELS[r.source] ?? r.source,
                    plays: r.plays,
                  }))}
                  label="Nothing played yet."
                />
              </CardContent>
            </Card>
            <Card sx={{ flex: 1 }}>
              <CardContent>
                <Typography variant="h6" gutterBottom>
                  Top artists (30 days)
                </Typography>
                <BarList
                  rows={stats.top_authors.map((a) => ({ key: a.author, label: a.author, plays: a.plays }))}
                  label="Nothing played yet."
                />
              </CardContent>
            </Card>
          </Box>

          <Card sx={{ mb: 2 }}>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Activity (30 days)
              </Typography>
              {stats.by_day.length === 0 ? (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  Nothing played yet.
                </Typography>
              ) : (
                <Box sx={{ display: "flex", alignItems: "flex-end", gap: 0.5, height: 80 }}>
                  {stats.by_day.map((d) => {
                    const max = Math.max(...stats.by_day.map((x) => x.plays), 1);
                    return (
                      <Box
                        key={d.day}
                        title={`${d.day}: ${d.plays} play(s)`}
                        sx={{
                          flex: 1,
                          height: `${Math.max((d.plays / max) * 100, 6)}%`,
                          minHeight: 6,
                          borderRadius: "3px 3px 0 0",
                          bgcolor: "primary.main",
                          opacity: 0.85,
                        }}
                      />
                    );
                  })}
                </Box>
              )}
              {stats.by_day.length > 0 && (
                <Typography variant="caption" sx={{ color: "text.secondary" }}>
                  {stats.by_day[0].day} — {stats.by_day[stats.by_day.length - 1].day}
                </Typography>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Recently played
              </Typography>
              {stats.recent.length === 0 ? (
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  The history is empty.
                </Typography>
              ) : (
                <List disablePadding>
                  {stats.recent.map((r, i) => (
                    <ListItem key={i} disableGutters dense>
                      <ListItemText
                        primary={r.title}
                        secondary={[r.author, r.requested_by].filter(Boolean).join(" · ")}
                        slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                      />
                      <Typography variant="caption" sx={{ color: "text.secondary", flexShrink: 0, ml: 1 }}>
                        {timeAgo(r.played_at)}
                      </Typography>
                    </ListItem>
                  ))}
                </List>
              )}
            </CardContent>
          </Card>
        </Box>
      )}
    </AppShell>
  );
}
