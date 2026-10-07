import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Box, Button, Card, CardContent, MenuItem, Select, Stack, TextField, Typography } from "@mui/material";
import { api, PostChannel } from "../api";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { useFeedback } from "../components/Feedback";

export function PostsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const gid = guildId ?? "";
  const { me, loading } = useAuth();
  const feedback = useFeedback();
  const [channels, setChannels] = useState<PostChannel[]>([]);
  const [channelId, setChannelId] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const guard = (e: Error) => {
    if (e.message !== "unauthorized") setError(e.message);
  };

  const refresh = useCallback(() => {
    api
      .postChannels(gid)
      .then((ch) => {
        setChannels(ch);
        setSelectedOrDefault(ch);
      })
      .catch(guard);
  }, [gid]);

  const setSelectedOrDefault = (ch: PostChannel[]) => {
    setChannelId((current) => current || ch[0]?.id || "");
  };

  useEffect(refresh, [refresh]);

  const selected = channels.find((c) => c.id === channelId);
  const canSend = !!selected && text.trim().length > 0 && (!selected || selected.type !== "forum" || title.trim().length > 0);

  const publish = () => {
    if (!selected || !text.trim()) return;
    setSending(true);
    api
      .createPost(gid, {
        channel_id: selected.id,
        text: text.trim(),
        title: selected.type === "forum" ? title.trim() : undefined,
      })
      .then((r) => {
        feedback.show(r.result);
        setText("");
        setTitle("");
      })
      .catch(guard)
      .finally(() => setSending(false));
  };

  if (loading) {
    return (
      <AppShell me={me} back title="Posts">
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Loading…
        </Typography>
      </AppShell>
    );
  }

  return (
    <AppShell me={me} back title="Posts">
      <Typography variant="h5" sx={{ mb: 2 }}>
        Create a post
      </Typography>
      {error && (
        <Typography variant="body2" sx={{ color: "error.main", mb: 2 }}>
          {error}
        </Typography>
      )}
      <Card sx={{ maxWidth: 720 }}>
        <CardContent>
          <Stack spacing={2}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Select
                fullWidth
                size="small"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value as string)}
                displayEmpty
              >
                {channels.map((c) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.type === "forum" ? "🗂" : "#"} {c.name}
                    <Typography variant="caption" sx={{ color: "text.secondary", ml: 1 }}>
                      {c.type}
                    </Typography>
                  </MenuItem>
                ))}
              </Select>
            </Stack>
            {selected?.type === "forum" && (
              <TextField
                fullWidth
                size="small"
                label="Post title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
            )}
            <TextField
              fullWidth
              multiline
              minRows={5}
              label={selected?.type === "forum" ? "Post text" : "Message text"}
              value={text}
              onChange={(e) => setText(e.target.value)}
            />
            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="contained" disabled={!canSend || sending} onClick={publish}>
                {sending ? "Publishing…" : "Publish"}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
      {feedback.node}
    </AppShell>
  );
}
