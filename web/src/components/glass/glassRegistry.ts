import { useEffect, useRef, type RefObject } from "react";

/**
 * Registry of glass islands the GlassScene renders. Panels keep their DOM
 * (text, controls) and become transparent windows; the scene paints the
 * glass beneath them, tracking each element's live box every frame, so
 * scrolling, collapsing columns and window resizes stay in sync for free.
 */
export interface GlassIslandOpts {
  /** Corner radius in CSS px (0 for the flush edge columns). */
  radius: number;
  /** Tint mixed over the refracted backdrop; defaults to the theme surface. */
  tint?: string;
  /** Tint strength; defaults to the theme's scrim tuning. */
  tintAlpha?: number;
}

interface GlassIslandEntry extends GlassIslandOpts {
  el: HTMLElement;
}

const islands = new Set<GlassIslandEntry>();

export function registerGlassIsland(el: HTMLElement, opts: GlassIslandOpts): () => void {
  const entry: GlassIslandEntry = { ...opts, el };
  islands.add(entry);
  return () => islands.delete(entry);
}

/** Snapshot for the render loop; rects are read live per frame. */
export function glassIslandEntries(): GlassIslandEntry[] {
  return [...islands];
}

/** Registers an element as a glass island while `enabled`. The options
    object is read through a ref, so passers-by re-renders don't churn the
    registry (registration order defines the paint order). */
export function useGlassIsland(
  ref: RefObject<HTMLElement | null>,
  opts: GlassIslandOpts,
  enabled: boolean,
): void {
  const latest = useRef(opts);
  latest.current = opts;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  useEffect(() => {
    const el = ref.current;
    if (!enabledRef.current || !el) return;
    return registerGlassIsland(el, latest.current);
  }, [ref, enabled]);
}
