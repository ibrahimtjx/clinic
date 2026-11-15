import {
  ActionIcon,
  Box,
  Button,
  Card,
  Checkbox,
  ColorSwatch,
  Divider,
  Group,
  Kbd,
  Modal,
  NumberInput,
  Paper,
  Select,
  SimpleGrid,
  Skeleton,
  Stack,
  Switch,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
  useMantineTheme,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { getHotkeyHandler, useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import {
  IconAlertTriangle,
  IconCalendarEvent,
  IconCalendarOff,
  IconCheck,
  IconDeviceFloppy,
  IconDots,
  IconPhone,
  IconPlus,
  IconShieldCheck,
  IconTrash,
  IconUserPlus,
  IconX,
} from '@tabler/icons-react';
import { zodResolver } from '@hookform/resolvers/zod';
import { useState, type ReactNode } from 'react';
import { Controller, useForm } from 'react-hook-form';
import { useTranslation } from 'react-i18next';
import { z } from 'zod';

import { usePrefs } from '../app/preferences';
import { statusColors, type StatusKey } from '../app/theme';
import { AppDrawer } from '../components/AppDrawer';
import { EmptyState } from '../components/EmptyState';
import { PhraseTextarea } from '../components/PhraseTextarea';
import { StatusChip } from '../components/StatusChip';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import { formatDate, formatMoney, formatTime, SAUDI_MOBILE } from '../lib/format';

/** Style guide (SPEC 4.5). Every later screen is built from these parts. */
export function DesignPage() {
  const { t } = useTranslation();
  return (
    <Stack gap="xl" maw={1100} pb="xl" data-testid="design-page">
      <div>
        <Title order={1}>{t('design.title')}</Title>
        <Text c="dimmed" mt={4}>
          {t('design.intro')}
        </Text>
      </div>
      <ColorsSection />
      <TypographySection />
      <SpacingSection />
      <ButtonsSection />
      <InputsSection />
      <ChipsSection />
      <TableSection />
      <CardSection />
      <OverlaysSection />
      <FeedbackSection />
      <ShortcutsSection />
    </Stack>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Box component="section">
      <Title order={2} mb="sm">
        {title}
      </Title>
      <Card>{children}</Card>
    </Box>
  );
}

function Swatches({ name }: { name: 'accent' | 'neutral' }) {
  return (
    <Group gap={6}>
      {Array.from({ length: 10 }, (_, i) => (
        <Tooltip key={i} label={`${name}.${i}`}>
          <ColorSwatch color={`var(--mantine-color-${name}-${i})`} radius="sm" size={36} />
        </Tooltip>
      ))}
    </Group>
  );
}

function ColorsSection() {
  const { t } = useTranslation();
  return (
    <Section title={t('design.colors')}>
      <Stack>
        <div>
          <Text fw={500} size="sm" mb={6}>
            {t('design.accent')}
          </Text>
          <Swatches name="accent" />
        </div>
        <div>
          <Text fw={500} size="sm" mb={6}>
            {t('design.neutral')}
          </Text>
          <Swatches name="neutral" />
        </div>
        <div>
          <Text fw={500} size="sm" mb={6}>
            {t('design.statusColors')}
          </Text>
          <Group gap="xs">
            {(Object.keys(statusColors) as StatusKey[]).map((s) => (
              <Paper key={s} p="xs" px="sm" bg={`var(--mantine-color-${statusColors[s]}-light)`}>
                <Text size="sm" c={`var(--mantine-color-${statusColors[s]}-light-color)`} fw={500}>
                  {t(`status.${s}`)}
                </Text>
              </Paper>
            ))}
          </Group>
        </div>
      </Stack>
    </Section>
  );
}

function TypographySection() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const labels = t('design.typeScale', { returnObjects: true }) as string[];
  const sample = t('design.typeSample');
  const now = new Date();
  return (
    <Section title={t('design.typography')}>
      <Stack gap="sm">
        {([1, 2, 3, 4] as const).map((o, i) => (
          <Group key={o} gap="lg" wrap="nowrap" align="baseline">
            <Text size="xs" c="dimmed" w={80}>
              {labels[i]}
            </Text>
            <Title order={o}>{sample}</Title>
          </Group>
        ))}
        <Group gap="lg" wrap="nowrap" align="baseline">
          <Text size="xs" c="dimmed" w={80}>
            {labels[4]}
          </Text>
          <Text>{sample}</Text>
        </Group>
        <Group gap="lg" wrap="nowrap" align="baseline">
          <Text size="xs" c="dimmed" w={80}>
            {labels[5]}
          </Text>
          <Text size="sm" c="dimmed">
            {sample}
          </Text>
        </Group>
        <Divider my="xs" label={t('design.numbers')} labelPosition="center" />
        <Group gap="xl">
          <Text data-testid="sample-date">{formatDate(now, lang, digits)}</Text>
          <Text>{formatTime(now, lang, digits)}</Text>
          <Text fw={600} data-testid="sample-money">
            {formatMoney('12450.5', lang, digits)}
          </Text>
          <Text>0551234567</Text>
        </Group>
      </Stack>
    </Section>
  );
}

function SpacingSection() {
  const { t } = useTranslation();
  const theme = useMantineTheme();
  return (
    <Section title={t('design.spacing')}>
      <Group align="flex-end" gap="lg">
        {(['xs', 'sm', 'md', 'lg', 'xl'] as const).map((k) => (
          <Stack key={k} gap={4} align="center">
            <Box w={theme.spacing[k]} h={theme.spacing[k]} bg="accent.5" style={{ borderRadius: 'var(--mantine-radius-xs)' }} />
            <Text size="xs" c="dimmed">
              {k} · {theme.spacing[k]}
            </Text>
          </Stack>
        ))}
        <Divider orientation="vertical" />
        {(['sm', 'md', 'lg'] as const).map((k) => (
          <Stack key={k} gap={4} align="center">
            <Box w={48} h={48} bd="1px solid var(--app-border)" bg="var(--app-bg)" style={{ borderRadius: `var(--mantine-radius-${k})` }} />
            <Text size="xs" c="dimmed">
              radius {k}
            </Text>
          </Stack>
        ))}
      </Group>
    </Section>
  );
}

function ButtonsSection() {
  const { t } = useTranslation();
  return (
    <Section title={t('design.buttons')}>
      <Stack>
        <Group>
          <Button>{t('design.primary')}</Button>
          <Button variant="light">{t('design.secondary')}</Button>
          <Button variant="default">{t('common.cancel')}</Button>
          <Button variant="subtle">{t('design.subtle')}</Button>
          <Button color="red" variant="light" leftSection={<IconTrash size={16} />}>
            {t('design.danger')}
          </Button>
          <Button disabled>{t('design.disabled')}</Button>
          <Button loading>{t('common.loading')}</Button>
        </Group>
        <Group>
          <Button leftSection={<IconPlus size={16} />}>{t('topbar.newAppointment')}</Button>
          <Button size="xs" variant="light" leftSection={<IconPhone size={14} />}>
            {t('sample.call')}
          </Button>
          <ActionIcon variant="subtle" color="neutral" size="lg" aria-label="more">
            <IconDots size={18} />
          </ActionIcon>
          <ActionIcon variant="light" size="lg" aria-label="add">
            <IconPlus size={18} />
          </ActionIcon>
        </Group>
      </Stack>
    </Section>
  );
}

const schemaFor = (t: (k: string) => string) =>
  z.object({
    name: z.string().trim().min(1, t('sample.required')),
    mobile: z.string().regex(SAUDI_MOBILE, t('sample.mobileInvalid')),
    doctor: z.string().min(1, t('sample.required')),
    date: z.date({ error: t('sample.required') }),
    duration: z.number().int().min(5).max(240),
    note: z.string(),
    smsOptOut: z.boolean(),
  });
type FormValues = z.infer<ReturnType<typeof schemaFor>>;

function SampleForm({ onSaved, formId }: { onSaved: () => void; formId: string }) {
  const { t } = useTranslation();
  const doctors = t('sample.doctors', { returnObjects: true }) as string[];
  const phrases = t('design.phrasesSample', { returnObjects: true }) as string[];
  const form = useForm<FormValues>({
    resolver: zodResolver(schemaFor(t)),
    defaultValues: { name: '', mobile: '', doctor: '', date: undefined, duration: 15, note: '', smsOptOut: false },
  });
  const submit = form.handleSubmit(() => {
    notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('design.toastSuccessMsg') });
    form.reset(form.getValues());
    onSaved();
  });
  const { errors } = form.formState;

  return (
    <form id={formId} onSubmit={submit} onKeyDown={getHotkeyHandler([['mod+Enter', () => void submit()]])} data-dirty={form.formState.isDirty || undefined}>
      <Stack>
        <Text size="sm" c="dimmed">
          {t('design.formHint')}
        </Text>
        <TextInput label={t('sample.patientName')} withAsterisk {...form.register('name')} error={errors.name?.message} />
        <TextInput label={t('sample.mobile')} placeholder="05XXXXXXXX" dir="ltr" inputMode="numeric" withAsterisk {...form.register('mobile')} error={errors.mobile?.message} />
        <Controller
          control={form.control}
          name="doctor"
          render={({ field }) => (
            <Select label={t('sample.doctor')} data={doctors} withAsterisk searchable {...field} error={errors.doctor?.message} />
          )}
        />
        <Group grow>
          <Controller
            control={form.control}
            name="date"
            render={({ field }) => (
              <DatePickerInput
                label={t('design.dateLabel')}
                valueFormat="DD/MM/YYYY"
                leftSection={<IconCalendarEvent size={16} />}
                withAsterisk
                value={field.value ?? null}
                onChange={(v) => field.onChange(v ? new Date(v) : undefined)}
                error={errors.date?.message}
              />
            )}
          />
          <Controller
            control={form.control}
            name="duration"
            render={({ field }) => (
              <NumberInput label={`${t('sample.time')} (min)`} min={5} max={240} step={5} value={field.value} onChange={(v) => field.onChange(Number(v))} />
            )}
          />
        </Group>
        <Controller
          control={form.control}
          name="note"
          render={({ field }) => (
            <PhraseTextarea label={t('sample.note')} placeholder={t('sample.notePlaceholder')} phrases={phrases} value={field.value} onChange={field.onChange} />
          )}
        />
        <Checkbox label={t('sample.smsOptOut')} {...form.register('smsOptOut')} />
      </Stack>
    </form>
  );
}

function InputsSection() {
  const { t } = useTranslation();
  return (
    <Section title={t('design.inputs')}>
      <SimpleGrid cols={{ base: 1, md: 2 }} spacing="xl">
        <SampleForm formId="inline-form" onSaved={() => {}} />
        <Stack>
          <TextInput label={t('sample.nationalId')} placeholder="1XXXXXXXXX" dir="ltr" description="10 digits" />
          <TextInput label={t('sample.fileNo')} disabled value="000245" readOnly />
          <TextInput label={t('sample.mobile')} error={t('sample.mobileInvalid')} defaultValue="55123" dir="ltr" />
          <Switch label={t('sample.smsOptOut')} defaultChecked />
          <Group justify="flex-start" mt="sm">
            <Button type="submit" form="inline-form" leftSection={<IconDeviceFloppy size={16} />}>
              {t('common.save')}
            </Button>
            <Group gap={4} dir="ltr">
              <Kbd size="xs">Ctrl</Kbd>
              <Text size="xs">+</Text>
              <Kbd size="xs">Enter</Kbd>
            </Group>
          </Group>
        </Stack>
      </SimpleGrid>
    </Section>
  );
}

function ChipsSection() {
  const { t } = useTranslation();
  return (
    <Section title={t('design.chips')}>
      <Group gap="xs">
        {(Object.keys(statusColors) as StatusKey[]).map((s) => (
          <StatusChip key={s} status={s} />
        ))}
      </Group>
    </Section>
  );
}

function TableSection() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const patients = t('sample.patients', { returnObjects: true }) as string[];
  const doctors = t('sample.doctors', { returnObjects: true }) as string[];
  const visitTypes = t('sample.visitTypes', { returnObjects: true }) as string[];
  const statuses: StatusKey[] = ['confirmed', 'arrived', 'withDoctor', 'unconfirmed'];
  const balances = ['0', '350', '0', '1200.5'];
  // Sample rows use fixed server-style timestamps (Riyadh 09:00 onwards).
  const rows = patients.map((name, i) => ({
    fileNo: String(1024 + i).padStart(6, '0'),
    name,
    mobile: `05${String(51234567 + i * 1111).slice(0, 8)}`,
    doctor: doctors[i % doctors.length],
    visitType: visitTypes[i % visitTypes.length],
    at: new Date(Date.UTC(2026, 10, 15, 6 + i, i % 2 ? 30 : 0)),
    status: statuses[i],
    balance: balances[i],
  }));
  return (
    <Section title={t('design.table')}>
      <Table.ScrollContainer minWidth={760}>
        <Table>
          <Table.Thead>
            <Table.Tr>
              <Table.Th>{t('sample.fileNo')}</Table.Th>
              <Table.Th>{t('sample.patientName')}</Table.Th>
              <Table.Th>{t('sample.mobile')}</Table.Th>
              <Table.Th>{t('sample.doctor')}</Table.Th>
              <Table.Th>{t('sample.visitType')}</Table.Th>
              <Table.Th>{t('sample.time')}</Table.Th>
              <Table.Th>{t('sample.status')}</Table.Th>
              <Table.Th ta="end">{t('sample.balance')}</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {rows.map((r) => (
              <Table.Tr key={r.fileNo}>
                <Table.Td c="dimmed">{r.fileNo}</Table.Td>
                <Table.Td fw={500}>{r.name}</Table.Td>
                <Table.Td>
                  <span dir="ltr">{r.mobile}</span>
                </Table.Td>
                <Table.Td>{r.doctor}</Table.Td>
                <Table.Td>{r.visitType}</Table.Td>
                <Table.Td>{formatTime(r.at, lang, digits)}</Table.Td>
                <Table.Td>
                  <StatusChip status={r.status} />
                </Table.Td>
                <Table.Td ta="end" c={r.balance !== '0' ? 'red' : undefined} fw={r.balance !== '0' ? 600 : undefined}>
                  {formatMoney(r.balance, lang, digits)}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Table.ScrollContainer>
    </Section>
  );
}

function CardSection() {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const patients = t('sample.patients', { returnObjects: true }) as string[];
  const doctors = t('sample.doctors', { returnObjects: true }) as string[];
  return (
    <Section title={t('design.card')}>
      <SimpleGrid cols={{ base: 1, sm: 2, md: 3 }}>
        <Card>
          <Group justify="space-between" mb="xs">
            <Text size="sm" c="dimmed">
              {t('sample.cardTitle')}
            </Text>
            <StatusChip status="arrived" size="sm" />
          </Group>
          <Text fw={600} size="lg">
            {patients[0]}
          </Text>
          <Text size="sm" c="dimmed">
            000245 · {doctors[0]}
          </Text>
          <Text size="sm" mt="xs">
            {t('sample.cardBody')}
          </Text>
          <Group justify="space-between" mt="md">
            <Group gap={6}>
              <Tooltip label={t('visitBadges.new')}>
                <IconUserPlus size={16} color="var(--mantine-color-blue-6)" />
              </Tooltip>
              <Tooltip label={t('visitBadges.insured')}>
                <IconShieldCheck size={16} color="var(--mantine-color-green-6)" />
              </Tooltip>
              <Tooltip label={t('visitBadges.balance')}>
                <IconAlertTriangle size={16} color="var(--mantine-color-red-6)" />
              </Tooltip>
            </Group>
            <Button size="xs" leftSection={<IconPhone size={14} />}>
              {t('sample.call')}
            </Button>
          </Group>
        </Card>
        <Card>
          <Text size="sm" c="dimmed">
            {t('sample.balance')}
          </Text>
          <Text fw={600} size="xl" mt={4}>
            {formatMoney('4870', lang, digits)}
          </Text>
          <Text size="xs" c="green" mt={4}>
            +12%
          </Text>
        </Card>
        <Card padding={0}>
          <EmptyState
            icon={IconCalendarOff}
            title={t('sample.emptyTitle')}
            hint={t('sample.emptyHint')}
            action={
              <Button size="xs" leftSection={<IconPlus size={14} />}>
                {t('topbar.newAppointment')}
              </Button>
            }
          />
        </Card>
      </SimpleGrid>
    </Section>
  );
}

function OverlaysSection() {
  const { t } = useTranslation();
  const [drawerOpen, drawer] = useDisclosure(false);
  const [modalOpen, modal] = useDisclosure(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [formKey, setFormKey] = useState(0);

  const requestClose = () => {
    const dirty = document.querySelector('#drawer-form[data-dirty]');
    if (dirty) setConfirmOpen(true);
    else drawer.close();
  };
  const discard = () => {
    setConfirmOpen(false);
    drawer.close();
    setFormKey((k) => k + 1);
  };

  return (
    <Section title={`${t('design.drawer')} · ${t('design.modal')}`}>
      <Group>
        <Button variant="light" onClick={drawer.open} data-testid="open-drawer">
          {t('design.openDrawer')}
        </Button>
        <Button variant="default" onClick={modal.open}>
          {t('design.openModal')}
        </Button>
      </Group>

      <AppDrawer opened={drawerOpen} onClose={requestClose} title={t('topbar.newAppointment')}>
        <Text size="sm" c="dimmed" mb="md">
          {t('design.drawerBody')}
        </Text>
        <SampleForm key={formKey} formId="drawer-form" onSaved={drawer.close} />
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={requestClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" form="drawer-form">
            {t('common.save')}
          </Button>
        </Group>
      </AppDrawer>

      <UnsavedChangesModal
        opened={confirmOpen}
        onKeepEditing={() => setConfirmOpen(false)}
        onDiscard={discard}
        onSave={() => {
          setConfirmOpen(false);
          (document.getElementById('drawer-form') as HTMLFormElement | null)?.requestSubmit();
        }}
      />

      <Modal opened={modalOpen} onClose={modal.close} title={t('design.modal')} size="sm">
        <Text size="sm">{t('design.modalBody')}</Text>
        <Group justify="flex-end" mt="lg">
          <Button variant="default" onClick={modal.close}>
            {t('common.cancel')}
          </Button>
          <Button onClick={modal.close}>{t('common.save')}</Button>
        </Group>
      </Modal>
    </Section>
  );
}

function FeedbackSection() {
  const { t } = useTranslation();
  return (
    <SimpleGrid cols={{ base: 1, md: 2 }}>
      <Section title={t('design.skeleton')}>
        <Stack gap="sm">
          {[0, 1, 2].map((i) => (
            <Group key={i} gap="sm" wrap="nowrap">
              <Skeleton height={36} circle />
              <Stack gap={6} flex={1}>
                <Skeleton height={10} width="60%" />
                <Skeleton height={8} width="35%" />
              </Stack>
              <Skeleton height={22} width={70} radius="sm" />
            </Group>
          ))}
        </Stack>
      </Section>
      <Section title={t('design.toasts')}>
        <Group>
          <Button
            variant="light"
            color="green"
            leftSection={<IconCheck size={16} />}
            onClick={() => notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('design.toastSuccessMsg') })}
          >
            {t('design.toastSuccess')}
          </Button>
          <Button
            variant="light"
            color="red"
            leftSection={<IconX size={16} />}
            onClick={() => notifications.show({ color: 'red', icon: <IconX size={18} />, message: t('design.toastErrorMsg') })}
          >
            {t('design.toastError')}
          </Button>
        </Group>
      </Section>
    </SimpleGrid>
  );
}

function ShortcutsSection() {
  const { t } = useTranslation();
  const rows: [string[], string][] = [
    [['Ctrl', 'K'], t('design.palette')],
    [['Ctrl', 'Enter'], t('design.submitForm')],
    [['Ctrl', 'Shift', 'L'], t('design.toggleThemeKey')],
  ];
  return (
    <Section title={t('design.shortcuts')}>
      <Stack gap="xs">
        {rows.map(([keys, label]) => (
          <Group key={label} justify="space-between" maw={420}>
            <Text size="sm">{label}</Text>
            <Group gap={4} dir="ltr">
              {keys.map((k) => (
                <Kbd key={k}>{k}</Kbd>
              ))}
            </Group>
          </Group>
        ))}
      </Stack>
    </Section>
  );
}
