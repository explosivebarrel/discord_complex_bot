/** Display names of the queue/favorite track sources (panel tags). */
export const SOURCE_LABELS: Record<string, string> = {
  yt: "YouTube",
  youtube: "YouTube",
  sc: "SoundCloud",
  soundcloud: "SoundCloud",
  ym: "Yandex Music",
  yandexmusic: "Yandex Music",
  vk: "VK",
  radio: "radio",
  archive: "Archive.org",
  local: "file",
  playlist: "playlist",
};

/** m:ss for a millisecond length, LIVE above the sentinel. */
export function fmt(ms: number): string {
  const LIVE_LENGTH = 9223372036854775807;
  if (ms >= LIVE_LENGTH) return "LIVE";
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
