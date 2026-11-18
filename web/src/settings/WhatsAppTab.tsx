import { Alert, Button, Card, Group, Paper, SimpleGrid, Skeleton, Stack, Text, Textarea } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { fillTemplate, useWhatsAppSettings, type WhatsAppSettings } from '../lib/whatsapp';
import { useClinicInfo } from '../master/queries';

/** The appointment reminder text sent through WhatsApp (click to send from the reception PC). */
export function WhatsAppTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const q = useWhatsAppSettings();
  const clinic = useClinicInfo();
  const [form, setForm] = useState<WhatsAppSettings | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (q.data) setForm(q.data);
  }, [q.data]);
  if (!form) return <Skeleton height={300} />;
  const sample = (ar: boolean) => ({
    patient: ar ? 'سارة أحمد' : 'Sara Ahmed',
    day: ar ? 'الأحد' : 'Sunday',
    date: '23/11/2026',
    time: ar ? '04:30 م' : '04:30 PM',
    doctor: ar ? 'د. ريم الحربي' : 'Dr. Reem Alharbi',
    room: ar ? 'غرفة 2' : 'Room 2',
    clinic: (ar ? clinic.data?.name_ar : clinic.data?.name_en) || '',
    phone: clinic.data?.phone || '',
  });
  return (
    <Card data-testid="whatsapp-tab">
      <Stack>
        <Text fw={600}>{t('settings.tabs.whatsapp')}</Text>
        <Text size="sm" c="dimmed">
          {t('whatsapp.settingsHint')}
        </Text>
        {error !== null && <Alert color="red">{errorMessage(t, error, lang)}</Alert>}
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          {(['ar', 'en'] as const).map((l) => {
            const key = l === 'ar' ? 'template_ar' : 'template_en';
            return (
              <Stack key={l} gap="xs">
                <Textarea
                  label={l === 'ar' ? t('whatsapp.templateAr') : t('whatsapp.templateEn')}
                  value={form[key]}
                  onChange={(e) => setForm({ ...form, [key]: e.currentTarget.value })}
                  autosize
                  minRows={5}
                  maxLength={1000}
                  dir={l === 'ar' ? 'rtl' : 'ltr'}
                  data-testid={`wa-template-${l}`}
                />
                <Text size="xs" c="dimmed">
                  {t('whatsapp.preview')}
                </Text>
                <Paper withBorder p="sm" bg="var(--mantine-color-green-light)" dir={l === 'ar' ? 'rtl' : 'ltr'} style={{ whiteSpace: 'pre-wrap' }}>
                  <Text size="sm">{fillTemplate(form[key], sample(l === 'ar'))}</Text>
                </Paper>
              </Stack>
            );
          })}
        </SimpleGrid>
        <Group justify="flex-end">
          <Button
            disabled={JSON.stringify(form) === JSON.stringify(q.data)}
            onClick={async () => {
              try {
                qc.setQueryData(['settings', 'whatsapp'], await api<WhatsAppSettings>('/settings/whatsapp', { method: 'PUT', body: form }));
                setError(null);
                notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
              } catch (e) {
                setError(e);
              }
            }}
            data-testid="wa-save"
          >
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </Card>
  );
}
