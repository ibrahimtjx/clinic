import { Alert, Anchor, Avatar, Box, Button, Card, Center, PasswordInput, Stack, Text, TextInput, Title } from '@mantine/core';
import { IconAlertCircle, IconLock } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { errorMessage } from '../lib/errors';
import { displayName, useAuth } from './AuthProvider';
import classes from './LockScreen.module.css';

type Mode = 'pin' | 'password';

/**
 * Lock screen (SPEC 3.3). Covers the app without unmounting it, so the previous user's open work
 * stays as it was. The same user unlocks with PIN or password; another user can switch in with theirs.
 */
export function LockScreen() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { lockedUser, pinLogin, login, logout } = useAuth();
  const [switching, setSwitching] = useState(false);
  const [username, setUsername] = useState(lockedUser?.username ?? '');
  const [mode, setMode] = useState<Mode>(lockedUser?.has_pin ? 'pin' : 'password');
  const [pin, setPin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    // Keep keyboard input inside the lock screen.
    const prev = document.activeElement as HTMLElement | null;
    prev?.blur?.();
  }, []);

  async function attempt(secret: string, how: Mode) {
    const user = switching ? username.trim() : lockedUser?.username;
    if (!user || !secret) return;
    setBusy(true);
    setError(null);
    try {
      if (how === 'pin') await pinLogin(user, secret);
      else await login(user, secret);
    } catch (err) {
      setError(errorMessage(t, err, lang));
      setPin('');
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void attempt(mode === 'pin' ? pin : password, mode);
  };

  const startSwitch = () => {
    setSwitching(true);
    setUsername('');
    setMode('pin');
    setError(null);
  };

  return (
    <Box className={classes.overlay} role="dialog" aria-modal="true" aria-label={t('lock.title')} data-testid="lock-screen">
      <Center h="100%" p="md">
        <Card w="100%" maw={380} padding="xl" shadow="xl">
          <form onSubmit={submit}>
            <Stack align="center" gap="md">
              {switching || !lockedUser ? (
                <>
                  <Avatar size={56} radius="xl" color="accent">
                    <IconLock size={26} />
                  </Avatar>
                  <Title order={3}>{t('lock.switchUser')}</Title>
                  <TextInput w="100%" label={t('auth.username')} value={username} onChange={(e) => setUsername(e.currentTarget.value)} dir="ltr" autoFocus required data-testid="lock-username" />
                </>
              ) : (
                <>
                  <Avatar size={56} radius="xl" color="accent">
                    {displayName(lockedUser, lang).slice(0, 1)}
                  </Avatar>
                  <Stack gap={2} align="center">
                    <Title order={3}>{displayName(lockedUser, lang)}</Title>
                    <Text size="sm" c="dimmed">
                      {t('lock.locked')}
                    </Text>
                  </Stack>
                </>
              )}

              {error && (
                <Alert w="100%" color="red" variant="light" icon={<IconAlertCircle size={18} />} data-testid="lock-error">
                  {error}
                </Alert>
              )}

              {mode === 'pin' ? (
                <>
                  <PasswordInput
                    w="100%"
                    label={t('lock.enterPin')}
                    value={pin}
                    onChange={(e) => setPin(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))}
                    inputMode="numeric"
                    autoComplete="off"
                    autoFocus={!switching}
                    dir="ltr"
                    classNames={{ innerInput: classes.pin }}
                    data-testid="lock-pin"
                  />
                  <Button type="submit" fullWidth loading={busy} disabled={pin.length < 4}>
                    {switching ? t('auth.signIn') : t('lock.unlock')}
                  </Button>
                </>
              ) : (
                <>
                  <PasswordInput w="100%" label={t('auth.password')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoFocus={!switching} data-testid="lock-password" />
                  <Button type="submit" fullWidth loading={busy}>
                    {switching ? t('auth.signIn') : t('lock.unlock')}
                  </Button>
                </>
              )}

              <Stack gap={4} align="center">
                <Anchor component="button" type="button" size="sm" onClick={() => { setMode(mode === 'pin' ? 'password' : 'pin'); setError(null); }}>
                  {mode === 'pin' ? t('lock.usePassword') : t('lock.usePin')}
                </Anchor>
                {!switching ? (
                  <Anchor component="button" type="button" size="sm" onClick={startSwitch} data-testid="lock-switch">
                    {t('lock.switchUser')}
                  </Anchor>
                ) : (
                  lockedUser && (
                    <Anchor component="button" type="button" size="sm" onClick={() => { setSwitching(false); setMode(lockedUser.has_pin ? 'pin' : 'password'); setError(null); }}>
                      {t('lock.backTo', { name: displayName(lockedUser, lang) })}
                    </Anchor>
                  )
                )}
                <Anchor component="button" type="button" size="sm" c="dimmed" onClick={() => void logout()}>
                  {t('topbar.signOut')}
                </Anchor>
              </Stack>
              <Text size="xs" c="dimmed" ta="center">
                {t('lock.workKept')}
              </Text>
            </Stack>
          </form>
        </Card>
      </Center>
    </Box>
  );
}
