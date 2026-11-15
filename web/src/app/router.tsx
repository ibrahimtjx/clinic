import { createBrowserRouter } from 'react-router';

import { CalendarPage } from '../appointments/CalendarPage';
import { DesignPage } from '../pages/DesignPage';
import { AppointmentSlip, DaySchedule } from '../print/PrintPages';
import { HomePage } from '../pages/HomePage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { PatientProfilePage } from '../patients/PatientProfilePage';
import { PatientsPage } from '../patients/PatientsPage';
import { SettingsPage } from '../settings/SettingsPage';
import { AppLayout } from './AppLayout';
import { NAV_ITEMS } from './nav';

export const routes = [
  // Print pages render without the app shell.
  { path: '/print/slip/:id', element: <AppointmentSlip /> },
  { path: '/print/day', element: <DaySchedule /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'design', element: <DesignPage /> },
      { path: 'settings/:tab?', element: <SettingsPage /> },
      { path: 'appointments', element: <CalendarPage /> },
      { path: 'patients', element: <PatientsPage /> },
      { path: 'patients/:id/:tab?', element: <PatientProfilePage /> },
      ...NAV_ITEMS.filter((i) => i.milestone).map((item) => ({
        path: item.path.slice(1),
        element: <PlaceholderPage item={item} />,
      })),
    ],
  },
];

export const router = createBrowserRouter(routes);
