import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CssBaseline, GlobalStyles, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import theme from "./theme";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { LoginPage } from "./pages/LoginPage";
import { GuildsPage } from "./pages/GuildsPage";
import { PlayerPage } from "./pages/PlayerPage";
import { AdminPage } from "./pages/AdminPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsPage } from "./pages/StatsPage";
import { PostsPage } from "./pages/PostsPage";
import { ModerationPage } from "./pages/ModerationPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A failed request shows the page error; 401 already redirects in api.ts.
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme={theme}>
        <CssBaseline />
        {/* Local subset of Material Symbols Rounded (Google Material icons,
            https://fonts.google.com/icons): only the glyph names used by
            MsIcon, served from /fonts. */}
        <GlobalStyles
          styles={{
            "@font-face": {
              fontFamily: '"Material Symbols Rounded"',
              fontStyle: "normal",
              fontWeight: "100 700",
              fontDisplay: "block",
              src: 'url("/fonts/material-symbols-rounded-subset.woff2") format("woff2")',
            },
          }}
        />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<GuildsPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/guild/:guildId" element={<PlayerPage />} />
            <Route path="/guild/:guildId/admin" element={<AdminPage />} />
            <Route path="/guild/:guildId/stats" element={<StatsPage />} />
            <Route path="/guild/:guildId/posts" element={<PostsPage />} />
            <Route path="/guild/:guildId/moderation" element={<ModerationPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Routes>
        </BrowserRouter>
      </ThemeProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
