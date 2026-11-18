import { Card, Group, Paper, SegmentedControl, SimpleGrid, Stack, Text, Title, UnstyledButton } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { usePrefs, useToggleTheme } from '../app/preferences';
import { FONTS, type FontKey } from '../app/theme';

const SIZES = [90, 100, 110, 120, 135] as const;

/** Settings → Appearance: each person's own text size, font, language, theme and digits. */
export function AppearanceTab() {
  const { t } = useTranslation();
  const { lang, setLang, digits, setDigits, font, setFont, fontScale, setFontScale } = usePrefs();
  const { isDark, setColorScheme } = useToggleTheme();

  return (
    <Card data-testid="appearance-tab">
      <Title order={3}>{t('appearance.title')}</Title>
      <Text size="sm" c="dimmed" mb="lg">
        {t('appearance.hint')}
      </Text>
      <Stack gap="xl">
        <div>
          <Text fw={600} mb={6}>
            {t('appearance.size')}
          </Text>
          <SegmentedControl
            value={String(fontScale)}
            onChange={(v) => setFontScale(Number(v))}
            data={SIZES.map((s) => ({ value: String(s), label: t(`appearance.sizes.${s}`) }))}
            data-testid="font-size"
          />
        </div>
        <div>
          <Text fw={600} mb={6}>
            {t('appearance.font')}
          </Text>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {(Object.keys(FONTS) as FontKey[]).map((k) => (
              <UnstyledButton key={k} onClick={() => setFont(k)} data-testid={`font-${k}`} aria-pressed={font === k}>
                <Paper
                  withBorder
                  p="md"
                  style={{
                    borderColor: font === k ? 'var(--mantine-color-accent-filled)' : undefined,
                    borderWidth: font === k ? 2 : 1,
                    fontFamily: `${FONTS[k][lang]}, system-ui, sans-serif`,
                  }}
                >
                  <Group justify="space-between" mb={4}>
                    <Text fw={600} ff="inherit">
                      {t(`appearance.fonts.${k}`)}
                    </Text>
                    {font === k && (
                      <Text size="xs" c="accent" fw={600}>
                        {t('appearance.current')}
                      </Text>
                    )}
                  </Group>
                  <Text size="lg" ff="inherit">
                    {t('appearance.sample')}
                  </Text>
                  <Text size="sm" c="dimmed" ff="inherit" dir="ltr">
                    Sara Ahmed · 0551234567 · 1,250.00
                  </Text>
                </Paper>
              </UnstyledButton>
            ))}
          </SimpleGrid>
        </div>
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <div>
            <Text fw={600} mb={6}>
              {t('appearance.language')}
            </Text>
            <SegmentedControl value={lang} onChange={(v) => setLang(v as 'ar' | 'en')} data={[{ value: 'ar', label: 'العربية' }, { value: 'en', label: 'English' }]} />
          </div>
          <div>
            <Text fw={600} mb={6}>
              {t('appearance.theme')}
            </Text>
            <SegmentedControl
              value={isDark ? 'dark' : 'light'}
              onChange={(v) => setColorScheme(v as 'light' | 'dark')}
              data={[
                { value: 'light', label: t('appearance.light') },
                { value: 'dark', label: t('appearance.dark') },
              ]}
            />
          </div>
          <div>
            <Text fw={600} mb={6}>
              {t('appearance.digits')}
            </Text>
            <SegmentedControl
              value={digits}
              onChange={(v) => setDigits(v as 'latn' | 'arab')}
              data={[
                { value: 'latn', label: '123' },
                { value: 'arab', label: '١٢٣' },
              ]}
            />
          </div>
        </SimpleGrid>
      </Stack>
    </Card>
  );
}
