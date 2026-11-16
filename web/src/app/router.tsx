import { createBrowserRouter } from 'react-router';

import { CalendarPage } from '../appointments/CalendarPage';
import { DesignPage } from '../pages/DesignPage';
import { BillingPage } from '../billing/BillingPage';
import { DocumentEditor } from '../billing/DocumentEditor';
import { InvoicePage } from '../billing/InvoicePage';
import { BillingPrint } from '../print/BillingPrint';
import { LabPrint, MedicalReportPrint, PrescriptionPrint } from '../print/ClinicalPrint';
import { DentalPrint } from '../print/DentalPrint';
import { ReportPrint } from '../print/ReportPrint';
import { ReportsPage } from '../reports/ReportsPage';
import { ClosingPrint, CreditNotePrint, InvoicePrint, ReceiptPrint } from '../print/LedgerPrint';
import { AppointmentSlip, DaySchedule, TestPrint } from '../print/PrintPages';
import { NotFoundPage, RouteErrorPage } from '../pages/ErrorPages';
import { HomePage } from '../pages/HomePage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { QueuePage } from '../queue/QueuePage';
import { PatientProfilePage } from '../patients/PatientProfilePage';
import { PatientsPage } from '../patients/PatientsPage';
import { SettingsPage } from '../settings/SettingsPage';
import { AppLayout } from './AppLayout';
import { NAV_ITEMS } from './nav';

export const routes = [
  // Print pages render without the app shell.
  { path: '/print/slip/:id', element: <AppointmentSlip /> },
  { path: '/print/day', element: <DaySchedule /> },
  { path: '/print/dental/:id', element: <DentalPrint /> },
  { path: '/print/billing/:kind/:id', element: <BillingPrint /> },
  { path: '/print/invoice/:id', element: <InvoicePrint /> },
  { path: '/print/receipt/:id', element: <ReceiptPrint /> },
  { path: '/print/credit-note/:id', element: <CreditNotePrint /> },
  { path: '/print/closing/:id', element: <ClosingPrint /> },
  { path: '/print/report/:key', element: <ReportPrint /> },
  { path: '/print/test/:kind', element: <TestPrint /> },
  { path: '/print/prescription/:id', element: <PrescriptionPrint /> },
  { path: '/print/lab/:id', element: <LabPrint /> },
  { path: '/print/medical-report/:id', element: <MedicalReportPrint /> },
  {
    path: '/',
    element: <AppLayout />,
    errorElement: <RouteErrorPage />,
    children: [
      { index: true, element: <HomePage /> },
      { path: 'design', element: <DesignPage /> },
      { path: 'settings/:tab?', element: <SettingsPage /> },
      { path: 'appointments', element: <CalendarPage /> },
      { path: 'queue', element: <QueuePage /> },
      { path: 'billing/:tab?', element: <BillingPage /> },
      { path: 'billing/invoice/:id', element: <InvoicePage /> },
      { path: 'billing/:kind/:id', element: <DocumentEditor /> },
      { path: 'reports/:key?', element: <ReportsPage /> },
      { path: 'patients', element: <PatientsPage /> },
      { path: 'patients/:id/:tab?', element: <PatientProfilePage /> },
      ...NAV_ITEMS.filter((i) => i.milestone).map((item) => ({
        path: item.path.slice(1),
        element: <PlaceholderPage item={item} />,
      })),
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];

export const router = createBrowserRouter(routes);
