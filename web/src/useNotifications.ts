import { useSyncExternalStore } from "react";
import { api, type NotificationInfo } from "./api";

const MAX_ITEMS = 50;
const LAST_SEEN_KEY = "ui.notifLastSeen";

let items: NotificationInfo[] = [];
let loaded = false;
const listeners = new Set<() => void>();
// useSyncExternalStore requires a cached snapshot object: a fresh object on
// every getSnapshot call sends React into an infinite re-render (#185).
let snapshot = { items, unread: 0, loaded };

function recompute() {
  const cut = Number(localStorage.getItem(LAST_SEEN_KEY) ?? 0);
  const unread = items.filter((n) => n.created_at && new Date(n.created_at).getTime() > cut).length;
  snapshot = { items, unread, loaded };
}

function emit() {
  recompute();
  listeners.forEach((fn) => fn());
}

/** Client-side unread rule: everything newer than the last "mark read". */
export function useNotifications() {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => snapshot,
    () => snapshot,
  );
}

export async function loadRecentNotifications() {
  if (loaded) return;
  loaded = true;
  try {
    items = await api.notifications();
    emit();
  } catch {
    loaded = false;
  }
}

export function addNotification(n: NotificationInfo) {
  items = [n, ...items.filter((x) => x.id !== n.id)].slice(0, MAX_ITEMS);
  emit();
}

export function markAllRead() {
  localStorage.setItem(LAST_SEEN_KEY, String(Date.now()));
  emit();
}
