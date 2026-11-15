import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import ar from './ar.json';
import en from './en.json';

export type Lang = 'ar' | 'en';
export const LANGS: Lang[] = ['ar', 'en'];
export const dirOf = (lang: Lang) => (lang === 'ar' ? 'rtl' : 'ltr');

void i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: 'ar',
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
  returnObjects: false,
});

export default i18n;
