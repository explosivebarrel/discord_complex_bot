import { useState } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Tooltip,
  Typography,
} from "@mui/material";
import { useAppTheme, GLASS_BACKDROPS, type GlassBackdrop } from "../themes/AppThemeContext";
import { ADVANCED_SCHEMES, BASE_SCHEMES, type AppThemeScheme } from "../themes/palettes";
import { IconCheck, IconPalette, IconTune } from "./icons";

/** Half primary / half surface circle: a compact preview of a theme. */
function Swatch({ scheme }: { scheme: AppThemeScheme }) {
  return (
    <Box
      aria-hidden
      sx={{
        width: 22,
        height: 22,
        borderRadius: "50%",
        flexShrink: 0,
        border: "1px solid",
        borderColor: "divider",
        background: `linear-gradient(135deg, ${scheme.tokens.primary} 0%, ${scheme.tokens.primary} 50%, ${scheme.tokens.surface} 50%, ${scheme.tokens.surface} 100%)`,
      }}
    />
  );
}

/** Miniature backdrop previews for the Liquid Glass settings dialog. */
const BACKDROP_PREVIEWS: Record<GlassBackdrop, object> = {
  "stars-sparse": { background: "radial-gradient(circle, #efeaff 1px, transparent 1.6px) 0 0 / 20px 20px, #14101f" },
  "stars-medium": { background: "radial-gradient(circle, #efeaff 1px, transparent 1.6px) 0 0 / 12px 12px, #14101f" },
  "stars-dense": { background: "radial-gradient(circle, #efeaff 0.8px, transparent 1.3px) 0 0 / 7px 7px, #14101f" },
  stripes: { background: "repeating-linear-gradient(90deg, #101014 0 10px, #e8e6ec 10px 20px)" },
  grid: { background: "repeating-conic-gradient(#14101f 0% 25%, #b9b3c9 0% 50%) 0 / 10px 10px" },
};

function GlassSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { glassBackdrop, setGlassBackdrop } = useAppTheme();
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Liquid Glass settings</DialogTitle>
      <DialogContent dividers sx={{ pt: 1 }}>
        <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
          Backdrop the glass refracts. Stripes and the checkerboard make the
          lens effect the most visible.
        </Typography>
        <List disablePadding>
          {GLASS_BACKDROPS.map((o) => (
            <ListItemButton
              key={o.id}
              selected={glassBackdrop === o.id}
              onClick={() => setGlassBackdrop(o.id)}
              sx={{ borderRadius: 2, mb: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 44, justifyContent: "center" }}>
                <Box
                  aria-hidden
                  sx={{ width: 30, height: 30, borderRadius: "8px", border: "1px solid", borderColor: "divider", ...BACKDROP_PREVIEWS[o.id] }}
                />
              </ListItemIcon>
              <ListItemText primary={o.label} slotProps={{ primary: { noWrap: true } }} />
              {glassBackdrop === o.id && <IconCheck fontSize={18} sx={{ color: "primary.main" }} />}
            </ListItemButton>
          ))}
        </List>
      </DialogContent>
    </Dialog>
  );
}

function ThemeMenu({ anchor, onClose, onOpenGlassSettings }: { anchor: HTMLElement | null; onClose: () => void; onOpenGlassSettings: () => void }) {
  const { scheme, setThemeId } = useAppTheme();
  const item = (s: AppThemeScheme) => (
    <MenuItem
      key={s.id}
      selected={s.id === scheme.id}
      onClick={() => {
        setThemeId(s.id);
        onClose();
      }}
    >
      <ListItemIcon sx={{ minWidth: 40, justifyContent: "center" }}>
        <Swatch scheme={s} />
      </ListItemIcon>
      <ListItemText primary={s.label} slotProps={{ primary: { noWrap: true } }} />
      {/* The check sits flush at the menu's right padding. The settings
          button keeps its full 28x28 box (this row is the widest and sets
          the menu width) and only its glyph shifts right 5px, cancelling
          the button's own side padding, so the glyph lands exactly on the
          check position without narrowing the menu. */}
      {s.id === "glass" ? (
        <Tooltip title="Liquid Glass settings">
          <IconButton
            size="small"
            aria-label="Liquid Glass settings"
            onClick={(e) => {
              e.stopPropagation();
              setThemeId("glass");
              onClose();
              onOpenGlassSettings();
            }}
            sx={{ "& > span": { transform: "translateX(5px)" } }}
          >
            <IconTune fontSize={18} />
          </IconButton>
        </Tooltip>
      ) : s.id === scheme.id ? (
        <IconCheck fontSize={18} sx={{ color: "primary.main" }} />
      ) : null}
    </MenuItem>
  );
  return (
    <Menu anchorEl={anchor} open={!!anchor} onClose={onClose} slotProps={{ paper: { sx: { maxHeight: 460 } } }}>
      {BASE_SCHEMES.map(item)}
      <Divider />
      <Typography variant="overline" sx={{ px: 2, display: "block", color: "text.secondary" }}>
        Advanced
      </Typography>
      {ADVANCED_SCHEMES.map(item)}
    </Menu>
  );
}

/** Bottom-of-sidebar theme picker: labeled row in the drawer, icon in the rail. */
export function ThemeSwitcher({ collapsed }: { collapsed: boolean }) {
  const { scheme } = useAppTheme();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [glassSettings, setGlassSettings] = useState(false);
  const menu = (
    <ThemeMenu anchor={anchor} onClose={() => setAnchor(null)} onOpenGlassSettings={() => setGlassSettings(true)} />
  );
  const glassDialog = <GlassSettingsDialog open={glassSettings} onClose={() => setGlassSettings(false)} />;
  if (collapsed) {
    return (
      <>
        <Tooltip title={`Palette: ${scheme.label}`} placement="right" disableInteractive>
          <IconButton
            aria-label="Switch theme"
            onClick={(e) => setAnchor(e.currentTarget)}
            sx={{ mx: "auto", display: "flex", mb: 0.5 }}
          >
            <IconPalette fontSize={22} />
          </IconButton>
        </Tooltip>
        {menu}
        {glassDialog}
      </>
    );
  }
  return (
    <>
      <ListItemButton
        onClick={(e) => setAnchor(e.currentTarget)}
        sx={{ borderRadius: 999, mx: 1.25, mb: 0.5, px: 2, minHeight: 44 }}
      >
        <ListItemIcon sx={{ minWidth: 40, justifyContent: "center" }}>
          <IconPalette fontSize={20} />
        </ListItemIcon>
        <ListItemText
          primary="Palette"
          secondary={scheme.label}
          slotProps={{ primary: { noWrap: true, variant: "body1" }, secondary: { noWrap: true } }}
        />
      </ListItemButton>
      {menu}
      {glassDialog}
    </>
  );
}
