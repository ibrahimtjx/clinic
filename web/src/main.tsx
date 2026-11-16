import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { DatesLocale } from './app/DatesLocale';
import { Providers } from './app/Providers';
import { router } from './app/router';
import { AuthGate } from './auth/AuthGate';
import { AuthProvider } from './auth/AuthProvider';
import { setMachineName } from './lib/api';
import { desktop, isDesktop, type DesktopInfo } from './lib/desktop';

// In the desktop app the audit "machine" is the Windows PC name (SPEC 3.4), not a typed label.
const machine = isDesktop()
  ? desktop<DesktopInfo>('get_config')
      .then((c) => setMachineName(c.machine))
      .catch(() => undefined)
  : Promise.resolve();

void machine.finally(() =>
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
  ),
);
