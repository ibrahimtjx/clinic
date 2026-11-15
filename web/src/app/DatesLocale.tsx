import 'dayjs/locale/ar';
import '@mantine/dates/styles.css';

import { DatesProvider } from '@mantine/dates';
import type { ReactNode } from 'react';

import { usePrefs } from './preferences';

export function DatesLocale({ children }: { children: ReactNode }) {
  const { lang } = usePrefs();
  // Week starts on Sunday in Saudi Arabia; weekend is Friday and Saturday.
  return (
    <DatesProvider settings={{ locale: lang, firstDayOfWeek: 0, weekendDays: [5, 6], timezone: 'Asia/Riyadh' }}>
      {children}
    </DatesProvider>
  );
}
