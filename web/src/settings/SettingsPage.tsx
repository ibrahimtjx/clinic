import { Tabs, Title } from '@mantine/core';
import { IconHistory, IconShieldLock, IconUserShield, IconUsers } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';

import { useAuth } from '../auth/AuthProvider';
import { EmptyState } from '../components/EmptyState';
import { AuditTab } from './AuditTab';
import { RolesTab } from './RolesTab';
import { SecurityTab } from './SecurityTab';
import { UsersTab } from './UsersTab';

const TABS = [
  { key: 'users', perm: 'user.manage', icon: IconUsers, el: <UsersTab /> },
  { key: 'roles', perm: 'role.manage', icon: IconUserShield, el: <RolesTab /> },
  { key: 'security', perm: 'settings.manage', icon: IconShieldLock, el: <SecurityTab /> },
  { key: 'audit', perm: 'audit.view', icon: IconHistory, el: <AuditTab /> },
] as const;

export function SettingsPage() {
  const { t } = useTranslation();
  const { can } = useAuth();
  const { tab } = useParams();
  const navigate = useNavigate();
  const visible = TABS.filter((x) => can(x.perm));

  if (!visible.length) {
    return <EmptyState icon={IconShieldLock} title={t('errors.forbidden')} hint={t('settings.noAccess')} />;
  }
  if (!tab || !visible.some((x) => x.key === tab)) return <Navigate to={`/settings/${visible[0].key}`} replace />;

  return (
    <>
      <Title order={1} mb="lg">
        {t('nav.settings')}
      </Title>
      <Tabs value={tab} onChange={(v) => v && navigate(`/settings/${v}`)} keepMounted={false} variant="pills" radius="md">
        <Tabs.List mb="lg">
          {visible.map(({ key, icon: Icon }) => (
            <Tabs.Tab key={key} value={key} leftSection={<Icon size={16} />}>
              {t(`settings.tabs.${key}`)}
            </Tabs.Tab>
          ))}
        </Tabs.List>
        {visible.map(({ key, el }) => (
          <Tabs.Panel key={key} value={key}>
            {el}
          </Tabs.Panel>
        ))}
      </Tabs>
    </>
  );
}
