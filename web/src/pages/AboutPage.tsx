import { type ReactNode, useState } from "react";
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
import { IconCheckCircle, IconCancel, IconHelp } from "../components/icons";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { CardSkeleton } from "../components/Skeletons";
import { useAvailability, useSystemStatus } from "../queries";
import { useBotName } from "../useMeta";
import { AvailabilityCharts, SERVICE_LABELS } from "../components/AvailabilityCharts";

type Status = number | null;

function statusColor(value: Status): string {
  if (value === 2) return "success.main";
  if (value === 1) return "warning.main";
  if (value === 0) return "error.main";
  return "text.disabled";
}

function statusWord(value: Status): string {
  if (value === 2) return "operational";
  if (value === 1) return "degraded";
  if (value === 0) return "down";
  return "not configured";
}

function StatusRow({ label, value }: { label: string; value: Status }) {
  return (
    <ListItem disableGutters dense>
      <ListItemIcon sx={{ minWidth: 32 }}>
        {value === 2 ? (
          <IconCheckCircle fontSize={18} sx={{ color: statusColor(value) }} />
        ) : value === null ? (
          <IconHelp fontSize={18} sx={{ color: statusColor(value) }} />
        ) : (
          <IconCancel fontSize={18} sx={{ color: statusColor(value) }} />
        )}
      </ListItemIcon>
      <ListItemText primary={label} slotProps={{ primary: { variant: "body2" } }} />
      <Typography variant="body2" sx={{ color: statusColor(value) }}>
        {statusWord(value)}
      </Typography>
    </ListItem>
  );
}

function AvailabilityTab() {
  const [range, setRange] = useState("hour");
  const availability = useAvailability(range);
  const status = useSystemStatus();
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
                <StatusRow key={key} label={SERVICE_LABELS[key] ?? key} value={value} />
              ))}
              <StatusRow label="Discord bot" value={status.data.bot_ready ? 2 : 0} />
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
  const [tab, setTab] = useState(0);
  // Left-aligned like the Settings page: the cards column hugs the
  // content column instead of floating centered.
  const shell = (children: ReactNode) => (
    <AppShell me={me} back title="About">
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        {/* The section switcher is a card of its own; the active tab's
            content follows in the next one. */}
        <Card>
          <Tabs value={tab} onChange={(_, v: number) => setTab(v)}>
            <Tab label="About" />
            <Tab label="Availability" />
            <Tab label="Terms" />
          </Tabs>
        </Card>
        <Card>
          <CardContent>{children}</CardContent>
        </Card>
      </Stack>
    </AppShell>
  );
  if (loading) return shell(<CardSkeleton height={220} />);
  return shell(
    <>
      {tab === 0 && <AboutTab />}
      {tab === 1 && <AvailabilityTab />}
      {tab === 2 && <TermsTab />}
    </>,
  );
}
