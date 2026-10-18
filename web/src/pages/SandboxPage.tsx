import { useCallback, useEffect, useRef, useState } from "react";
import { Box, Button, IconButton, Paper, Slider, Typography } from "@mui/material";
import { IconAddToQueue as AddToQueue, IconClose as Close } from "../components/icons";
import { useAuth } from "../useAuth";
import type { Me } from "../api";
import { api } from "../api";
import { AppShell } from "../components/AppShell";
import { CardSkeleton } from "../components/Skeletons";
import { BACKDROPS, drawScene } from "../sandbox/backdrops";
import { EXPERIMENTS, defaultParams, type ExperimentDef } from "../sandbox/registry";

/** An object placed on the sandbox canvas. */
interface SceneItem {
  id: string;
  experimentId: string;
  x: number;
  y: number;
  w: number;
  h: number;
  params: Record<string, number>;
}

let nextItemId = 1;

const PANEL = {
  width: 260,
  bgcolor: "#141020",
  color: "#e8e3f6",
  flexShrink: 0,
  borderRadius: "12px",
  overflowY: "auto" as const,
};

const OVERLINE = { display: "block", px: 1, pt: 1, color: "#9a92b0" };

/** The superadmin-only test polygon: Unity-style layout — experiment
    palette | canvas | inspector. The canvas is a generic surface: the
    scene, drag logic and inspector never mention specific experiments. */
export function SandboxPage() {
  const { me, loading } = useAuth();
  const shell = (children: React.ReactNode) => (
    <AppShell me={me} back title="Sandbox">
      {children}
    </AppShell>
  );
  if (loading) {
    return shell(
      <Box sx={{ display: "flex", gap: 2 }}>
        <CardSkeleton />
        <CardSkeleton />
      </Box>,
    );
  }
  if (!me?.is_superadmin) {
    return shell(
      <Box sx={{ textAlign: "center", py: 8 }}>
        <Typography variant="body1" sx={{ color: "text.secondary", mb: 2 }}>
          Super-admin only. Add your Discord ID to SUPERADMIN_IDS in .env.
        </Typography>
        <Button href="/api/auth/login" variant="contained">
          Login with Discord
        </Button>
      </Box>,
    );
  }
  return <SandboxWorkspace me={me} />;
}

function SandboxWorkspace({ me }: { me: Me }) {
  const [instances, setInstances] = useState<SceneItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [backdropMode, setBackdropMode] = useState<string>("grid");
  const [backdropVersion, setBackdropVersion] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasBoxRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ id: string; startX: number; startY: number; origX: number; origY: number } | null>(null);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const box = canvasBoxRef.current;
    if (!canvas || !box) return;
    const w = box.clientWidth;
    const h = box.clientHeight;
    if (w === 0 || h === 0) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    drawScene(ctx, w, h, backdropMode, dpr);
    setBackdropVersion((v) => v + 1);
  }, [backdropMode]);

  useEffect(() => {
    redraw();
    const box = canvasBoxRef.current;
    if (!box) return;
    const ro = new ResizeObserver(() => redraw());
    ro.observe(box);
    return () => ro.disconnect();
  }, [redraw]);

  const addInstance = (def: ExperimentDef) => {
    const box = canvasBoxRef.current;
    const cw = (box?.clientWidth ?? 800) / 2 - def.defaultSize.w / 2;
    const ch = (box?.clientHeight ?? 500) / 2 - def.defaultSize.h / 2;
    const jitter = (nextItemId % 6) * 36;
    const id = `obj-${nextItemId++}`;
    setInstances((list) => [
      ...list,
      {
        id,
        experimentId: def.id,
        x: Math.max(8, cw + jitter),
        y: Math.max(8, ch + jitter * 0.7),
        w: def.defaultSize.w,
        h: def.defaultSize.h,
        params: defaultParams(def),
      },
    ]);
    setSelectedId(id);
  };

  const updateSelected = (patch: Partial<SceneItem>) =>
    setInstances((list) => list.map((i) => (i.id === selectedId ? { ...i, ...patch } : i)));

  const removeInstance = (id: string) => {
    setInstances((list) => list.filter((i) => i.id !== id));
    setSelectedId((s) => (s === id ? null : s));
  };

  const selected = instances.find((i) => i.id === selectedId) ?? null;
  const selectedDef = selected ? EXPERIMENTS.find((e) => e.id === selected.experimentId) ?? null : null;

  const onCardPointerDown = (e: React.PointerEvent, inst: SceneItem) => {
    e.stopPropagation();
    setSelectedId(inst.id);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = { id: inst.id, startX: e.clientX, startY: e.clientY, origX: inst.x, origY: inst.y };
  };
  const onCardPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    const box = canvasBoxRef.current;
    if (!d || !box) return;
    const nx = Math.max(0, Math.min(d.origX + e.clientX - d.startX, box.clientWidth - 40));
    const ny = Math.max(0, Math.min(d.origY + e.clientY - d.startY, box.clientHeight - 40));
    setInstances((list) => list.map((i) => (i.id === d.id ? { ...i, x: nx, y: ny } : i)));
  };
  const onCardPointerUp = () => {
    dragRef.current = null;
  };

  const logout = () => api.logout().then(() => window.location.reload());

  return (
    <AppShell me={me} back title="Sandbox" onLogout={logout}>
      <Box sx={{ height: "calc(100dvh - 160px)", minHeight: 480, display: "flex", gap: 1.5 }}>
        {/* Left: experiment palette + placed scene objects. */}
        <Paper sx={{ ...PANEL, p: 1 }}>
          <Typography variant="overline" sx={OVERLINE}>
            Experiments
          </Typography>
          <Box sx={{ px: 0.5 }}>
            {EXPERIMENTS.map((def) => (
              <Button
                key={def.id}
                size="small"
                fullWidth
                startIcon={<AddToQueue />}
                sx={{ justifyContent: "flex-start", mb: 0.5, color: "inherit" }}
                onClick={() => addInstance(def)}
              >
                {def.label}
              </Button>
            ))}
          </Box>
          <Typography variant="overline" sx={{ ...OVERLINE, mt: 1.5 }}>
            Scene ({instances.length})
          </Typography>
          {instances.map((inst) => {
            const def = EXPERIMENTS.find((e) => e.id === inst.experimentId);
            return (
              <Box
                key={inst.id}
                onClick={() => setSelectedId(inst.id)}
                sx={{
                  display: "flex",
                  alignItems: "center",
                  px: 1,
                  py: 0.5,
                  mx: 0.5,
                  mb: 0.5,
                  borderRadius: 2,
                  cursor: "pointer",
                  bgcolor: selectedId === inst.id ? "rgba(205,186,255,0.16)" : "transparent",
                }}
              >
                <Typography variant="body2" noWrap sx={{ flex: 1 }}>
                  {def?.label ?? inst.experimentId}
                </Typography>
                <IconButton size="small" aria-label="Remove" onClick={(e) => { e.stopPropagation(); removeInstance(inst.id); }}>
                  <Close fontSize={16} />
                </IconButton>
              </Box>
            );
          })}
        </Paper>

        {/* Center: the polygon. Backdrop toolbar + canvas with objects. */}
        <Box sx={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 1 }}>
          <Paper sx={{ ...PANEL, width: "auto", p: 1, display: "flex", gap: 0.5, alignItems: "center", overflowX: "auto" }}>
            <Typography variant="overline" sx={{ px: 1, color: "#9a92b0" }}>
              Backdrop
            </Typography>
            <Button
              size="small"
              variant={backdropMode === "grid" ? "contained" : "text"}
              onClick={() => setBackdropMode("grid")}
              sx={{ minWidth: 0, color: backdropMode === "grid" ? "inherit" : "#b8b0c8" }}
            >
              Grid 3×2
            </Button>
            {BACKDROPS.map((b) => (
              <Button
                key={b.id}
                size="small"
                variant={backdropMode === b.id ? "contained" : "text"}
                onClick={() => setBackdropMode(b.id)}
                sx={{ minWidth: 0, color: backdropMode === b.id ? "inherit" : "#b8b0c8" }}
              >
                {b.label}
              </Button>
            ))}
          </Paper>
          <Paper
            sx={{ flex: 1, position: "relative", overflow: "hidden", bgcolor: "#0d0a18", borderRadius: "12px" }}
            ref={canvasBoxRef}
            onPointerDown={() => setSelectedId(null)}
          >
            <canvas
              ref={canvasRef}
              style={{ position: "absolute", inset: 0, width: "100%", height: "100%", display: "block" }}
            />
            {instances.map((inst) => {
              const def = EXPERIMENTS.find((e) => e.id === inst.experimentId);
              if (!def) return null;
              return (
                <Box
                  key={inst.id}
                  data-sandbox-card={inst.id}
                  onPointerDown={(e) => onCardPointerDown(e, inst)}
                  onPointerMove={onCardPointerMove}
                  onPointerUp={onCardPointerUp}
                  sx={{
                    position: "absolute",
                    left: inst.x,
                    top: inst.y,
                    width: inst.w,
                    height: inst.h,
                    borderRadius: `${inst.params.radius ?? 24}px`,
                    overflow: "hidden",
                    cursor: "grab",
                    touchAction: "none",
                    outline: selectedId === inst.id ? "2px solid rgba(205,186,255,0.85)" : "none",
                    outlineOffset: 2,
                  }}
                >
                  <def.Component
                    params={inst.params}
                    width={inst.w}
                    height={inst.h}
                    offset={[inst.x, inst.y]}
                    backdropCanvas={canvasRef.current}
                    backdropVersion={backdropVersion}
                  />
                </Box>
              );
            })}
          </Paper>
        </Box>

        {/* Right: schema-driven inspector for the selected object. */}
        <Paper sx={{ ...PANEL, width: 300, p: 1.5 }}>
          <Typography variant="overline" sx={OVERLINE}>
            Inspector
          </Typography>
          {!selected || !selectedDef ? (
            <Typography variant="body2" sx={{ px: 1, color: "#9a92b0" }}>
              Add an experiment and select it to tune its parameters.
            </Typography>
          ) : (
            <Box sx={{ px: 0.5 }}>
              <Typography variant="subtitle2" sx={{ mb: 1 }}>
                {selectedDef.label}
              </Typography>
              {selectedDef.params.map((spec) => (
                <Box key={spec.key} sx={{ mb: 1.5 }}>
                  <Typography variant="caption" sx={{ color: "#9a92b0" }}>
                    {spec.label}
                  </Typography>
                  <Slider
                    size="small"
                    min={spec.min}
                    max={spec.max}
                    step={spec.step}
                    value={selected.params[spec.key] ?? spec.default}
                    onChange={(_, v) => updateSelected({ params: { ...selected.params, [spec.key]: v as number } })}
                    valueLabelDisplay="auto"
                  />
                </Box>
              ))}
              <Typography variant="caption" sx={{ color: "#9a92b0" }}>
                Width, px
              </Typography>
              <Slider
                size="small"
                min={120}
                max={480}
                step={4}
                value={selected.w}
                onChange={(_, v) => updateSelected({ w: v as number })}
                valueLabelDisplay="auto"
              />
              <Typography variant="caption" sx={{ color: "#9a92b0" }}>
                Height, px
              </Typography>
              <Slider
                size="small"
                min={90}
                max={360}
                step={4}
                value={selected.h}
                onChange={(_, v) => updateSelected({ h: v as number })}
                valueLabelDisplay="auto"
              />
            </Box>
          )}
        </Paper>
      </Box>
    </AppShell>
  );
}
