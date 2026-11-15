import { Alert, Badge, Button, Card, Code, Group, Select, SimpleGrid, Skeleton, Stack, Table, Text, TextInput } from '@mantine/core';
import { IconHistory } from '@tabler/icons-react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Fragment, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { displayName } from '../auth/AuthProvider';
import type { AuditRow } from '../auth/types';
import { EmptyState } from '../components/EmptyState';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { fetchAudit, keys, useUsers, type AuditFilters } from './queries';

const ACTIONS = ['create', 'update', 'delete', 'restore', 'read', 'export', 'login', 'login_failed', 'login_blocked', 'logout', 'lock', 'unlock'];
const TABLES = [
  'patients',
  'patient_insurance',
  'patient_assignments',
  'users',
  'roles',
  'role_permissions',
  'user_roles',
  'settings',
  'auth_sessions',
  'doctors',
  'services',
  'appointment_statuses',
  'visit_types',
  'saved_phrases',
  'clinics',
  'departments',
  'insurance_companies',
];
const ACTION_COLOR: Record<string, string> = {
  create: 'green',
  update: 'blue',
  delete: 'red',
  restore: 'cyan',
  login_failed: 'orange',
  login_blocked: 'red',
};

/** Audit trail viewer (SPEC 3.4). */
export function AuditTab() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const users = useUsers();
  const [filters, setFilters] = useState<AuditFilters>({});
  const [open, setOpen] = useState<number | null>(null);
  const q = useInfiniteQuery({
    queryKey: keys.audit(filters),
    queryFn: ({ pageParam }) => fetchAudit(filters, pageParam),
    initialPageParam: undefined as number | undefined,
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <Stack>
      <Card>
        <SimpleGrid cols={{ base: 1, sm: 2, md: 4 }}>
          <Select label={t('audit.table')} data={TABLES.map((v) => ({ value: v, label: t(`audit.tables.${v}`, { defaultValue: v }) }))} value={filters.table_name ?? null} onChange={(v) => setFilters({ ...filters, table_name: v ?? undefined })} clearable />
          <Select label={t('audit.action')} data={ACTIONS.map((v) => ({ value: v, label: t(`audit.actions.${v}`, { defaultValue: v }) }))} value={filters.action ?? null} onChange={(v) => setFilters({ ...filters, action: v ?? undefined })} clearable />
          <Select
            label={t('audit.user')}
            data={(users.data ?? []).map((u) => ({ value: String(u.id), label: displayName(u, lang) }))}
            value={filters.user_id ? String(filters.user_id) : null}
            onChange={(v) => setFilters({ ...filters, user_id: v ? Number(v) : undefined })}
            clearable
            searchable
          />
          <TextInput label={t('audit.recordId')} value={filters.record_id ?? ''} onChange={(e) => setFilters({ ...filters, record_id: e.currentTarget.value || undefined })} dir="ltr" />
        </SimpleGrid>
      </Card>
      <Card padding={0}>
        {q.isPending ? (
          <Stack p="md" gap="sm">
            {[0, 1, 2, 3, 4].map((i) => (
              <Skeleton key={i} height={26} />
            ))}
          </Stack>
        ) : q.isError ? (
          <Alert m="md" color="red" variant="light">
            {errorMessage(t, q.error, lang)}
          </Alert>
        ) : rows.length === 0 ? (
          <EmptyState icon={IconHistory} title={t('audit.emptyTitle')} hint={t('audit.emptyHint')} />
        ) : (
          <Table.ScrollContainer minWidth={820}>
            <Table data-testid="audit-table">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>{t('audit.at')}</Table.Th>
                  <Table.Th>{t('audit.user')}</Table.Th>
                  <Table.Th>{t('audit.action')}</Table.Th>
                  <Table.Th>{t('audit.table')}</Table.Th>
                  <Table.Th>{t('audit.recordId')}</Table.Th>
                  <Table.Th>{t('audit.machine')}</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {rows.map((r) => (
                  <Fragment key={r.id}>
                    <Table.Tr onClick={() => setOpen(open === r.id ? null : r.id)} style={{ cursor: 'pointer' }}>
                      <Table.Td fz="sm">{formatDateTime(r.at, lang, digits)}</Table.Td>
                      <Table.Td>{r.user_name ?? '—'}</Table.Td>
                      <Table.Td>
                        <Badge color={ACTION_COLOR[r.action] ?? 'neutral'}>{t(`audit.actions.${r.action}`, { defaultValue: r.action })}</Badge>
                      </Table.Td>
                      <Table.Td>{t(`audit.tables.${r.table_name}`, { defaultValue: r.table_name })}</Table.Td>
                      <Table.Td fz="sm" c="dimmed">
                        <span dir="ltr">{r.record_id ?? '—'}</span>
                      </Table.Td>
                      <Table.Td fz="sm" c="dimmed">
                        <span dir="ltr">{r.machine ?? '—'}</span>
                        {r.ip ? <Text span size="xs" c="dimmed" dir="ltr">{` · ${r.ip}`}</Text> : null}
                      </Table.Td>
                    </Table.Tr>
                    {open === r.id && (
                      <Table.Tr>
                        <Table.Td colSpan={6}>
                          <Changes row={r} />
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Fragment>
                ))}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        )}
        {q.hasNextPage && (
          <Group justify="center" p="md">
            <Button variant="light" onClick={() => void q.fetchNextPage()} loading={q.isFetchingNextPage}>
              {t('common.loadMore')}
            </Button>
          </Group>
        )}
      </Card>
    </Stack>
  );
}

function Changes({ row }: { row: AuditRow }) {
  const { t } = useTranslation();
  const keysOf = [...new Set([...Object.keys(row.old_json ?? {}), ...Object.keys(row.new_json ?? {})])];
  if (!keysOf.length) return <Text size="sm" c="dimmed">{t('audit.noDetails')}</Text>;
  const show = (v: unknown) => (v === undefined ? '' : JSON.stringify(v));
  return (
    <Table withRowBorders={false} fz="xs" dir="ltr">
      <Table.Thead>
        <Table.Tr>
          <Table.Th>{t('audit.field')}</Table.Th>
          <Table.Th>{t('audit.old')}</Table.Th>
          <Table.Th>{t('audit.new')}</Table.Th>
        </Table.Tr>
      </Table.Thead>
      <Table.Tbody>
        {keysOf.map((k) => (
          <Table.Tr key={k}>
            <Table.Td>
              <Code>{k}</Code>
            </Table.Td>
            <Table.Td c="red">{show(row.old_json?.[k])}</Table.Td>
            <Table.Td c="green">{show(row.new_json?.[k])}</Table.Td>
          </Table.Tr>
        ))}
      </Table.Tbody>
    </Table>
  );
}
