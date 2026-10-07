import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Card, CardContent, List, ListItem, ListItemText, Typography } from "@mui/material";
import BarChart from "@mui/icons-material/BarChart";
import { api, GuildStats } from "../api";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";

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

function StatTile({ label, value }: { label: string; value: number }) {
  return (
    <Card sx={{ flex: 1 }}>
      <CardContent sx={{ py: 1.5, "&:last-child": { pb: 1.5 } }}>
        <Typography variant="h4" sx={{ fontWeight: 500 }}>
          {value}
        </Typography>
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          {label}
        </Typography>
      </CardContent>
    </Card>
  );
}

export function StatsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const gid = guildId ?? "";
  const { me, loading } = useAuth();
  const [stats, setStats] = useState<GuildStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    api
      .guildStats(gid)
      .then(setStats)
      .catch((e: Error) => setError(e.message));
  }, [gid]);

  useEffect(refresh, [refresh]);

  if (loading) {
    return (
      <AppShell me={me} back title="Stats">
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Loading…
        </Typography>
      </AppShell>
    );
  }

  return (
    <AppShell me={me} back title="Stats">
      <Typography variant="h5" sx={{ mb: 2 }}>
        Server statistics
      </Typography>
      {error && (
        <Typography variant="body2" sx={{ color: "error.main", mb: 2 }}>
          {error}
        </Typography>
      )}
      {stats && (
        <Box sx={{ maxWidth: 760, mx: "auto" }}>
          <Box sx={{ display: "flex", gap: 2, mb: 2, flexWrap: "wrap" }}>
            <StatTile label="plays, last 30 days" value={stats.totals.plays_30d} />
            <StatTile label="unique tracks" value={stats.totals.unique_tracks} />
            <StatTile label="plays, all time" value={stats.totals.plays_total} />
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
                      <BarChart sx={{ color: "primary.main", fontSize: 18, mr: 1 }} />
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
