import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';

import { DatesLocale } from '../app/DatesLocale';
import { makeQueryClient, Providers } from '../app/Providers';
import { routes } from '../app/router';

export function renderApp(path: string, lang: 'ar' | 'en' = 'ar') {
  localStorage.setItem('clinic.lang', JSON.stringify(lang));
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  return render(
    <Providers queryClient={makeQueryClient()}>
      <DatesLocale>
        <RouterProvider router={router} />
      </DatesLocale>
    </Providers>,
  );
}

export function renderWithProviders(ui: ReactElement) {
  return render(<Providers queryClient={makeQueryClient()}>{ui}</Providers>);
}
