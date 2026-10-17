import React from 'react';
import { useTranslation } from 'react-i18next';
import './LanguageSwitcher.css';

const LanguageSwitcher: React.FC = () => {
  const { i18n, t } = useTranslation();
  
  const handleLanguageChange = (lng: string) => {
    i18n.changeLanguage(lng);
  };
  
  return (
    <div className="language-switcher">
      <label>{t('language')}:</label>
      <select 
        value={i18n.language}
        onChange={(e) => handleLanguageChange(e.target.value)}
      >
        <option value="en">{t('english')}</option>
        <option value="zh">{t('chinese')}</option>
      </select>
    </div>
  );
};

export default LanguageSwitcher;