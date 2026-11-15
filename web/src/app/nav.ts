import {
  IconCalendarEvent,
  IconChartBar,
  IconHome,
  IconPalette,
  IconReceipt2,
  IconSettings,
  IconUsers,
  IconUsersGroup,
  type Icon,
} from '@tabler/icons-react';

export interface NavItem {
  key: 'home' | 'appointments' | 'queue' | 'patients' | 'billing' | 'reports' | 'settings' | 'design';
  path: string;
  icon: Icon;
  /** Milestone that delivers the screen; shown on placeholder pages. */
  milestone?: string;
  /** Shown when the user holds any of these permissions (SPEC 4.3: items are shown by role). */
  anyOf?: string[];
}

// Sidebar order from SPEC 4.3. Role filtering arrives with permissions in M1.
export const NAV_ITEMS: NavItem[] = [
  { key: 'home', path: '/', icon: IconHome },
  { key: 'appointments', path: '/appointments', icon: IconCalendarEvent, milestone: 'M4', anyOf: ['appointment.view'] },
  { key: 'queue', path: '/queue', icon: IconUsersGroup, milestone: 'M5', anyOf: ['queue.view'] },
  { key: 'patients', path: '/patients', icon: IconUsers, milestone: 'M3', anyOf: ['patient.view'] },
  {
    key: 'billing',
    path: '/billing',
    icon: IconReceipt2,
    milestone: 'M7–M8',
    anyOf: ['quotation.view', 'invoice.view', 'payment.collect'],
  },
  {
    key: 'reports',
    path: '/reports',
    icon: IconChartBar,
    milestone: 'M9',
    anyOf: ['report.revenue', 'report.financial', 'report.clinical', 'report.operational'],
  },
  {
    key: 'settings',
    path: '/settings',
    icon: IconSettings,
    anyOf: ['user.manage', 'role.manage', 'settings.manage', 'audit.view'],
  },
];

export const visibleNav = (canAny: (...p: string[]) => boolean) => NAV_ITEMS.filter((i) => !i.anyOf || canAny(...i.anyOf));

export const DESIGN_ITEM: NavItem = { key: 'design', path: '/design', icon: IconPalette };
