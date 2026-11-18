import { Alert, Anchor, Divider, Group, Select, SimpleGrid, Stack, Switch, Text, Textarea, TextInput, Title } from '@mantine/core';
import { DateInput } from '@mantine/dates';
import { IconAlertTriangle } from '@tabler/icons-react';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import { usePrefs } from '../app/preferences';
import { useQuery } from '@tanstack/react-query';

import type { InsuranceClass } from '../billing/types';
import { api } from '../lib/api';
import { NATIONAL_ID, SAUDI_MOBILE } from '../lib/format';
import { nameOf, useDoctors, useReferralSources } from '../master/queries';
import { useInsuranceCompanies } from './queries';
import type { Duplicate, Patient } from './types';

/** Editable patient fields (SPEC 5.3), all as strings or booleans for the form. */
export interface PatientFormValues {
  name_ar: string;
  name_en: string;
  national_id: string;
  nationality: string;
  gender: string;
  dob: string;
  mobile: string;
  phone: string;
  emergency_name: string;
  emergency_phone: string;
  default_doctor_id: string;
  secondary_file_no: string;
  is_external: boolean;
  sms_opt_out: boolean;
  chronic_diseases: string;
  allergies: string;
  referral_source_id: string;
  notes: string;
  ins_company_id: string;
  ins_policy_no: string;
  ins_class_name: string;
  ins_class_id: string;
  ins_membership_no: string;
  ins_expiry: string;
}

export const EMPTY_PATIENT: PatientFormValues = {
  name_ar: '',
  name_en: '',
  national_id: '',
  nationality: 'SA',
  gender: '',
  dob: '',
  mobile: '',
  phone: '',
  emergency_name: '',
  emergency_phone: '',
  default_doctor_id: '',
  secondary_file_no: '',
  is_external: false,
  sms_opt_out: false,
  chronic_diseases: '',
  allergies: '',
  referral_source_id: '',
  notes: '',
  ins_company_id: '',
  ins_policy_no: '',
  ins_class_name: '',
  ins_class_id: '',
  ins_membership_no: '',
  ins_expiry: '',
};

export function toForm(p: Patient): PatientFormValues {
  const s = (v: string | number | null | undefined) => (v == null ? '' : String(v));
  return {
    name_ar: p.name_ar,
    name_en: p.name_en,
    national_id: s(p.national_id),
    nationality: s(p.nationality),
    gender: s(p.gender),
    dob: s(p.dob),
    mobile: s(p.mobile),
    phone: s(p.phone),
    emergency_name: s(p.emergency_name),
    emergency_phone: s(p.emergency_phone),
    default_doctor_id: s(p.default_doctor_id),
    secondary_file_no: s(p.secondary_file_no),
    is_external: p.is_external,
    sms_opt_out: p.sms_opt_out,
    chronic_diseases: p.chronic_diseases,
    allergies: p.allergies,
    referral_source_id: s(p.referral_source_id),
    notes: p.notes,
    ins_company_id: s(p.insurance?.company_id),
    ins_policy_no: s(p.insurance?.policy_no),
    ins_class_name: s(p.insurance?.class_name),
    ins_class_id: s((p.insurance as { class_id?: number | null } | null)?.class_id),
    ins_membership_no: s(p.insurance?.membership_no),
    ins_expiry: s(p.insurance?.expiry),
  };
}

const AR_DIGITS = /[٠-٩]/g;
const toLatinDigits = (s: string) => s.replace(AR_DIGITS, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
const cleanNumber = (s: string) => toLatinDigits(s).replace(/[\s-]/g, '');

/** API body from form values. Empty strings become null. */
export function toBody(v: PatientFormValues) {
  const n = (x: string) => (x.trim() === '' ? null : x.trim());
  return {
    name_ar: v.name_ar.trim(),
    name_en: n(v.name_en),
    national_id: n(cleanNumber(v.national_id)),
    nationality: n(v.nationality),
    gender: n(v.gender),
    dob: n(v.dob),
    mobile: n(cleanNumber(v.mobile)),
    phone: n(v.phone),
    emergency_name: n(v.emergency_name),
    emergency_phone: n(cleanNumber(v.emergency_phone)),
    default_doctor_id: v.default_doctor_id ? Number(v.default_doctor_id) : null,
    secondary_file_no: n(v.secondary_file_no),
    is_external: v.is_external,
    sms_opt_out: v.sms_opt_out,
    chronic_diseases: v.chronic_diseases.trim(),
    allergies: v.allergies.trim(),
    referral_source_id: v.referral_source_id ? Number(v.referral_source_id) : null,
    notes: v.notes.trim(),
    insurance: v.ins_company_id
      ? {
          company_id: Number(v.ins_company_id),
          policy_no: v.ins_policy_no.trim(),
          class_name: v.ins_class_name.trim(),
          class_id: v.ins_class_id ? Number(v.ins_class_id) : null,
          membership_no: v.ins_membership_no.trim(),
          expiry: n(v.ins_expiry),
        }
      : null,
  };
}

export function validate(v: PatientFormValues, t: (k: string) => string): Partial<Record<keyof PatientFormValues, string>> {
  const e: Partial<Record<keyof PatientFormValues, string>> = {};
  if (v.name_ar.trim().length < 2) e.name_ar = t('patients.errors.name');
  const nid = cleanNumber(v.national_id);
  if (nid && !NATIONAL_ID.test(nid)) e.national_id = t('patients.errors.nationalId');
  const mob = cleanNumber(v.mobile);
  if (mob && !SAUDI_MOBILE.test(mob)) e.mobile = t('sample.mobileInvalid');
  if (v.dob && dayjs(v.dob).isAfter(dayjs())) e.dob = t('patients.errors.dob');
  return e;
}

export const NATIONALITIES = ['SA', 'EG', 'YE', 'SY', 'JO', 'SD', 'IN', 'PK', 'BD', 'PH', 'ID', 'KW', 'AE', 'BH', 'QA', 'OM', 'LB', 'PS', 'IQ', 'MA', 'TN', 'DZ', 'ET', 'NP', 'LK', 'US', 'GB'];

/** Warns while typing when the national ID or mobile already belongs to a patient (SPEC 5.3). */
export function useDuplicates(nationalId: string, mobile: string, excludeId?: number) {
  const [dups, setDups] = useState<Duplicate[]>([]);
  useEffect(() => {
    const nid = cleanNumber(nationalId);
    const mob = cleanNumber(mobile);
    const query = { national_id: NATIONAL_ID.test(nid) ? nid : undefined, mobile: SAUDI_MOBILE.test(mob) ? mob : undefined, exclude_id: excludeId };
    if (!query.national_id && !query.mobile) {
      setDups([]);
      return;
    }
    const ctrl = new AbortController();
    const id = setTimeout(() => {
      api<Duplicate[]>('/patients/duplicates', { query, signal: ctrl.signal })
        .then(setDups)
        .catch(() => {});
    }, 300);
    return () => {
      clearTimeout(id);
      ctrl.abort();
    };
  }, [nationalId, mobile, excludeId]);
  return dups;
}

export function DuplicateAlert({ dups }: { dups: Duplicate[] }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  if (!dups.length) return null;
  return (
    <Alert color="yellow" variant="light" icon={<IconAlertTriangle size={18} />} title={t('patients.duplicateTitle')} data-testid="duplicate-alert">
      <Stack gap={4}>
        {dups.map((d) => (
          <Text size="sm" key={d.id}>
            <Anchor component={Link} to={`/patients/${d.id}`} target="_blank">
              {nameOf(d, lang)} · {t('patients.fileNo')} {d.file_no}
            </Anchor>{' '}
            ({d.matched_on.map((m) => t(`patients.fields.${m}`)).join('، ')})
          </Text>
        ))}
      </Stack>
    </Alert>
  );
}

export function PatientFields({
  value,
  onChange,
  errors,
  compact = false,
}: {
  value: PatientFormValues;
  onChange: (v: PatientFormValues) => void;
  errors: Partial<Record<keyof PatientFormValues, string>>;
  /** Fewer fields: used when registering quickly. */
  compact?: boolean;
}) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const doctors = useDoctors();
  const sources = useReferralSources();
  const companies = useInsuranceCompanies();
  const classes = useQuery({ queryKey: ['master', 'insurance-classes'], queryFn: () => api<InsuranceClass[]>('/insurance-classes') });
  const set = <K extends keyof PatientFormValues>(k: K, v: PatientFormValues[K]) => onChange({ ...value, [k]: v });
  const text = (k: keyof PatientFormValues, opts: { ltr?: boolean; required?: boolean; placeholder?: string; inputMode?: 'numeric' | 'tel' } = {}) => (
    <TextInput
      label={t(`patients.fields.${k}`)}
      value={value[k] as string}
      onChange={(e) => set(k, e.currentTarget.value as never)}
      error={errors[k]}
      dir={opts.ltr ? 'ltr' : undefined}
      required={opts.required}
      placeholder={opts.placeholder}
      inputMode={opts.inputMode}
      name={k}
    />
  );
  const regionNames = new Intl.DisplayNames([lang], { type: 'region' });

  return (
    <Stack>
      <SimpleGrid cols={{ base: 1, sm: 2 }}>
        {text('name_ar', { required: true })}
        {text('name_en', { ltr: true })}
        {text('national_id', { ltr: true, placeholder: '1XXXXXXXXX', inputMode: 'numeric' })}
        {text('mobile', { ltr: true, placeholder: '05XXXXXXXX', inputMode: 'tel' })}
        <Select
          label={t('patients.fields.gender')}
          data={[
            { value: 'male', label: t('patients.male') },
            { value: 'female', label: t('patients.female') },
          ]}
          value={value.gender || null}
          onChange={(v) => set('gender', v ?? '')}
          clearable
        />
        <DateInput
          label={t('patients.fields.dob')}
          valueFormat="DD/MM/YYYY"
          value={value.dob ? dayjs(value.dob).toDate() : null}
          onChange={(d) => set('dob', d ? dayjs(d).format('YYYY-MM-DD') : '')}
          maxDate={new Date()}
          error={errors.dob}
          clearable
          defaultLevel="decade"
        />
      </SimpleGrid>
      {!compact && (
        <>
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label={t('patients.fields.nationality')}
              data={NATIONALITIES.map((c) => ({ value: c, label: regionNames.of(c) ?? c }))}
              value={value.nationality || null}
              onChange={(v) => set('nationality', v ?? '')}
              searchable
              clearable
            />
            <Select
              label={t('patients.fields.default_doctor_id')}
              data={(doctors.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
              value={value.default_doctor_id || null}
              onChange={(v) => set('default_doctor_id', v ?? '')}
              clearable
              searchable
            />
            {text('phone', { ltr: true, inputMode: 'tel' })}
            {text('secondary_file_no', { ltr: true })}
            {text('emergency_name')}
            {text('emergency_phone', { ltr: true, inputMode: 'tel' })}
          </SimpleGrid>

          <Divider label={t('patients.insurance')} labelPosition="left" />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Select
              label={t('patients.fields.ins_company_id')}
              data={(companies.data ?? []).map((c) => ({ value: String(c.id), label: nameOf(c, lang) }))}
              value={value.ins_company_id || null}
              onChange={(v) => onChange({ ...value, ins_company_id: v ?? '', ins_class_id: '', ins_class_name: '' })}
              clearable
              searchable
              description={(companies.data ?? []).length === 0 ? t('patients.noCompanies') : undefined}
            />
            {value.ins_company_id && (
              <>
                {text('ins_policy_no', { ltr: true })}
                <Select
                  label={t('patients.fields.ins_class_name')}
                  data={(classes.data ?? []).filter((c) => String(c.company_id) === value.ins_company_id).map((c) => ({ value: String(c.id), label: c.name }))}
                  value={value.ins_class_id || null}
                  onChange={(v) => onChange({ ...value, ins_class_id: v ?? '', ins_class_name: classes.data?.find((c) => String(c.id) === v)?.name ?? '' })}
                  clearable
                  description={t('billing.classPickHint')}
                  data-testid="ins-class"
                />
                {text('ins_membership_no', { ltr: true })}
                <DateInput
                  label={t('patients.fields.ins_expiry')}
                  valueFormat="DD/MM/YYYY"
                  value={value.ins_expiry ? dayjs(value.ins_expiry).toDate() : null}
                  onChange={(d) => set('ins_expiry', d ? dayjs(d).format('YYYY-MM-DD') : '')}
                  clearable
                />
              </>
            )}
          </SimpleGrid>

          <Divider label={t('patients.warnings')} labelPosition="left" />
          <SimpleGrid cols={{ base: 1, sm: 2 }}>
            <Textarea label={t('patients.fields.chronic_diseases')} value={value.chronic_diseases} onChange={(e) => set('chronic_diseases', e.currentTarget.value)} autosize minRows={2} />
            <Textarea label={t('patients.fields.allergies')} value={value.allergies} onChange={(e) => set('allergies', e.currentTarget.value)} autosize minRows={2} />
          </SimpleGrid>

          <Title order={4} mt="xs">
            {t('patients.other')}
          </Title>
          <Group>
            <Switch label={t('patients.fields.is_external')} description={t('patients.externalHint')} checked={value.is_external} onChange={(e) => set('is_external', e.currentTarget.checked)} />
            <Switch label={t('patients.fields.sms_opt_out')} checked={value.sms_opt_out} onChange={(e) => set('sms_opt_out', e.currentTarget.checked)} />
          </Group>
          <Select
            label={t('patients.fields.referral_source')}
            description={t('patients.referralHint')}
            data={(sources.data ?? []).map((r) => ({ value: String(r.id), label: nameOf(r, lang) }))}
            value={value.referral_source_id || null}
            onChange={(v) => set('referral_source_id', v ?? '')}
            clearable
            searchable
            data-testid="referral-source"
          />
          <Textarea label={t('patients.fields.notes')} value={value.notes} onChange={(e) => set('notes', e.currentTarget.value)} autosize minRows={2} />
        </>
      )}
    </Stack>
  );
}
