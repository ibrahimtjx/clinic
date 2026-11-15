import { Box, Button, Center, Loader, Stack } from '@mantine/core';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { AuthLayout } from './AuthLayout';
import { useAuth } from './AuthProvider';
import { ChangePasswordForm } from './ChangePasswordForm';
import { LockScreen } from './LockScreen';
import classes from './LockScreen.module.css';
import { LoginPage } from './LoginPage';

/** Shows sign-in, forced password change, or the app (with the lock screen over it when locked). */
export function AuthGate({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { status, me, logout } = useAuth();

  if (status === 'loading') {
    return (
      <Center h="100vh" bg="var(--app-bg)">
        <Loader type="dots" aria-label={t('common.loading')} />
      </Center>
    );
  }
  if (status === 'signedOut') return <LoginPage />;
  // Overlays keep the app mounted so open work survives a lock or a user switch.
  return (
    <>
      {children}
      {status === 'locked' && <LockScreen />}
      {status === 'signedIn' && me?.must_change_password && (
        <Box className={classes.cover} data-testid="must-change-password">
          <AuthLayout title={t('password.mustChangeTitle')} subtitle={t('password.mustChangeHint')}>
            <Stack>
              <ChangePasswordForm />
              <Button variant="subtle" color="neutral" onClick={() => void logout()}>
                {t('topbar.signOut')}
              </Button>
            </Stack>
          </AuthLayout>
        </Box>
      )}
    </>
  );
}
