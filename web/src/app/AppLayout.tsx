import {
  ActionIcon,
  Alert,
  AppShell,
  Box,
  Button,
  Group,
  Indicator,
  Kbd,
  Menu,
  NavLink,
  ScrollArea,
  Stack,
  Text,
  ThemeIcon,
  Tooltip,
  UnstyledButton,
} from '@mantine/core';
import { useHotkeys, useLocalStorage } from '@mantine/hooks';
import { useState } from 'react';
import { spotlight } from '@mantine/spotlight';
import {
  IconChevronsLeft,
  IconChevronsRight,
  IconDialpad,
  IconKey,
  IconLanguage,
  IconLock,
  IconLogout,
  IconMoon,
  IconPlus,
  IconSearch,
  IconStethoscope,
  IconSun,
  IconUserCircle,
  IconWifi,
  IconWifiOff,
} from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { NavLink as RouterNavLink, Outlet, useLocation } from 'react-router';

import { useClinicInfo } from '../master/queries';
import { CommandPalette } from './CommandPalette';
import { NotificationsPopover } from './NotificationsPopover';
import { useConnection } from './connection';
import { displayName, useAuth } from '../auth/AuthProvider';
import { AccountModals, type AccountModal } from '../auth/AccountModals';
import { DESIGN_ITEM, visibleNav, type NavItem } from './nav';
import { usePrefs, useToggleTheme } from './preferences';
import classes from './AppLayout.module.css';

export function AppLayout() {
  const { t } = useTranslation();
  const [collapsed, setCollapsed] = useLocalStorage({ key: 'clinic.sidebar-collapsed', defaultValue: false });
  const conn = useConnection();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: collapsed ? 72 : 240, breakpoint: 0 }}
      padding="lg"
      classNames={{ main: classes.main, header: classes.header, navbar: classes.navbar }}
    >
      <AppShell.Header>
        <TopBar />
      </AppShell.Header>

      <AppShell.Navbar p="sm">
        <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((c) => !c)} />
      </AppShell.Navbar>

      <AppShell.Main>
        {conn.state === 'offline' && (
          <Alert
            color="red"
            variant="light"
            icon={<IconWifiOff size={18} />}
            mb="lg"
            role="alert"
            data-testid="offline-banner"
          >
            <Group justify="space-between" wrap="nowrap">
              <Text size="sm">{t('connection.banner')}</Text>
              <Button size="xs" variant="white" color="red" onClick={conn.retry} loading={conn.isFetching}>
                {t('connection.retry')}
              </Button>
            </Group>
          </Alert>
        )}
        <Outlet />
      </AppShell.Main>
      <CommandPalette />
    </AppShell>
  );
}

function Sidebar({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) {
  const { t, i18n } = useTranslation();
  const { canAny } = useAuth();
  const { lang } = usePrefs();
  const clinic = useClinicInfo();
  const clinicName = (lang === 'ar' ? clinic.data?.name_ar || clinic.data?.name_en : clinic.data?.name_en || clinic.data?.name_ar) || t('app.name');
  const rtl = i18n.dir() === 'rtl';
  // Chevron points toward the edge the sidebar collapses to.
  const CollapseIcon = collapsed === rtl ? IconChevronsRight : IconChevronsLeft;

  return (
    <Stack h="100%" gap="xs">
      <Group gap="sm" px={collapsed ? 0 : 'xs'} justify={collapsed ? 'center' : 'flex-start'} h={44} wrap="nowrap">
        <ThemeIcon size={34} radius="md" variant="filled">
          <IconStethoscope size={20} />
        </ThemeIcon>
        {!collapsed && (
          <Box>
            <Text fw={600} size="md" lh={1.2} lineClamp={1} data-testid="clinic-name">
              {clinicName}
            </Text>
            <Text size="xs" c="dimmed" lh={1.2}>
              {t('app.tagline')}
            </Text>
          </Box>
        )}
      </Group>

      <ScrollArea flex={1} mt="sm">
        <Stack gap={4}>
          {visibleNav(canAny).map((item) => (
            <SidebarLink key={item.key} item={item} collapsed={collapsed} />
          ))}
        </Stack>
      </ScrollArea>

      <Stack gap={4}>
        <SidebarLink item={DESIGN_ITEM} collapsed={collapsed} />
        <Tooltip label={collapsed ? t('nav.expand') : t('nav.collapse')} position={rtl ? 'left' : 'right'}>
          <UnstyledButton className={classes.collapse} onClick={onToggle} aria-label={collapsed ? t('nav.expand') : t('nav.collapse')}>
            <CollapseIcon size={18} />
          </UnstyledButton>
        </Tooltip>
      </Stack>
    </Stack>
  );
}

function SidebarLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const { t, i18n } = useTranslation();
  const { pathname } = useLocation();
  const active = item.path === '/' ? pathname === '/' : pathname.startsWith(item.path);
  const label = t(`nav.${item.key}`);
  const Icon = item.icon;
  const link = (
    <NavLink
      component={RouterNavLink}
      to={item.path}
      label={collapsed ? undefined : label}
      aria-label={label}
      leftSection={<Icon size={20} stroke={1.6} />}
      active={active}
      className={classes.navLink}
      data-collapsed={collapsed || undefined}
    />
  );
  return collapsed ? (
    <Tooltip label={label} position={i18n.dir() === 'rtl' ? 'left' : 'right'}>
      {link}
    </Tooltip>
  ) : (
    link
  );
}

function TopBar() {
  const { t } = useTranslation();
  const conn = useConnection();
  const { lang, setLang } = usePrefs();
  const { isDark, toggle } = useToggleTheme();
  const { me, lock, logout } = useAuth();
  const [modal, setModal] = useState<AccountModal>(null);

  useHotkeys([
    ['mod+shift+L', toggle],
    ['mod+L', () => void lock()],
  ]);

  return (
    <Group h="100%" px="lg" justify="space-between" wrap="nowrap" gap="md">
      <UnstyledButton className={classes.search} onClick={() => spotlight.open()} data-testid="global-search">
        <IconSearch size={16} />
        <Text size="sm" c="dimmed" flex={1} truncate>
          {t('topbar.search')}
        </Text>
        <Group gap={4} dir="ltr" wrap="nowrap">
          <Kbd size="xs">Ctrl</Kbd>
          <Kbd size="xs">K</Kbd>
        </Group>
      </UnstyledButton>

      <Group gap="xs" wrap="nowrap">
        <Tooltip label={t('common.milestone', { m: 'M4' })}>
          <Button leftSection={<IconPlus size={16} />} disabled={!conn.online} data-testid="new-appointment">
            {t('topbar.newAppointment')}
          </Button>
        </Tooltip>

        <NotificationsPopover />

        <Tooltip label={t(`connection.${conn.state}`)}>
          <Indicator
            color={conn.state === 'online' ? 'green' : conn.state === 'offline' ? 'red' : 'yellow'}
            size={9}
            offset={6}
            processing={conn.state === 'checking'}
          >
            <ThemeIcon variant="subtle" color={conn.online ? 'neutral' : 'red'} size="lg" aria-label={t(`connection.${conn.state}`)} data-testid="connection" data-state={conn.state}>
              {conn.state === 'offline' ? <IconWifiOff size={20} stroke={1.6} /> : <IconWifi size={20} stroke={1.6} />}
            </ThemeIcon>
          </Indicator>
        </Tooltip>

        <Menu position="bottom-end" shadow="md" width={220}>
          <Menu.Target>
            <ActionIcon variant="subtle" color="neutral" size="lg" aria-label={t('topbar.userMenu')} data-testid="user-menu">
              <IconUserCircle size={22} stroke={1.6} />
            </ActionIcon>
          </Menu.Target>
          <Menu.Dropdown>
            {me && (
              <>
                <Box px="sm" py={6}>
                  <Text size="sm" fw={600} data-testid="current-user">
                    {displayName(me, lang)}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {me.roles.map((r) => (lang === 'ar' ? r.name_ar : r.name_en)).join('، ')}
                  </Text>
                </Box>
                <Menu.Divider />
                <Menu.Item leftSection={<IconKey size={16} />} onClick={() => setModal('password')}>
                  {t('password.change')}
                </Menu.Item>
                <Menu.Item leftSection={<IconDialpad size={16} />} onClick={() => setModal('pin')} data-testid="open-pin">
                  {me.has_pin ? t('pin.change') : t('pin.set')}
                </Menu.Item>
                <Menu.Divider />
              </>
            )}
            <Menu.Label>{t('topbar.language')}</Menu.Label>
            <Menu.Item
              leftSection={<IconLanguage size={16} />}
              onClick={() => setLang(lang === 'ar' ? 'en' : 'ar')}
              data-testid="toggle-language"
            >
              {lang === 'ar' ? 'English' : 'العربية'}
            </Menu.Item>
            <Menu.Label>{t('topbar.theme')}</Menu.Label>
            <Menu.Item
              leftSection={isDark ? <IconSun size={16} /> : <IconMoon size={16} />}
              onClick={toggle}
              rightSection={<Kbd size="xs">Ctrl+Shift+L</Kbd>}
              data-testid="toggle-theme"
            >
              {isDark ? t('topbar.light') : t('topbar.dark')}
            </Menu.Item>
            <Menu.Divider />
            <Menu.Item leftSection={<IconLock size={16} />} onClick={() => void lock()} rightSection={<Kbd size="xs">Ctrl+L</Kbd>} data-testid="lock">
              {t('topbar.lock')}
            </Menu.Item>
            <Menu.Item leftSection={<IconLogout size={16} />} onClick={() => void logout()} data-testid="sign-out">
              {t('topbar.signOut')}
            </Menu.Item>
          </Menu.Dropdown>
        </Menu>
        <AccountModals modal={modal} onClose={() => setModal(null)} />
      </Group>
    </Group>
  );
}
