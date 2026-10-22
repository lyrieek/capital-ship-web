import { useTranslation } from "react-i18next";
import { Route, Routes, NavLink } from "react-router-dom";
import LanguageSwitcher from "./components/LanguageSwitcher";
import BattleCanvas from "./components/BattleCanvas";
import TestHub from "./playground/TestHub";
import TestExpanse from "./playground/TestExpanse";
import TestWeapons from "./playground/TestWeapons";
import TestShip from "./playground/TestShip";
import "./App.css";

function App() {
  const { t } = useTranslation();

  const NAV_ITEMS = [
    // 根路径必须加 end
    { to: "/", label: "游戏", end: true },
    { to: "/hub", label: "HUD 测试中心" },
    { to: "/expanse", label: t("expanse.title") },
    { to: "/weapons", label: t("weapons.title") },
    { to: "/ship", label: t("ship.title") },
  ];

  return (
    <div className="app">
      <header className="app-header">
        <h1>{t("title")}</h1>
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
        <Routes>
          <Route
            path="/"
            element={
              <section className="map-section">
                <BattleCanvas />
              </section>
            }
          />
          <Route path="/hub" element={<TestHub />} />
          <Route path="/expanse" element={<TestExpanse />} />
          <Route path="/weapons" element={<TestWeapons />} />
          <Route path="/ship" element={<TestShip />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
