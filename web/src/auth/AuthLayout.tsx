import { ActionIcon, Box, Card, Center, Group, Stack, Text, ThemeIcon, Title, Tooltip } from '@mantine/core';
import { IconLanguage, IconMoon, IconStethoscope, IconSun } from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs, useToggleTheme } from '../app/preferences';

/** Centered card used by the sign-in and forced password change screens. */
export function AuthLayout({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  const { t } = useTranslation();
  const { lang, setLang } = usePrefs();
  const { isDark, toggle } = useToggleTheme();
  return (
    <Box mih="100vh" bg="var(--app-bg)" p="md">
      <Group justify="flex-end" gap="xs">
        <Tooltip label={lang === 'ar' ? 'English' : 'العربية'}>
          <ActionIcon variant="subtle" color="neutral" size="lg" onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')} aria-label={t('topbar.language')} data-testid="auth-toggle-language">
            <IconLanguage size={20} />
          </ActionIcon>
        </Tooltip>
        <ActionIcon variant="subtle" color="neutral" size="lg" onClick={toggle} aria-label={t('topbar.theme')}>
          {isDark ? <IconSun size={20} /> : <IconMoon size={20} />}
        </ActionIcon>
      </Group>
      <Center mih="calc(100vh - 120px)">
        <Stack w="100%" maw={400} gap="lg">
          <Stack align="center" gap={6}>
            <ThemeIcon size={52} radius="lg">
              <IconStethoscope size={30} />
            </ThemeIcon>
            <Title order={2} mt="xs">
              {title}
            </Title>
            {subtitle && (
              <Text c="dimmed" size="sm" ta="center">
                {subtitle}
              </Text>
            )}
          </Stack>
          <Card padding="xl" shadow="md">
            {children}
          </Card>
        </Stack>
      </Center>
    </Box>
  );
}
