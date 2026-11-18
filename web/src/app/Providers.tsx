import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
// Other fonts for Settings → Appearance; the browser downloads one only when it is chosen.
import '@fontsource/tajawal/400.css';
import '@fontsource/tajawal/500.css';
import '@fontsource/tajawal/700.css';
import '@fontsource/cairo/400.css';
import '@fontsource/cairo/500.css';
import '@fontsource/cairo/600.css';
import '@fontsource/noto-naskh-arabic/400.css';
import '@fontsource/noto-naskh-arabic/500.css';
import '@fontsource/noto-naskh-arabic/600.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
import './global.css';

import { DirectionProvider, MantineProvider, localStorageColorSchemeManager } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import i18n, { dirOf, type Lang } from '../i18n';
import { PreferencesProvider } from './preferences';
import { buildTheme, cssVariablesResolver, type FontKey } from './theme';

const colorSchemeManager = localStorageColorSchemeManager({ key: 'clinic.color-scheme' });

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
  });
}

export function Providers({ children, queryClient }: { children: ReactNode; queryClient?: QueryClient }) {
  const [lang, setLang] = useLocalStorage<Lang>({ key: 'clinic.lang', defaultValue: 'ar', getInitialValueInEffect: false });
  const [font, setFont] = useLocalStorage<FontKey>({ key: 'clinic.font', defaultValue: 'plex', getInitialValueInEffect: false });
  const [fontScale, setFontScale] = useLocalStorage<number>({ key: 'clinic.font-scale', defaultValue: 100, getInitialValueInEffect: false });
  const theme = useMemo(() => buildTheme(lang, font), [lang, font]);
  // Every size in the app is in rem, so the root size scales all text and spacing together.
  useEffect(() => {
    document.documentElement.style.fontSize = fontScale === 100 ? '' : `${fontScale}%`;
  }, [fontScale]);
  const client = useMemo(() => queryClient ?? makeQueryClient(), [queryClient]);
  const dir = dirOf(lang);
  // In-memory resources make this synchronous, so the first paint is already in the right language.
  if (i18n.language !== lang) void i18n.changeLanguage(lang);

  return (
    <QueryClientProvider client={client}>
      <I18nextProvider i18n={i18n}>
        <DirectionProvider initialDirection={dir} detectDirection={false}>
          <MantineProvider
            theme={theme}
            cssVariablesResolver={cssVariablesResolver}
            colorSchemeManager={colorSchemeManager}
            defaultColorScheme="light"
          >
            <Notifications position={dir === 'rtl' ? 'top-left' : 'top-right'} />
            <PreferencesProvider lang={lang} setLang={setLang} font={font} setFont={setFont} fontScale={fontScale} setFontScale={setFontScale}>
              {children}
            </PreferencesProvider>
          </MantineProvider>
        </DirectionProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
