import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Divider,
  IconButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Select,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from "@mui/material";
import Bold from "@mui/icons-material/FormatBold";
import Italic from "@mui/icons-material/FormatItalic";
import Underline from "@mui/icons-material/FormatUnderlined";
import Strikethrough from "@mui/icons-material/FormatStrikethrough";
import Code from "@mui/icons-material/Code";
import FormatQuote from "@mui/icons-material/FormatQuote";
import FormatListBulleted from "@mui/icons-material/FormatListBulleted";
import TitleIcon from "@mui/icons-material/Title";
import LinkIcon from "@mui/icons-material/Link";
import AlternateEmail from "@mui/icons-material/AlternateEmail";
import Tag from "@mui/icons-material/Tag";
import Workspaces from "@mui/icons-material/Workspaces";
import Campaign from "@mui/icons-material/Campaign";
import EmojiEmotions from "@mui/icons-material/EmojiEmotions";
import Visibility from "@mui/icons-material/Visibility";
import Edit from "@mui/icons-material/Edit";
import { api, ComposerData, PostChannel } from "../api";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { useFeedback } from "../components/Feedback";
import { renderDiscordHtml } from "../discordMd";

const CONTENT_LIMIT = 2000;

const previewSx = {
  minHeight: 148,
  maxHeight: 340,
  overflowY: "auto",
  p: 1.5,
  borderRadius: "12px",
  border: "1px solid #2B2930",
  bgcolor: "#141218",
  "& .md-mention": {
    bgcolor: "rgba(88,101,242,.3)",
    color: "#C9CDFB",
    borderRadius: "4px",
    px: 0.5,
    fontWeight: 500,
  },
  "& .md-emoji": { width: 22, height: 22, verticalAlign: "-0.4em" },
  "& code": { bgcolor: "#2B2930", borderRadius: "4px", px: 0.5, fontFamily: "monospace", fontSize: "0.9em" },
  "& pre": { bgcolor: "#2B2930", borderRadius: "8px", p: 1.5, overflowX: "auto", my: 1 },
  "& pre code": { bgcolor: "transparent", p: 0 },
  "& blockquote": { margin: 0, pl: 1.5, borderLeft: "4px solid #4A4458", color: "text.secondary" },
  "& ul": { margin: 0, pl: 3 },
  "& a": { color: "#00A8FC" },
  "& img": { maxWidth: "100%" },
} as const;

type MenuKind = "user" | "channel" | "role" | "emoji" | null;

export function PostsPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const gid = guildId ?? "";
  const { me, loading } = useAuth();
  const feedback = useFeedback();
  const [composer, setComposer] = useState<ComposerData | null>(null);
  const [channelId, setChannelId] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [preview, setPreview] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [menuKind, setMenuKind] = useState<MenuKind>(null);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
  const [userFilter, setUserFilter] = useState("");
  const taRef = useRef<HTMLTextAreaElement | null>(null);

  const guard = (e: Error) => {
    if (e.message !== "unauthorized") setError(e.message);
  };

  const refresh = useCallback(() => {
    api
      .postComposer(gid)
      .then((data) => {
        setComposer(data);
        setChannelId((current) => current || data.channels[0]?.id || "");
      })
      .catch(guard);
  }, [gid]);

  useEffect(refresh, [refresh]);

  const selected = composer?.channels.find((c) => c.id === channelId);
  const canSend =
    !!selected &&
    text.trim().length > 0 &&
    text.length <= CONTENT_LIMIT &&
    (selected.type !== "forum" || title.trim().length > 0);

  // Insert at the cursor (or wrap the selection) and put the caret back.
  const insert = (before: string, after: string = "", placeholder = "") => {
    const ta = taRef.current;
    const start = ta?.selectionStart ?? text.length;
    const end = ta?.selectionEnd ?? text.length;
    const selectedText = text.slice(start, end);
    const body = selectedText || placeholder;
    setText(text.slice(0, start) + before + body + after + text.slice(end));
    requestAnimationFrame(() => {
      if (!ta) return;
      ta.focus();
      const caret = start + before.length + body.length;
      ta.setSelectionRange(caret, caret);
    });
  };

  const insertToken = (token: string) => {
    closeMenu();
    insert(token);
  };

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

  const openMenu = (kind: Exclude<MenuKind, null>, anchor: HTMLElement) => {
    setMenuKind(kind);
    setMenuAnchor(anchor);
    if (kind === "user") setUserFilter("");
  };
  const closeMenu = () => {
    setMenuKind(null);
    setMenuAnchor(null);
  };

  const filteredUsers = (composer?.users ?? []).filter((u) =>
    u.name.toLowerCase().includes(userFilter.toLowerCase()),
  );

  if (loading) {
    return (
      <AppShell me={me} back title="Posts">
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          Loading…
        </Typography>
      </AppShell>
    );
  }

  const fmtButton = (title: string, icon: React.ReactNode, before: string, after: string, placeholder: string) => (
    <Tooltip title={title} key={title}>
      <IconButton size="small" onClick={() => insert(before, after, placeholder)}>
        {icon}
      </IconButton>
    </Tooltip>
  );

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
      <Card sx={{ maxWidth: 760 }}>
        <CardContent>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1.5} sx={{ alignItems: "center" }}>
              <Select
                fullWidth
                size="small"
                value={channelId}
                onChange={(e) => setChannelId(e.target.value as string)}
                displayEmpty
              >
                {(composer?.channels ?? []).map((c: PostChannel) => (
                  <MenuItem key={c.id} value={c.id}>
                    {c.type === "forum" ? "🗂" : "#"} {c.name}
                    <Typography variant="caption" sx={{ color: "text.secondary", ml: 1 }}>
                      {c.type}
                    </Typography>
                  </MenuItem>
                ))}
              </Select>
              <Chip
                icon={preview ? <Edit /> : <Visibility />}
                label={preview ? "Editing" : "Preview"}
                variant={preview ? "outlined" : "filled"}
                color={preview ? "default" : "primary"}
                onClick={() => setPreview((p) => !p)}
              />
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

            <Box sx={{ display: "flex", flexWrap: "wrap", alignItems: "center", rowGap: 0.5 }}>
              {fmtButton("Bold (**text**)", <Bold fontSize="small" />, "**", "**", "text")}
              {fmtButton("Italic (*text*)", <Italic fontSize="small" />, "*", "*", "text")}
              {fmtButton("Underline (__text__)", <Underline fontSize="small" />, "__", "__", "text")}
              {fmtButton("Strikethrough (~~text~~)", <Strikethrough fontSize="small" />, "~~", "~~", "text")}
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
              {fmtButton("Code (`text`)", <Code fontSize="small" />, "`", "`", "code")}
              {fmtButton("Code block", <Box component={Code} fontSize="small" sx={{ transform: "scale(1.15)" }} />, "```\n", "\n```", "code")}
              {fmtButton("Quote", <FormatQuote fontSize="small" />, "> ", "", "quote")}
              {fmtButton("Heading (## text)", <TitleIcon fontSize="small" />, "## ", "", "heading")}
              {fmtButton("List item", <FormatListBulleted fontSize="small" />, "- ", "", "item")}
              {fmtButton("Link ([text](url))", <LinkIcon fontSize="small" />, "[", "](https://)", "text")}
              <Divider orientation="vertical" flexItem sx={{ mx: 0.5 }} />
              <Tooltip title="Mention a user">
                <IconButton size="small" onClick={(e) => openMenu("user", e.currentTarget)}>
                  <AlternateEmail fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Mention a channel">
                <IconButton size="small" onClick={(e) => openMenu("channel", e.currentTarget)}>
                  <Tag fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="Mention a role">
                <IconButton size="small" onClick={(e) => openMenu("role", e.currentTarget)}>
                  <Workspaces fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="@everyone (pings everyone in the channel)">
                <IconButton size="small" onClick={() => insert("@everyone ")}>
                  <Campaign fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title="@here (pings online members)">
                <IconButton size="small" onClick={() => insert("@here ")}>
                  <Campaign fontSize="small" sx={{ opacity: 0.6 }} />
                </IconButton>
              </Tooltip>
              <Tooltip title="Server emojis">
                <IconButton size="small" onClick={(e) => openMenu("emoji", e.currentTarget)}>
                  <EmojiEmotions fontSize="small" />
                </IconButton>
              </Tooltip>
              <Box sx={{ flex: 1 }} />
              <Typography
                variant="caption"
                sx={{ color: text.length > CONTENT_LIMIT ? "error.main" : "text.secondary" }}
              >
                {text.length}/{CONTENT_LIMIT}
              </Typography>
            </Box>

            {preview ? (
              <Box
                sx={previewSx}
                dangerouslySetInnerHTML={{ __html: renderDiscordHtml(text, composer ?? { users: [], roles: [], channels: [] }) }}
              />
            ) : (
              <TextField
                inputRef={taRef}
                fullWidth
                multiline
                minRows={6}
                placeholder={
                  "Text in Discord markdown: **bold**, *italic*, __underline__, ~~strike~~, `code`, > quote, [link](url)\nMentions go through the buttons above (<@user_id>, <#channel_id>, <@&role_id> will be inserted)."
                }
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            )}

            <Box sx={{ display: "flex", justifyContent: "flex-end" }}>
              <Button variant="contained" disabled={!canSend || sending} onClick={publish}>
                {sending ? "Publishing…" : "Publish"}
              </Button>
            </Box>
          </Stack>
        </CardContent>
      </Card>
      {feedback.node}

      <Menu
        open={menuKind === "user"}
        anchorEl={menuAnchor}
        onClose={closeMenu}
        slotProps={{ paper: { sx: { maxHeight: 420, width: 280 } } }}
      >
        <Box sx={{ px: 1, pt: 1 }}>
          <TextField
            size="small"
            fullWidth
            autoFocus
            placeholder="Search…"
            value={userFilter}
            onChange={(e) => setUserFilter(e.target.value)}
          />
        </Box>
        {filteredUsers.length === 0 && (
          <Typography variant="body2" sx={{ color: "text.secondary", p: 1.5 }}>
            No known users yet. The bot sees panel users, voice members and users it has already met.
          </Typography>
        )}
        {filteredUsers.map((u) => (
          <MenuItem key={u.id} onClick={() => insertToken(`<@${u.id}>`)} dense>
            <ListItemIcon sx={{ minWidth: 32 }}>
              {u.avatar ? (
                <Box component="img" src={u.avatar} sx={{ width: 20, height: 20, borderRadius: "50%" }} />
              ) : (
                <AlternateEmail fontSize="small" />
              )}
            </ListItemIcon>
            <ListItemText primary={u.name} slotProps={{ primary: { noWrap: true, variant: "body2" } }} />
          </MenuItem>
        ))}
      </Menu>

      <Menu open={menuKind === "channel"} anchorEl={menuAnchor} onClose={closeMenu}>
        {(composer?.channels ?? []).map((c) => (
          <MenuItem key={c.id} onClick={() => insertToken(`<#${c.id}>`)} dense>
            {c.type === "forum" ? "🗂" : "#"} {c.name}
          </MenuItem>
        ))}
      </Menu>

      <Menu
        open={menuKind === "role"}
        anchorEl={menuAnchor}
        onClose={closeMenu}
        slotProps={{ paper: { sx: { maxHeight: 420 } } }}
      >
        {(composer?.roles ?? []).map((role) => (
          <MenuItem key={role.id} onClick={() => insertToken(`<@&${role.id}>`)} dense>
            <ListItemIcon sx={{ minWidth: 28 }}>
              <Box
                sx={{
                  width: 12,
                  height: 12,
                  borderRadius: "50%",
                  bgcolor: role.color ?? "#99AAB5",
                  border: role.color ? "none" : "1px solid #49454F",
                }}
              />
            </ListItemIcon>
            <ListItemText primary={role.name} slotProps={{ primary: { noWrap: true, variant: "body2" } }} />
          </MenuItem>
        ))}
      </Menu>

      <Menu
        open={menuKind === "emoji"}
        anchorEl={menuAnchor}
        onClose={closeMenu}
        slotProps={{ paper: { sx: { maxHeight: 360, width: 280 } } }}
      >
        {(composer?.emojis ?? []).length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary", p: 1.5 }}>
            This server has no custom emojis.
          </Typography>
        ) : (
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, p: 1 }}>
            {(composer?.emojis ?? []).map((e) => (
              <IconButton
                key={e.id}
                size="small"
                title={`:${e.name}:`}
                onClick={() => insertToken(`<${e.animated ? "a" : ""}:${e.name}:${e.id}>`)}
              >
                <Box
                  component="img"
                  alt={`:${e.name}:`}
                  src={`https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}`}
                  sx={{ width: 24, height: 24 }}
                />
              </IconButton>
            ))}
          </Box>
        )}
      </Menu>
    </AppShell>
  );
}
