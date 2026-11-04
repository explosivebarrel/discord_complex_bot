import { useEffect, useSyncExternalStore } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { NotificationInfo, PlayerState } from "./api";
import { addNotification, loadRecentNotifications } from "./useNotifications";

interface SocketEntry {
  ws: WebSocket | null;
  open: boolean;
  listeners: Set<() => void>;
  retryTimer: number | null;
  retries: number;
}

const sockets = new Map<string, SocketEntry>();
const clients = new Map<string, QueryClient>();

function entryFor(gid: string): SocketEntry {
  let entry = sockets.get(gid);
  if (!entry) {
    entry = { ws: null, open: false, listeners: new Set(), retryTimer: null, retries: 0 };
    sockets.set(gid, entry);
  }
  return entry;
}

function notify(entry: SocketEntry) {
  entry.listeners.forEach((fn) => fn());
}

function connect(gid: string) {
  const entry = entryFor(gid);
  if (entry.ws || entry.retryTimer !== null) return;
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}/api/guilds/${gid}/player/ws`);
  entry.ws = ws;
  ws.onopen = () => {
    entry.open = true;
    entry.retries = 0;
    notify(entry);
  };
  ws.onmessage = (event) => {
    try {
      const msg = JSON.parse(event.data) as
        | { type: "state"; state: PlayerState }
        | { type: "notification"; notification: NotificationInfo };
      if (msg.type === "state") {
        // Hand the snapshot to react-query: every usePlayerState reader
        // updates without an HTTP round-trip.
        clients.get(gid)?.setQueryData(["player", gid], msg.state);
      } else if (msg.type === "notification") {
        const n = msg.notification;
        addNotification({
          ...n,
          id: n.id ?? -Date.now(),
          created_at: n.created_at ?? new Date().toISOString(),
        });
      }
    } catch {
      // Malformed frame: ignore, the connection stays up.
    }
  };
  ws.onclose = () => {
    entry.ws = null;
    entry.open = false;
    notify(entry);
    // Reconnect with capped backoff; the polling fallback covers gaps.
    const delay = Math.min(1000 * 2 ** entry.retries, 15000);
    entry.retries += 1;
    entry.retryTimer = window.setTimeout(() => {
      entry.retryTimer = null;
      connect(gid);
    }, delay);
  };
  ws.onerror = () => ws.close();
}

/** Live connection to the guild's player channel: pushes state snapshots
    into the react-query cache and notification events into the bell store.
    The socket survives unmounts; polling slows down while it is open. */
export function usePlayerSocket(gid: string) {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!gid) return;
    clients.set(gid, queryClient);
    connect(gid);
    loadRecentNotifications();
  }, [gid, queryClient]);
}

/** Reactive "socket open" flag for slowing the polling fallback down. */
export function useSocketOpen(gid: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const entry = entryFor(gid);
      entry.listeners.add(cb);
      return () => entry.listeners.delete(cb);
    },
    () => entryFor(gid).open,
    () => false,
  );
}
