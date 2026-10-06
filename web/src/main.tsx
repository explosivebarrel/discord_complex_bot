import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { LoginPage } from "./pages/LoginPage";
import { GuildsPage } from "./pages/GuildsPage";
import { PlayerPage } from "./pages/PlayerPage";
import { AdminPage } from "./pages/AdminPage";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<GuildsPage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/guild/:guildId" element={<PlayerPage />} />
        <Route path="/guild/:guildId/admin" element={<AdminPage />} />
      </Routes>
    </BrowserRouter>
  </React.StrictMode>,
);
