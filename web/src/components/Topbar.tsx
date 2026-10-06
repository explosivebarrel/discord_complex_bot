export function Topbar({
  me,
  onLogout,
}: {
  me: { global_name: string; avatar_url: string; is_superadmin: boolean } | null;
  onLogout?: () => void;
}) {
  return (
    <div className="topbar">
      <div className="brand">
        <a href="/">🎧 discord_complex_bot</a>
      </div>
      {me && (
        <div className="user">
          {me.is_superadmin && (
            <>
              <span className="badge admin">superadmin</span>
              <a href="/settings">
                <button className="secondary">Settings</button>
              </a>
            </>
          )}
          <span>{me.global_name}</span>
          <img src={me.avatar_url} alt="avatar" />
          {onLogout && (
            <button className="secondary" onClick={onLogout}>
              Logout
            </button>
          )}
        </div>
      )}
    </div>
  );
}
