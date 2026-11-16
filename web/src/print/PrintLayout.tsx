import { Button, Group, Stack, Text, Title } from '@mantine/core';
import { IconPrinter } from '@tabler/icons-react';
import { useEffect, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { useClinicInfo } from '../master/queries';
import classes from './Print.module.css';

/**
 * Printable page (SPEC 3.8): preview on screen, then the browser's Print or Save as PDF. Silent
 * printing to the PC's printers comes with the desktop app (M0.5/M10).
 */
export function PrintLayout({ title, children, ready, size = 'a4' }: { title: string; children: ReactNode; ready: boolean; size?: 'a4' | 'slip' | 'a4-landscape' }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const clinic = useClinicInfo();
  const name = (lang === 'ar' ? clinic.data?.name_ar : clinic.data?.name_en) || t('app.name');
  useEffect(() => {
    if (ready && clinic.data) {
      const id = setTimeout(() => window.print(), 400);
      return () => clearTimeout(id);
    }
  }, [ready, clinic.data]);
  return (
    <div className={size === 'slip' ? classes.slip : size === 'a4-landscape' ? classes.a4l : classes.a4} data-testid="print-page">
      <Group justify="flex-end" className={classes.noPrint} mb="md">
        <Button leftSection={<IconPrinter size={16} />} onClick={() => window.print()}>
          {t('print.print')}
        </Button>
      </Group>
      <Stack gap={2} className={classes.letterhead}>
        <Title order={3}>{name}</Title>
        {clinic.data?.phone && <Text size="xs">{clinic.data.phone}</Text>}
      </Stack>
      <Title order={4} my="sm">
        {title}
      </Title>
      {children}
    </div>
  );
}
