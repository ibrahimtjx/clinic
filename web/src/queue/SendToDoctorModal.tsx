import { Alert, Button, Group, Modal, Select, Stack, Text, TextInput } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck } from '@tabler/icons-react';
import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { api } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { nameOf, useDoctors } from '../master/queries';
import type { QueueEntry } from './types';

export interface SendTarget {
  patient_id: number;
  patient_label: string;
  doctor_id?: number | null;
  appointment_id?: number | null;
}

/** Send a patient to a doctor's queue (SPEC 7.3): from an appointment, the profile, or a walk-in. */
export function SendToDoctorModal({ target, onClose }: { target: SendTarget | null; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const qc = useQueryClient();
  const doctors = useDoctors();
  const [doctor, setDoctor] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setDoctor(target?.doctor_id ? String(target.doctor_id) : null);
    setNote('');
    setError(null);
  }, [target]);
  if (!target) return null;
  return (
    <Modal opened onClose={onClose} title={t('patients.sendToDoctor')} size="sm">
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const q = await api<QueueEntry>('/queue', {
              method: 'POST',
              body: { patient_id: target.patient_id, doctor_id: Number(doctor), appointment_id: target.appointment_id ?? null, note },
            });
            await qc.invalidateQueries({ queryKey: ['queue'] });
            await qc.invalidateQueries({ queryKey: ['appointments'] });
            notifications.show({ color: 'green', icon: <IconCheck size={18} />, message: t('queue.sent', { no: q.queue_no }) });
            onClose();
          } catch (err) {
            setError(err);
          } finally {
            setBusy(false);
          }
        }}
        data-testid="send-form"
      >
        <Stack>
          <Text size="sm" fw={600}>
            {target.patient_label}
          </Text>
          {error !== null && (
            <Alert color="red" variant="light">
              {errorMessage(t, error, lang)}
            </Alert>
          )}
          <Select
            label={t('appointments.doctor')}
            data={(doctors.data ?? []).map((d) => ({ value: String(d.id), label: nameOf(d, lang) }))}
            value={doctor}
            onChange={setDoctor}
            required
            searchable
            data-testid="send-doctor"
          />
          <TextInput label={t('sample.note')} value={note} onChange={(e) => setNote(e.currentTarget.value)} />
          <Group justify="flex-end">
            <Button variant="default" onClick={onClose}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={!doctor} loading={busy} data-testid="send-ok">
              {t('patients.sendToDoctor')}
            </Button>
          </Group>
        </Stack>
      </form>
    </Modal>
  );
}
