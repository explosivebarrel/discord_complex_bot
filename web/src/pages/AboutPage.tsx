import { type ReactNode, useEffect, useState } from "react";
import {
  Box,
  Card,
  CardContent,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  Tab,
  Tabs,
  Typography,
} from "@mui/material";
import { useSearchParams } from "react-router-dom";
import { IconCheckCircle, IconCancel, IconHelp } from "../components/icons";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { CardSkeleton } from "../components/Skeletons";
import { useAvailability, useSystemStatus } from "../queries";
import { useBotName } from "../useMeta";
import { AvailabilityCharts, SERVICE_LABELS } from "../components/AvailabilityCharts";
import { useStatusPalette } from "../components/statusColors";
import { BOT_VERSION, CHANGELOG } from "../changelog";

type Status = number | null;

function statusColor(value: Status, p: { down: string; degraded: string; up: string }): string {
  if (value === 2) return p.up;
  if (value === 1) return p.degraded;
  if (value === 0) return p.down;
  return "text.disabled";
}

function statusWord(value: Status): string {
  if (value === 2) return "operational";
  if (value === 1) return "degraded";
  if (value === 0) return "down";
  return "not configured";
}

function StatusRow({ label, value, palette }: { label: string; value: Status; palette: ReturnType<typeof useStatusPalette> }) {
  return (
    <ListItem disableGutters dense>
      <ListItemIcon sx={{ minWidth: 32 }}>
        {value === 2 ? (
          <IconCheckCircle fontSize={18} sx={{ color: statusColor(value, palette) }} />
        ) : value === null ? (
          <IconHelp fontSize={18} sx={{ color: statusColor(value, palette) }} />
        ) : (
          <IconCancel fontSize={18} sx={{ color: statusColor(value, palette) }} />
        )}
      </ListItemIcon>
      <ListItemText primary={label} slotProps={{ primary: { variant: "body2" } }} />
      <Typography variant="body2" sx={{ color: statusColor(value, palette) }}>
        {statusWord(value)}
      </Typography>
    </ListItem>
  );
}

function AvailabilityTab() {
  const [range, setRange] = useState("hour");
  const availability = useAvailability(range);
  const status = useSystemStatus();
  const palette = useStatusPalette();
  return (
    <Stack spacing={2}>
      {/* The range switch lives in its own card, status and charts follow
          as separate blocks — the Settings page card rhythm. */}
      <Card>
        <Tabs value={range} onChange={(_, v: string) => setRange(v)}>
          <Tab value="hour" label="Hour" />
          <Tab value="day" label="Day" />
          <Tab value="month" label="Month" />
        </Tabs>
      </Card>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Right now
          </Typography>
          {status.data ? (
            <Box>
              {Object.entries(status.data.statuses).map(([key, value]) => (
                <StatusRow key={key} label={SERVICE_LABELS[key] ?? key} value={value} palette={palette} />
              ))}
              <StatusRow label="Discord bot" value={status.data.bot_ready ? 2 : 0} palette={palette} />
            </Box>
          ) : (
            <Typography variant="body2" sx={{ color: "text.secondary" }}>
              No probe data yet — the monitor samples every minute.
            </Typography>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          {availability.isPending ? (
            <CardSkeleton height={220} />
          ) : availability.isError ? (
            <Typography variant="body2" sx={{ color: "error.main" }}>
              Availability data is unavailable: {(availability.error as Error).message}
            </Typography>
          ) : (
            <AvailabilityCharts data={availability.data} range={range} />
          )}
        </CardContent>
      </Card>
    </Stack>
  );
}

function AboutTab() {
  const botName = useBotName();
  const status = useSystemStatus();
  const ok = status.data?.bot_ready ?? false;
  return (
    <Stack spacing={1.5}>
      <Typography variant="body2">
        {botName} is a self-hosted Discord bot and this web panel: music playback with a queue,
        playlists and radio, per-guild statistics, message-driven posts and moderation tools.
        The panel talks straight to the bot process, so everything you see here reflects the
        live state of the machine it runs on.
      </Typography>
      <Typography variant="body2">
        Use the Availability tab to see how the bot and its dependencies (Discord, Lavalink,
        music sources) are doing right now and how reliable they have been over the last hour,
        day and month.
      </Typography>
      <Typography variant="body2" sx={{ display: "flex", alignItems: "center", gap: 1 }}>
        {ok ? "The bot is online." : "The bot is offline — check the Availability tab for details."}
      </Typography>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        Panel and bot version: {BOT_VERSION} — the history lives in the Changelog tab.
      </Typography>
    </Stack>
  );
}

// Draft terms: edit freely, the panel renders one paragraph per entry.
const TERMS: string[] = [
  "This service is provided as-is, on a best-effort basis. Availability, uptime and fitness for any particular purpose are not guaranteed; the status page reflects real measurements, not promises.",
  "The bot stores per-guild settings, playback history (track titles, authors and requester names), moderation warnings and your Discord id, username and avatar to run the panel. Nothing is sold or shared with third parties.",
  "Queued and played media comes from sources you or your guild members request. Do not use the bot to play or distribute content you have no right to use.",
  "Guild administrators control which panel sections their members can see and use. You are responsible for the content queued under your account and for the commands issued in your guilds.",
  "Abuse of the panel or the bot (spam, flooding sources, attempts to break access control) may lead to a ban from the panel or removal of the bot from a guild.",
];

function ChangelogTab() {
  return (
    <Stack spacing={2}>
      {CHANGELOG.map((block) => (
        <Card key={block.version}>
          <CardContent>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "baseline", mb: 1 }}>
              <Typography variant="h6" component="div">{block.version}</Typography>
              <Typography variant="caption" sx={{ color: "text.secondary" }}>
                {block.date}
              </Typography>
              <Typography
                variant="caption"
                component="a"
                href={`https://github.com/explosivebarrel/discord_complex_bot/commit/${block.commit}`}
                target="_blank"
                rel="noreferrer"
                sx={{ color: "text.secondary", fontFamily: "monospace", textDecoration: "none" }}
              >
                {block.commit}
              </Typography>
            </Stack>
            <Typography variant="body2" sx={{ fontWeight: 500, mb: 0.5 }}>{block.title}</Typography>
            <Stack spacing={0.5} sx={{ pl: 2 }}>
              {block.points.map((point, i) => (
                <Typography key={i} variant="body2" component="div" sx={{ display: "list-item", color: "text.secondary" }}>
                  {point}
                </Typography>
              ))}
            </Stack>
          </CardContent>
        </Card>
      ))}
    </Stack>
  );
}

function TermsTab() {
  return (
    <Stack spacing={1.5}>
      {TERMS.map((paragraph, i) => (
        <Typography key={i} variant="body2">
          {paragraph}
        </Typography>
      ))}
    </Stack>
  );
}

export function AboutPage() {
  const { me, loading } = useAuth();
  // The status chip deep-links the Availability tab (?tab=availability).
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState(() => (searchParams.get("tab") === "availability" ? 1 : 0));
  useEffect(() => {
    if (searchParams.get("tab") === "availability") setTab(1);
  }, [searchParams]);
  const selectTab = (v: number) => {
    setTab(v);
    setSearchParams(v === 1 ? { tab: "availability" } : {}, { replace: true });
  };
  // Left-aligned like the Settings page: the cards column hugs the
  // content column instead of floating centered.
  const shell = (children: ReactNode) => (
    <AppShell me={me} back title="About">
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        {/* The section switcher is a card of its own; the active tab's
            blocks follow next to it, not inside a wrapper card. */}
        <Card>
          <Tabs value={tab} onChange={(_, v: number) => selectTab(v)}>
            <Tab label="About" />
            <Tab label="Availability" />
            <Tab label="Changelog" />
            <Tab label="Terms" />
          </Tabs>
        </Card>
        {children}
      </Stack>
    </AppShell>
  );
  if (loading) {
    return shell(
      <Card>
        <CardContent>
          <CardSkeleton height={220} />
        </CardContent>
      </Card>,
    );
  }
  return shell(
    <>
      {tab === 0 && (
        <Card>
          <CardContent>
            <AboutTab />
          </CardContent>
        </Card>
      )}
      {tab === 1 && <AvailabilityTab />}
      {tab === 2 && <ChangelogTab />}
      {tab === 3 && (
        <Card>
          <CardContent>
            <TermsTab />
          </CardContent>
        </Card>
      )}
    </>,
  );
}
