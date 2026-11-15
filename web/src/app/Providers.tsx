import '@fontsource/ibm-plex-sans-arabic/400.css';
import '@fontsource/ibm-plex-sans-arabic/500.css';
import '@fontsource/ibm-plex-sans-arabic/600.css';
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@mantine/core/styles.css';
import '@mantine/notifications/styles.css';
import '@mantine/spotlight/styles.css';
import './global.css';

import { DirectionProvider, MantineProvider, localStorageColorSchemeManager } from '@mantine/core';
import { useLocalStorage } from '@mantine/hooks';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useMemo, type ReactNode } from 'react';
import { I18nextProvider } from 'react-i18next';

import i18n, { dirOf, type Lang } from '../i18n';
import { PreferencesProvider } from './preferences';
import { buildTheme, cssVariablesResolver } from './theme';

const colorSchemeManager = localStorageColorSchemeManager({ key: 'clinic.color-scheme' });

export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 30_000 } },
  });
}

export function Providers({ children, queryClient }: { children: ReactNode; queryClient?: QueryClient }) {
  const [lang, setLang] = useLocalStorage<Lang>({ key: 'clinic.lang', defaultValue: 'ar', getInitialValueInEffect: false });
  const theme = useMemo(() => buildTheme(lang), [lang]);
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
            <PreferencesProvider lang={lang} setLang={setLang}>
              {children}
            </PreferencesProvider>
          </MantineProvider>
        </DirectionProvider>
      </I18nextProvider>
    </QueryClientProvider>
  );
}
