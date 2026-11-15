import { Alert, Button, Card, Group, NumberInput, Skeleton, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import type { SecuritySettings } from '../auth/types';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { keys, useSecurity } from './queries';

export function SecurityTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const q = useSecurity();
  const [form, setForm] = useState<SecuritySettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);

  const dirty = !!form && !!q.data && JSON.stringify(form) !== JSON.stringify(q.data);

  async function save(): Promise<boolean> {
    if (!form) return false;
    setBusy(true);
    setError(null);
    try {
      const saved = await api<SecuritySettings>('/settings/security', { method: 'PUT', body: form });
      qc.setQueryData(keys.security, saved);
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }
  const guard = useUnsavedGuard(dirty, save);

  if (!form) return <Skeleton height={260} radius="md" />;
  const field = (k: keyof SecuritySettings, min: number, max: number) => (
    <NumberInput
      label={t(`security.${k}`)}
      description={t(`security.${k}_hint`)}
      value={form[k]}
      min={min}
      max={max}
      clampBehavior="strict"
      allowDecimal={false}
      onChange={(v) => setForm({ ...form, [k]: Number(v) || min })}
      maw={320}
    />
  );

  return (
    <Card maw={640}>
      {guard}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <Stack>
          <Text fw={600}>{t('settings.tabs.security')}</Text>
          {error !== null && (
            <Alert color="red" variant="light">
              {errorMessage(t, error, lang)}
            </Alert>
          )}
          {field('auto_lock_minutes', 1, 120)}
          {field('lockout_attempts', 3, 20)}
          {field('lockout_minutes', 1, 240)}
          <Text size="xs" c="dimmed">
            {t('security.note')}
          </Text>
          <Group justify="flex-end">
            <Button type="submit" loading={busy} disabled={!dirty}>
              {t('common.save')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Card>
  );
}
