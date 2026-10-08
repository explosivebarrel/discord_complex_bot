import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CssBaseline, ThemeProvider } from "@mui/material";
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

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ThemeProvider theme={theme}>
      <CssBaseline />
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
  </React.StrictMode>,
);
