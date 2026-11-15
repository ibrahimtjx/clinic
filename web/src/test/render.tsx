import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { DatesLocale } from '../app/DatesLocale';
import { makeQueryClient, Providers } from '../app/Providers';
import { routes } from '../app/router';
import { AuthGate } from '../auth/AuthGate';
import { AuthProvider } from '../auth/AuthProvider';

export function renderApp(path: string, lang: 'ar' | 'en' = 'ar') {
  localStorage.setItem('clinic.lang', JSON.stringify(lang));
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <Providers queryClient={makeQueryClient()}>
      <DatesLocale>
        <AuthProvider>
          <AuthGate>
            <RouterProvider router={router} />
          </AuthGate>
        </AuthProvider>
      </DatesLocale>
    </Providers>,
  );
}

export function renderWithProviders(ui: ReactElement) {
  return render(<Providers queryClient={makeQueryClient()}>{ui}</Providers>);
}
