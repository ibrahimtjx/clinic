import { ActionIcon, Badge, Button, Group, Menu, Modal, SegmentedControl, Skeleton, Stack, Table, Text, Tooltip } from '@mantine/core';
import { IconBrandWhatsapp, IconCheck } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { formatTime } from '../lib/format';
import { useReminder, waNumber } from '../lib/whatsapp';
import { nameOf } from '../master/queries';
import type { Doctor } from '../master/types';
import { useAppointmentsRange } from './queries';
import type { Appointment } from './types';

/** "WhatsApp reminder": opens WhatsApp with the clinic's reminder text; the user presses Send. */
export function WhatsAppButton({ appointment, doctor, compact = false, onSent }: { appointment: Appointment; doctor: Doctor | undefined; compact?: boolean; onSent?: () => void }) {
  const { t } = useTranslation();
  const reminder = useReminder();
  const number = waNumber(appointment.patient?.mobile);
  const send = (language: 'ar' | 'en') => {
    if (reminder.send(appointment, doctor, language)) onSent?.();
  };
  const target = compact ? (
    <ActionIcon variant="light" color="green" disabled={!number || !reminder.ready} aria-label={t('whatsapp.remind')} data-testid={`wa-${appointment.id}`}>
      <IconBrandWhatsapp size={18} />
    </ActionIcon>
  ) : (
    <Button variant="light" color="green" leftSection={<IconBrandWhatsapp size={16} />} disabled={!number || !reminder.ready} data-testid="wa-remind">
      {t('whatsapp.remind')}
    </Button>
  );
  if (!number)
    return (
      <Tooltip label={t('whatsapp.noMobile')}>
        <span>{target}</span>
      </Tooltip>
    );
  return (
    <Menu position="top" withinPortal>
      <Menu.Target>{target}</Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{t('whatsapp.language')}</Menu.Label>
        <Menu.Item onClick={() => send('ar')} data-testid="wa-ar">
          العربية
        </Menu.Item>
        <Menu.Item onClick={() => send('en')} data-testid="wa-en">
          English
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/** Tomorrow's (or today's) appointments, one WhatsApp reminder button each. */
export function RemindersModal({ opened, onClose, doctors, statuses }: { opened: boolean; onClose: () => void; doctors: Doctor[]; statuses: Map<number, { key: string }> }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const [which, setWhich] = useState<'today' | 'tomorrow'>('tomorrow');
  const [done, setDone] = useState<Set<number>>(new Set());
  const day = dayjs().add(which === 'tomorrow' ? 1 : 0, 'day').format('YYYY-MM-DD');
  const q = useAppointmentsRange(day, day, doctors.map((d) => d.id), opened && doctors.length > 0);
  const rows = (q.data ?? []).filter((a) => a.blocks_slot && !['cancelled', 'no_show', 'completed'].includes(statuses.get(a.status_id)?.key ?? ''));
  const byId = new Map(doctors.map((d) => [d.id, d]));
  return (
    <Modal opened={opened} onClose={onClose} title={t('whatsapp.reminders')} size="xl">
      <Stack>
        <Group justify="space-between">
          <SegmentedControl
            value={which}
            onChange={(v) => setWhich(v as 'today' | 'tomorrow')}
            data={[
              { value: 'today', label: t('whatsapp.today') },
              { value: 'tomorrow', label: t('whatsapp.tomorrow') },
            ]}
          />
          <Text size="sm" c="dimmed">
            {t('whatsapp.progress', { done: rows.filter((a) => done.has(a.id)).length, total: rows.length })}
          </Text>
        </Group>
        <Text size="xs" c="dimmed">
          {t('whatsapp.how')}
        </Text>
        {q.isPending ? (
          <Skeleton height={120} />
        ) : rows.length === 0 ? (
          <Text c="dimmed" ta="center" py="lg">
            {t('whatsapp.none')}
          </Text>
        ) : (
          <Table data-testid="reminders-table">
            <Table.Tbody>
              {rows.map((a) => (
                <Table.Tr key={a.id}>
                  <Table.Td w={90} dir="ltr">
                    {formatTime(a.starts_at, lang, digits)}
                  </Table.Td>
                  <Table.Td>
                    <Text size="sm" fw={500}>
                      {lang === 'ar' ? a.patient?.name_ar : a.patient?.name_en || a.patient?.name_ar}
                    </Text>
                    <Text size="xs" c="dimmed" dir="ltr" ta="start">
                      {a.patient?.mobile ?? '—'}
                    </Text>
                  </Table.Td>
                  <Table.Td>{nameOf(byId.get(a.doctor_id), lang)}</Table.Td>
                  <Table.Td w={120}>
                    <Group gap={6} justify="flex-end" wrap="nowrap">
                      {done.has(a.id) && (
                        <Badge color="green" variant="light" leftSection={<IconCheck size={12} />}>
                          {t('whatsapp.opened')}
                        </Badge>
                      )}
                      <WhatsAppButton appointment={a} doctor={byId.get(a.doctor_id)} compact onSent={() => setDone((s) => new Set(s).add(a.id))} />
                    </Group>
                  </Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        )}
      </Stack>
    </Modal>
  );
}
