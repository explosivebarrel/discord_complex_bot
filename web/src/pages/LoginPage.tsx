export function LoginPage() {
  return (
    <div className="login-page">
      <h1>🎧 discord_complex_bot</h1>
      <p className="muted">Music, moderation and more — sign in with your Discord account.</p>
      <a href="/api/auth/login">
        <button style={{ padding: "12px 28px", fontSize: 16 }}>Login with Discord</button>
      </a>
    </div>
  );
}
