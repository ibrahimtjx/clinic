import { Card, Group, SimpleGrid, Stack, Text, Title } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { useConnection } from '../app/connection';
import { usePrefs } from '../app/preferences';
import { displayName, useAuth } from '../auth/AuthProvider';
import { formatDateTime } from '../lib/format';

export function HomePage() {
  const { t } = useTranslation();
  const { health } = useConnection();
  const { lang, digits } = usePrefs();
  const { me } = useAuth();

  return (
    <Stack gap="lg" maw={1100}>
      <div>
        <Text c="dimmed" size="lg">
          {t('home.welcome')}
        </Text>
        <Title order={1} fz={{ base: '2rem', sm: '2.75rem' }} lh={1.2} data-testid="welcome-name">
          {me ? displayName(me, lang) : ''}
        </Title>
        <Text c="dimmed" mt={4}>
          {t('home.hint')}
        </Text>
      </div>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        <Card>
          <Text size="sm" c="dimmed">
            {t('home.serverTime')}
          </Text>
          <Text size="xl" fw={600} mt={4} data-testid="server-time">
            {health ? formatDateTime(health.server_time, lang, digits) : '—'}
          </Text>
          <Text size="xs" c="dimmed">{health?.timezone}</Text>
        </Card>
        <Card>
          <Group justify="space-between">
            <Text size="sm" c="dimmed">
              {t('home.version')}
            </Text>
          </Group>
          <Text size="xl" fw={600} mt={4}>
            {health?.version ?? '—'}
          </Text>
        </Card>
      </SimpleGrid>
    </Stack>
  );
}
