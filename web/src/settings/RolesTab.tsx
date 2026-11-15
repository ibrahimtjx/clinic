import { Alert, Button, Card, Checkbox, Group, Modal, Skeleton, Stack, Table, Text, TextInput, Tooltip } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconAlertCircle, IconCheck, IconPlus } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import type { Role } from '../auth/types';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { keys, usePermissions, useRoles } from './queries';
import classes from './RolesTab.module.css';

type Draft = Record<number, Set<string>>;

const toDraft = (roles: Role[]): Draft => Object.fromEntries(roles.map((r) => [r.id, new Set(r.permissions)]));

/** Role × permission matrix (SPEC 3.2). Admin always holds everything. */
export function RolesTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const roles = useRoles();
  const perms = usePermissions();
  const [draft, setDraft] = useState<Draft>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [newOpen, newRole] = useDisclosure(false);

  useEffect(() => {
    if (roles.data) setDraft(toDraft(roles.data));
  }, [roles.data]);

  const changed = useMemo(
    () => (roles.data ?? []).filter((r) => r.key !== 'admin' && draft[r.id] && !sameSet(draft[r.id], new Set(r.permissions))),
    [roles.data, draft],
  );
  const dirty = changed.length > 0;

  async function save(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      for (const r of changed) {
        await api(`/roles/${r.id}`, { method: 'PATCH', body: { version: r.version, permissions: [...draft[r.id]].sort() } });
      }
      await qc.invalidateQueries({ queryKey: keys.roles });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      return true;
    } catch (e) {
      setError(e);
      await qc.invalidateQueries({ queryKey: keys.roles });
      return false;
    } finally {
      setBusy(false);
    }
  }

  const guard = useUnsavedGuard(dirty, save);

  if (roles.isPending || perms.isPending) return <Skeleton height={400} radius="md" />;
  if (roles.isError || perms.isError) {
    return (
      <Alert color="red" variant="light">
        {errorMessage(t, roles.error ?? perms.error, lang)}
      </Alert>
    );
  }

  const groups = [...new Set(perms.data.map((p) => p.group))];
  const toggle = (roleId: number, perm: string, on: boolean) =>
    setDraft((d) => {
      const s = new Set(d[roleId]);
      if (on) s.add(perm);
      else s.delete(perm);
      return { ...d, [roleId]: s };
    });

  return (
    <Stack>
      {guard}
      {error !== null && (
        <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
          {errorMessage(t, error, lang)}
        </Alert>
      )}
      <Card padding={0}>
        <Group justify="space-between" p="md">
          <div>
            <Text fw={600}>{t('roles.title')}</Text>
            <Text size="sm" c="dimmed">
              {t('roles.hint')}
            </Text>
          </div>
          <Group gap="xs">
            <Button variant="light" leftSection={<IconPlus size={16} />} onClick={newRole.open}>
              {t('roles.new')}
            </Button>
            <Button onClick={() => void save()} loading={busy} disabled={!dirty} data-testid="save-roles">
              {t('common.save')}
            </Button>
          </Group>
        </Group>
        <Table.ScrollContainer minWidth={760} type="native" mah="calc(100vh - 300px)">
          <Table stickyHeader highlightOnHover={false} className={classes.matrix}>
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('roles.permission')}</Table.Th>
                {roles.data.map((r) => (
                  <Table.Th key={r.id} ta="center">
                    {lang === 'ar' ? r.name_ar : r.name_en}
                  </Table.Th>
                ))}
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {groups.map((g) => (
                <Fragment key={g}>
                  <Table.Tr className={classes.group}>
                    <Table.Td colSpan={roles.data.length + 1} fw={600}>
                      {t(`permGroups.${g}`, { defaultValue: g })}
                    </Table.Td>
                  </Table.Tr>
                  {perms.data
                    .filter((p) => p.group === g)
                    .map((p) => (
                      <Table.Tr key={p.key}>
                        <Table.Td>
                          <Text size="sm">{t(`perms.${p.key.replace('.', '_')}`, { defaultValue: p.key })}</Text>
                          <Text size="xs" c="dimmed" dir="ltr" ta="start">
                            {p.key}
                          </Text>
                        </Table.Td>
                        {roles.data.map((r) => (
                          <Table.Td key={r.id} ta="center">
                            {r.key === 'admin' ? (
                              <Tooltip label={t('roles.adminFixed')}>
                                <Checkbox checked readOnly disabled className={classes.cell} aria-label={`${r.key} ${p.key}`} />
                              </Tooltip>
                            ) : (
                              <Checkbox
                                className={classes.cell}
                                checked={draft[r.id]?.has(p.key) ?? false}
                                onChange={(e) => toggle(r.id, p.key, e.currentTarget.checked)}
                                aria-label={`${r.key} ${p.key}`}
                                data-testid={`perm-${r.key}-${p.key}`}
                              />
                            )}
                          </Table.Td>
                        ))}
                      </Table.Tr>
                    ))}
                </Fragment>
              ))}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      </Card>
      <NewRoleModal opened={newOpen} onClose={newRole.close} />
    </Stack>
  );
}

function NewRoleModal({ opened, onClose }: { opened: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const [form, setForm] = useState({ key: '', name_ar: '', name_en: '' });
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    setForm({ key: '', name_ar: '', name_en: '' });
    setError(null);
  }, [opened]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await api('/roles', { method: 'POST', body: { ...form, permissions: [] } });
      await qc.invalidateQueries({ queryKey: keys.roles });
      onClose();
    } catch (err) {
      setError(err);
    }
  }

  return (
    <Modal opened={opened} onClose={onClose} title={t('roles.new')} size="sm">
      <form onSubmit={submit}>
        <Stack>
          {error !== null && (
            <Alert color="red" variant="light">
              {errorMessage(t, error, lang)}
            </Alert>
          )}
          <TextInput label={t('roles.key')} description={t('roles.keyHint')} value={form.key} onChange={(e) => setForm({ ...form, key: e.currentTarget.value.toLowerCase() })} dir="ltr" required pattern="[a-z][a-z0-9_]*" />
          <TextInput label={t('users.nameAr')} value={form.name_ar} onChange={(e) => setForm({ ...form, name_ar: e.currentTarget.value })} required />
          <TextInput label={t('users.nameEn')} value={form.name_en} onChange={(e) => setForm({ ...form, name_en: e.currentTarget.value })} dir="ltr" required />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit">{t('common.save')}</Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}

function sameSet(a: Set<string>, b: Set<string>) {
  return a.size === b.size && [...a].every((x) => b.has(x));
}
