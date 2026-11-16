import { Alert, Badge, Card, Group, SimpleGrid, Skeleton, Stack, Table, Text, Title } from '@mantine/core';
import { IconAlertTriangle, IconCircleCheck } from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';

export interface HealthWarning {
  code: string;
  severity: 'danger' | 'warning';
  params: Record<string, string | number | null>;
}

interface Node {
  node: string;
  role: 'primary' | 'standby';
  updated_at: string;
  stale: boolean;
  disk_free_pct: number | null;
  backup_free_pct: number | null;
  disk_free: number | null;
  backup_free: number | null;
  last_wal_at: string | null;
  last_dump_at: string | null;
  last_dump_bytes: number | null;
  last_dump_file: string | null;
  last_basebackup_at: string | null;
  last_error: string | null;
  last_error_at: string | null;
}

interface Health {
  now: string;
  role: string;
  ok: boolean;
  replication: { application_name: string; client_addr: string | null; state: string; lag_seconds: number; bytes_behind: number }[];
  standby_slot: { active: boolean } | null;
  archiver: { archived_count: number; last_archived_time: string | null; failed_count: number; last_failed_time: string | null };
  nodes: Node[];
  warnings: HealthWarning[];
}

const size = (b: number | null) => (b === null ? '—' : b >= 1024 ** 3 ? `${(b / 1024 ** 3).toFixed(1)} GB` : `${(b / 1024 ** 2).toFixed(1)} MB`);
const pct = (p: number | null) => (p === null ? '—' : `${Math.round(p * 100)}%`);

/** A warning in words, with times shown in clinic time. */
export function warningText(t: TFunction, w: HealthWarning, lang: 'ar' | 'en', digits: 'latn' | 'arab') {
  const params = Object.fromEntries(Object.entries(w.params).map(([k, v]) => [k, k === 'at' ? (v ? formatDateTime(String(v), lang, digits) : t('health.never')) : v]));
  return t(`health.warnings.${w.code}`, params);
}

/** Settings → System health (SPEC 15.4). */
export function SystemHealthTab() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const q = useQuery({ queryKey: ['system', 'health'], queryFn: () => api<Health>('/system/health'), refetchInterval: 30_000 });
  const when = (v: string | null) => (v ? formatDateTime(v, lang, digits) : t('health.never'));
  if (q.isPending) return <Skeleton height={300} />;
  if (q.isError) return <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>;
  const h = q.data;
  return (
    <Stack data-testid="system-health">
      <Title order={2}>{t('settings.tabs.systemHealth')}</Title>
      <Alert color={h.ok ? 'green' : 'red'} icon={h.ok ? <IconCircleCheck /> : <IconAlertTriangle />} title={h.ok ? t('health.allGood') : t('health.attention')} data-testid="health-status">
        {h.warnings.length === 0 ? (
          t('health.allGoodHint')
        ) : (
          <Stack gap={4}>
            {h.warnings.map((w) => (
              <Text key={`${w.code}-${w.params.node ?? ''}`} size="sm" c={w.severity === 'danger' ? undefined : 'dimmed'}>
                • {warningText(t, w, lang, digits)}
              </Text>
            ))}
          </Stack>
        )}
      </Alert>

      <Card withBorder padding={0}>
        <Text fw={600} p="sm">
          {t('health.servers')}
        </Text>
        <Table.ScrollContainer minWidth={900}>
          <Table data-testid="health-nodes">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('health.server')}</Table.Th>
                <Table.Th>{t('health.lastReport')}</Table.Th>
                <Table.Th>{t('health.diskFree')}</Table.Th>
                <Table.Th>{t('health.backupFree')}</Table.Th>
                <Table.Th>{t('health.lastWal')}</Table.Th>
                <Table.Th>{t('health.lastBackup')}</Table.Th>
                <Table.Th>{t('health.lastBase')}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {h.nodes.map((n) => (
                <Table.Tr key={n.node}>
                  <Table.Td>
                    <Group gap={6}>
                      <Text fw={600} dir="ltr">
                        {n.node}
                      </Text>
                      <Badge color={n.role === 'primary' ? 'teal' : 'blue'} variant="light">
                        {t(`health.roles.${n.role}`)}
                      </Badge>
                    </Group>
                    {n.last_error && (
                      <Text size="xs" c="red">
                        {n.last_error} ({when(n.last_error_at)})
                      </Text>
                    )}
                  </Table.Td>
                  <Table.Td c={n.stale ? 'red' : undefined}>{when(n.updated_at)}</Table.Td>
                  <Table.Td dir="ltr">
                    {pct(n.disk_free_pct)} · {size(n.disk_free)}
                  </Table.Td>
                  <Table.Td dir="ltr">
                    {pct(n.backup_free_pct)} · {size(n.backup_free)}
                  </Table.Td>
                  <Table.Td>{n.role === 'primary' ? when(n.last_wal_at) : '—'}</Table.Td>
                  <Table.Td>
                    {n.role === 'primary' ? (
                      <>
                        {when(n.last_dump_at)}
                        {n.last_dump_bytes !== null && (
                          <Text span size="xs" c="dimmed" dir="ltr">
                            {' '}
                            ({size(n.last_dump_bytes)})
                          </Text>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </Table.Td>
                  <Table.Td>{n.role === 'primary' ? when(n.last_basebackup_at) : '—'}</Table.Td>
                </Table.Tr>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>

      <SimpleGrid cols={{ base: 1, md: 2 }}>
        <Card withBorder>
          <Text fw={600} mb="xs">
            {t('health.replication')}
          </Text>
          {h.replication.length === 0 ? (
            <Text size="sm" c="dimmed">
              {h.standby_slot ? t('health.standbyDisconnected') : t('health.noStandby')}
            </Text>
          ) : (
            h.replication.map((r) => (
              <Group key={`${r.client_addr}-${r.application_name}`} justify="space-between">
                <Text size="sm" dir="ltr">
                  {r.client_addr ?? r.application_name} · {r.state}
                </Text>
                <Text size="sm" fw={600} data-testid="replication-lag">
                  {t('health.lag', { seconds: Math.round(r.lag_seconds) })}
                </Text>
              </Group>
            ))
          )}
        </Card>
        <Card withBorder>
          <Text fw={600} mb="xs">
            {t('health.archiving')}
          </Text>
          <Text size="sm">
            {t('health.lastArchived')}: {when(h.archiver.last_archived_time)}
          </Text>
          <Text size="sm" c={h.archiver.failed_count ? 'red' : 'dimmed'}>
            {t('health.archiveFailures', { n: h.archiver.failed_count })}
            {h.archiver.last_failed_time ? ` · ${when(h.archiver.last_failed_time)}` : ''}
          </Text>
        </Card>
      </SimpleGrid>
      <Text size="xs" c="dimmed">
        {t('health.footer')}
      </Text>
    </Stack>
  );
}
