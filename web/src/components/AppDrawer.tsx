import { Drawer, type DrawerProps } from '@mantine/core';
import { useTranslation } from 'react-i18next';

/** Side drawer for quick edits (SPEC 4.1.3). Opens from the side opposite the sidebar. */
export function AppDrawer(props: Omit<DrawerProps, 'position'>) {
  const { i18n } = useTranslation();
  return <Drawer position={i18n.dir() === 'rtl' ? 'left' : 'right'} size="md" padding="lg" {...props} />;
}
