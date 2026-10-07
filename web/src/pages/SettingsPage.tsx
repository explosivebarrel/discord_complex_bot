import { useCallback, useEffect, useState } from "react";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import CheckCircle from "@mui/icons-material/CheckCircle";
import Cancel from "@mui/icons-material/Cancel";
import ErrorOutline from "@mui/icons-material/Error";
import { api, Integrations } from "../api";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { useFeedback } from "../components/Feedback";

function StatusRow({ ok, text }: { ok: boolean; text: string }) {
  return (
    <ListItem disableGutters dense>
      <ListItemIcon sx={{ minWidth: 34 }}>
        {ok ? <CheckCircle sx={{ color: "success.main" }} /> : <Cancel sx={{ color: "error.main" }} />}
      </ListItemIcon>
      <ListItemText primary={text} slotProps={{ primary: { variant: "body2" } }} />
    </ListItem>
  );
}

export function SettingsPage() {
  const { me, loading } = useAuth();
  const feedback = useFeedback();
  const [info, setInfo] = useState<Integrations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState("");
  const [poToken, setPoToken] = useState("");
  const [visitorData, setVisitorData] = useState("");
  const [yandexToken, setYandexToken] = useState("");

  const guard = (e: Error) => {
    if (e.message !== "unauthorized") setError(e.message);
  };

  const refresh = useCallback(() => {
    api
      .integrations()
      .then(setInfo)
      .catch(guard);
  }, []);

  useEffect(refresh, [refresh]);

  const yt = info?.youtube;
  const ym = info?.yandexmusic;

  if (loading) {
    return (
      <AppShell me={me} title="Settings">
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Loading…
        </Typography>
      </AppShell>
    );
  }
  if (me && !me.is_superadmin) {
    return (
      <AppShell me={me} title="Settings">
        <Typography variant="body2" sx={{ color: "error.main" }}>
          Super-admin only. Add your Discord ID to SUPERADMIN_IDS in .env.
        </Typography>
      </AppShell>
    );
  }

  return (
    <AppShell me={me} title="Settings">
      <Typography variant="h5" sx={{ mb: 2 }}>
        System settings
      </Typography>
      {error && (
        <Typography variant="body2" sx={{ color: "error.main", mb: 2 }}>
          {error}
        </Typography>
      )}

      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Integrations
            </Typography>
            {info ? (
              <List disablePadding>
                <StatusRow
                  ok={info.discord.ready}
                  text={`Discord bot: ${info.discord.user ?? "?"} · ${info.discord.guilds} guild(s)`}
                />
                <StatusRow
                  ok={info.lavalink.connected}
                  text={`Lavalink ${info.lavalink.host}: ${info.lavalink.connected ? "connected" : "offline"} · ${info.lavalink.players} player(s)`}
                />
                <StatusRow
                  ok={!!yt?.oauth_configured}
                  text={`YouTube OAuth: ${yt?.refresh_token_masked ?? "not configured"}`}
                />
                <StatusRow
                  ok={!!ym?.configured}
                  text={`Yandex Music: ${ym?.token_masked ?? "not configured"}`}
                />
              </List>
            ) : (
              <Typography variant="body2" sx={{ color: "text.secondary" }}>
                Loading…
              </Typography>
            )}
            {yt?.last_error && (
              <Box sx={{ mt: 1.5, display: "flex", alignItems: "center", gap: 1 }}>
                <ErrorOutline sx={{ color: "error.main" }} />
                <Typography variant="body2" sx={{ color: "error.main", flex: 1, minWidth: 0 }} noWrap>
                  {yt.last_error.message}
                </Typography>
                <Button size="small" onClick={() => api.clearYoutubeLastError().then(refresh).catch(guard)}>
                  Clear
                </Button>
              </Box>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              YouTube OAuth refresh token
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
              Playback needs a Google account token. Run Lavalink without a token, open the login URL from its logs
              (docker logs dcbot-lavalink) at google.com/device, then paste the printed refresh token here.
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                placeholder="1//0… (paste a new refresh token, leave empty to keep)"
                value={refreshToken}
                onChange={(e) => setRefreshToken(e.target.value)}
              />
              <Button
                variant="contained"
                disabled={!refreshToken.trim()}
                onClick={() =>
                  api
                    .updateYoutubeConfig({ refresh_token: refreshToken })
                    .then((r) => {
                      feedback.show(`Saved. OAuth: ${r.refresh_token_masked}`);
                      setRefreshToken("");
                      refresh();
                    })
                    .catch(guard)
                }
              >
                Save
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Yandex Music access token
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
              Needs a Yandex account with Plus. Open{" "}
              <a
                href="https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d"
                target="_blank"
                rel="noreferrer"
                style={{ color: "#D0BCFF" }}
              >
                oauth.yandex.ru/authorize
              </a>
              , log in, grant access, then copy <code>access_token</code> from the redirect URL (it flashes by).
              Current: {ym?.configured ? ym.token_masked : "not set"}.
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                placeholder="y0_AgAAA… paste the access token"
                value={yandexToken}
                onChange={(e) => setYandexToken(e.target.value)}
              />
              <Button
                variant="contained"
                disabled={!yandexToken.trim()}
                onClick={() =>
                  api
                    .updateYandexToken(yandexToken)
                    .then((r) => {
                      feedback.show(r.note);
                      setYandexToken("");
                      refresh();
                    })
                    .catch(guard)
                }
              >
                Save
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              YouTube POT (proof of origin)
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
              Optional anti-bot tokens for the WEB clients (youtube-trusted-session-generator). Applied without a
              restart. {yt?.pot_saved_in_db ? "A pair is saved." : ""}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1}>
              <TextField
                fullWidth
                placeholder="poToken"
                value={poToken}
                onChange={(e) => setPoToken(e.target.value)}
              />
              <TextField
                fullWidth
                placeholder="visitorData"
                value={visitorData}
                onChange={(e) => setVisitorData(e.target.value)}
              />
              <Button
                variant="contained"
                disabled={!poToken.trim() || !visitorData.trim()}
                onClick={() =>
                  api
                    .updateYoutubeConfig({ po_token: poToken, visitor_data: visitorData })
                    .then(() => {
                      feedback.show("POT saved");
                      setPoToken("");
                      setVisitorData("");
                      refresh();
                    })
                    .catch(guard)
                }
              >
                Save
              </Button>
            </Stack>
          </CardContent>
        </Card>

        <Box>
          <Chip
            size="small"
            label="Super-admin page: IDs in SUPERADMIN_IDS (.env)"
            sx={{ color: "text.secondary" }}
          />
        </Box>
      </Stack>
      {feedback.node}
    </AppShell>
  );
}
