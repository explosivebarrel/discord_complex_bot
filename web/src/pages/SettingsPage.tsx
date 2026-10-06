import { useCallback, useEffect, useState } from "react";
import { api, Integrations } from "../api";
import { useAuth } from "../useAuth";
import { Topbar } from "../components/Topbar";

function Status({ ok, label }: { ok: boolean; label: string }) {
  return (
    <span className="muted">
      {ok ? "🟢" : "🔴"} {label}
    </span>
  );
}

export function SettingsPage() {
  const { me, loading } = useAuth();
  const [info, setInfo] = useState<Integrations | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [refreshToken, setRefreshToken] = useState("");
  const [poToken, setPoToken] = useState("");
  const [visitorData, setVisitorData] = useState("");

  const refresh = useCallback(() => {
    api
      .integrations()
      .then(setInfo)
      .catch((e: Error) => setError(e.message));
  }, []);

  useEffect(refresh, [refresh]);

  const save = async (body: { refresh_token?: string; po_token?: string; visitor_data?: string }) => {
    setError(null);
    setMessage(null);
    try {
      const result = await api.updateYoutubeConfig(body);
      setMessage(
        `Saved. OAuth: ${result.oauth_configured ? "configured" : "not configured"} (${result.refresh_token_masked}). POT: ${
          result.pot_saved ? "saved" : "not set"
        }.`,
      );
      setRefreshToken("");
      setPoToken("");
      setVisitorData("");
      refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  if (loading) return <div className="login-page"><p className="muted">Loading…</p></div>;
  if (me && !me.is_superadmin) {
    return (
      <div className="container">
        <Topbar me={me} />
        <p className="error">Super-admin only. Add your Discord ID to SUPERADMIN_IDS in .env.</p>
      </div>
    );
  }

  const yt = info?.youtube;

  return (
    <div className="container">
      <Topbar me={me} onLogout={() => api.logout().then(() => window.location.reload())} />
      <h2>System settings</h2>
      {error && <p className="error">{error}</p>}
      {message && <p className="muted">{message}</p>}

      <div className="card">
        <h2>Integrations</h2>
        {info ? (
          <div className="channel-list">
            <Status ok={info.discord.ready} label={`Discord bot: ${info.discord.user ?? "?"} · ${info.discord.guilds} guild(s)`} />
            <Status
              ok={info.lavalink.connected}
              label={`Lavalink ${info.lavalink.host}: ${info.lavalink.connected ? "connected" : "offline"} · ${info.lavalink.players} player(s)`}
            />
            <Status
              ok={!!yt?.reachable}
              label={`YouTube plugin REST: ${yt?.reachable ? "reachable" : yt?.error ?? "unreachable"}`}
            />
            <Status
              ok={!!yt?.oauth_configured}
              label={`YouTube OAuth: ${yt?.oauth_configured ? yt.refresh_token_masked ?? "configured" : "not configured"}`}
            />
          </div>
        ) : (
          <p className="muted">Loading…</p>
        )}
        {yt?.last_error && (
          <div>
            <p className="error">
              Last playback error ({new Date(yt.last_error.at).toLocaleString()}): {yt.last_error.message}
            </p>
            <button className="secondary" onClick={() => api.clearYoutubeLastError().then(refresh)}>
              Clear error
            </button>
          </div>
        )}
      </div>

      <div className="card">
        <h2>YouTube OAuth refresh token</h2>
        <p className="muted">
          Playback needs a Google account token (device flow). Current state:{" "}
          {yt?.token_saved_in_db ? "saved in the database" : "only from .env / not set"}. To get a token: run
          Lavalink without a token, open the login URL from its logs (docker logs dcbot-lavalink) at
          google.com/device, then copy the printed refresh token here.
        </p>
        <div className="row">
          <input
            type="text"
            placeholder="1//0… (paste a new refresh token, leave empty to keep)"
            value={refreshToken}
            onChange={(e) => setRefreshToken(e.target.value)}
          />
          <button disabled={!refreshToken.trim()} onClick={() => save({ refresh_token: refreshToken })}>
            Save token
          </button>
        </div>
      </div>

      <div className="card">
        <h2>YouTube POT (proof of origin)</h2>
        <p className="muted">
          Optional anti-bot tokens for the WEB clients. Generate both values with
          youtube-trusted-session-generator and paste them here. They are applied without a restart.
          {yt?.pot_saved_in_db ? " A pair is saved." : ""}
        </p>
        <div className="row">
          <input type="text" placeholder="poToken" value={poToken} onChange={(e) => setPoToken(e.target.value)} />
        </div>
        <div className="row">
          <input
            type="text"
            placeholder="visitorData"
            value={visitorData}
            onChange={(e) => setVisitorData(e.target.value)}
          />
          <button
            disabled={!poToken.trim() || !visitorData.trim()}
            onClick={() => save({ po_token: poToken, visitor_data: visitorData })}
          >
            Save POT
          </button>
        </div>
      </div>
    </div>
  );
}
