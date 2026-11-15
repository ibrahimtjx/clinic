import { Alert, Button, Card, Group, NumberInput, Skeleton, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import type { QueueSettings } from '../queue/types';

/** Wait-time colors on the queue board (SPEC 7.1: amber after 15, red after 30, configurable). */
export function QueueSettingsTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['settings', 'queue'], queryFn: () => api<QueueSettings>('/settings/queue') });
  const [form, setForm] = useState<QueueSettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);
  if (!form) return <Skeleton height={200} />;
  return (
    <Card maw={520}>
      <Stack>
        <Text fw={600}>{t('settings.tabs.queueSettings')}</Text>
        {error !== null && <Alert color="red">{errorMessage(t, error, lang)}</Alert>}
        <NumberInput label={t('queue.warnAfter')} value={form.warn_minutes} onChange={(v) => setForm({ ...form, warn_minutes: Number(v) || 1 })} min={1} max={240} allowDecimal={false} />
        <NumberInput label={t('queue.lateAfter')} value={form.late_minutes} onChange={(v) => setForm({ ...form, late_minutes: Number(v) || 2 })} min={2} max={480} allowDecimal={false} />
        <Group justify="flex-end">
          <Button
            disabled={JSON.stringify(form) === JSON.stringify(q.data)}
            onClick={async () => {
              try {
                qc.setQueryData(['settings', 'queue'], await api<QueueSettings>('/settings/queue', { method: 'PUT', body: form }));
                setError(null);
                notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
              } catch (e) {
                setError(e);
              }
            }}
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
