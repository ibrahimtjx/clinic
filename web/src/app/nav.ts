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
}

// Sidebar order from SPEC 4.3. Role filtering arrives with permissions in M1.
export const NAV_ITEMS: NavItem[] = [
  { key: 'home', path: '/', icon: IconHome },
  { key: 'appointments', path: '/appointments', icon: IconCalendarEvent, milestone: 'M4' },
  { key: 'queue', path: '/queue', icon: IconUsersGroup, milestone: 'M5' },
  { key: 'patients', path: '/patients', icon: IconUsers, milestone: 'M3' },
  { key: 'billing', path: '/billing', icon: IconReceipt2, milestone: 'M7–M8' },
  { key: 'reports', path: '/reports', icon: IconChartBar, milestone: 'M9' },
  { key: 'settings', path: '/settings', icon: IconSettings, milestone: 'M2' },
];

export const DESIGN_ITEM: NavItem = { key: 'design', path: '/design', icon: IconPalette };
