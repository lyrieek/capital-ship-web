import { useTranslation } from "react-i18next";
import { Route, Routes, Link, useLocation } from "react-router-dom";
import LanguageSwitcher from "./components/LanguageSwitcher";
import BattleCanvas from "./components/BattleCanvas";
import TestHub from "./playground/TestHub";
import "./App.css";

function App() {
  const { t } = useTranslation();
  const location = useLocation();

  return (
    <div className="app">
      <header className="app-header">
        <h1>{t("title")}</h1>
        <nav className="app-nav">
          <Link to="/" className={location.pathname === "/" ? "active" : ""}>
            {t("map")}
          </Link>
          <Link to="/hub" className={location.pathname === "/hub" ? "active" : ""}>
            HUD 测试中心
          </Link>
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
        </Routes>
      </main>
    </div>
  );
}

export default App;
