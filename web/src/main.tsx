import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router';

import { DatesLocale } from './app/DatesLocale';
import { Providers } from './app/Providers';
import { router } from './app/router';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Providers>
      <DatesLocale>
        <RouterProvider router={router} />
      </DatesLocale>
    </Providers>
  </StrictMode>,
);
