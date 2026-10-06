import { useCallback, useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { api, GuildSettings } from "../api";
import { useAuth } from "../useAuth";
import { Topbar } from "../components/Topbar";

export function AdminPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const gid = Number(guildId);
  const { me, loading } = useAuth();
  const [settings, setSettings] = useState<GuildSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newAdmin, setNewAdmin] = useState("");

  const refresh = useCallback(() => {
    api
      .guildSettings(gid)
      .then(setSettings)
      .catch((e: Error) => setError(e.message));
  }, [gid]);

  useEffect(refresh, [refresh]);

  if (loading) return <div className="login-page"><p className="muted">Loading…</p></div>;

  return (
    <div className="container">
      <Topbar me={me} onLogout={() => api.logout().then(() => window.location.reload())} />
      <h2>Manage: {settings?.guild.name ?? gid}</h2>
      {error && <p className="error">{error}</p>}
      {!error && !settings && <p className="muted">Loading settings…</p>}

      {settings && (
        <>
          <div className="card">
            <h2>Default voice channel</h2>
            <div className="row">
              <input
                type="number"
                placeholder="Voice channel ID (optional)"
                value={settings.default_voice_channel_id ?? ""}
                onChange={(e) =>
                  setSettings({
                    ...settings,
                    default_voice_channel_id: e.target.value ? Number(e.target.value) : null,
                  })
                }
              />
              <button
                onClick={() =>
                  api
                    .updateGuildSettings(gid, settings.default_voice_channel_id)
                    .then(setSettings)
                    .catch((e: Error) => setError(e.message))
                }
              >
                Save
              </button>
            </div>
            <p className="muted">Channel id: enable Developer Mode in Discord → right-click channel → Copy ID.</p>
          </div>

          <div className="card">
            <h2>Server admins (web panel)</h2>
            <div className="row tag-input">
              <input
                type="text"
                placeholder="Discord user ID"
                value={newAdmin}
                onChange={(e) => setNewAdmin(e.target.value)}
              />
              <button
                onClick={() =>
                  api
                    .addGuildAdmin(gid, newAdmin)
                    .then((r) => {
                      setSettings({ ...settings, admins: r.admins });
                      setNewAdmin("");
                    })
                    .catch((e: Error) => setError(e.message))
                }
              >
                Add
              </button>
            </div>
            {settings.admins.length === 0 && <p className="muted">No extra admins yet.</p>}
            {settings.admins.map((a) => (
              <div className="queue-item" key={a}>
                <span>{a}</span>
                <button
                  className="danger"
                  onClick={() =>
                    api
                      .removeGuildAdmin(gid, a)
                      .then((r) => setSettings({ ...settings, admins: r.admins }))
                      .catch((e: Error) => setError(e.message))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
