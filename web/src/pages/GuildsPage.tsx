import { Box, Button, Card, CardContent, Chip, Grid, Skeleton, Typography } from "@mui/material";
import { IconBarChart as BarChart, IconGavel as Gavel, IconGraphicEq as GraphicEq, IconPostAdd as PostAdd, IconSettings as Settings } from "../components/icons";
import { api } from "../api";
import { useGuilds } from "../queries";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { m3 } from "../theme";

export function GuildsPage() {
  const { me, loading } = useAuth();
  const guildsQuery = useGuilds();
  const guilds = guildsQuery.data;
  const guildsError = guildsQuery.error ? (guildsQuery.error as Error).message : null;

  const shell = (children: React.ReactNode) => (
    <AppShell me={me} title="Servers" onLogout={() => api.logout().then(() => window.location.reload())}>
      {children}
    </AppShell>
  );

  if (loading) {
    return shell(
      <Grid container spacing={2}>
        {[0, 1, 2].map((i) => (
          <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card>
              <CardContent>
                <Skeleton width="60%" />
                <Skeleton width="40%" />
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>,
    );
  }
  if (!me) {
    return shell(
      <Box sx={{ textAlign: "center", py: 8 }}>
        <Typography variant="body1" sx={{ color: "text.secondary", mb: 2 }}>
          Please log in with Discord to continue.
        </Typography>
        <Button href="/api/auth/login" variant="contained" size="large">
          Login with Discord
        </Button>
      </Box>,
    );
  }

  return shell(
    <Box>
      {guildsError && (
        <Typography variant="body2" sx={{ color: "error.main", mb: 2 }}>
          {guildsError}
        </Typography>
      )}
      {guilds && guilds.length === 0 && (
        <Typography variant="body2" sx={{ color: "text.secondary" }}>
          The bot is not on any of your servers yet. Invite it first: the link is in the project README.
        </Typography>
      )}
      <Grid container spacing={2}>
        {guilds?.map((g) => (
          <Grid key={g.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  <Box
                    sx={{
                      width: 44,
                      height: 44,
                      borderRadius: "12px",
                      bgcolor: m3.surfaceContainerHigh,
                      display: "grid",
                      placeItems: "center",
                      flexShrink: 0,
                    }}
                  >
                    <GraphicEq sx={{ color: "primary.main" }} />
                  </Box>
                  <Typography variant="h6" noWrap sx={{ flex: 1, minWidth: 0 }}>
                    {g.name}
                  </Typography>
                </Box>
                {g.is_admin && <Chip size="small" label="admin" color="primary" sx={{ alignSelf: "flex-start" }} />}
                <Box sx={{ mt: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
                  <Button href={`/guild/${g.id}`} variant="contained" size="small">
                    Open player
                  </Button>
                  {(g.access?.manage || g.access?.stats || g.access?.posts || g.access?.moderation || g.is_superadmin) && (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    {(g.access?.manage || g.access?.stats) && (
                      <Box sx={{ display: "flex", gap: 1 }}>
                        {g.access?.manage && (
                          <Button href={`/guild/${g.id}/admin`} variant="tonal" size="small" sx={{ flex: 1 }} startIcon={<Settings />}>
                            Manage
                          </Button>
                        )}
                        {g.access?.stats && (
                          <Button href={`/guild/${g.id}/stats`} variant="tonal" size="small" sx={{ flex: 1 }} startIcon={<BarChart />}>
                            Stats
                          </Button>
                        )}
                      </Box>
                    )}
                    {(g.access?.posts || g.access?.moderation) && (
                      <Box sx={{ display: "flex", gap: 1 }}>
                        {g.access?.posts && (
                          <Button href={`/guild/${g.id}/posts`} variant="tonal" size="small" sx={{ flex: 1 }} startIcon={<PostAdd />}>
                            Post
                          </Button>
                        )}
                        {g.access?.moderation && (
                          <Button href={`/guild/${g.id}/moderation`} variant="tonal" size="small" sx={{ flex: 1 }} startIcon={<Gavel />}>
                            Mod
                          </Button>
                        )}
                      </Box>
                    )}
                  </Box>
                )}
                </Box>
              </CardContent>
            </Card>
          </Grid>
        ))}
      </Grid>
    </Box>,
  );
}
