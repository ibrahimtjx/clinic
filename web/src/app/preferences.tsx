import { useDirection, useMantineColorScheme } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { createContext, useContext, useEffect, type ReactNode } from 'react';

import i18n, { dirOf, type Lang } from '../i18n';
import type { DigitStyle } from '../lib/format';
import type { FontKey } from './theme';

/**
 * Per-user UI preferences (language, digits). Until sign-in exists (M1) they are kept
 * per browser; from M1 they are loaded from and saved to the user's profile on the server.
 */
interface Prefs {
  lang: Lang;
  setLang: (l: Lang) => void;
  digits: DigitStyle;
  setDigits: (d: DigitStyle) => void;
  font: FontKey;
  setFont: (f: FontKey) => void;
  fontScale: number;
  setFontScale: (n: number) => void;
}

const PrefsContext = createContext<Prefs | null>(null);

export function PreferencesProvider({
  children,
  lang,
  setLang,
  font = 'plex',
  setFont = () => {},
  fontScale = 100,
  setFontScale = () => {},
}: {
  children: ReactNode;
  lang: Lang;
  setLang: (l: Lang) => void;
  font?: FontKey;
  setFont?: (f: FontKey) => void;
  fontScale?: number;
  setFontScale?: (n: number) => void;
}) {
  const [digits, setDigits] = useLocalStorage<DigitStyle>({ key: 'clinic.digits', defaultValue: 'latn' });

  const { setDirection } = useDirection();

  useEffect(() => {
    document.documentElement.lang = lang;
    setDirection(dirOf(lang)); // also sets <html dir>
    void i18n.changeLanguage(lang);
  }, [lang, setDirection]);

  return <PrefsContext.Provider value={{ lang, setLang, digits, setDigits, font, setFont, fontScale, setFontScale }}>{children}</PrefsContext.Provider>;
}

export function usePrefs(): Prefs {
  const ctx = useContext(PrefsContext);
  if (!ctx) throw new Error('usePrefs outside PreferencesProvider');
  return ctx;
}

export function useToggleTheme() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();
  const isDark = colorScheme === 'dark';
  return { isDark, toggle: () => setColorScheme(isDark ? 'light' : 'dark'), setColorScheme };
}
