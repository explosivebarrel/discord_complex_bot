import { useState } from "react";
import { api, GuildBrief } from "../api";
import { useAuth } from "../useAuth";
import { Topbar } from "../components/Topbar";

export function GuildsPage() {
  const { me, loading } = useAuth();
  const [guilds, setGuilds] = useState<GuildBrief[] | null>(null);
  const [guildsError, setGuildsError] = useState<string | null>(null);

  if (!loading && me && guilds === null && guildsError === null) {
    api
      .myGuilds()
      .then(setGuilds)
      .catch((e: Error) => setGuildsError(e.message));
  }

  if (loading) {
    return (
      <div className="login-page">
        <p className="muted">Loading…</p>
      </div>
    );
  }
  if (!me) {
    return <LoginPageRedirect />;
  }

  return (
    <div className="container">
      <Topbar me={me} onLogout={() => api.logout().then(() => window.location.reload())} />
      <h2>Your servers</h2>
      {guildsError && <p className="error">{guildsError}</p>}
      {guilds && guilds.length === 0 && (
        <p className="muted">
          The bot is not on any of your servers yet. Invite it first: the link is in the project README.
        </p>
      )}
      {guilds?.map((g) => (
        <div className="card" key={g.id}>
          <h2>
            <a href={`/guild/${g.id}`}>{g.name}</a>
            {g.is_admin && <span className="badge admin">admin</span>}
          </h2>
          <div className="row">
            <a href={`/guild/${g.id}`}>
              <button>Open player</button>
            </a>
            {(g.is_admin || g.is_superadmin) && (
              <a href={`/guild/${g.id}/admin`}>
                <button className="secondary">Manage</button>
              </a>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function LoginPageRedirect() {
  return (
    <div className="login-page">
      <p className="muted">Please log in.</p>
      <a href="/api/auth/login">
        <button>Login with Discord</button>
      </a>
    </div>
  );
}
