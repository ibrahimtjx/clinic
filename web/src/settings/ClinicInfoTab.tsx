import { Alert, Button, Card, Group, SimpleGrid, Skeleton, Stack, Text, Textarea, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { useClinicInfo } from '../master/queries';
import type { ClinicInfo } from '../master/types';

/** Clinic details for the header, letterhead and invoices (SPEC 12). Logo upload comes with printing. */
export function ClinicInfoTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const q = useClinicInfo();
  const [form, setForm] = useState<ClinicInfo | null>(null);
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
      qc.setQueryData(['settings', 'clinic'], await api<ClinicInfo>('/settings/clinic', { method: 'PUT', body: form }));
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
  if (!form) return <Skeleton height={360} radius="md" />;
  const f = (k: keyof ClinicInfo, ltr = false, extra: object = {}) => (
    <TextInput label={t(`clinicInfo.${k}`)} value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.currentTarget.value })} dir={ltr ? 'ltr' : undefined} {...extra} />
  );

  return (
    <Card maw={760}>
      {guard}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        data-testid="clinic-info-form"
      >
        <Stack>
          <Text fw={600}>{t('settings.tabs.clinicInfo')}</Text>
          {error !== null && (
            <Alert color="red" variant="light">
              {errorMessage(t, error, lang)}
            </Alert>
          )}
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {f('name_ar')}
            {f('name_en', true)}
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Textarea label={t('clinicInfo.address_ar')} value={form.address_ar} onChange={(e) => setForm({ ...form, address_ar: e.currentTarget.value })} autosize minRows={2} />
            <Textarea label={t('clinicInfo.address_en')} value={form.address_en} onChange={(e) => setForm({ ...form, address_en: e.currentTarget.value })} autosize minRows={2} dir="ltr" />
          </SimpleGrid>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            {f('phone', true)}
            {f('email', true, { type: 'email' })}
            {f('vat_number', true, { description: t('clinicInfo.vatHint'), maxLength: 15, inputMode: 'numeric' })}
            {f('cr_number', true, { description: t('clinicInfo.crHint'), maxLength: 10, inputMode: 'numeric' })}
          </SimpleGrid>
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
