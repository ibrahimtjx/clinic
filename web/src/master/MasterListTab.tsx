import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Button,
  Card,
  Group,
  Menu,
  Modal,
  Select,
  Skeleton,
  Stack,
  Switch,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconAlertCircle,
  IconArrowBackUp,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconDots,
  IconEye,
  IconEyeOff,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
  type Icon,
} from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { AppDrawer } from '../components/AppDrawer';
import { ColorSelect } from '../components/ColorSelect';
import { EmptyState } from '../components/EmptyState';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useList, type Resource } from './queries';
import type { ColorName } from './types';

interface BaseItem {
  id: number;
  is_active: boolean;
  sort_order: number;
  version: number;
  deleted_at: string | null;
}

export interface FieldDef<T> {
  key: keyof T & string;
  kind: 'text' | 'textLtr' | 'textarea' | 'color' | 'switch' | 'select';
  label: string;
  description?: string;
  required?: boolean;
  options?: { value: string; label: string }[];
  /** Only editable when creating (e.g. a status key). */
  createOnly?: boolean;
  /** Numeric ids in selects. */
  numeric?: boolean;
}

export interface ColumnDef<T> {
  label: string;
  render: (item: T) => ReactNode;
  width?: number;
}

interface Props<T extends BaseItem> {
  resource: Resource;
  title: string;
  hint?: string;
  icon: Icon;
  fields: FieldDef<T>[];
  columns: ColumnDef<T>[];
  defaults: Partial<T>;
  /** Extra list query (saved phrases by field). */
  fieldKey?: string;
  toolbar?: ReactNode;
  /** Return an i18n error code to refuse, e.g. system statuses. */
  locked?: (item: T, action: 'delete' | 'deactivate') => boolean;
  testId?: string;
  /** Makes the first column a link that opens a details view. */
  onOpen?: (item: T) => void;
}

/** A settings list screen: table, show inactive and deleted, reorder, edit drawer, soft delete, restore. */
export function MasterListTab<T extends BaseItem>(p: Props<T>) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [showInactive, setShowInactive] = useState(false);
  const [showDeleted, setShowDeleted] = useState(false);
  const list = useList<T>(p.resource, { includeInactive: showInactive || showDeleted, includeDeleted: showDeleted, fieldKey: p.fieldKey as never });
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [deleting, setDeleting] = useState<T | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ['master', p.resource] });
  const fail = (e: unknown) => notifications.show({ color: 'red', icon: <IconX size={18} />, message: errorMessage(t, e, lang) });
  const ok = () => notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });

  async function patch(item: T, body: Partial<T>) {
    try {
      await api(`/${p.resource}/${item.id}`, { method: 'PATCH', body: { version: item.version, ...body } });
      ok();
    } catch (e) {
      fail(e);
    } finally {
      void invalidate();
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const rows = (list.data ?? []).filter((r) => !r.deleted_at);
    const j = index + dir;
    if (j < 0 || j >= rows.length) return;
    const ids = rows.map((r) => r.id);
    [ids[index], ids[j]] = [ids[j], ids[index]];
    try {
      await api(`/${p.resource}/order`, { method: 'PUT', body: { ids } });
    } catch (e) {
      fail(e);
    } finally {
      void invalidate();
    }
  }

  async function restore(item: T) {
    try {
      await api(`/${p.resource}/${item.id}/restore`, { method: 'POST' });
      ok();
    } catch (e) {
      fail(e);
    } finally {
      void invalidate();
    }
  }

  const rows = list.data ?? [];
  const live = rows.filter((r) => !r.deleted_at);

  return (
    <Card padding={0} data-testid={p.testId}>
      <Group justify="space-between" p="md" align="flex-start">
        <div>
          <Text fw={600}>{p.title}</Text>
          {p.hint && (
            <Text size="sm" c="dimmed" maw={560}>
              {p.hint}
            </Text>
          )}
        </div>
        <Group gap="xs">
          <Switch size="sm" label={t('master.showInactive')} checked={showInactive} onChange={(e) => setShowInactive(e.currentTarget.checked)} />
          {can('record.view_deleted') && (
            <Switch size="sm" label={t('master.showDeleted')} checked={showDeleted} onChange={(e) => setShowDeleted(e.currentTarget.checked)} />
          )}
          <Button leftSection={<IconPlus size={16} />} onClick={() => setEditing('new')} data-testid="master-new">
            {t('master.add')}
          </Button>
        </Group>
      </Group>
      {p.toolbar && (
        <Group px="md" pb="md">
          {p.toolbar}
        </Group>
      )}
      {list.isPending ? (
        <Stack p="md" gap="sm">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} height={28} />
          ))}
        </Stack>
      ) : list.isError ? (
        <Alert m="md" color="red" variant="light" icon={<IconAlertCircle size={18} />}>
          {errorMessage(t, list.error, lang)}
        </Alert>
      ) : rows.length === 0 ? (
        <EmptyState
          icon={p.icon}
          title={t('master.emptyTitle')}
          hint={t('master.emptyHint')}
          action={
            <Button size="xs" leftSection={<IconPlus size={14} />} onClick={() => setEditing('new')}>
              {t('master.add')}
            </Button>
          }
        />
      ) : (
        <Table.ScrollContainer minWidth={640}>
          <Table>
            <Table.Thead>
              <Table.Tr>
                <Table.Th w={70}>{t('master.order')}</Table.Th>
                {p.columns.map((c) => (
                  <Table.Th key={c.label} w={c.width}>
                    {c.label}
                  </Table.Th>
                ))}
                <Table.Th w={110}>{t('users.status')}</Table.Th>
                <Table.Th w={48} />
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {rows.map((item) => {
                const idx = live.indexOf(item);
                return (
                  <Table.Tr key={item.id} opacity={item.deleted_at ? 0.55 : 1}>
                    <Table.Td>
                      {!item.deleted_at && (
                        <Group gap={0} wrap="nowrap">
                          <ActionIcon variant="subtle" color="neutral" size="sm" disabled={idx === 0} onClick={() => void move(idx, -1)} aria-label={t('master.moveUp')}>
                            <IconChevronUp size={14} />
                          </ActionIcon>
                          <ActionIcon variant="subtle" color="neutral" size="sm" disabled={idx === live.length - 1} onClick={() => void move(idx, 1)} aria-label={t('master.moveDown')}>
                            <IconChevronDown size={14} />
                          </ActionIcon>
                        </Group>
                      )}
                    </Table.Td>
                    {p.columns.map((c, ci) => (
                      <Table.Td key={c.label}>
                        {ci === 0 && p.onOpen && !item.deleted_at ? (
                          <Anchor component="button" type="button" fz="sm" fw={500} onClick={() => p.onOpen!(item)} data-testid={`open-${item.id}`}>
                            {c.render(item)}
                          </Anchor>
                        ) : (
                          c.render(item)
                        )}
                      </Table.Td>
                    ))}
                    <Table.Td>
                      {item.deleted_at ? (
                        <Badge color="red">{t('master.deleted')}</Badge>
                      ) : item.is_active ? (
                        <Badge color="green">{t('users.active')}</Badge>
                      ) : (
                        <Badge color="neutral">{t('users.inactive')}</Badge>
                      )}
                    </Table.Td>
                    <Table.Td>
                      {item.deleted_at ? (
                        <ActionIcon variant="subtle" onClick={() => void restore(item)} aria-label={t('master.restore')}>
                          <IconArrowBackUp size={18} />
                        </ActionIcon>
                      ) : (
                        <Menu position="bottom-end" withinPortal>
                          <Menu.Target>
                            <ActionIcon variant="subtle" color="neutral" aria-label={t('common.actions')}>
                              <IconDots size={18} />
                            </ActionIcon>
                          </Menu.Target>
                          <Menu.Dropdown>
                            <Menu.Item leftSection={<IconPencil size={16} />} onClick={() => setEditing(item)}>
                              {t('common.edit')}
                            </Menu.Item>
                            {item.is_active ? (
                              <Menu.Item
                                leftSection={<IconEyeOff size={16} />}
                                disabled={p.locked?.(item, 'deactivate')}
                                onClick={() => void patch(item, { is_active: false } as Partial<T>)}
                              >
                                {t('users.deactivate')}
                              </Menu.Item>
                            ) : (
                              <Menu.Item leftSection={<IconEye size={16} />} onClick={() => void patch(item, { is_active: true } as Partial<T>)}>
                                {t('users.activate')}
                              </Menu.Item>
                            )}
                            <Menu.Divider />
                            <Menu.Item color="red" leftSection={<IconTrash size={16} />} disabled={p.locked?.(item, 'delete')} onClick={() => setDeleting(item)}>
                              {t('common.delete')}
                            </Menu.Item>
                          </Menu.Dropdown>
                        </Menu>
                      )}
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}

      <ItemDrawer<T> {...p} item={editing} onClose={() => setEditing(null)} onSaved={() => void invalidate()} />

      <Modal opened={deleting !== null} onClose={() => setDeleting(null)} title={t('master.deleteTitle')} size="sm">
        <Text size="sm">{t('master.deleteBody')}</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={() => setDeleting(null)}>
            {t('common.cancel')}
          </Button>
          <Button
            color="red"
            onClick={async () => {
              const item = deleting!;
              setDeleting(null);
              try {
                await api(`/${p.resource}/${item.id}`, { method: 'DELETE' });
                ok();
              } catch (e) {
                fail(e);
              } finally {
                void invalidate();
              }
            }}
          >
            {t('common.delete')}
          </Button>
        </Group>
      </Modal>
    </Card>
  );
}

function ItemDrawer<T extends BaseItem>({
  item,
  onClose,
  onSaved,
  resource,
  fields,
  defaults,
}: Props<T> & { item: T | 'new' | null; onClose: () => void; onSaved: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const isNew = item === 'new';
  const initial = useMemo(() => {
    const src = (item && item !== 'new' ? item : defaults) as Record<string, unknown>;
    return Object.fromEntries(fields.map((f) => [f.key, src[f.key] ?? (f.kind === 'switch' ? false : f.kind === 'select' ? null : '')]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item]);
  const [form, setForm] = useState<Record<string, unknown>>(initial);
  const [version, setVersion] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, confirm] = useDisclosure(false);

  useEffect(() => {
    setForm(initial);
    setVersion(item && item !== 'new' ? item.version : 0);
    setError(null);
  }, [initial, item]);

  const dirty = JSON.stringify(form) !== JSON.stringify(initial);
  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setBusy(true);
    setError(null);
    try {
      if (isNew) await api(`/${resource}`, { method: 'POST', body: form });
      else if (item) {
        const changed = Object.fromEntries(
          fields.filter((f) => !f.createOnly && JSON.stringify(form[f.key]) !== JSON.stringify(initial[f.key])).map((f) => [f.key, form[f.key]]),
        );
        await api(`/${resource}/${item.id}`, { method: 'PATCH', body: { version, ...changed } });
      }
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
      onSaved();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  async function reload() {
    if (!item || item === 'new') return;
    const fresh = await api<T>(`/${resource}/${item.id}`);
    setForm(Object.fromEntries(fields.map((f) => [f.key, (fresh as Record<string, unknown>)[f.key]])));
    setVersion(fresh.version);
    setError(null);
    onSaved();
  }

  const stale = error instanceof ApiError && error.code === 'stale_record';
  const requestClose = () => (dirty ? confirm.open() : onClose());
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void save();
  };

  return (
    <>
      <AppDrawer opened={item !== null} onClose={requestClose} title={isNew ? t('master.add') : t('common.edit')}>
        <form
          onSubmit={submit}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
          }}
          data-testid="master-form"
        >
          <Stack>
            {error !== null && (
              <Alert color={stale ? 'yellow' : 'red'} variant="light" icon={<IconAlertCircle size={18} />}>
                <Stack gap="xs">
                  <Text size="sm">{errorMessage(t, error, lang)}</Text>
                  {stale && (
                    <Button size="xs" variant="white" w="fit-content" onClick={() => void reload()}>
                      {t('common.reload')}
                    </Button>
                  )}
                </Stack>
              </Alert>
            )}
            {fields.map((f) => {
              const disabled = f.createOnly && !isNew;
              const common = { label: f.label, description: f.description, required: f.required, disabled, name: f.key };
              switch (f.kind) {
                case 'color':
                  return <ColorSelect key={f.key} {...common} value={form[f.key] as ColorName} onChange={(v) => set(f.key, v)} />;
                case 'switch':
                  return <Switch key={f.key} label={f.label} description={f.description} checked={!!form[f.key]} onChange={(e) => set(f.key, e.currentTarget.checked)} disabled={disabled} />;
                case 'select':
                  return (
                    <Select
                      key={f.key}
                      {...common}
                      data={f.options ?? []}
                      value={form[f.key] == null ? null : String(form[f.key])}
                      onChange={(v) => set(f.key, v == null ? null : f.numeric ? Number(v) : v)}
                      clearable={!f.required}
                      searchable
                    />
                  );
                case 'textarea':
                  return <Textarea key={f.key} {...common} value={String(form[f.key] ?? '')} onChange={(e) => set(f.key, e.currentTarget.value)} autosize minRows={3} />;
                default:
                  return (
                    <TextInput
                      key={f.key}
                      {...common}
                      value={String(form[f.key] ?? '')}
                      onChange={(e) => set(f.key, e.currentTarget.value)}
                      dir={f.kind === 'textLtr' ? 'ltr' : undefined}
                    />
                  );
              }
            })}
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={requestClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={busy} disabled={!isNew && !dirty}>
                {t('common.save')}
              </Button>
            </Group>
          </Stack>
        </form>
      </AppDrawer>
      <UnsavedChangesModal
        opened={confirmOpen}
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
