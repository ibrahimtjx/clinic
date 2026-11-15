import { createBrowserRouter } from 'react-router';

import { DesignPage } from '../pages/DesignPage';
import { HomePage } from '../pages/HomePage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { PatientProfilePage } from '../patients/PatientProfilePage';
import { PatientsPage } from '../patients/PatientsPage';
import { SettingsPage } from '../settings/SettingsPage';
import { AppLayout } from './AppLayout';
import { NAV_ITEMS } from './nav';

export const routes = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'design', element: <DesignPage /> },
      { path: 'settings/:tab?', element: <SettingsPage /> },
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
