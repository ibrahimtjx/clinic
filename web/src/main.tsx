import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { DatesLocale } from './app/DatesLocale';
import { Providers } from './app/Providers';
import { router } from './app/router';
import { AuthGate } from './auth/AuthGate';
import { AuthProvider } from './auth/AuthProvider';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <DatesLocale>
        <AuthProvider>
          <AuthGate>
            <RouterProvider router={router} />
          </AuthGate>
        </AuthProvider>
      </DatesLocale>
    </Providers>
  </StrictMode>,
);
