import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Divider,
  Group,
  Modal,
  NumberInput,
  Progress,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Table,
  Text,
  Textarea,
  TextInput,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconClipboardList, IconFileInvoice, IconPlus, IconSend, IconTrash } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { AppDrawer } from '../components/AppDrawer';
import { EmptyState } from '../components/EmptyState';
import { MoneyInput } from '../components/MoneyInput';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate, formatMoney } from '../lib/format';
import { nameOf, useDepartments, useDoctors, useServices } from '../master/queries';
import type { Patient } from '../patients/types';
import type { Plan } from './types';

const PLAN_COLOR: Record<Plan['status'], string> = { draft: 'neutral', proposed: 'blue', accepted: 'green', in_progress: 'cyan', completed: 'teal', cancelled: 'red' };

/** Treatment plans (SPEC 9): options, planned sessions, payment schedule. */
export function PlansTab({ patient }: { patient: Patient }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const doctors = useDoctors({ includeInactive: true });
  const q = useQuery({ queryKey: ['plans', patient.id], queryFn: () => api<Plan[]>('/treatment-plans', { query: { patient_id: patient.id } }) });
  const [open, setOpen] = useState<Plan | 'new' | null>(null);
  if (q.isPending) return <Skeleton height={200} />;
  if (q.isError) return <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>;
  const current = open && open !== 'new' ? q.data.find((p) => p.id === open.id) ?? open : open;
  return (
    <Stack data-testid="plans-tab">
      {can('plan.edit') && (
        <Group>
          <Button leftSection={<IconPlus size={16} />} onClick={() => setOpen('new')} data-testid="new-plan">
            {t('plans.new')}
          </Button>
        </Group>
      )}
      {q.data.length === 0 ? (
        <Card>
          <EmptyState icon={IconClipboardList} title={t('plans.emptyTitle')} hint={t('plans.emptyHint')} />
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          {q.data.map((p) => {
            const paidPct = Number(p.net_price) > 0 ? (Number(p.paid) / Number(p.net_price)) * 100 : 0;
            const done = p.sessions.filter((s) => s.status === 'done').length;
            const overdue = p.installments.filter((i) => i.overdue).length;
            return (
              <Card key={p.id} onClick={() => setOpen(p)} style={{ cursor: 'pointer' }} data-testid={`plan-${p.id}`}>
                <Group justify="space-between" mb={4}>
                  <Text fw={600}>{p.title}</Text>
                  <Badge color={PLAN_COLOR[p.status]}>{t(`plans.status.${p.status}`)}</Badge>
                </Group>
                <Text size="xs" c="dimmed">
                  {nameOf(doctors.data?.find((d) => d.id === p.doctor_id), lang)} · {formatDate(p.created_at, lang, digits)}
                </Text>
                <Group justify="space-between" mt="sm">
                  <Text size="sm">{t('plans.net')}: {formatMoney(p.net_price, lang, digits)}</Text>
                  <Text size="sm">{t('plans.remaining')}: {formatMoney(p.remaining, lang, digits)}</Text>
                </Group>
                <Progress value={paidPct} mt={6} size="sm" />
                <Group gap="xs" mt="xs">
                  <Text size="xs" c="dimmed">
                    {t('plans.sessionsDone', { done, total: p.sessions.length })}
                  </Text>
                  {overdue > 0 && <Badge size="xs" color="red">{t('plans.overdue', { count: overdue })}</Badge>}
                </Group>
              </Card>
            );
          })}
        </SimpleGrid>
      )}
      <PlanDrawer patient={patient} plan={current} onClose={() => setOpen(null)} onSaved={(p) => setOpen(p)} />
    </Stack>
  );
}

interface Form {
  title: string;
  doctor_id: number | null;
  department_id: number | null;
  total_price: string;
  discount: string;
  notes: string;
  options: { title: string; price: string; description: string }[];
  sessions: { description: string; service_id: number | null; teeth: string; price_share: string; status: 'planned' | 'booked' | 'done' }[];
}

const toForm = (p: Plan | null, doctorId: number | null): Form => ({
  title: p?.title ?? '',
  doctor_id: p?.doctor_id ?? doctorId,
  department_id: p?.department_id ?? null,
  total_price: p?.total_price ?? '0.00',
  discount: p?.discount ?? '0.00',
  notes: p?.notes ?? '',
  options: (p?.options ?? []).map(({ title, price, description }) => ({ title, price, description })),
  sessions: (p?.sessions ?? []).map(({ description, service_id, teeth, price_share, status }) => ({ description, service_id, teeth: teeth.join(' '), price_share, status })),
});

function PlanDrawer({ patient, plan, onClose, onSaved }: { patient: Patient; plan: Plan | 'new' | null; onClose: () => void; onSaved: (p: Plan) => void }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can, me } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const doctors = useDoctors();
  const departments = useDepartments();
  const services = useServices();
  const existing = plan && plan !== 'new' ? plan : null;
  const myDoctor = doctors.data?.find((d) => d.user_id === me?.id);
  const [form, setForm] = useState<Form>(toForm(existing, myDoctor?.id ?? patient.default_doctor_id));
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [gen, setGen] = useState(false);
  useEffect(() => {
    setForm(toForm(existing, myDoctor?.id ?? patient.default_doctor_id));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan && plan !== 'new' ? plan.id : plan, plan && plan !== 'new' ? plan.version : 0]);

  const editable = can('plan.edit') && (!existing || !['completed', 'cancelled'].includes(existing.status));
  const priceLocked = !!existing && ['accepted', 'in_progress'].includes(existing.status);
  const refresh = async (p: Plan) => {
    await qc.invalidateQueries({ queryKey: ['plans', patient.id] });
    onSaved(p);
  };
  const run = async (fn: () => Promise<Plan>) => {
    setBusy(true);
    setError(null);
    try {
      const p = await fn();
      await refresh(p);
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const body = () => {
    const b: Record<string, unknown> = {
      title: form.title,
      doctor_id: form.doctor_id,
      department_id: form.department_id,
      notes: form.notes,
      sessions: form.sessions.map((s) => ({ ...s, teeth: s.teeth.split(/[\s,،]+/).map(Number).filter((n) => n > 0) })),
    };
    if (!priceLocked) Object.assign(b, { total_price: form.total_price, discount: form.discount, options: form.options });
    return b;
  };
  const save = () =>
    run(() =>
      existing
        ? api<Plan>(`/treatment-plans/${existing.id}`, { method: 'PATCH', body: { version: existing.version, ...body() } })
        : api<Plan>('/treatment-plans', { method: 'POST', body: { patient_id: patient.id, ...body() } }),
    );
  const status = (s: string) => existing && run(() => api<Plan>(`/treatment-plans/${existing.id}/status`, { method: 'POST', body: { version: existing.version, status: s } }));
  const accept = (optionId?: number) => existing && run(() => api<Plan>(`/treatment-plans/${existing.id}/accept`, { method: 'POST', body: { version: existing.version, option_id: optionId ?? null } }));
  const sendInstallment = async (iid: number) => {
    try {
      await api(`/treatment-plans/${existing!.id}/installments/${iid}/payment-order`, { method: 'POST', body: {} });
      await qc.invalidateQueries({ queryKey: ['billing'] });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('billing.done.send') });
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(t, e, lang) });
    }
  };
  const fm = (v: string) => formatMoney(v, lang, digits);

  return (
    <AppDrawer opened={plan !== null} onClose={onClose} title={existing ? existing.title : t('plans.new')} size="xl">
      <Stack data-testid="plan-form">
        {error !== null && <Alert color="red">{errorMessage(t, error, lang)}</Alert>}
        {existing && (
          <Group gap="xs">
            <Badge color={PLAN_COLOR[existing.status]} size="lg">
              {t(`plans.status.${existing.status}`)}
            </Badge>
            {existing.accepted_at && (
              <Text size="xs" c="dimmed">
                {t('plans.acceptedOn', { date: formatDate(existing.accepted_at, lang, digits) })}
              </Text>
            )}
          </Group>
        )}
        <SimpleGrid cols={{ base: 1, sm: 3 }}>
          <TextInput label={t('plans.title')} value={form.title} onChange={(e) => setForm({ ...form, title: e.currentTarget.value })} required disabled={!editable} data-testid="plan-title" />
          <Select label={t('appointments.doctor')} data={(doctors.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))} value={form.doctor_id ? String(form.doctor_id) : null} onChange={(v) => setForm({ ...form, doctor_id: v ? Number(v) : null })} disabled={!editable} required />
          <Select label={t('services.department')} data={(departments.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))} value={form.department_id ? String(form.department_id) : null} onChange={(v) => setForm({ ...form, department_id: v ? Number(v) : null })} disabled={!editable} clearable />
        </SimpleGrid>

        <Divider label={t('plans.options')} labelPosition="left" />
        <Text size="xs" c="dimmed">
          {t('plans.optionsHint')}
        </Text>
        {form.options.map((o, i) => (
          <Group key={i} align="flex-end" wrap="nowrap" gap="xs">
            <TextInput flex={1} label={i === 0 ? t('plans.optionTitle') : undefined} value={o.title} onChange={(e) => setForm({ ...form, options: form.options.map((x, j) => (j === i ? { ...x, title: e.currentTarget.value } : x)) })} disabled={!editable || priceLocked} />
            <MoneyInput w={150} label={i === 0 ? t('billing.price') : undefined} value={o.price} onChange={(v) => setForm({ ...form, options: form.options.map((x, j) => (j === i ? { ...x, price: v } : x)) })} disabled={!editable || priceLocked} />
            {existing && ['draft', 'proposed'].includes(existing.status) && can('plan.edit') && (
              <Button size="xs" color="green" variant="light" onClick={() => accept(existing.options[i]?.id)} disabled={!existing.options[i]} data-testid={`accept-option-${i}`}>
                {t('plans.acceptOption')}
              </Button>
            )}
            {existing?.accepted_option_id && existing.options[i]?.id === existing.accepted_option_id && <Badge color="green">{t('plans.chosen')}</Badge>}
            {editable && !priceLocked && (
              <ActionIcon variant="subtle" color="red" mb={4} onClick={() => setForm({ ...form, options: form.options.filter((_, j) => j !== i) })} aria-label={t('common.delete')}>
                <IconTrash size={14} />
              </ActionIcon>
            )}
          </Group>
        ))}
        {editable && !priceLocked && (
          <Button size="xs" variant="subtle" w="fit-content" leftSection={<IconPlus size={14} />} onClick={() => setForm({ ...form, options: [...form.options, { title: '', price: '0.00', description: '' }] })} data-testid="add-option">
            {t('plans.addOption')}
          </Button>
        )}
        {form.options.length === 0 && (
          <SimpleGrid cols={2}>
            <MoneyInput label={t('plans.totalPrice')} value={form.total_price} onChange={(v) => setForm({ ...form, total_price: v })} disabled={!editable || priceLocked} data-testid="plan-price" />
            <MoneyInput label={t('billing.discount')} value={form.discount} onChange={(v) => setForm({ ...form, discount: v })} disabled={!editable || priceLocked} />
          </SimpleGrid>
        )}

        <Divider label={t('plans.sessions')} labelPosition="left" />
        {form.sessions.map((s, i) => (
          <Group key={i} align="flex-end" wrap="nowrap" gap="xs">
            <Text w={20} size="sm" mb={8}>
              {i + 1}
            </Text>
            <TextInput flex={1} label={i === 0 ? t('plans.sessionDesc') : undefined} value={s.description} onChange={(e) => setForm({ ...form, sessions: form.sessions.map((x, j) => (j === i ? { ...x, description: e.currentTarget.value } : x)) })} disabled={!editable} />
            <Select w={190} label={i === 0 ? t('appointments.service') : undefined} data={(services.data ?? []).map((x) => ({ value: String(x.id), label: `${x.code} · ${nameOf(x, lang)}` }))} value={s.service_id ? String(s.service_id) : null} onChange={(v) => setForm({ ...form, sessions: form.sessions.map((x, j) => (j === i ? { ...x, service_id: v ? Number(v) : null } : x)) })} disabled={!editable} clearable searchable />
            <TextInput w={80} label={i === 0 ? t('dental.teeth') : undefined} value={s.teeth} onChange={(e) => setForm({ ...form, sessions: form.sessions.map((x, j) => (j === i ? { ...x, teeth: e.currentTarget.value } : x)) })} disabled={!editable} dir="ltr" />
            <Badge mb={6} color={s.status === 'done' ? 'green' : s.status === 'booked' ? 'blue' : 'neutral'}>
              {t(`plans.sessionStatus.${s.status}`)}
            </Badge>
            {editable && (
              <ActionIcon variant="subtle" color="red" mb={4} onClick={() => setForm({ ...form, sessions: form.sessions.filter((_, j) => j !== i) })} aria-label={t('common.delete')}>
                <IconTrash size={14} />
              </ActionIcon>
            )}
          </Group>
        ))}
        {editable && (
          <Button size="xs" variant="subtle" w="fit-content" leftSection={<IconPlus size={14} />} onClick={() => setForm({ ...form, sessions: [...form.sessions, { description: '', service_id: null, teeth: '', price_share: '0.00', status: 'planned' }] })} data-testid="add-session">
            {t('plans.addSession')}
          </Button>
        )}
        <Textarea label={t('sample.note')} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.currentTarget.value })} disabled={!editable} autosize minRows={1} />

        {editable && (
          <Group justify="flex-end">
            <Button onClick={() => void save()} loading={busy} disabled={!form.title.trim() || !form.doctor_id} data-testid="save-plan">
              {t('common.save')}
            </Button>
          </Group>
        )}

        {existing && (
          <>
            <Divider label={t('plans.payments')} labelPosition="left" />
            <SimpleGrid cols={4}>
              <Stat label={t('plans.net')} value={fm(existing.net_price)} />
              <Stat label={t('plans.scheduled')} value={fm(existing.installments_total)} />
              <Stat label={t('plans.paid')} value={fm(existing.paid)} />
              <Stat label={t('plans.remaining')} value={fm(existing.remaining)} />
            </SimpleGrid>
            {existing.installments.length > 0 && (
              <Table data-testid="installments">
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th>{t('plans.dueDate')}</Table.Th>
                    <Table.Th ta="end">{t('plans.amount')}</Table.Th>
                    <Table.Th ta="end">{t('plans.paid')}</Table.Th>
                    <Table.Th />
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {existing.installments.map((i) => (
                    <Table.Tr key={i.id}>
                      <Table.Td>
                        {formatDate(`${i.due_date}T12:00:00+03:00`, lang, digits)} {i.overdue && <Badge size="xs" color="red">{t('plans.overdueOne')}</Badge>}
                      </Table.Td>
                      <Table.Td ta="end">{fm(i.amount)}</Table.Td>
                      <Table.Td ta="end">{fm(i.paid_amount)}</Table.Td>
                      <Table.Td ta="end">
                        {can('quotation.edit') && ['accepted', 'in_progress'].includes(existing.status) && Number(i.paid_amount) < Number(i.amount) && (
                          <Button size="compact-xs" variant="light" leftSection={<IconSend size={12} />} onClick={() => void sendInstallment(i.id)} data-testid={`send-installment-${i.id}`}>
                            {t('billing.sendToReception')}
                          </Button>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            )}
            {can('plan.edit') && Number(existing.net_price) > 0 && !['completed', 'cancelled'].includes(existing.status) && (
              <Button size="xs" variant="light" w="fit-content" onClick={() => setGen(true)} data-testid="generate-installments">
                {t('plans.generate')}
              </Button>
            )}
            <Divider />
            <Group gap="xs">
              {can('plan.edit') && existing.status === 'draft' && <Button variant="light" onClick={() => status('proposed')}>{t('plans.propose')}</Button>}
              {can('plan.edit') && ['draft', 'proposed'].includes(existing.status) && existing.options.length === 0 && (
                <Button color="green" onClick={() => accept()} data-testid="accept-plan">
                  {t('plans.accept')}
                </Button>
              )}
              {can('plan.edit') && existing.status === 'accepted' && <Button variant="light" onClick={() => status('in_progress')}>{t('plans.start')}</Button>}
              {can('plan.edit') && existing.status === 'in_progress' && <Button variant="light" color="teal" onClick={() => status('completed')}>{t('plans.complete')}</Button>}
              {can('quotation.edit') && (
                <Button variant="default" leftSection={<IconFileInvoice size={16} />} onClick={() => navigate(`/billing/quotation/new?patient=${patient.id}&plan=${existing.id}&doctor=${existing.doctor_id}`)}>
                  {t('plans.quotation')}
                </Button>
              )}
              {can('plan.edit') && !['completed', 'cancelled'].includes(existing.status) && (
                <Button variant="subtle" color="red" onClick={() => status('cancelled')}>
                  {t('plans.cancel')}
                </Button>
              )}
            </Group>
            <GenerateModal plan={existing} opened={gen} onClose={() => setGen(false)} onDone={(p) => void refresh(p)} />
          </>
        )}
      </Stack>
    </AppDrawer>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text fw={600}>{value}</Text>
    </div>
  );
}

function GenerateModal({ plan, opened, onClose, onDone }: { plan: Plan; opened: boolean; onClose: () => void; onDone: (p: Plan) => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const [count, setCount] = useState(6);
  const [first, setFirst] = useState<Date | null>(dayjs().add(1, 'month').toDate());
  const [down, setDown] = useState('0.00');
  const [every, setEvery] = useState(1);
  const [error, setError] = useState<unknown>(null);
  return (
    <Modal opened={opened} onClose={onClose} title={t('plans.generate')} size="sm">
      <Stack>
        {error !== null && <Alert color="red">{errorMessage(t, error, lang)}</Alert>}
        <MoneyInput label={t('plans.downPayment')} value={down} onChange={setDown} />
        <NumberInput label={t('plans.count')} value={count} onChange={(v) => setCount(Number(v) || 1)} min={1} max={60} allowDecimal={false} />
        <NumberInput label={t('plans.everyMonths')} value={every} onChange={(v) => setEvery(Number(v) || 1)} min={1} max={12} allowDecimal={false} />
        <DatePickerInput label={t('plans.firstDue')} value={first} onChange={setFirst} valueFormat="DD/MM/YYYY" />
        <Text size="xs" c="dimmed">
          {t('plans.generateHint')}
        </Text>
        <Group justify="flex-end">
          <Button
            onClick={async () => {
              try {
                const p = await api<Plan>(`/treatment-plans/${plan.id}/installments/generate`, {
                  method: 'POST',
                  body: { version: plan.version, count, first_due: dayjs(first).format('YYYY-MM-DD'), every_months: every, down_payment: down },
                });
                onDone(p);
                onClose();
              } catch (e) {
                setError(e);
              }
            }}
            data-testid="generate-ok"
          >
            {t('plans.generate')}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

