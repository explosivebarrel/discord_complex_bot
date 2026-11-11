import { useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  ListItemText,
  Typography,
} from "@mui/material";
import { IconMic as Mic } from "../components/icons";
import { useDeleteRecording, useRecordingTranscript, useRecordings } from "../queries";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { CardSkeleton } from "../components/Skeletons";
import type { TranscriptWord, VoiceRecordingInfo } from "../api";

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

const STATUS_CHIP: Record<VoiceRecordingInfo["status"], { label: string; color: string }> = {
  recording: { label: "Recording", color: "error.main" },
  queued: { label: "Queued", color: "text.secondary" },
  transcribing: { label: "Transcribing…", color: "warning.main" },
  done: { label: "Ready", color: "success.main" },
  failed: { label: "Failed", color: "text.disabled" },
};

function stamp(seconds: number): string {
  const s = Math.floor(seconds);
  return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

function WordSpan({ word }: { word: TranscriptWord }) {
  return (
    <Typography
      component="span"
      variant="body2"
      sx={{ display: "inline", color: "text.primary", cursor: "default" }}
      title={`${stamp(word.start)} – ${stamp(word.end)}`}
    >
      {word.w}{" "}
    </Typography>
  );
}

function Transcript({ guildId, id }: { guildId: string; id: number }) {
  const { data, isPending, error } = useRecordingTranscript(guildId, id);
  if (isPending) return <Typography variant="body2" sx={{ color: "text.secondary", px: 2 }}>Loading…</Typography>;
  if (error) return <Typography variant="body2" sx={{ color: "error.main", px: 2 }}>{(error as Error).message}</Typography>;
  if (data.length === 0)
    return <Typography variant="body2" sx={{ color: "text.secondary", px: 2 }}>No speech was detected in this recording.</Typography>;
  return (
    <List disablePadding sx={{ px: 2, pb: 1 }}>
      {data.map((seg, i) => (
        <ListItem key={i} disableGutters dense alignItems="flex-start">
          <Typography component="span" variant="caption" sx={{ color: "text.secondary", mt: "3px", width: 72, flexShrink: 0 }}>
            {stamp(seg.offset_s)}
          </Typography>
          <ListItemText
            primary={seg.username || `user ${seg.user_id}`}
            secondary={
              seg.words?.length ? (
                seg.words.map((w, j) => <WordSpan key={j} word={w} />)
              ) : (
                seg.text
              )
            }
            slotProps={{
              primary: { variant: "body2", sx: { fontWeight: 600, display: "inline", mr: 1 } },
              secondary: { variant: "body2", sx: { display: "inline", color: "text.primary" } },
            }}
          />
        </ListItem>
      ))}
    </List>
  );
}

function RecordingCard({ guildId, recording }: { guildId: string; recording: VoiceRecordingInfo }) {
  const [open, setOpen] = useState(false);
  const del = useDeleteRecording(guildId);
  const status = STATUS_CHIP[recording.status];
  const speakers = recording.speakers?.length ?? 0;
  return (
    <Card sx={{ mb: 2 }}>
      <CardContent sx={{ pb: open ? 0 : 2, "&:last-child": { pb: open ? 0 : 2 } }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <Mic sx={{ color: "primary.main", fontSize: 20 }} />
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body1" noWrap>
              #{recording.id} · {recording.title}
            </Typography>
            <Typography variant="caption" sx={{ color: "text.secondary" }}>
              {timeAgo(recording.started_at)}
              {speakers > 0 && ` · ${speakers} speaker(s)`}
            </Typography>
          </Box>
          <Chip
            size="small"
            label={status.label}
            sx={{ bgcolor: "action.hover", color: status.color, fontWeight: 600 }}
          />
        </Box>
        {recording.status === "failed" && recording.error && (
          <Typography variant="body2" sx={{ color: "text.secondary", mt: 1 }}>
            {recording.error}
          </Typography>
        )}
        {recording.status === "done" && (
          <Box sx={{ display: "flex", gap: 1, mt: 1.5, flexWrap: "wrap" }}>
            <Button size="small" onClick={() => setOpen(!open)}>
              {open ? "Hide transcript" : "Transcript"}
            </Button>
            <Button size="small" href={`/api/guilds/${guildId}/recordings/${recording.id}/download`}>
              txt
            </Button>
            <Button size="small" href={`/api/guilds/${guildId}/recordings/${recording.id}/download?fmt=srt`}>
              srt
            </Button>
            {recording.speakers?.map((sp) => (
              <Button
                key={sp.user_id}
                size="small"
                href={`/api/guilds/${guildId}/recordings/${recording.id}/audio/${sp.user_id}`}
              >
                audio: {sp.username}
              </Button>
            ))}
            <Button
              size="small"
              color="error"
              onClick={() => {
                if (window.confirm(`Delete recording #${recording.id} with its audio files?`)) {
                  del.mutate(recording.id);
                }
              }}
              disabled={del.isPending}
            >
              Delete
            </Button>
          </Box>
        )}
        {open && recording.status === "done" && <Transcript guildId={guildId} id={recording.id} />}
      </CardContent>
    </Card>
  );
}

export function RecordingsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const gid = guildId ?? "";
  const { me, loading } = useAuth();
  const { data, isPending, error } = useRecordings(gid);

  if (loading) {
    return (
      <AppShell me={me} back title="Recordings">
        <CardSkeleton />
      </AppShell>
    );
  }

  return (
    <AppShell me={me} back title="Recordings">
      {error && (
        <Typography variant="body2" sx={{ color: "error.main", mb: 2 }}>
          {(error as Error).message}
        </Typography>
      )}
      {isPending && <Box sx={{ maxWidth: 760 }}><CardSkeleton /></Box>}
      {data && (
        <Box sx={{ maxWidth: 760 }}>
          {data.length === 0 ? (
            <Card>
              <CardContent>
                <Typography variant="body2" sx={{ color: "text.secondary" }}>
                  No recordings yet. Start one with <code>/record start</code> in a voice channel —
                  every speaker gets their own track, and the transcript appears here.
                </Typography>
              </CardContent>
            </Card>
          ) : (
            data.map((r) => <RecordingCard key={r.id} guildId={gid} recording={r} />)
          )}
        </Box>
      )}
    </AppShell>
  );
}
