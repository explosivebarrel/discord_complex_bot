import { useState } from "react";
import {
  Badge,
  Box,
  Button,
  ListItemIcon,
  ListItemButton,
  List,
  Popover,
  Stack,
  Tooltip,
  Typography,
} from "@mui/material";
import { MsIcon } from "./MsIcon";
import { useNotifications, markAllRead, clearAllNotifications } from "../useNotifications";

const CATEGORY_ICON: Record<string, string> = {
  player: "error",
  availability: "cloud_off",
};

function timeAgo(iso: string | null): string {
  if (!iso) return "just now";
  // Backend timestamps are naive UTC: mark them, or they parse as local.
  const at = new Date(iso.endsWith("Z") ? iso : `${iso}Z`).getTime();
  const sec = Math.max(0, Math.round((Date.now() - at) / 1000));
  if (sec < 60) return "just now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

/** The sidebar bell: unread badge + a popover list. `collapsed` renders the
    rail icon variant, otherwise the labelled row. */
export function NotificationBell({ collapsed }: { collapsed: boolean }) {
  const { items, unread, loaded } = useNotifications();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const open = (e: React.MouseEvent<HTMLElement>) => setAnchor(e.currentTarget);
  const close = () => setAnchor(null);

  const badge = unread > 0 ? (unread > 9 ? "9+" : unread) : null;

  if (collapsed) {
    return (
      <>
        <Tooltip title={badge ? `Notifications — ${unread} unread` : "Notifications"} placement="right" disableInteractive>
          {/* Same 48px round row as the palette/availability rail buttons:
              a plain IconButton's 40px halo reads smaller than theirs. */}
          <ListItemButton
            onClick={open}
            aria-label="Notifications"
            sx={{ width: 48, height: 48, minHeight: 48, px: 0, mx: "auto", mb: 0.5, borderRadius: "50%", justifyContent: "center" }}
          >
            <Badge badgeContent={badge} color="primary">
              <MsIcon name="notifications" fontSize={22} />
            </Badge>
          </ListItemButton>
        </Tooltip>
        <NotificationsPopover anchor={anchor} onClose={close} items={items} loaded={loaded} />
      </>
    );
  }

  return (
    <>
      <Tooltip title="Notifications" disableInteractive>
        <ListItemButton
          onClick={open}
          sx={{ borderRadius: 999, mx: 1.25, mb: 0.5, px: 2, minHeight: 44 }}
        >
          <ListItemIcon sx={{ minWidth: 40, justifyContent: "center" }}>
            <Badge badgeContent={badge} color="primary">
              <MsIcon name="notifications" fontSize={22} />
            </Badge>
          </ListItemIcon>
          <Typography variant="body1" noWrap>
            Notifications
          </Typography>
        </ListItemButton>
      </Tooltip>
      <NotificationsPopover anchor={anchor} onClose={close} items={items} loaded={loaded} />
    </>
  );
}

export function NotificationsPopover({
  anchor, onClose, items, loaded,
}: {
  anchor: HTMLElement | null;
  onClose: () => void;
  items: ReturnType<typeof useNotifications>["items"];
  loaded: boolean;
}) {
  return (
    <Popover
      open={!!anchor}
      anchorEl={anchor}
      onClose={onClose}
      anchorOrigin={{ vertical: "top", horizontal: "right" }}
      transformOrigin={{ vertical: "bottom", horizontal: "left" }}
      slotProps={{ paper: { sx: { width: 340, maxHeight: 480, display: "flex", flexDirection: "column" } } }}
    >
      <Stack direction="row" spacing={1} sx={{ alignItems: "center", px: 2, pt: 1.5, pb: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          Notifications
        </Typography>
        <Button size="small" variant="text" onClick={markAllRead} disabled={!items.length}>
          Mark read
        </Button>
        <Button
          size="small"
          variant="text"
          color="error"
          onClick={() => {
            close();
            clearAllNotifications();
          }}
          disabled={!items.length}
        >
          Clear all
        </Button>
      </Stack>
      <Box sx={{ overflowY: "auto", px: 1, pb: 1.5 }}>
        {items.length === 0 ? (
          <Typography variant="body2" sx={{ color: "text.secondary", px: 2, py: 3, textAlign: "center" }}>
            {loaded ? "Nothing yet. Playback and source events will show up here." : "Loading…"}
          </Typography>
        ) : (
          <List disablePadding>
            {items.map((n) => (
              <ListItemButton key={`${n.id}-${n.created_at}`} disableGutters sx={{ borderRadius: 1.5, alignItems: "flex-start", py: 1 }}>
                <ListItemIcon sx={{ minWidth: 36, pl: 1, pt: 0.25 }}>
                  <MsIcon
                    name={CATEGORY_ICON[n.category] ?? "info"}
                    fontSize={20}
                    sx={{ color: n.category === "availability" ? "text.secondary" : "error.main" }}
                  />
                </ListItemIcon>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="body2" sx={{ fontWeight: 500 }}>{n.title}</Typography>
                  {n.body && (
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        display: "block",
                        // Stack traces and error dumps carry long unbroken
                        // tokens: wrap them instead of stretching the card.
                        wordBreak: "break-word",
                        overflowWrap: "anywhere",
                      }}
                    >
                      {n.body}
                    </Typography>
                  )}
                  <Typography variant="caption" sx={{ color: "text.secondary", opacity: 0.7 }}>
                    {timeAgo(n.created_at)}
                  </Typography>
                </Box>
              </ListItemButton>
            ))}
          </List>
        )}
      </Box>
    </Popover>
  );
}
