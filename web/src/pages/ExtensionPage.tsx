import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  IconButton,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { AppShell } from "../components/AppShell";
import { useAuth } from "../useAuth";
import { useFeedback } from "../components/Feedback";
import { MsIcon } from "../components/MsIcon";
import { api } from "../api";

/** Relative ids the list endpoint returns (12-char hash prefixes). */
function TokenRow({ id, label, created, lastUsed, onRevoke }: {
  id: string;
  label: string;
  created: string;
  lastUsed: string | null;
  onRevoke: () => void;
}) {
  return (
    <Stack direction="row" spacing={1.5} sx={{ alignItems: "center", py: 0.75 }}>
      <MsIcon name="key" fontSize={18} sx={{ color: "text.secondary" }} />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" noWrap>
          {label || "Userscript key"}
        </Typography>
        <Typography variant="caption" component="div" sx={{ color: "text.secondary" }} noWrap>
          {new Date(created).toLocaleDateString()}
          {lastUsed ? ` · last used ${new Date(lastUsed).toLocaleDateString()}` : " · never used"}
        </Typography>
      </Box>
      <Tooltip title="Revoke key">
        <IconButton size="small" onClick={onRevoke} aria-label={`Revoke key ${label || id}`}>
          <MsIcon name="delete" fontSize={18} />
        </IconButton>
      </Tooltip>
    </Stack>
  );
}

/** Install the "add tracks from platform pages" userscript: one install
    button (Tampermonkey intercepts .user.js links), one key per user, the
    script itself asks for the key once in its menu. */
export function ExtensionPage() {
  const { me } = useAuth();
  const feedback = useFeedback();
  const queryClient = useQueryClient();
  const [newKey, setNewKey] = useState<string | null>(null);
  const tokensQuery = useQuery({
    queryKey: ["apiTokens"],
    queryFn: () => api.listApiTokens(),
  });
  const tokens = tokensQuery.data ?? [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["apiTokens"] });
  const guard = (e: Error) => {
    if (e.message !== "unauthorized") feedback.show(e.message, "error");
  };
  const scriptUrl = `${location.origin}/extension/queue.user.js`;

  const createKey = () => {
    api
      .createApiToken("userscript")
      .then((r) => {
        setNewKey(r.token);
        refresh();
      })
      .catch(guard);
  };

  return (
    <AppShell me={me} back title="Add from sites">
      {feedback.node}
      {/* Same content column as About/Settings: capped width, card gap. */}
      <Stack spacing={2} sx={{ maxWidth: 760 }}>
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Tracks straight from the platform pages
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
            The userscript plugin adds a "＋ Queue" pill to YouTube, Yandex
            Music, SoundCloud and VK pages. Hover it for a panel with every
            track visible on the page; click a track to add it to the bot's
            queue. No platform tokens live on the server: the page you are
            logged into provides everything.
          </Typography>
          <Stack spacing={1.5} sx={{ mb: 2 }}>
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
              <Chip size="small" label="1" sx={{ flexShrink: 0, mt: 0.25 }} />
              <Typography variant="body2">
                Install a userscript manager —{" "}
                <a href="https://www.tampermonkey.net/" target="_blank" rel="noreferrer">
                  Tampermonkey
                </a>{" "}
                (Chrome, Edge, Firefox, Opera) or{" "}
                <a href="https://violentmonkey.github.io/" target="_blank" rel="noreferrer">
                  Violentmonkey
                </a>{" "}
                — if you don't have one. This is a browser extension that runs
                the plugin on the supported pages; the plugin itself is ours
                and comes from this server.
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
              <Chip size="small" label="2" sx={{ flexShrink: 0, mt: 0.25 }} />
              <Typography variant="body2">
                Click "Install userscript" below. Tampermonkey intercepts
                .user.js links and opens its own install page — press
                "Install" there. If nothing opens, open the Tampermonkey
                dashboard → Utilities → "Import from URL" and paste the same
                link. Updates are automatic: whenever the bot ships a new
                plugin version, Tampermonkey picks it up on its own.
              </Typography>
            </Box>
            <Box sx={{ pl: 5 }}>
              <Button component="a" href={scriptUrl} variant="contained" startIcon={<MsIcon name="download" fontSize={20} />}>
                Install userscript
              </Button>
            </Box>
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
              <Chip size="small" label="3" sx={{ flexShrink: 0, mt: 0.25 }} />
              <Typography variant="body2">
                Create a personal key below ("Create key") and copy it — it is
                shown exactly once. The key identifies you to the bot; treat
                it like a password, anyone holding it can queue tracks on your
                behalf (revoke it here anytime).
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
              <Chip size="small" label="4" sx={{ flexShrink: 0, mt: 0.25 }} />
              <Typography variant="body2">
                On any supported page, click the Tampermonkey toolbar icon →
                "Discord Queue: настройки" (settings) → paste the key and
                press OK, then pick the server from the list. Use this exact
                browser and profile — the key is stored per browser.
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "flex-start", gap: 1.5 }}>
              <Chip size="small" label="5" sx={{ flexShrink: 0, mt: 0.25 }} />
              <Typography variant="body2">
                Verify: Tampermonkey menu → "Discord Queue: проверить связь"
                (check connection) should report the server. Then play any
                track on YouTube / Yandex Music / VK and press the "＋ Queue"
                pill in the corner. Problems? The same menu has "Discord
                Queue: скопировать лог (текст)" — send the log when asking
                for help.
              </Typography>
            </Box>
          </Stack>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Known limits: VK queues as "listen now" — the direct stream link
            taken from the page lives for a few hours, so replays from history
            may ask you to add the track again; the mobile m.vk.ru player may
            refuse to yield links (desktop vk.ru is the reliable one).
            YouTube / Yandex Music / SoundCloud queue normally.
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
            <Typography variant="h6" sx={{ flex: 1 }}>
              My keys
            </Typography>
            <Button size="small" variant="tonal" onClick={createKey}>
              Create key
            </Button>
          </Stack>
          {newKey && (
            <Box
              onClick={() => {
                navigator.clipboard?.writeText(newKey);
                feedback.show("Key copied");
              }}
              sx={(t) => ({
                bgcolor: t.palette.m3.surfaceContainerHighest,
                borderRadius: 2,
                p: 1.5,
                mb: 1.5,
                cursor: "pointer",
                wordBreak: "break-all",
                fontFamily: "monospace",
                fontSize: 13,
              })}
            >
              {newKey}
              <Typography variant="caption" sx={{ color: "text.secondary", display: "block", mt: 0.5, fontFamily: "inherit" }}>
                Shown only once — copy it now (click to copy)
              </Typography>
            </Box>
          )}
          {tokens.length > 0 ? (
            <Box>
              {tokens.map((t) => (
                <TokenRow
                  key={t.id}
                  id={t.id}
                  label={t.label}
                  created={t.created_at}
                  lastUsed={t.last_used_at}
                  onRevoke={() => {
                    api.revokeApiToken(t.id).then(refresh).catch(guard);
                  }}
                />
              ))}
            </Box>
          ) : (
            !newKey && (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                No keys yet.
              </Typography>
            )
          )}
        </CardContent>
      </Card>
      </Stack>
    </AppShell>
  );
}
