import { useEffect, useState } from "react";
import {
  Box,
  Dialog,
  DialogContent,
  DialogTitle,
  Divider,
  FormControlLabel,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Menu,
  MenuItem,
  Slider,
  Switch,
  Tooltip,
  Typography,
} from "@mui/material";
import { alpha } from "@mui/material/styles";
import { useAppTheme, GLASS_BACKDROPS, type GlassBackdrop, type GlassTuning, type AuroraTuning } from "../themes/AppThemeContext";
import { ADVANCED_SCHEMES, BASE_SCHEMES, type AppThemeScheme } from "../themes/palettes";
import { IconCheck, IconPalette, IconTune, IconVisibility } from "./icons";

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
  mesh: { background: "radial-gradient(circle at 25% 30%, #6a4fb0 0%, transparent 55%), radial-gradient(circle at 75% 70%, #a06a8c 0%, transparent 55%), #14101f" },
  "stars-sparse": { background: "radial-gradient(circle, #efeaff 1px, transparent 1.6px) 0 0 / 20px 20px, #14101f" },
  "stars-medium": { background: "radial-gradient(circle, #efeaff 1px, transparent 1.6px) 0 0 / 12px 12px, #14101f" },
  "stars-dense": { background: "radial-gradient(circle, #efeaff 0.8px, transparent 1.3px) 0 0 / 7px 7px, #14101f" },
  stripes: { background: "repeating-linear-gradient(90deg, #101014 0 10px, #e8e6ec 10px 20px)" },
  grid: { background: "repeating-conic-gradient(#14101f 0% 25%, #b9b3c9 0% 50%) 0 / 10px 10px" },
};

function GlassSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { scheme, setThemeId, glassBackdrop, setGlassBackdrop, glassTuning, setGlassTuning } = useAppTheme();
  const tune = (patch: Partial<GlassTuning>) => setGlassTuning({ ...glassTuning, ...patch });
  // Preview ("eye"): the dialog and its backdrop dim go transparent, so the
  // scene can be judged live; only the eye stays, on a dark backing.
  // Solo: grabbing a slider hides everything but that slider on a small
  // dark pill — release restores the dialog.
  const [preview, setPreview] = useState(false);
  const [solo, setSolo] = useState<string | null>(null);
  const hideAll = preview || !!solo;
  useEffect(() => {
    if (!solo) return;
    const up = () => setSolo(null);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
    return () => {
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
    };
  }, [solo]);

  const row = (key: string, node: React.ReactNode) => (
    <Box sx={{ visibility: !hideAll || solo === key ? "visible" : "hidden", ...(solo === key ? { bgcolor: alpha("#0b0817", 0.72), backdropFilter: "blur(10px)", borderRadius: 3, px: 1.5, py: 1, my: -0.5 } : {}) }}>
      {node}
    </Box>
  );

  const slider = (label: string, key: keyof GlassTuning, min: number, max: number, step: number) =>
    row(`s-${key}`, (
      <Box onPointerDown={() => setSolo(`s-${key}`)} sx={{ cursor: "pointer" }}>
        <Typography variant="caption" sx={{ color: "text.secondary", display: solo === `s-${key}` ? "none" : "block" }}>
          {label}
        </Typography>
        <Slider
          size="small"
          min={min}
          max={max}
          step={step}
          value={glassTuning[key] as number}
          onChange={(_, v) => tune({ [key]: v as number } as Partial<GlassTuning>)}
          valueLabelDisplay={solo === `s-${key}` ? "on" : "auto"}
        />
      </Box>
    ));

  const tintRow = (label: string, colorKey: "lensTint" | "panelTint" | "fabTint", alphaKey: "lensTintAlpha" | "panelTintAlpha" | "fabTintAlpha") =>
    row(`t-${colorKey}`, (
      <Box>
        <Typography variant="caption" sx={{ color: "text.secondary", display: solo === `t-${colorKey}` ? "none" : "block" }}>
          {label}
        </Typography>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          {/* The color swatch itself never triggers solo — only the alpha
              slider hides the dialog around it. */}
          <Box
            component="input"
            type="color"
            value={glassTuning[colorKey]}
            onChange={(e) => tune({ [colorKey]: (e.target as HTMLInputElement).value } as Partial<GlassTuning>)}
            sx={{
              width: 40,
              height: 30,
              p: "3px",
              border: "1px solid",
              borderColor: "divider",
              borderRadius: "6px",
              bgcolor: "transparent",
              cursor: "pointer",
              flexShrink: 0,
            }}
          />
          <Box onPointerDown={() => setSolo(`t-${colorKey}`)} sx={{ flex: 1, cursor: "pointer" }}>
            <Slider
              size="small"
              min={0}
              max={1}
              step={0.05}
              value={glassTuning[alphaKey] as number}
              onChange={(_, v) => tune({ [alphaKey]: v as number } as Partial<GlassTuning>)}
              valueLabelDisplay={solo === `t-${colorKey}` ? "on" : "auto"}
              sx={{ display: "block" }}
            />
          </Box>
        </Box>
      </Box>
    ));

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: hideAll
            ? { bgcolor: "transparent", backgroundImage: "none", boxShadow: "none", overflow: "visible" }
            : undefined,
        },
        backdrop: {
          sx: hideAll ? { bgcolor: "transparent", backdropFilter: "none", transitionDuration: "0ms" } : undefined,
        },
      }}
    >
      <DialogTitle sx={{ display: "flex", alignItems: "center", pr: 2 }}>
        <Typography variant="h6" component="span" sx={{ visibility: hideAll ? "hidden" : "visible", flex: 1 }}>
          Liquid Glass settings
        </Typography>
        <Tooltip title={preview ? "Back to the settings" : "Preview the scene"}>
          <IconButton
            onClick={() => setPreview(!preview)}
            aria-label="Preview the scene"
            sx={hideAll ? { bgcolor: alpha("#0b0817", 0.75), "&:hover": { bgcolor: alpha("#0b0817", 0.9) } } : {}}
          >
            <IconVisibility fontSize={20} />
          </IconButton>
        </Tooltip>
      </DialogTitle>
      <DialogContent dividers sx={{ pt: 1, ...(hideAll ? { overflow: "hidden", border: "none" } : {}) }}>
        <Box sx={{ visibility: hideAll && !solo ? "hidden" : "visible" }}>
          {row("mode", (
            <FormControlLabel
              control={
                <Switch
                  checked={scheme.id === "glass-light"}
                  onChange={(_, v) => setThemeId(v ? "glass-light" : "glass")}
                />
              }
              label="Light glass (dark text for bright backdrops)"
            />
          ))}
          <Typography variant="body2" sx={{ color: "text.secondary", mb: 1 }}>
            Backdrop the glass refracts. Stripes and the checkerboard make the
            lens effect the most visible; the mesh gradient is the moodiest.
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
          <Typography variant="overline" sx={{ display: "block", mt: 1.5, color: "text.secondary" }}>
            Lens tuning
          </Typography>
          <Box sx={{ px: 1 }}>
            {row("fab", (
              <FormControlLabel
                control={
                  <Switch
                    checked={glassTuning.fabFrost}
                    onChange={(_, v) => tune({ fabFrost: v })}
                  />
                }
                label="Frosted play button (panel frost instead of the lens)"
              />
            ))}
            {slider("Play button blur, px", "fabBlur", 1, 44, 1)}
            {tintRow("Play button tint", "fabTint", "fabTintAlpha")}
            {slider("Lens strength — peak rim refraction, px", "maxDisp", 0, 36, 1)}
            {slider("Lens band — rim thickness, px", "bezel", 6, 40, 1)}
            {slider("Chromatic aberration, px", "aberration", 0, 6, 0.5)}
            {slider("Specular highlight strength", "specular", 0, 1, 0.05)}
            {slider("Shader resolution ×devicePixelRatio", "renderScale", 0.5, 2, 0.25)}
            {tintRow("Glass tint (dock, buttons, FAB)", "lensTint", "lensTintAlpha")}
            {tintRow("Panel tint (nav, content, queue)", "panelTint", "panelTintAlpha")}
          </Box>
        </Box>
      </DialogContent>
    </Dialog>
  );
}

/** Aurora backdrop settings: the classic canvas torus blobs or the WebGL
    mesh built from the aurora gradients, with mesh intensity/speed. */
function AuroraSettingsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { auroraTuning, setAuroraTuning } = useAppTheme();
  const tune = (patch: Partial<AuroraTuning>) => setAuroraTuning({ ...auroraTuning, ...patch });
  const slider = (label: string, key: "intensity" | "speed", min: number, max: number, step: number) => (
    <Box sx={{ px: 1 }}>
      <Typography variant="caption" sx={{ color: "text.secondary" }}>
        {label}
      </Typography>
      <Slider
        size="small"
        min={min}
        max={max}
        step={step}
        value={auroraTuning[key]}
        onChange={(_, v) => tune({ [key]: v as number } as Partial<AuroraTuning>)}
        valueLabelDisplay="auto"
      />
    </Box>
  );
  return (
    <Dialog open={open} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>Aurora settings</DialogTitle>
      <DialogContent dividers sx={{ pt: 1 }}>
        <FormControlLabel
          control={<Switch checked={auroraTuning.mesh} onChange={(_, v) => tune({ mesh: v })} />}
          label="Mesh gradient backdrop (WebGL)"
        />
        <Typography variant="body2" sx={{ color: "text.secondary", mb: auroraTuning.mesh ? 1 : 0 }}>
          Off: the classic canvas torus blobs. On: a liquid-warped WebGL mesh —
          each torus's gradient stops become drifting color blobs over the
          theme's base background.
        </Typography>
        {auroraTuning.mesh && (
          <>
            {slider("Blob intensity", "intensity", 0.4, 1.4, 0.05)}
            {slider("Drift speed", "speed", 0.4, 2, 0.1)}
            <FormControlLabel
              sx={{ px: 1 }}
              control={
                <Switch
                  checked={auroraTuning.bridges > 0}
                  onChange={(_, v) => tune({ bridges: v ? 0.6 : 0 })}
                />
              }
              label="Neon bridges between close blobs"
            />
            {auroraTuning.bridges > 0 &&
              slider("Bridge glow", "bridges", 0.15, 1, 0.05)}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ThemeMenu({ anchor, onClose, onOpenGlassSettings, onOpenAuroraSettings }: { anchor: HTMLElement | null; onClose: () => void; onOpenGlassSettings: () => void; onOpenAuroraSettings: () => void }) {
  const { scheme, setThemeId, cbPalette, setCbPalette } = useAppTheme();
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
      {s.id.startsWith("glass") ? (
        <Tooltip title="Liquid Glass settings">
          <IconButton
            size="small"
            aria-label="Liquid Glass settings"
            onClick={(e) => {
              e.stopPropagation();
              setThemeId(s.id);
              onClose();
              onOpenGlassSettings();
            }}
            sx={{ transform: "translateX(5px)" }}
          >
            <IconTune fontSize={18} />
          </IconButton>
        </Tooltip>
      ) : s.id.startsWith("aurora") ? (
        <Tooltip title="Aurora settings">
          <IconButton
            size="small"
            aria-label="Aurora settings"
            onClick={(e) => {
              e.stopPropagation();
              setThemeId(s.id);
              onClose();
              onOpenAuroraSettings();
            }}
            sx={{ transform: "translateX(5px)" }}
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
      {/* glass-light is reachable via the Light glass switch in the glass
          settings dialog, not as a separate menu entry. */}
      {ADVANCED_SCHEMES.filter((s) => s.id !== "glass-light").map(item)}
      <Divider />
      <MenuItem
        onClick={() => setCbPalette(!cbPalette)}
        // The check mark shows the state like on the theme items.
        selected={cbPalette}
      >
        <ListItemIcon sx={{ minWidth: 40, justifyContent: "center" }}>
          {cbPalette ? <IconCheck fontSize={18} sx={{ color: "primary.main" }} /> : null}
        </ListItemIcon>
        <ListItemText
          primary="Color-blind palette"
          slotProps={{ primary: { noWrap: true }, secondary: { noWrap: true } }}
          secondary="Sky-blue / yellow / vermillion status markers"
        />
      </MenuItem>
    </Menu>
  );
}

/** Bottom-of-sidebar theme picker: labeled row in the drawer, icon in the rail. */
export function ThemeSwitcher({ collapsed }: { collapsed: boolean }) {
  const { scheme } = useAppTheme();
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [glassSettings, setGlassSettings] = useState(false);
  const [auroraSettings, setAuroraSettings] = useState(false);
  const menu = (
    <ThemeMenu
      anchor={anchor}
      onClose={() => setAnchor(null)}
      onOpenGlassSettings={() => setGlassSettings(true)}
      onOpenAuroraSettings={() => setAuroraSettings(true)}
    />
  );
  const glassDialog = <GlassSettingsDialog open={glassSettings} onClose={() => setGlassSettings(false)} />;
  const auroraDialog = <AuroraSettingsDialog open={auroraSettings} onClose={() => setAuroraSettings(false)} />;
  if (collapsed) {
    // Same 48px round ListItemButton as the other rail rows: a plain
    // IconButton is 40px, so its hover/selected halo reads smaller.
    return (
      <>
        <Tooltip title={`Palette: ${scheme.label}`} placement="right" disableInteractive>
          <ListItemButton
            aria-label="Switch theme"
            onClick={(e) => setAnchor(e.currentTarget)}
            sx={{
              width: 48,
              height: 48,
              minHeight: 48,
              px: 0,
              mx: "auto",
              mb: 0.5,
              borderRadius: "50%",
              justifyContent: "center",
            }}
          >
            <ListItemIcon sx={{ minWidth: 0, justifyContent: "center" }}>
              <IconPalette fontSize={22} />
            </ListItemIcon>
          </ListItemButton>
        </Tooltip>
        {menu}
        {glassDialog}
        {auroraDialog}
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
      {auroraDialog}
    </>
  );
}
