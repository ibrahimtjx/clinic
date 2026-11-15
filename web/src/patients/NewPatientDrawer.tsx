import { Alert, Anchor, Button, Group, Stack, Text } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { notifications } from '@mantine/notifications';
import { IconCheck } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { usePrefs } from '../app/preferences';
import { AppDrawer } from '../components/AppDrawer';
import { UnsavedChangesModal } from '../components/UnsavedChangesModal';
import { api, ApiError } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { DuplicateAlert, EMPTY_PATIENT, PatientFields, toBody, useDuplicates, validate, type PatientFormValues } from './PatientForm';
import type { Patient } from './types';

/** Register a patient (SPEC 5.3). Warns about a duplicate ID or mobile; the user can still continue. */
export function NewPatientDrawer({ opened, onClose, onCreated }: { opened: boolean; onClose: () => void; onCreated?: (p: Patient) => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState<PatientFormValues>(EMPTY_PATIENT);
  const [more, setMore] = useState(false);
  const [errors, setErrors] = useState<Partial<Record<keyof PatientFormValues, string>>>({});
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [confirmOpen, confirm] = useDisclosure(false);
  const dups = useDuplicates(form.national_id, form.mobile);

  useEffect(() => {
    if (opened) {
      setForm(EMPTY_PATIENT);
      setErrors({});
      setError(null);
      setMore(false);
    }
  }, [opened]);

  const dirty = JSON.stringify(form) !== JSON.stringify(EMPTY_PATIENT);

  async function save(allowDuplicate = false) {
    const e = validate(form, t);
    setErrors(e);
    if (Object.keys(e).length) return;
    setBusy(true);
    setError(null);
    try {
      const p = await api<Patient>('/patients', { method: 'POST', body: { ...toBody(form), allow_duplicate: allowDuplicate } });
      await qc.invalidateQueries({ queryKey: ['patients'] });
      notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('patients.created', { no: p.file_no }) });
      onClose();
      if (onCreated) onCreated(p);
      else navigate(`/patients/${p.id}`);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  }

  const possibleDup = error instanceof ApiError && error.code === 'possible_duplicate';
  const requestClose = () => (dirty ? confirm.open() : onClose());

  return (
    <>
      <AppDrawer opened={opened} onClose={requestClose} title={t('patients.new')} size="lg">
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            void save();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) void save();
          }}
          data-testid="new-patient-form"
        >
          <Stack>
            {!possibleDup && <DuplicateAlert dups={dups} />}
            {possibleDup ? (
              <Alert color="yellow" variant="light" title={t('patients.duplicateTitle')} data-testid="duplicate-confirm">
                <Stack gap="xs">
                  <DuplicateAlert dups={(error as ApiError).detail?.matches as never} />
                  <Text size="sm">{t('patients.duplicateConfirm')}</Text>
                  <Group gap="xs">
                    <Button size="xs" color="yellow" onClick={() => void save(true)} loading={busy}>
                      {t('patients.createAnyway')}
                    </Button>
                    <Button size="xs" variant="default" onClick={() => setError(null)}>
                      {t('common.cancel')}
                    </Button>
                  </Group>
                </Stack>
              </Alert>
            ) : (
              error !== null && (
                <Alert color="red" variant="light">
                  {errorMessage(t, error, lang)}
                </Alert>
              )
            )}
            <PatientFields value={form} onChange={setForm} errors={errors} compact={!more} />
            {!more && (
              <Anchor component="button" type="button" size="sm" onClick={() => setMore(true)} w="fit-content">
                {t('patients.moreDetails')}
              </Anchor>
            )}
            <Group justify="flex-end" mt="md">
              <Button variant="default" onClick={requestClose}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" loading={busy} disabled={possibleDup}>
                {t('common.save')}
              </Button>
            </Group>
          </Stack>
        </form>
      </AppDrawer>
      <UnsavedChangesModal
        opened={confirmOpen}
        onKeepEditing={confirm.close}
        onDiscard={() => {
          confirm.close();
          onClose();
        }}
        onSave={() => {
          confirm.close();
          void save();
        }}
      />
    </>
  );
}
