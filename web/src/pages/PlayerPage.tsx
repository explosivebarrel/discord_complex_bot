import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { api, PlayerState, TrackInfo, VoiceChannel } from "../api";
import { useAuth } from "../useAuth";
import { Topbar } from "../components/Topbar";

function fmt(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function PlayerPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const gid = guildId ?? "";
  const { me, loading } = useAuth();
  const [state, setState] = useState<PlayerState | null>(null);
  const [channels, setChannels] = useState<VoiceChannel[]>([]);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<TrackInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState<number | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refresh = useCallback(() => {
    api
      .playerState(gid)
      .then((s) => {
        setState(s);
        setVolume((v) => (v === null ? s.volume : v));
      })
      .catch((e: Error) => setError(e.message));
  }, [gid]);

  useEffect(() => {
    refresh();
    api.voiceChannels(gid).then(setChannels).catch(() => setChannels([]));
    pollRef.current = setInterval(refresh, 3000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [gid, refresh]);

  const act = (fn: () => Promise<unknown>) => {
    fn()
      .then(refresh)
      .catch((e: Error) => setError(e.message));
  };

  const doSearch = () => {
    if (!query.trim()) return;
    act(() =>
      api
        .search(gid, query)
        .then((r) => setResults(r))
        .then(() => undefined),
    );
  };

  const enqueue = (body: { query?: string; encoded?: string }) => act(() => api.enqueue(gid, body));

  if (loading) return <div className="login-page"><p className="muted">Loading…</p></div>;

  return (
    <div className="container">
      <Topbar me={me} onLogout={() => api.logout().then(() => window.location.reload())} />
      <h2>{state?.guild_name ?? `Guild ${gid}`}</h2>
      {error && <p className="error">{error}</p>}

      <div className="card">
        <h2>Voice connection</h2>
        {state?.connected ? (
          <div className="row">
            <span>
              Connected to <strong>{state.channel_name}</strong>
            </span>
            <button className="secondary" onClick={() => act(() => api.leave(gid))}>
              Leave
            </button>
          </div>
        ) : channels.length > 0 ? (
          <div className="channel-list">
            <p className="muted">Pick a voice channel to connect:</p>
            {channels.map((c) => (
              <button key={c.id} onClick={() => act(() => api.join(gid, c.id))}>
                🔊 {c.name}
              </button>
            ))}
          </div>
        ) : (
          <p className="muted">No voice channels found (or the bot lacks access).</p>
        )}
      </div>

      <div className="card">
        <h2>Add music</h2>
        <div className="row">
          <input
            type="text"
            placeholder="Track name or URL (YouTube, SoundCloud, …)"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && doSearch()}
          />
          <button onClick={doSearch}>Search</button>
          <button className="secondary" onClick={() => enqueue({ query })}>
            Queue URL / first match
          </button>
        </div>
        {results && (
          <div className="search-results">
            {results.length === 0 && <p className="muted">Nothing found.</p>}
            {results.map((t, i) => (
              <div className="queue-item" key={i}>
                <span className="title">
                  🎵 {t.title} <span className="muted">— {t.author} · {fmt(t.length)}</span>
                </span>
                <button
                  onClick={() => {
                    enqueue(t.encoded ? { encoded: t.encoded } : { query: t.uri ?? t.title });
                    setResults(null);
                    setQuery("");
                  }}
                >
                  Queue
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="card">
        <h2>Now playing</h2>
        {state?.current ? (
          <div>
            <div className="now-playing">
              {state.current.artwork && <img src={state.current.artwork} alt="" />}
              <div className="info">
                <div className="title">{state.current.title}</div>
                <div className="muted">
                  {state.current.author} · requested by {state.current.requested_by || "unknown"}
                </div>
                <div className="muted progress">
                  {fmt(state.current.position ?? 0)} / {fmt(state.current.length)}{" "}
                  {state.current.paused ? "⏸" : "▶"}
                </div>
              </div>
            </div>
            <div className="controls">
              {state.current.paused ? (
                <button onClick={() => act(() => api.simpleAction(gid, "resume"))}>▶ Resume</button>
              ) : (
                <button onClick={() => act(() => api.simpleAction(gid, "pause"))}>⏸ Pause</button>
              )}
              <button onClick={() => act(() => api.simpleAction(gid, "skip"))}>⏭ Skip</button>
              <button className="danger" onClick={() => act(() => api.simpleAction(gid, "stop"))}>
                ⏹ Stop
              </button>
              <label className="muted">
                🔉 Volume {Math.round((volume ?? 100) / 10)}%
                <input
                  type="range"
                  min={0}
                  max={1000}
                  value={volume ?? 100}
                  onChange={(e) => setVolume(Number(e.target.value))}
                  onMouseUp={() => volume !== null && act(() => api.volume(gid, volume))}
                  onTouchEnd={() => volume !== null && act(() => api.volume(gid, volume))}
                />
              </label>
            </div>
          </div>
        ) : (
          <p className="muted">Nothing is playing.</p>
        )}
      </div>

      <div className="card">
        <h2>Queue ({state?.queue.length ?? 0})</h2>
        {state && state.queue.length > 0 ? (
          state.queue.map((t, i) => (
            <div className="queue-item" key={i}>
              <span className="title">
                {i + 1}. {t.title}
              </span>
              <span className="muted">{t.requested_by}</span>
            </div>
          ))
        ) : (
          <p className="muted">Queue is empty.</p>
        )}
      </div>
    </div>
  );
}
