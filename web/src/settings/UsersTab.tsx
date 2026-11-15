import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  Group,
  Menu,
  Modal,
  PasswordInput,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle,
  IconCheck,
  IconDots,
  IconKey,
  IconLockOpen,
  IconPencil,
  IconPlus,
  IconUserCheck,
  IconUserOff,
  IconUsers,
  IconX,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { displayName, useAuth } from '../auth/AuthProvider';
import type { Role, User } from '../auth/types';
import { AppDrawer } from '../components/AppDrawer';
import { EmptyState } from '../components/EmptyState';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDateTime } from '../lib/format';
import { keys, useRoles, useUserAction, useUsers } from './queries';

export function UsersTab() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { me } = useAuth();
  const users = useUsers();
  const roles = useRoles();
  const action = useUserAction();
  const [editing, setEditing] = useState<User | 'new' | null>(null);
  const [resetting, setResetting] = useState<User | null>(null);

  const run = (u: User, a: 'unlock' | 'deactivate' | 'activate' | 'pin') =>
    action.mutate(
      { id: u.id, action: a },
      {
        onSuccess: () => notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t(`users.done.${a}`) }),
        onError: (e) => notifications.show({ color: 'red', icon: <IconX size={18} />, message: errorMessage(t, e, lang) }),
      },
    );

  const roleName = (r: { name_ar: string; name_en: string }) => (lang === 'ar' ? r.name_ar : r.name_en);
  const now = Date.now();

  return (
    <Card padding={0}>
      <Group justify="space-between" p="md">
        <Text fw={600}>{t('users.title')}</Text>
        <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')} data-testid="new-user">
          {t('users.new')}
        </Button>
      </Group>
      {users.isPending ? (
        <Stack p="md" gap="sm">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={28} />
          ))}
        </Stack>
      ) : users.isError ? (
        <Alert m="md" color="red" variant="light" icon={<IconAlertCircle size={18} />}>
          {errorMessage(t, users.error, lang)}
        </Alert>
      ) : users.data.length === 0 ? (
        <EmptyState icon={IconUsers} title={t('users.emptyTitle')} hint={t('users.emptyHint')} />
      ) : (
        <Table.ScrollContainer minWidth={820}>
          <Table data-testid="users-table">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t('users.name')}</Table.Th>
                <Table.Th>{t('auth.username')}</Table.Th>
                <Table.Th>{t('users.roles')}</Table.Th>
                <Table.Th>{t('users.status')}</Table.Th>
                <Table.Th>{t('users.pin')}</Table.Th>
                <Table.Th>{t('users.updated')}</Table.Th>
                <Table.Th w={48} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {users.data.map((u) => {
                const locked = u.locked_until && new Date(u.locked_until).getTime() > now;
                return (
                  <Table.Tr key={u.id} data-testid={`user-row-${u.username}`}>
                    <Table.Td fw={500}>
                      {displayName(u, lang)}
                      {u.id === me?.id && (
                        <Text span size="xs" c="dimmed">
                          {' '}
                          ({t('users.you')})
                        </Text>
                      )}
                    </Table.Td>
                    <Table.Td>
                      <span dir="ltr">{u.username}</span>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {u.roles.map((r) => (
                          <Badge key={r.id} color="accent" variant="light">
                            {roleName(r)}
                          </Badge>
                        ))}
                      </Group>
                    </Table.Td>
                    <Table.Td>
                      <Group gap={4}>
                        {!u.is_active ? (
                          <Badge color="neutral">{t('users.inactive')}</Badge>
                        ) : locked ? (
                          <Tooltip label={t('users.lockedUntil', { time: formatDateTime(u.locked_until!, lang, digits) })}>
                            <Badge color="red">{t('users.locked')}</Badge>
                          </Tooltip>
                        ) : (
                          <Badge color="green">{t('users.active')}</Badge>
                        )}
                        {u.must_change_password && <Badge color="yellow">{t('users.mustChange')}</Badge>}
                      </Group>
                    </Table.Td>
                    <Table.Td>{u.has_pin ? t('common.yes') : '—'}</Table.Td>
                    <Table.Td c="dimmed" fz="sm">
                      {formatDateTime(u.updated_at, lang, digits)}
                    </Table.Td>
                    <Table.Td>
                      <Menu position="bottom-end" withinPortal>
                        <Menu.Target>
                          <ActionIcon variant="subtle" color="neutral" aria-label={t('common.actions')} data-testid={`user-menu-${u.username}`}>
                            <IconDots size={18} />
                          </ActionIcon>
                        </Menu.Target>
                        <Menu.Dropdown>
                          <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setEditing(u)}>
                            {t('common.edit')}
                          </Menu.Item>
                          <Menu.Item leftSection={<IconKey size={16} />} onClick={() => setResetting(u)}>
                            {t('users.resetPassword')}
                          </Menu.Item>
                          {locked && (
                            <Menu.Item leftSection={<IconLockOpen size={16} />} onClick={() => run(u, 'unlock')}>
                              {t('users.unlock')}
                            </Menu.Item>
                          )}
                          {u.has_pin && (
                            <Menu.Item leftSection={<IconKey size={16} />} onClick={() => run(u, 'pin')}>
                              {t('users.clearPin')}
                            </Menu.Item>
                          )}
                          <Menu.Divider />
                          {u.is_active ? (
                            <Menu.Item color="red" leftSection={<IconUserOff size={16} />} onClick={() => run(u, 'deactivate')} disabled={u.id === me?.id}>
                              {t('users.deactivate')}
                            </Menu.Item>
                          ) : (
                            <Menu.Item leftSection={<IconUserCheck size={16} />} onClick={() => run(u, 'activate')}>
                              {t('users.activate')}
                            </Menu.Item>
                          )}
                        </Menu.Dropdown>
                      </Menu>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <UserDrawer user={editing} roles={roles.data ?? []} onClose={() => setEditing(null)} />
      <ResetPasswordModal user={resetting} onClose={() => setResetting(null)} />
    </Card>
  );
}

function UserDrawer({ user, roles, onClose }: { user: User | 'new' | null; roles: Role[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const isNew = user === 'new';
  const existing = user && user !== 'new' ? user : null;
  const initial = {
    username: existing?.username ?? '',
    full_name_ar: existing?.full_name_ar ?? '',
    full_name_en: existing?.full_name_en ?? '',
    password: '',
    role_ids: existing?.roles.map((r) => r.id) ?? [],
  };
  const [form, setForm] = useState(initial);
  const [version, setVersion] = useState(existing?.version ?? 0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmClose, confirm] = useDisclosure(false);

  useEffect(() => {
    setForm(initial);
    setVersion(existing?.version ?? 0);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm((f) => ({ ...f, [k]: v }));

  async function save(): Promise<boolean> {
    setBusy(true);
    setError(null);
    try {
      if (isNew) {
        await api('/users', { method: 'POST', body: { ...form, username: form.username.trim() } });
      } else if (existing) {
        await api(`/users/${existing.id}`, {
          method: 'PATCH',
          body: { version, full_name_ar: form.full_name_ar, full_name_en: form.full_name_en, role_ids: form.role_ids },
        });
      }
      await qc.invalidateQueries({ queryKey: keys.users });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      onClose();
      return true;
    } catch (e) {
      setError(e);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    if (!existing) return;
    const fresh = await api<User>(`/users/${existing.id}`);
    const next = { ...form, full_name_ar: fresh.full_name_ar, full_name_en: fresh.full_name_en, role_ids: fresh.roles.map((r) => r.id) };
    setForm(next);
    setVersion(fresh.version);
    setError(null);
    void qc.invalidateQueries({ queryKey: keys.users });
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };
  const requestClose = () => (dirty ? confirm.open() : onClose());
  const stale = error instanceof ApiError && error.code === 'stale_record';

  return (
    <>
      <AppDrawer opened={user !== null} onClose={requestClose} title={isNew ? t('users.new') : t('users.edit')}>
        <form
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
          }}
          data-testid="user-form"
        >
          <Stack>
            {error !== null && (
              <Alert color={stale ? 'yellow' : 'red'} variant="light" icon={<IconAlertCircle size={18} />}>
                <Stack gap="xs">
                  <Text size="sm">{errorMessage(t, error, lang)}</Text>
                  {stale && (
                    <Button size="xs" variant="white" onClick={() => void reload()} w="fit-content">
                      {t('common.reload')}
                    </Button>
                  )}
                </Stack>
              </Alert>
            )}
            <TextInput label={t('auth.username')} value={form.username} onChange={(e) => set('username', e.currentTarget.value)} disabled={!isNew} dir="ltr" required description={isNew ? t('users.usernameHint') : undefined} />
            <TextInput label={t('users.nameAr')} value={form.full_name_ar} onChange={(e) => set('full_name_ar', e.currentTarget.value)} required dir="rtl" />
            <TextInput label={t('users.nameEn')} value={form.full_name_en} onChange={(e) => set('full_name_en', e.currentTarget.value)} dir="ltr" />
            {isNew && (
              <PasswordInput label={t('users.tempPassword')} description={t('users.tempPasswordHint')} value={form.password} onChange={(e) => set('password', e.currentTarget.value)} required minLength={10} autoComplete="new-password" />
            )}
            <Checkbox.Group label={t('users.roles')} value={form.role_ids.map(String)} onChange={(v) => set('role_ids', v.map(Number))} withAsterisk>
              <Stack gap={8} mt={6}>
                {roles.map((r) => (
                  <Checkbox key={r.id} value={String(r.id)} label={lang === 'ar' ? r.name_ar : r.name_en} />
                ))}
              </Stack>
            </Checkbox.Group>
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={requestClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={busy} disabled={!dirty || form.role_ids.length === 0}>
                {t('common.save')}
              </Button>
            </Group>
          </Stack>
        </form>
      </AppDrawer>
      <UnsavedChangesModal
        opened={confirmClose}
        onKeepEditing={confirm.close}
        onDiscard={() => {
          confirm.close();
          onClose();
        }}
        onSave={() => {
          confirm.close();
          void save();
        }}
      />
    </>
  );
}

function ResetPasswordModal({ user, onClose }: { user: User | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const action = useUserAction();
  const [password, setPassword] = useState('');
  useEffect(() => setPassword(''), [user]);
  if (!user) return null;
  return (
    <Modal opened onClose={onClose} title={t('users.resetPasswordFor', { name: displayName(user, lang) })} size="sm">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          action.mutate(
            { id: user.id, action: 'reset-password', body: { new_password: password } },
            {
              onSuccess: () => {
                notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('users.done.reset') });
                onClose();
              },
            },
          );
        }}
      >
        <Stack>
          <Text size="sm" c="dimmed">
            {t('users.resetHint')}
          </Text>
          {action.isError && (
            <Alert color="red" variant="light">
              {errorMessage(t, action.error, lang)}
            </Alert>
          )}
          <PasswordInput label={t('users.tempPassword')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} required minLength={10} autoFocus autoComplete="new-password" />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" loading={action.isPending} disabled={password.length < 10}>
              {t('users.resetPassword')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
