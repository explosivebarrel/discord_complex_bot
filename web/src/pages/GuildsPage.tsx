import { useState } from "react";
import { Avatar, Box, Button, Card, CardContent, Chip, Grid, IconButton, ListItemText, Menu, MenuItem, Skeleton, Tooltip, Typography } from "@mui/material";
import { IconBarChart as BarChart, IconGavel as Gavel, IconGraphicEq as GraphicEq, IconPostAdd as PostAdd, IconSettings as Settings } from "../components/icons";
import { api, guildAllows, type AccessMockTier, type GuildBrief } from "../api";
import { useGuilds, useMe, useSetAccessMock } from "../queries";
import { useAuth } from "../useAuth";
import { AppShell } from "../components/AppShell";
import { MsIcon } from "../components/MsIcon";
import { m3 } from "../theme";

function guildIconUrl(guild: GuildBrief) {
  if (!guild.icon) return undefined;
  return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.png?size=64`;
}

/** Guild card section button: disabled with a hint when no access. */
function SectionButton({ label, icon, href, enabled, primary }: { label: string; icon: React.ReactNode; href: string; enabled: boolean; primary?: boolean }) {
  const button = (
    <Button href={href} variant={primary ? "contained" : "tonal"} size="small" startIcon={icon} disabled={!enabled} sx={{ flex: 1 }}>
      {label}
    </Button>
  );
  return (
    <Tooltip title={enabled ? undefined : "You don't have access to this section"}>
      <span style={{ display: "flex", flex: 1 }}>{button}</span>
    </Tooltip>
  );
}

const MOCK_LABELS: Record<AccessMockTier | "real", string> = {
  real: "Real permissions",
  admin: "As admin",
  member: "As member",
  guest: "As guest",
};

/** Super-admin-only menu on a guild card: preview the panel as another tier. */
function MockMenu({ guild, mock }: { guild: GuildBrief; mock: AccessMockTier | null }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const setMock = useSetAccessMock();
  const choose = (tier: AccessMockTier | null) => {
    setAnchor(null);
    setMock.mutate({ guildId: guild.id, tier });
  };
  return (
    <>
      <Tooltip title="Preview as another tier">
        <IconButton
          size="small"
          aria-label="Preview as another tier"
          onClick={(e) => setAnchor(e.currentTarget)}
          sx={{ color: mock ? "primary.main" : "text.secondary" }}
        >
          <MsIcon name="switch_account" fontSize={20} />
        </IconButton>
      </Tooltip>
      <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
        {(["real", "admin", "member", "guest"] as const).map((tier) => (
          <MenuItem
            key={tier}
            selected={tier === "real" ? !mock : mock === tier}
            onClick={() => choose(tier === "real" ? null : tier)}
          >
            <ListItemText primary={MOCK_LABELS[tier]} />
          </MenuItem>
        ))}
      </Menu>
    </>
  );
}

export function GuildsPage() {
  const { me, loading } = useAuth();
  const guildsQuery = useGuilds();
  const meQuery = useMe();
  const guilds = guildsQuery.data;
  const guildsError = guildsQuery.error ? (guildsQuery.error as Error).message : null;

  const shell = (children: React.ReactNode) => (
    <AppShell me={me} title="Servers" onLogout={() => api.logout().then(() => window.location.reload())}>
      {children}
    </AppShell>
  );

  // First load (auth or the guilds fetch): card skeletons instead of an
  // empty grid under the "Servers" title.
  if (loading || (me && guildsQuery.isPending)) {
    return shell(
      <Grid container spacing={2}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <Grid key={i} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 1.5 }}>
                  <Skeleton variant="rounded" width={44} height={44} />
                  <Skeleton width="60%" />
                </Box>
                <Skeleton width="35%" sx={{ mb: 2.5 }} />
                <Skeleton variant="rounded" height={32} sx={{ mb: 1 }} />
                <Skeleton variant="rounded" height={32} />
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
        {guilds?.map((g) => {
          const mock = meQuery.data?.access_mock?.[g.id] ?? null;
          return (
          <Grid key={g.id} size={{ xs: 12, sm: 6, md: 4 }}>
            <Card sx={{ height: "100%" }}>
              <CardContent sx={{ display: "flex", flexDirection: "column", gap: 1.5, height: "100%" }}>
                <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
                  {/* The server's own icon fills the same rounded square the
                      bot glyph used to sit in; the letter covers no-icon guilds. */}
                  <Avatar
                    src={guildIconUrl(g)}
                    variant="rounded"
                    sx={{ width: 44, height: 44, borderRadius: "12px", bgcolor: m3.surfaceContainerHigh, fontSize: 18, flexShrink: 0 }}
                  >
                    {g.name.slice(0, 1)}
                  </Avatar>
                  <Typography variant="h6" noWrap sx={{ flex: 1, minWidth: 0 }}>
                    {g.name}
                  </Typography>
                  {me?.is_superadmin && <MockMenu guild={g} mock={mock} />}
                </Box>
                <Box sx={{ display: "flex", gap: 1, alignSelf: "flex-start" }}>
                  {g.is_admin && <Chip size="small" label="admin" color="primary" />}
                  {mock && <Chip size="small" label={`as ${mock}`} color="secondary" />}
                </Box>
                <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <SectionButton
                    label="Open player"
                    icon={<GraphicEq />}
                    href={`/guild/${g.id}`}
                    enabled={guildAllows(g, "player")}
                    primary
                  />
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <SectionButton
                        label="Manage"
                        icon={<Settings />}
                        href={`/guild/${g.id}/admin`}
                        enabled={guildAllows(g, "manage")}
                      />
                      <SectionButton
                        label="Stats"
                        icon={<BarChart />}
                        href={`/guild/${g.id}/stats`}
                        enabled={guildAllows(g, "stats")}
                      />
                    </Box>
                    <Box sx={{ display: "flex", gap: 1 }}>
                      <SectionButton
                        label="Post"
                        icon={<PostAdd />}
                        href={`/guild/${g.id}/posts`}
                        enabled={guildAllows(g, "posts")}
                      />
                      <SectionButton
                        label="Mod"
                        icon={<Gavel />}
                        href={`/guild/${g.id}/moderation`}
                        enabled={guildAllows(g, "moderation")}
                      />
                    </Box>
                  </Box>
                </Box>
              </CardContent>
            </Card>
          </Grid>
          );
        })}
      </Grid>
    </Box>,
  );
}
