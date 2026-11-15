import { Alert, Anchor, Button, Group, PasswordInput, Popover, Stack, Text, TextInput } from '@mantine/core';
import { IconAlertCircle, IconDeviceDesktop, IconLogin } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { useConnection } from '../app/connection';
import { usePrefs } from '../app/preferences';
import { getMachineName, setMachineName } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { AuthLayout } from './AuthLayout';
import { useAuth } from './AuthProvider';

export function LoginPage() {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { login } = useAuth();
  const conn = useConnection();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!username || !password) return;
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError(errorMessage(t, err, lang));
      setPassword('');
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthLayout title={t('app.name')} subtitle={t('auth.signInHint')}>
      <form onSubmit={submit} data-testid="login-form">
        <Stack>
          {conn.state === 'offline' && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
              {t('connection.banner')}
            </Alert>
          )}
          {error && (
            <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />} data-testid="login-error">
              {error}
            </Alert>
          )}
          <TextInput
            label={t('auth.username')}
            value={username}
            onChange={(e) => setUsername(e.currentTarget.value)}
            autoComplete="username"
            dir="ltr"
            autoFocus
            required
            name="username"
          />
          <PasswordInput
            label={t('auth.password')}
            value={password}
            onChange={(e) => setPassword(e.currentTarget.value)}
            autoComplete="current-password"
            required
            name="password"
          />
          <Button type="submit" loading={busy} disabled={conn.state === 'offline'} leftSection={<IconLogin size={18} />} fullWidth mt="xs">
            {t('auth.signIn')}
          </Button>
          <DeviceName />
        </Stack>
      </form>
    </AuthLayout>
  );
}

/** Name of this PC as recorded in the audit log. The desktop app fills it automatically (M10). */
function DeviceName() {
  const { t } = useTranslation();
  const [name, setName] = useState(getMachineName());
  const [draft, setDraft] = useState(name);
  const [opened, setOpened] = useState(false);
  return (
    <Group justify="center" gap={6}>
      <IconDeviceDesktop size={14} color="var(--app-muted)" />
      <Text size="xs" c="dimmed">
        {t('auth.device')}: <span dir="ltr">{name}</span>
      </Text>
      <Popover opened={opened} onChange={setOpened} width={240} position="top">
        <Popover.Target>
          <Anchor component="button" type="button" size="xs" onClick={() => setOpened((o) => !o)}>
            {t('common.edit')}
          </Anchor>
        </Popover.Target>
        <Popover.Dropdown>
          <Stack gap="xs">
            <TextInput size="xs" label={t('auth.deviceName')} value={draft} onChange={(e) => setDraft(e.currentTarget.value)} dir="ltr" maxLength={64} />
            <Button
              size="xs"
              onClick={() => {
                if (!draft.trim()) return;
                setMachineName(draft);
                setName(getMachineName());
                setOpened(false);
              }}
            >
              {t('common.save')}
            </Button>
          </Stack>
        </Popover.Dropdown>
      </Popover>
    </Group>
  );
}
