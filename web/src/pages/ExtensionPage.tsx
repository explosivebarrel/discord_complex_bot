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
          {lastUsed ? ` · использован ${new Date(lastUsed).toLocaleDateString()}` : " · ещё не использовался"}
        </Typography>
      </Box>
      <Tooltip title="Отозвать ключ">
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
      <Card>
        <CardContent>
          <Typography variant="h6" gutterBottom>
            Tracks straight from the platform pages
          </Typography>
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 2 }}>
            Плагин-юзерскрипт добавляет кнопку «＋ Queue» на страницы YouTube,
            Яндекс.Музыки, SoundCloud и VK. Один клик — трек в очереди бота.
            Никаких токенов площадок на сервере: страница, на которой вы
            авторизованы, сама даёт всё необходимое.
          </Typography>
          <Stack spacing={1.5} sx={{ mb: 2 }}>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Chip size="small" label="1" sx={{ flexShrink: 0 }} />
              <Typography variant="body2">
                Поставьте{" "}
                <a href="https://www.tampermonkey.net/" target="_blank" rel="noreferrer">
                  Tampermonkey
                </a>{" "}
                (или Violentmonkey), если ещё нет.
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Chip size="small" label="2" sx={{ flexShrink: 0 }} />
              <Typography variant="body2">
                Нажмите «Установить» — откроется страница Tampermonkey с плагином. Он
                обновляется сам при новых версиях бота.
              </Typography>
            </Box>
            <Box sx={{ pl: 5 }}>
              <Button component="a" href={scriptUrl} variant="contained" startIcon={<MsIcon name="download" fontSize={20} />}>
                Установить юзерскрипт
              </Button>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Chip size="small" label="3" sx={{ flexShrink: 0 }} />
              <Typography variant="body2">
                Создайте персональный ключ ниже, скопируйте его.
              </Typography>
            </Box>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
              <Chip size="small" label="4" sx={{ flexShrink: 0 }} />
              <Typography variant="body2">
                На любой поддерживаемой странице: меню Tampermonkey → «Discord Queue:
                настройки» → вставьте ключ, выберите сервер. Готово.
              </Typography>
            </Box>
          </Stack>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Ключ — это доступ к добавлению треков от вашего имени: не публикуйте его.
            VK добавляется как «услышать сейчас» (прямая ссылка со страницы живёт
            недолго), YouTube / Яндекс.Музыка / SoundCloud работают в обычном режиме.
          </Typography>
        </CardContent>
      </Card>

      <Card>
        <CardContent>
          <Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
            <Typography variant="h6" sx={{ flex: 1 }}>
              Мои ключи
            </Typography>
            <Button size="small" variant="tonal" onClick={createKey}>
              Создать ключ
            </Button>
          </Stack>
          {newKey && (
            <Box
              onClick={() => {
                navigator.clipboard?.writeText(newKey);
                feedback.show("Ключ скопирован");
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
                Показан только один раз — скопируйте сейчас (клик — в буфер)
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
                Ключей ещё нет.
              </Typography>
            )
          )}
        </CardContent>
      </Card>
    </AppShell>
  );
}
