import { Box, Button, Card, CardContent, Typography } from "@mui/material";
import GraphicEq from "@mui/icons-material/GraphicEq";

export function LoginPage() {
  return (
    <Box sx={{ minHeight: "100vh", display: "grid", placeItems: "center", p: 2 }}>
      <Card sx={{ maxWidth: 420, width: "100%" }}>
        <CardContent sx={{ textAlign: "center", py: 6, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
          <GraphicEq sx={{ fontSize: 48, color: "primary.main" }} />
          <Typography variant="h5">Discord Council Bot</Typography>
          <Typography variant="body2" sx={{ color: "text.secondary" }}>
            Music, moderation and more. Sign in with your Discord account.
          </Typography>
          <Button href="/api/auth/login" variant="contained" size="large" sx={{ mt: 1 }}>
            Login with Discord
          </Button>
        </CardContent>
      </Card>
    </Box>
  );
}
