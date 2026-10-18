/**
 * Sandbox backdrop scenes, drawn with 2D canvas into an arbitrary rect.
 * One draw function per backdrop; the same code renders the display
 * canvas and (potentially) texture sources for shader experiments.
 */
export interface BackdropDef {
  id: string;
  label: string;
  draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
}

const stripes: BackdropDef = {
  id: "stripes",
  label: "Stripes",
  draw: (ctx, w, h) => {
    ctx.fillStyle = "#0b0b10";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#eceaf0";
    for (let x = 0; x < w; x += 180) ctx.fillRect(x, 0, 90, h);
  },
};

const checker: BackdropDef = {
  id: "checker",
  label: "Checkerboard",
  draw: (ctx, w, h) => {
    const cell = 44;
    for (let y = 0; y < Math.ceil(h / cell); y++) {
      for (let x = 0; x < Math.ceil(w / cell); x++) {
        ctx.fillStyle = (x + y) % 2 ? "#d6d2de" : "#16121f";
        ctx.fillRect(x * cell, y * cell, cell, cell);
      }
    }
  },
};

const stars: BackdropDef = {
  id: "stars",
  label: "Stars",
  draw: (ctx, w, h) => {
    ctx.fillStyle = "#0d0a18";
    ctx.fillRect(0, 0, w, h);
    const count = Math.round((w * h) / 7000);
    for (let i = 0; i < count; i++) {
      // Deterministic pseudo-random so redraws are stable.
      const x = ((i * 911) % 1000) / 1000 * w;
      const y = ((i * 677) % 1000) / 1000 * h;
      const r = 0.4 + ((i * 37) % 100) / 100 * 1.4;
      ctx.globalAlpha = 0.25 + ((i * 53) % 100) / 100 * 0.6;
      ctx.fillStyle = "#e8e3ff";
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  },
};

const mesh: BackdropDef = {
  id: "mesh",
  label: "Gradient mesh",
  draw: (ctx, w, h) => {
    ctx.fillStyle = "#f4f2f7";
    ctx.fillRect(0, 0, w, h);
    const blobs: [string, number, number][] = [
      ["#b69dff", 0.22, 0.25],
      ["#ffb3d9", 0.8, 0.2],
      ["#8fd3ff", 0.25, 0.8],
      ["#ffd9a8", 0.8, 0.8],
    ];
    const r = Math.min(w, h) * 0.45;
    for (const [color, fx, fy] of blobs) {
      const g = ctx.createRadialGradient(fx * w, fy * h, 0, fx * w, fy * h, r);
      g.addColorStop(0, color);
      g.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    ctx.globalAlpha = 1;
  },
};

const text: BackdropDef = {
  id: "text",
  label: "Text sample",
  draw: (ctx, w, h) => {
    ctx.fillStyle = "#f4f2f7";
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1a1626";
    ctx.font = "600 30px Roboto, sans-serif";
    ctx.fillText("Glass legibility", 28, 64);
    ctx.font = "400 16px Roboto, sans-serif";
    ctx.fillStyle = "#3a3444";
    const lines = [
      "The quick brown fox jumps over the lazy dog.",
      "0123456789 — punctuation, no refraction loss?",
      "Move a glass card over this text and judge",
      "how much of it stays readable through the lens.",
    ];
    lines.forEach((line, i) => ctx.fillText(line, 30, 110 + i * 26));
    ctx.font = "500 12px Roboto, sans-serif";
    ctx.fillStyle = "#8a8496";
    ctx.fillText("SMALL CAPTION 11PX — THE FINE PRINT TEST", 30, 226);
  },
};

const blueprint: BackdropDef = {
  id: "blueprint",
  label: "Blueprint grid",
  draw: (ctx, w, h) => {
    ctx.fillStyle = "#101423";
    ctx.fillRect(0, 0, w, h);
    ctx.lineWidth = 1;
    for (let x = 0; x <= w; x += 24) {
      ctx.strokeStyle = x % 96 === 0 ? "rgba(120,140,255,0.25)" : "rgba(120,140,255,0.10)";
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, h);
      ctx.stroke();
    }
    for (let y = 0; y <= h; y += 24) {
      ctx.strokeStyle = y % 96 === 0 ? "rgba(120,140,255,0.25)" : "rgba(120,140,255,0.10)";
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(w, y + 0.5);
      ctx.stroke();
    }
    // Crosses at major intersections.
    ctx.strokeStyle = "rgba(150,170,255,0.5)";
    for (let x = 0; x <= w; x += 96) {
      for (let y = 0; y <= h; y += 96) {
        ctx.beginPath();
        ctx.moveTo(x - 5, y);
        ctx.lineTo(x + 5, y);
        ctx.moveTo(x, y - 5);
        ctx.lineTo(x, y + 5);
        ctx.stroke();
      }
    }
  },
};

/** All registered sandbox backdrops. */
export const BACKDROPS: BackdropDef[] = [stripes, checker, stars, mesh, text, blueprint];

export function getBackdrop(id: string): BackdropDef {
  return BACKDROPS.find((b) => b.id === id) ?? BACKDROPS[0];
}

/** Draws the current sandbox backdrop arrangement into a full-size canvas. */
export function drawScene(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  mode: "grid" | string,
  dpr: number,
) {
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (mode === "grid") {
    const cols = 3;
    const rows = 2;
    const cw = w / cols;
    const ch = h / rows;
    BACKDROPS.forEach((b, i) => {
      ctx.save();
      ctx.translate((i % cols) * cw, Math.floor(i / cols) * ch);
      ctx.beginPath();
      ctx.rect(0, 0, cw, ch);
      ctx.clip();
      b.draw(ctx, cw, ch);
      ctx.restore();
    });
    ctx.strokeStyle = "rgba(128,128,140,0.35)";
    ctx.lineWidth = 1;
    for (let c = 1; c < cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cw + 0.5, 0);
      ctx.lineTo(c * cw + 0.5, h);
      ctx.stroke();
    }
    for (let r2 = 1; r2 < rows; r2++) {
      ctx.beginPath();
      ctx.moveTo(0, r2 * ch + 0.5);
      ctx.lineTo(w, r2 * ch + 0.5);
      ctx.stroke();
    }
  } else {
    getBackdrop(mode).draw(ctx, w, h);
  }
}
