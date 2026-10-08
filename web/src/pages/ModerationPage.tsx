import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Select,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import Gavel from "@mui/icons-material/Gavel";
import { api, ModerationAction, ModerationWarning } from "../api";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { useFeedback } from "../components/Feedback";

const DURATIONS: { label: string; minutes: number }[] = [
  { label: "10 minutes", minutes: 10 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
  { label: "6 hours", minutes: 360 },
  { label: "1 day", minutes: 1440 },
  { label: "7 days", minutes: 10080 },
  { label: "28 days", minutes: 40320 },
];

function timeAgo(iso: string): string {
  const then = new Date(iso.endsWith("Z") ? iso : `${iso}Z`).getTime();
  const minutes = Math.max(0, Math.floor((Date.now() - then) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function ModerationPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const gid = guildId ?? "";
  const { me, loading } = useAuth();
  const feedback = useFeedback();
  const [users, setUsers] = useState<{ id: string; name: string }[]>([]);
  const [warnings, setWarnings] = useState<ModerationWarning[]>([]);
  const [log, setLog] = useState<ModerationAction[]>([]);
  const [canAct, setCanAct] = useState(false);
  const [action, setAction] = useState<"timeout" | "kick" | "ban">("timeout");
  const [userId, setUserId] = useState("");
  const [minutes, setMinutes] = useState(10);
  const [reason, setReason] = useState("");
  const [applying, setApplying] = useState(false);

  const guard = (e: Error) => {
    if (e.message !== "unauthorized") feedback.show(e.message, "error");
  };

  const refresh = useCallback(() => {
    api
      .moderationUsers(gid)
      .then((u) => {
        setUsers(u);
        setSelectedOrDefault(u);
      })
      .catch(guard);
    api
      .moderationWarnings(gid)
      .then(setWarnings)
      .catch(guard);
    api
      .moderationLog(gid)
      .then(setLog)
      .catch(guard);
    // The access endpoint answers 403 for visitors without section access;
    // admins get can_act=true, everyone-level viewers false.
    fetch(`/api/guilds/${gid}/moderation/access`)
      .then((r) => (r.ok ? r.json() : { can_act: false }))
      .then((j) => setCanAct(!!j.can_act))
      .catch(() => setCanAct(false));
  }, [gid]);

  const setSelectedOrDefault = (u: { id: string; name: string }[]) => {
    setUserId((current) => current || u[0]?.id || "");
  };

  useEffect(refresh, [refresh]);

  const apply = () => {
    if (!userId.trim()) return;
    setApplying(true);
    api
      .moderationAction(gid, action, {
        user_id: userId.trim(),
        reason: reason.trim(),
        minutes: action === "timeout" ? minutes : undefined,
      })
      .then((r) => {
        feedback.show(`Done: ${Object.values(r)[0]}`);
        setReason("");
        refresh();
      })
      .catch(guard)
      .finally(() => setApplying(false));
  };

  if (loading) {
    return (
      <AppShell me={me} back title="Moderation">
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Loading…
        </Typography>
      </AppShell>
    );
  }

  return (
    <AppShell me={me} back title="Moderation">
      <Typography variant="h5" sx={{ mb: 2 }}>
        Moderation
      </Typography>
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        {canAct && (
          <Card>
            <CardContent>
              <Typography variant="h6" gutterBottom>
                Apply action
              </Typography>
              <Stack spacing={1.5}>
                <Stack direction={{ xs: "column", sm: "row" }} spacing={1.5}>
                  <Select size="small" value={action} onChange={(e) => setAction(e.target.value as typeof action)}>
                    <MenuItem value="timeout">Timeout</MenuItem>
                    <MenuItem value="kick">Kick</MenuItem>
                    <MenuItem value="ban">Ban</MenuItem>
                  </Select>
                  <Select
                    fullWidth
                    size="small"
                    value={users.some((u) => u.id === userId) ? userId : ""}
                    onChange={(e) => setUserId(e.target.value as string)}
                    displayEmpty
                  >
                    <MenuItem value="">
                      <em>Pick a known user…</em>
                    </MenuItem>
                    {users.map((u) => (
                      <MenuItem key={u.id} value={u.id}>
                        {u.name}
                      </MenuItem>
                    ))}
                  </Select>
                </Stack>
                <TextField
                  fullWidth
                  size="small"
                  label="User ID (if not in the list)"
                  value={userId}
                  onChange={(e) => setUserId(e.target.value)}
                />
                {action === "timeout" && (
                  <Select size="small" value={minutes} onChange={(e) => setMinutes(e.target.value as number)}>
                    {DURATIONS.map((d) => (
                      <MenuItem key={d.minutes} value={d.minutes}>
                        {d.label}
                      </MenuItem>
                    ))}
                  </Select>
                )}
                <TextField
                  fullWidth
                  size="small"
                  label="Reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
                  <Button variant="contained" startIcon={<Gavel />} disabled={applying || !userId.trim()} onClick={apply}>
                    {applying ? "Applying…" : `Apply ${action}`}
                  </Button>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Warnings
            </Typography>
            {warnings.length === 0 ? (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                No warnings on this server yet.
              </Typography>
            ) : (
              <List disablePadding>
                {warnings.slice(0, 20).map((w) => (
                  <ListItem key={w.id} disableGutters dense>
                    <ListItemText
                      primary={`${w.user_name} — ${w.reason}`}
                      secondary={`by ${w.issuer_name} · ${timeAgo(w.created_at)}`}
                      slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                    />
                  </ListItem>
                ))}
              </List>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Recent actions
            </Typography>
            {log.length === 0 ? (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Nothing logged yet.
              </Typography>
            ) : (
              <List disablePadding>
                {log.map((a, i) => {
                  const target = String((a.details as { user_id?: string }).user_id ?? "");
                  return (
                    <ListItem key={i} disableGutters dense>
                      <ListItemText
                        primary={`${a.action.replace("moderation.", "")} → ${target}`}
                        secondary={timeAgo(a.created_at)}
                        slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
                      />
                    </ListItem>
                  );
                })}
              </List>
            )}
          </CardContent>
        </Card>
      </Stack>
      {feedback.node}
    </AppShell>
  );
}
