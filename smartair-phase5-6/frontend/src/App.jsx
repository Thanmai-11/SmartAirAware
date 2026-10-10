import { useState } from "react";
import Dashboard from "./pages/Dashboard.jsx";
import Settings from "./pages/Settings.jsx";

export default function App() {
  const [page, setPage] = useState(window.location.hash === "#settings" ? "settings" : "dashboard");
  const go = (p) => {
    window.location.hash = p === "settings" ? "settings" : "";
    setPage(p);
  };
  return (
    <div className="app">
      <nav className="topbar" aria-label="Main">
        <span className="brand">SmartAirAware</span>
        <div className="tabs">
          <button className={page === "dashboard" ? "tab on" : "tab"} onClick={() => go("dashboard")}>
            Schedule
          </button>
          <button className={page === "settings" ? "tab on" : "tab"} onClick={() => go("settings")}>
            Settings
          </button>
        </div>
      </nav>
      {page === "dashboard" ? <Dashboard onGoSettings={() => go("settings")} /> : <Settings />}
    </div>
  );
}
