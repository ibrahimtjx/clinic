import { ActionIcon, Anchor, Group, Indicator, Popover, ScrollArea, Stack, Text, Tooltip } from '@mantine/core';
import { IconBell, IconCheck } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { useAuth } from '../auth/AuthProvider';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import { useMyAssignments } from '../patients/queries';
import { usePrefs } from './preferences';

/** Top bar notifications (SPEC 4.3). M3: patients assigned to me (SPEC 5.4). */
export function NotificationsPopover() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { status } = useAuth();
  const qc = useQueryClient();
  const { can } = useAuth();
  const mine = useMyAssignments(status === 'signedIn');
  const items = mine.data ?? [];
  // Payment orders waiting at reception (SPEC 4.3).
  const waiting = useQuery({
    queryKey: ['billing', 'waiting-count'],
    queryFn: () => api<{ count: number }>('/payment-orders/waiting-count'),
    enabled: status === 'signedIn' && can('payment.collect'),
    refetchInterval: 20_000,
  });
  const waitingCount = waiting.data?.count ?? 0;
  const badge = items.length + waitingCount;

  return (
    <Popover position="bottom-end" shadow="md" width={340}>
      <Popover.Target>
        <Tooltip label={t('topbar.notifications')}>
          <Indicator label={badge} size={16} disabled={!badge} color="red" offset={4}>
            <ActionIcon variant="subtle" color="neutral" size="lg" aria-label={t('topbar.notifications')} data-testid="notifications">
              <IconBell size={20} stroke={1.6} />
            </ActionIcon>
          </Indicator>
        </Tooltip>
      </Popover.Target>
      <Popover.Dropdown p={0}>
        {waitingCount > 0 && (
          <Anchor component={Link} to="/billing" display="block" px="md" py="sm" fw={500} data-testid="waiting-orders">
            {t('billing.waitingOrders', { count: waitingCount })}
          </Anchor>
        )}
        {items.length === 0 && waitingCount === 0 ? (
          <Text size="sm" c="dimmed" ta="center" py="md">
            {t('topbar.noNotifications')}
          </Text>
        ) : items.length === 0 ? null : (
          <ScrollArea.Autosize mah={360}>
            <Stack gap={0}>
              <Text size="xs" fw={600} c="dimmed" px="md" pt="sm" pb={4}>
                {t('patients.assignedToMe')}
              </Text>
              {items.map((a) => (
                <Group key={a.id} justify="space-between" wrap="nowrap" px="md" py="xs" align="flex-start" style={{ borderTop: '1px solid var(--app-border)' }}>
                  <div>
                    <Anchor component={Link} to={`/patients/${a.patient_id}`} size="sm" fw={500}>
                      {(lang === 'ar' ? a.patient_name_ar : a.patient_name_en || a.patient_name_ar) ?? ''} · {a.patient_file_no}
                    </Anchor>
                    <Text size="sm">{a.note}</Text>
                    <Text size="xs" c="dimmed">
                      {a.assigned_by_name} · {formatDateTime(a.created_at, lang, digits)}
                    </Text>
                  </div>
                  <Tooltip label={t('patients.markDone')}>
                    <ActionIcon
                      variant="light"
                      color="green"
                      onClick={async () => {
                        await api(`/assignments/${a.id}/done`, { method: 'POST' }).catch(() => {});
                        await qc.invalidateQueries({ queryKey: ['assignments', 'mine'] });
                        await qc.invalidateQueries({ queryKey: ['patients', 'assignments', a.patient_id] });
                      }}
                      aria-label={t('patients.markDone')}
                    >
                      <IconCheck size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              ))}
            </Stack>
          </ScrollArea.Autosize>
        )}
      </Popover.Dropdown>
    </Popover>
  );
}
