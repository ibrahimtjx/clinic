import { Badge, ColorSwatch, Group, SegmentedControl, Select, Text } from '@mantine/core';
import { IconBuildingHospital, IconCalendarStats, IconCategory, IconFlask, IconPill, IconQuote, IconShieldCheck, IconTag } from '@tabler/icons-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import type { LabTest, Medication } from '../clinical/types';
import { MasterListTab } from '../master/MasterListTab';
import { nameOf, useClinics } from '../master/queries';
import type { InsuranceCompany } from '../patients/types';
import { PHRASE_FIELDS, type AppointmentStatus, type Clinic, type Department, type PhraseField, type SavedPhrase, type VisitType } from '../master/types';

function useNameFields() {
  const { t } = useTranslation();
  return [
    { key: 'name_ar' as const, kind: 'text' as const, label: t('users.nameAr'), required: true },
    { key: 'name_en' as const, kind: 'textLtr' as const, label: t('users.nameEn'), required: true },
  ];
}

const Swatch = ({ color, label }: { color: string; label: string }) => (
  <Badge color={color} variant="light" leftSection={<ColorSwatch color={`var(--mantine-color-${color}-filled)`} size={8} />}>
    {label}
  </Badge>
);

export function ClinicsTab() {
  const { t } = useTranslation();
  const names = useNameFields();
  return (
    <MasterListTab<Clinic>
      resource="clinics"
      title={t('settings.tabs.clinics')}
      hint={t('master.clinicsHint')}
      icon={IconBuildingHospital}
      fields={names}
      columns={[
        { label: t('users.nameAr'), render: (c) => c.name_ar },
        { label: t('users.nameEn'), render: (c) => <span dir="ltr">{c.name_en}</span> },
      ]}
      defaults={{ name_ar: '', name_en: '' }}
      testId="clinics-tab"
    />
  );
}

export function DepartmentsTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const names = useNameFields();
  const clinics = useClinics({ includeInactive: true });
  const clinicName = (id: number | null) => nameOf(clinics.data?.find((c) => c.id === id), lang) || '—';
  return (
    <MasterListTab<Department>
      resource="departments"
      title={t('settings.tabs.departments')}
      hint={t('master.departmentsHint')}
      icon={IconCategory}
      fields={[
        ...names,
        { key: 'clinic_id', kind: 'select', label: t('master.clinic'), numeric: true, options: (clinics.data ?? []).map((c) => ({ value: String(c.id), label: nameOf(c, lang) })) },
      ]}
      columns={[
        { label: t('master.name'), render: (d) => nameOf(d, lang) },
        { label: t('master.clinic'), render: (d) => clinicName(d.clinic_id) },
      ]}
      defaults={{ name_ar: '', name_en: '', clinic_id: clinics.data?.[0]?.id ?? null }}
      testId="departments-tab"
    />
  );
}

export function StatusesTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const names = useNameFields();
  return (
    <MasterListTab<AppointmentStatus>
      resource="appointment-statuses"
      title={t('settings.tabs.statuses')}
      hint={t('master.statusesHint')}
      icon={IconCalendarStats}
      fields={[
        { key: 'key', kind: 'textLtr', label: t('roles.key'), description: t('roles.keyHint'), required: true, createOnly: true },
        ...names,
        { key: 'color', kind: 'color', label: t('master.color') },
        { key: 'blocks_slot', kind: 'switch', label: t('master.blocksSlot'), description: t('master.blocksSlotHint') },
      ]}
      columns={[
        { label: t('master.name'), render: (s) => <Swatch color={s.color} label={nameOf(s, lang)} /> },
        {
          label: t('master.blocksSlot'),
          render: (s) => (s.blocks_slot ? <Badge color="accent">{t('common.yes')}</Badge> : <Text c="dimmed">{t('common.no')}</Text>),
        },
        {
          label: t('roles.key'),
          render: (s) => (
            <Group gap={6}>
              <Text size="xs" c="dimmed" dir="ltr">
                {s.key}
              </Text>
              {s.is_system && (
                <Badge size="xs" color="neutral">
                  {t('master.system')}
                </Badge>
              )}
            </Group>
          ),
        },
      ]}
      defaults={{ key: '', name_ar: '', name_en: '', color: 'neutral', blocks_slot: true }}
      locked={(s) => s.is_system}
      testId="statuses-tab"
    />
  );
}

export function VisitTypesTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const names = useNameFields();
  return (
    <MasterListTab<VisitType>
      resource="visit-types"
      title={t('settings.tabs.visitTypes')}
      icon={IconTag}
      fields={[...names, { key: 'color', kind: 'color', label: t('master.color') }]}
      columns={[{ label: t('master.name'), render: (v) => <Swatch color={v.color} label={nameOf(v, lang)} /> }]}
      defaults={{ name_ar: '', name_en: '', color: 'neutral' }}
      testId="visit-types-tab"
    />
  );
}

export function PhrasesTab() {
  const { t } = useTranslation();
  const [field, setField] = useState<PhraseField>('chief_complaint');
  const options = PHRASE_FIELDS.map((f) => ({ value: f, label: t(`phraseFields.${f}`) }));
  return (
    <MasterListTab<SavedPhrase>
      key={field}
      resource="saved-phrases"
      title={t('settings.tabs.phrases')}
      hint={t('master.phrasesHint')}
      icon={IconQuote}
      fieldKey={field}
      toolbar={
        options.length > 5 ? (
          <Select label={t('master.field')} data={options} value={field} onChange={(v) => v && setField(v as PhraseField)} allowDeselect={false} w={280} data-testid="phrase-field" />
        ) : (
          <SegmentedControl data={options} value={field} onChange={(v) => setField(v as PhraseField)} />
        )
      }
      fields={[
        { key: 'field_key', kind: 'select', label: t('master.field'), options, required: true, createOnly: true },
        { key: 'text', kind: 'textarea', label: t('master.phraseText'), required: true },
      ]}
      columns={[{ label: t('master.phraseText'), render: (p) => <Text size="sm">{p.text}</Text> }]}
      defaults={{ field_key: field, text: '' }}
      testId="phrases-tab"
    />
  );
}

export function InsuranceCompaniesTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const names = useNameFields();
  return (
    <MasterListTab<InsuranceCompany>
      resource="insurance-companies"
      title={t('settings.tabs.insuranceCompanies')}
      hint={t('master.insuranceHint')}
      icon={IconShieldCheck}
      fields={[{ key: 'code', kind: 'textLtr', label: t('services.code'), required: true }, ...names]}
      columns={[
        { label: t('services.code'), render: (c) => <Text size="sm" dir="ltr">{c.code}</Text> },
        { label: t('master.name'), render: (c) => nameOf(c, lang) },
      ]}
      defaults={{ code: '', name_ar: '', name_en: '' }}
      testId="insurance-tab"
    />
  );
}

export function MedicationsTab() {
  const { t } = useTranslation();
  return (
    <MasterListTab<Medication>
      resource="medications"
      title={t('settings.tabs.medications')}
      hint={t('clinical.medicationsHint')}
      icon={IconPill}
      fields={[
        { key: 'name', kind: 'textLtr', label: t('clinical.drug'), required: true },
        { key: 'form', kind: 'textLtr', label: t('clinical.form') },
        { key: 'dose', kind: 'text', label: t('clinical.dose') },
        { key: 'frequency', kind: 'text', label: t('clinical.frequency') },
        { key: 'duration', kind: 'text', label: t('clinical.duration') },
        { key: 'instructions', kind: 'text', label: t('clinical.instructions') },
      ]}
      columns={[
        { label: t('clinical.drug'), render: (m) => <Text size="sm" dir="ltr">{m.name}</Text> },
        { label: t('clinical.dose'), render: (m) => <Text size="sm" dir="auto">{[m.dose, m.frequency, m.duration].filter(Boolean).join(' · ')}</Text> },
      ]}
      defaults={{ name: '', form: '', dose: '', frequency: '', duration: '', instructions: '' }}
      testId="medications-tab"
    />
  );
}

export function LabTestsTab() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const names = useNameFields();
  return (
    <MasterListTab<LabTest>
      resource="lab-tests"
      title={t('settings.tabs.labTests')}
      hint={t('clinical.labTestsHint')}
      icon={IconFlask}
      fields={[
        { key: 'code', kind: 'textLtr', label: t('services.code') },
        ...names,
        { key: 'unit', kind: 'textLtr', label: t('clinical.unit') },
        { key: 'reference_range', kind: 'textLtr', label: t('clinical.reference') },
      ]}
      columns={[
        { label: t('services.code'), render: (x) => <Text size="sm" dir="ltr">{x.code}</Text> },
        { label: t('master.name'), render: (x) => nameOf(x, lang) },
        { label: t('clinical.reference'), render: (x) => <Text size="sm" dir="ltr">{[x.reference_range, x.unit].filter(Boolean).join(' ')}</Text> },
      ]}
      defaults={{ code: '', name_ar: '', name_en: '', unit: '', reference_range: '' }}
      testId="lab-tests-tab"
    />
  );
}
