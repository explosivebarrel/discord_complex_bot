import React, { useEffect, useMemo } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CssBaseline, GlobalStyles, ThemeProvider } from "@mui/material";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AppThemeContext, getGlassBackdrop, getGlassTuning } from "./themes/AppThemeContext";
import { buildTheme } from "./themes/buildTheme";
import { getScheme } from "./themes/palettes";
import { useLocalPrefValue } from "./useLocalPrefValue";
import { AuroraBackground } from "./components/AuroraBackground";
import { GlassBackground } from "./components/GlassBackground";
import "@fontsource/roboto/400.css";
import "@fontsource/roboto/500.css";
import "@fontsource/roboto/700.css";
import { LoginPage } from "./pages/LoginPage";
import { GuildsPage } from "./pages/GuildsPage";
import { PlayerPage } from "./pages/PlayerPage";
import { AboutPage } from "./pages/AboutPage";
import { AdminPage } from "./pages/AdminPage";
import { SettingsPage } from "./pages/SettingsPage";
import { StatsPage } from "./pages/StatsPage";
import { PostsPage } from "./pages/PostsPage";
import { ModerationPage } from "./pages/ModerationPage";
import { SandboxPage } from "./pages/SandboxPage";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // A failed request shows the page error; 401 already redirects in api.ts.
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

/** Theme provider + persisted theme choice + animated backdrops. */
function ThemedApp({ children }: { children: React.ReactNode }) {
  const [themeId, setThemeId] = useLocalPrefValue("ui.theme", "dark");
  const [glassBg, setGlassBg] = useLocalPrefValue("ui.glassBg", "stars-sparse");
  const [glassTuningRaw, setGlassTuningRaw] = useLocalPrefValue("ui.glassTuning", "");
  const [cbRaw, setCbRaw] = useLocalPrefValue("ui.cbPalette", "");
  const glassTuning = getGlassTuning(glassTuningRaw);
  const scheme = getScheme(themeId);
  const theme = useMemo(() => buildTheme(scheme), [scheme]);
  // Native widgets (scrollbars, form controls) follow the color scheme.
  useEffect(() => {
    document.documentElement.style.colorScheme = scheme.mode;
  }, [scheme]);
  return (
    <AppThemeContext.Provider
      value={{
        scheme,
        setThemeId,
        glassBackdrop: getGlassBackdrop(glassBg),
        setGlassBackdrop: setGlassBg,
        glassTuning,
        setGlassTuning: (t) => setGlassTuningRaw(JSON.stringify(t)),
        cbPalette: cbRaw === "1",
        setCbPalette: (v) => setCbRaw(v ? "1" : "0"),
      }}
    >
      <ThemeProvider theme={theme}>
        {scheme.aurora && <AuroraBackground />}
        {scheme.id === "glass" && <GlassBackground />}
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
              src: 'url("/fonts/material-symbols-rounded-subset.woff2?v=5") format("woff2")',
            },
          }}
        />
        {children}
      </ThemeProvider>
    </AppThemeContext.Provider>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ThemedApp>
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<GuildsPage />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/about" element={<AboutPage />} />
            <Route path="/guild/:guildId" element={<PlayerPage />} />
            <Route path="/guild/:guildId/admin" element={<AdminPage />} />
            <Route path="/guild/:guildId/stats" element={<StatsPage />} />
            <Route path="/guild/:guildId/posts" element={<PostsPage />} />
            <Route path="/guild/:guildId/moderation" element={<ModerationPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/sandbox" element={<SandboxPage />} />
          </Routes>
        </BrowserRouter>
      </ThemedApp>
    </QueryClientProvider>
  </React.StrictMode>,
);
