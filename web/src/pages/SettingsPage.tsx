import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Link,
  Stack,
  TextField,
  Typography,
} from "@mui/material";
import { IconCancel as Cancel, IconCheckCircle as CheckCircle, IconError as ErrorOutline } from "../components/icons";
import { api } from "../api";
import { useIntegrations } from "../queries";
import { CardSkeleton } from "../components/Skeletons";
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
  const queryClient = useQueryClient();
  const infoQuery = useIntegrations();
  const info = infoQuery.data ?? null;
  const [error, setError] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState("");
  const [poToken, setPoToken] = useState("");
  const [visitorData, setVisitorData] = useState("");
  const [yandexToken, setYandexToken] = useState("");
  const [vkToken, setVkToken] = useState("");
  // VK direct auth: the password is used once for the token exchange and
  // never stored; a 2FA challenge reveals the code field.
  const [vkLogin, setVkLogin] = useState("");
  const [vkPassword, setVkPassword] = useState("");
  const [vkCode, setVkCode] = useState("");
  const [vkCodeNeeded, setVkCodeNeeded] = useState(false);
  const [vkSigning, setVkSigning] = useState(false);

  const guard = (e: Error) => {
    if (e.message !== "unauthorized") setError(e.message);
  };

  const refresh = () => void queryClient.invalidateQueries({ queryKey: ["integrations"] });

  const yt = info?.youtube;
  const ym = info?.yandexmusic;
  const vk = info?.vkmusic;

  if (loading) {
    return (
      <AppShell me={me} back title="Settings">
        <CardSkeleton />
        <Box sx={{ mt: 2 }}>
          <CardSkeleton />
        </Box>
      </AppShell>
    );
  }
  if (me && !me.is_superadmin) {
    return (
      <AppShell me={me} back title="Settings">
        <Typography variant="body2" sx={{ color: "error.main" }}>
          Super-admin only. Add your Discord ID to SUPERADMIN_IDS in .env.
        </Typography>
      </AppShell>
    );
  }

  return (
    <AppShell me={me} back title="Settings">
      {error && (
        <Typography variant="body2" sx={{ color: "error.main", mb: 2 }}>
          {error}
        </Typography>
      )}

      <Stack spacing={2} sx={{ maxWidth: 760 }}>
        <Card>
          <CardContent>
            <Typography variant="h6" gutterBottom>
              Developer sandbox
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 1.5 }}>
              A free-form canvas for testing UI effects in isolation — glass
              methods, backdrops, draggable test objects.
            </Typography>
            <Button variant="tonal" href="/sandbox">
              Open sandbox
            </Button>
          </CardContent>
        </Card>

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
                  text={`YouTube OAuth: ${(yt?.refresh_token_masked ?? "not configured").replace(/ \(\d+ chars\)$/, "")}`}
                />
                <StatusRow
                  ok={!!ym?.configured}
                  text={`Yandex Music: ${(ym?.token_masked ?? "not configured").replace(/ \(\d+ chars\)$/, "")}`}
                />
                <StatusRow
                  ok={!!vk?.configured}
                  text={`VK Music: ${(vk?.token_masked ?? "not configured").replace(/ \(\d+ chars\)$/, "")}`}
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
              (docker logs dcbot-lavalink) at{" "}
              <Link
                href="https://google.com/device"
                target="_blank"
                rel="noreferrer"
              >
                google.com/device
              </Link>
              , then paste the printed refresh token here.
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
              <Link
                href="https://oauth.yandex.ru/authorize?response_type=token&client_id=23cabbbdc6cd418abb4b39c32c41195d"
                target="_blank"
                rel="noreferrer"
              >
                oauth.yandex.ru/authorize
              </Link>
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
              VK Music access token
            </Typography>
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
              Recommended: sign in with the VK account below — the panel exchanges the credentials
              for an official-app token (audio-capable, and the one VK antifraid tolerates best).
              The password is used once for the exchange and never stored. With 2FA enabled you get
              a code prompt instead.{" "}
              {vk?.configured ? `Current: ${vk.token_masked}.` : "Currently not set."}
            </Typography>
            <Stack direction={{ xs: "column", sm: "row" }} spacing={1} sx={{ mb: 1 }}>
              <TextField
                fullWidth
                autoComplete="off"
                placeholder="VK login (phone or email)"
                value={vkLogin}
                onChange={(e) => setVkLogin(e.target.value)}
              />
              <TextField
                fullWidth
                type="password"
                autoComplete="new-password"
                placeholder="VK password"
                value={vkPassword}
                onChange={(e) => setVkPassword(e.target.value)}
              />
              {vkCodeNeeded && (
                <TextField
                  fullWidth
                  placeholder="Code from VK (SMS)"
                  value={vkCode}
                  onChange={(e) => setVkCode(e.target.value)}
                />
              )}
              <Button
                variant="contained"
                disabled={!vkLogin.trim() || !vkPassword || vkSigning}
                onClick={() => {
                  setVkSigning(true);
                  api
                    .vkAuth(vkLogin, vkPassword, vkCode)
                    .then((r) => {
                      feedback.show(r.note);
                      setVkLogin("");
                      setVkPassword("");
                      setVkCode("");
                      setVkCodeNeeded(false);
                      refresh();
                    })
                    .catch((e: Error & { status?: number }) => {
                      if (e.status === 428) setVkCodeNeeded(true);
                      guard(e);
                    })
                    .finally(() => setVkSigning(false));
                }}
              >
                {vkSigning ? <CircularProgress size={16} /> : "Sign in"}
              </Button>
            </Stack>
            <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
              Alternative (the old mobile-client OAuth trick): log into VK in this browser, open{" "}
              <Link
                href="https://oauth.vk.com/authorize?client_id=2685278&display=mobile&response_type=token&scope=audio&redirect_uri=https://oauth.vk.com/blank.html&v=5.199"
                target="_blank"
                rel="noreferrer"
              >
                this VK OAuth link
              </Link>
              , press Allow, then copy the <code>access_token=...</code> value from the blank-page
              address bar into the field below. This token type freezes accounts more often — use
              only on a spare account. Applied without a restart.
            </Typography>
            <Stack direction="row" spacing={1}>
              <TextField
                fullWidth
                placeholder="paste the access_token from the OAuth page"
                value={vkToken}
                onChange={(e) => setVkToken(e.target.value)}
              />
              <Button
                variant="contained"
                disabled={!vkToken.trim()}
                onClick={() =>
                  api
                    .updateVkToken(vkToken)
                    .then((r) => {
                      feedback.show(r.note);
                      setVkToken("");
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
