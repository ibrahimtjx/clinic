import { Alert, Button, List, PasswordInput, Stack } from '@mantine/core';
import { IconAlertCircle } from '@tabler/icons-react';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useAuth } from './AuthProvider';
import type { TokenOut } from './types';

/** Change own password. Policy (SPEC 3.3): at least 10 characters and not the username. */
export function ChangePasswordForm({ onDone }: { onDone?: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { me, applyToken } = useAuth();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const tooShort = next.length > 0 && next.length < 10;
  const sameAsUser = next.length > 0 && me && next.trim().toLowerCase() === me.username.toLowerCase();
  const mismatch = confirm.length > 0 && confirm !== next;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (tooShort || sameAsUser || next !== confirm) return;
    setBusy(true);
    setError(null);
    try {
      const t2 = await api<TokenOut>('/auth/me/password', { method: 'POST', body: { current_password: current, new_password: next } });
      applyToken(t2);
      onDone?.();
    } catch (err) {
      setError(errorMessage(t, err, lang));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} data-testid="change-password-form">
      <Stack>
        {error && (
          <Alert color="red" variant="light" icon={<IconAlertCircle size={18} />}>
            {error}
          </Alert>
        )}
        <PasswordInput label={t('password.current')} value={current} onChange={(e) => setCurrent(e.currentTarget.value)} autoComplete="current-password" required autoFocus />
        <PasswordInput
          label={t('password.new')}
          value={next}
          onChange={(e) => setNext(e.currentTarget.value)}
          autoComplete="new-password"
          required
          error={tooShort ? t('errors.password_too_short') : sameAsUser ? t('errors.password_equals_username') : undefined}
        />
        <PasswordInput
          label={t('password.confirm')}
          value={confirm}
          onChange={(e) => setConfirm(e.currentTarget.value)}
          autoComplete="new-password"
          required
          error={mismatch ? t('password.mismatch') : undefined}
        />
        <List size="xs" c="dimmed">
          <List.Item>{t('password.rule1')}</List.Item>
          <List.Item>{t('password.rule2')}</List.Item>
        </List>
        <Button type="submit" loading={busy} disabled={!current || !next || next !== confirm || !!tooShort || !!sameAsUser}>
          {t('password.change')}
        </Button>
      </Stack>
    </form>
  );
}
