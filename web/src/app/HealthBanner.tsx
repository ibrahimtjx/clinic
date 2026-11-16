import { Alert, Anchor, Stack, Text } from '@mantine/core';
import { IconServerBolt } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useAuth } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { warningText, type HealthWarning } from '../settings/SystemHealthTab';
import { usePrefs } from './preferences';

/** Admins see server problems (replication lag, old backups, low disk) at the top (SPEC 15.4). */
export function HealthBanner() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const enabled = can('settings.manage');
  const q = useQuery({
    queryKey: ['system', 'warnings'],
    queryFn: () => api<{ warnings: HealthWarning[] }>('/system/warnings'),
    enabled,
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
  });
  const warnings = q.data?.warnings ?? [];
  if (!enabled || warnings.length === 0) return null;
  return (
    <Alert color="red" variant="light" icon={<IconServerBolt size={18} />} mb="lg" role="alert" data-testid="health-banner" title={t('health.bannerTitle')}>
      <Stack gap={2}>
        {warnings.slice(0, 3).map((w) => (
          <Text key={`${w.code}-${w.params.node ?? ''}`} size="sm">
            {warningText(t, w, lang, digits)}
          </Text>
        ))}
        <Anchor component={Link} to="/settings/system-health" size="sm">
          {t('health.open')}
        </Anchor>
      </Stack>
    </Alert>
  );
}
