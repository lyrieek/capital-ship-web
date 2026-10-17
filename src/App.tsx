import { useTranslation } from "react-i18next";
import LanguageSwitcher from "./components/LanguageSwitcher";
import BattleCanvas from "./components/BattleCanvas";
import "./App.css";

function App() {
  const { t } = useTranslation();

  return (
    <div className="app">
      <header className="app-header">
        <h1>{t("title")}</h1>
        <LanguageSwitcher />
      </header>
      <main className="app-main">
        <section className="map-section">
          <BattleCanvas />
        </section>
      </main>
    </div>
  );
}

export default App;
