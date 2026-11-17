import { Grid, NavLink, Paper, Stack, Text, Title } from '@mantine/core';
import {
  IconBrandWhatsapp,
  IconBuildingHospital,
  IconCalendarStats,
  IconCategory,
  IconDeviceDesktop,
  IconFlask,
  IconHash,
  IconHistory,
  IconId,
  IconTypography,
  IconQuote,
  IconReceipt2,
  IconServerBolt,
  IconShieldCheck,
  IconShieldLock,
  IconSpeakerphone,
  IconStethoscope,
  IconTag,
  IconUserShield,
  IconUsers,
  IconUsersGroup,
  IconList,
  IconPill,
  type Icon,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useParams } from 'react-router';

import { useAuth } from '../auth/AuthProvider';
import { EmptyState } from '../components/EmptyState';
import { AppearanceTab } from './AppearanceTab';
import { AuditTab } from './AuditTab';
import { ClinicInfoTab } from './ClinicInfoTab';
import { DoctorsTab } from './DoctorsTab';
import { ClinicsTab, DepartmentsTab, InsuranceCompaniesTab, LabTestsTab, MedicationsTab, PhrasesTab, ReferralSourcesTab, StatusesTab, VisitTypesTab } from './ListTabs';
import { BillingSettingsTab, InsuranceClassesTab } from './InsuranceClassesTab';
import { NumberingTab } from './NumberingTab';
import { QueueSettingsTab } from './QueueSettingsTab';
import { RolesTab } from './RolesTab';
import { SecurityTab } from './SecurityTab';
import { ServicesTab } from './ServicesTab';
import { SystemHealthTab } from './SystemHealthTab';
import { ThisPcTab } from './ThisPcTab';
import { UsersTab } from './UsersTab';
import { WhatsAppTab } from './WhatsAppTab';

interface Tab {
  key: string;
  /** Empty: every signed-in user (their own preferences). */
  perm: string;
  icon: Icon;
  el: ReactNode;
}

const GROUPS: { key: string; tabs: Tab[] }[] = [
  { key: 'me', tabs: [{ key: 'appearance', perm: '', icon: IconTypography, el: <AppearanceTab /> }] },
  {
    key: 'clinic',
    tabs: [
      { key: 'clinic-info', perm: 'settings.manage', icon: IconId, el: <ClinicInfoTab /> },
      { key: 'clinics', perm: 'settings.manage', icon: IconBuildingHospital, el: <ClinicsTab /> },
      { key: 'departments', perm: 'settings.manage', icon: IconCategory, el: <DepartmentsTab /> },
      { key: 'doctors', perm: 'settings.manage', icon: IconStethoscope, el: <DoctorsTab /> },
    ],
  },
  {
    key: 'lists',
    tabs: [
      { key: 'services', perm: 'settings.manage', icon: IconList, el: <ServicesTab /> },
      { key: 'statuses', perm: 'settings.manage', icon: IconCalendarStats, el: <StatusesTab /> },
      { key: 'visit-types', perm: 'settings.manage', icon: IconTag, el: <VisitTypesTab /> },
      { key: 'insurance-companies', perm: 'settings.manage', icon: IconShieldCheck, el: <InsuranceCompaniesTab /> },
      { key: 'insurance-classes', perm: 'settings.manage', icon: IconShieldCheck, el: <InsuranceClassesTab /> },
      { key: 'billing-settings', perm: 'settings.manage', icon: IconReceipt2, el: <BillingSettingsTab /> },
      { key: 'referral-sources', perm: 'settings.manage', icon: IconSpeakerphone, el: <ReferralSourcesTab /> },
      { key: 'phrases', perm: 'settings.manage', icon: IconQuote, el: <PhrasesTab /> },
      { key: 'medications', perm: 'settings.manage', icon: IconPill, el: <MedicationsTab /> },
      { key: 'lab-tests', perm: 'settings.manage', icon: IconFlask, el: <LabTestsTab /> },
      { key: 'numbering', perm: 'settings.manage', icon: IconHash, el: <NumberingTab /> },
      { key: 'queue-settings', perm: 'settings.manage', icon: IconUsersGroup, el: <QueueSettingsTab /> },
      { key: 'whatsapp', perm: 'settings.manage', icon: IconBrandWhatsapp, el: <WhatsAppTab /> },
    ],
  },
  {
    key: 'access',
    tabs: [
      { key: 'users', perm: 'user.manage', icon: IconUsers, el: <UsersTab /> },
      { key: 'roles', perm: 'role.manage', icon: IconUserShield, el: <RolesTab /> },
      { key: 'security', perm: 'settings.manage', icon: IconShieldLock, el: <SecurityTab /> },
      { key: 'audit', perm: 'audit.view', icon: IconHistory, el: <AuditTab /> },
    ],
  },
  {
    key: 'pc',
    tabs: [
      { key: 'system-health', perm: 'settings.manage', icon: IconServerBolt, el: <SystemHealthTab /> },
      { key: 'this-pc', perm: 'settings.manage', icon: IconDeviceDesktop, el: <ThisPcTab /> },
    ],
  },
];

const camel = (k: string) => k.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());

/** Settings (SPEC 12): a side list of sections, one screen per section. */
export function SettingsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { tab } = useParams();
  const groups = GROUPS.map((g) => ({ ...g, tabs: g.tabs.filter((x) => !x.perm || can(x.perm)) })).filter((g) => g.tabs.length);
  const all = groups.flatMap((g) => g.tabs);

  if (!all.length) return <EmptyState icon={IconShieldLock} title={t('errors.forbidden')} hint={t('settings.noAccess')} />;
  const current = all.find((x) => x.key === tab);
  if (!current) return <Navigate to={`/settings/${all[0].key}`} replace />;

  return (
    <>
      <Title order={1} mb="lg">
        {t('nav.settings')}
      </Title>
      <Grid gutter="lg">
        <Grid.Col span={{ base: 12, md: 3, lg: 2.5 }}>
          <Paper p="xs" withBorder>
            <Stack gap="sm">
              {groups.map((g) => (
                <div key={g.key}>
                  <Text size="xs" c="dimmed" fw={600} px="sm" py={4}>
                    {t(`settings.groups.${g.key}`)}
                  </Text>
                  {g.tabs.map(({ key, icon: I }) => (
                    <NavLink
                      key={key}
                      component={Link}
                      to={`/settings/${key}`}
                      label={t(`settings.tabs.${camel(key)}`)}
                      leftSection={<I size={18} stroke={1.6} />}
                      active={key === tab}
                      style={{ borderRadius: 'var(--mantine-radius-md)' }}
                      data-testid={`settings-nav-${key}`}
                    />
                  ))}
                </div>
              ))}
            </Stack>
          </Paper>
        </Grid.Col>
        <Grid.Col span={{ base: 12, md: 9, lg: 9.5 }} key={current.key}>
          {current.el}
        </Grid.Col>
      </Grid>
    </>
  );
}
