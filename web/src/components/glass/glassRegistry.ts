import { useEffect, type RefObject } from "react";

/**
 * Registry of glass islands the GlassScene renders. Panels keep their DOM
 * (text, controls) and become transparent windows; the scene paints the
 * glass beneath them, tracking each element's live box every frame, so
 * scrolling, collapsing columns and window resizes stay in sync for free.
 * Tints come from the glass tuning (per island kind) at draw time.
 */
export type GlassIslandKind = "panel" | "lens";

export interface GlassIslandOpts {
  /** Corner radius in CSS px (999 = pill / fully round). */
  radius: number;
  /** "panel": frosted backdrop panel (columns); "lens": refracting
      surface (dock, FAB, buttons). */
  kind: GlassIslandKind;
}

interface GlassIslandEntry extends GlassIslandOpts {
  el: HTMLElement;
}

const islands = new Set<GlassIslandEntry>();

export function registerGlassIsland(el: HTMLElement, opts: GlassIslandOpts): () => void {
  const entry: GlassIslandEntry = { ...opts, el };
  islands.add(entry);
  // Debug handle: live registry inspection from the console.
  (window as unknown as { __glassIslands: typeof islands }).__glassIslands = islands;
  return () => islands.delete(entry);
}

/** Snapshot for the render loop; rects are read live per frame. */
export function glassIslandEntries(): GlassIslandEntry[] {
  return [...islands];
}

/** Registers an element as a glass island while `enabled`. */
export function useGlassIsland(
  ref: RefObject<HTMLElement | null>,
  opts: GlassIslandOpts,
  enabled: boolean,
): void {
  useEffect(() => {
    const el = ref.current;
    if (typeof window !== "undefined") {
      const w = window as unknown as { __glassHookLog?: object[] };
      (w.__glassHookLog ??= []).push({ kind: opts.kind, enabled, hasEl: !!el, size: el ? `${el.offsetWidth}x${el.offsetHeight}` : "" });
    }
    if (!enabled || !el) return;
    return registerGlassIsland(el, opts);
    // Radius/kind changes re-register; the opts object itself is fine to
    // be recreated per render — registration order defines paint order
    // and stays stable because these deps rarely change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ref, enabled, opts.radius, opts.kind]);
}
