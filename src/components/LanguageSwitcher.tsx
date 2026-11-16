import React from "react";
import { useTranslation } from "react-i18next";
import { Slider, type SliderOption } from "./Slider";
import "./LanguageSwitcher.css";

type Language = "zh" | "en";

const LANGUAGE_OPTIONS: readonly SliderOption<Language>[] = [
  { value: "zh", label: "中文" },
  { value: "en", label: "English" },
];

const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation();
  const current: Language = i18n.language?.startsWith("zh") ? "zh" : "en";

  const handleLanguageChange = (lng: Language) => {
    i18n.changeLanguage(lng);
  };

  return (
    <div className="language-switcher">
      <label>{t("language")}:</label>
      <Slider value={current} onChange={handleLanguageChange} options={LANGUAGE_OPTIONS} ariaLabel={t("language")} />
    </div>
  );
};

export default LanguageSwitcher;
