import { useEffect, useState } from "react";

const FALLBACK = "discord_complex_bot";

let cached: string | null = null;
let pending: Promise<string> | null = null;

function fetchBotName(): Promise<string> {
  if (!pending) {
    pending = fetch("/api/auth/meta")
      .then((r) => (r.ok ? r.json() : {}))
      .then((m: { bot_name?: string }) => {
        cached = m.bot_name || FALLBACK;
        document.title = cached;
        return cached;
      })
      .catch(() => FALLBACK);
  }
  return pending;
}

/** Display name of the bot, loaded once from the public /api/auth/meta. */
export function useBotName(): string {
  const [name, setName] = useState(cached ?? FALLBACK);
  useEffect(() => {
    if (cached) {
      setName(cached);
      return;
    }
    fetchBotName().then(setName);
  }, []);
  return name;
}
