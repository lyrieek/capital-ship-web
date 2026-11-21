import { Suspense, lazy } from "react";
import { useTranslation } from "react-i18next";
import { Route, Routes, NavLink } from "react-router-dom";
import LanguageSwitcher from "./components/LanguageSwitcher";
import BattleCanvas from "./components/BattleCanvas";
import "./App.css";

const TestHud = lazy(() => import("./playground/TestHud"));
const TestExpanse = lazy(() => import("./playground/TestExpanse"));
const TestWeapons = lazy(() => import("./playground/TestWeapons"));
const TestShip = lazy(() => import("./playground/TestShip"));

function App() {
  const { t } = useTranslation();

  const NAV_ITEMS = [
    // 根路径必须加 end
    { to: "/", label: t("title"), end: true },
    { to: "/hud", label: "HUD 测试中心" },
    { to: "/expanse", label: t("expanse.title") },
    { to: "/weapons", label: t("weapons.title") },
    { to: "/ship", label: t("ship.title") },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <nav className="app-nav">
          {NAV_ITEMS.map(({ to, label, end }) => (
            <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? "active" : "")}>
              {label}
            </NavLink>
          ))}
          <LanguageSwitcher />
        </nav>
      </header>
      <main className="app-main">
        <Suspense fallback={<div className="app-loading">Loading...</div>}>
          <Routes>
            <Route
              path="/"
              element={
                <section className="map-section">
                  <BattleCanvas />
                </section>
              }
            />
            <Route path="/hud" element={<TestHud />} />
            <Route path="/expanse" element={<TestExpanse />} />
            <Route path="/weapons" element={<TestWeapons />} />
            <Route path="/ship" element={<TestShip />} />
          </Routes>
        </Suspense>
      </main>
    </div>
  );
}

export default App;
