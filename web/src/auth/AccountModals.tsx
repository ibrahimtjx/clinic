import { Alert, Button, Group, Modal, PasswordInput, Stack, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck } from '@tabler/icons-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { useAuth } from './AuthProvider';
import { ChangePasswordForm } from './ChangePasswordForm';
import type { Me } from './types';

export type AccountModal = 'password' | 'pin' | null;

export function AccountModals({ modal, onClose }: { modal: AccountModal; onClose: () => void }) {
  const { t } = useTranslation();
  const done = () => {
    notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('common.saved') });
    onClose();
  };
  return (
    <>
      <Modal opened={modal === 'password'} onClose={onClose} title={t('password.change')} size="sm">
        <ChangePasswordForm onDone={done} />
      </Modal>
      <Modal opened={modal === 'pin'} onClose={onClose} title={t('pin.title')} size="sm">
        <PinForm onDone={done} />
      </Modal>
    </>
  );
}

/** Personal 4 to 6 digit PIN for unlocking and quick user switch (SPEC 3.3). */
function PinForm({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { me, applyMe } = useAuth();
  const [password, setPassword] = useState('');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => setError(null), [pin, password]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      applyMe(await api<Me>('/auth/me/pin', { method: 'PUT', body: { password, pin } }));
      onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    applyMe(await api<Me>('/auth/me/pin', { method: 'DELETE' }));
    onDone();
  }

  return (
    <form onSubmit={submit} data-testid="pin-form">
      <Stack>
        <Text size="sm" c="dimmed">
          {t('pin.hint')}
        </Text>
        {error !== null && (
          <Alert color="red" variant="light">
            {errorMessage(t, error, lang)}
          </Alert>
        )}
        <PasswordInput label={t('pin.newPin')} value={pin} onChange={(e) => setPin(e.currentTarget.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" autoComplete="off" dir="ltr" required autoFocus data-testid="pin-new" />
        <PasswordInput label={t('pin.confirmWithPassword')} value={password} onChange={(e) => setPassword(e.currentTarget.value)} autoComplete="current-password" required data-testid="pin-password" />
        <Group justify="space-between">
          {me?.has_pin ? (
            <Button variant="subtle" color="red" onClick={() => void remove()}>
              {t('pin.remove')}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" loading={busy} disabled={pin.length < 4 || !password}>
            {t('common.save')}
          </Button>
        </Group>
      </Stack>
    </form>
  );
}
