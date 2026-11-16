import {
  ActionIcon,
  Alert,
  Badge,
  Button,
  Card,
  Checkbox,
  FileInput,
  Group,
  Image,
  Loader,
  Modal,
  NumberInput,
  Select,
  SimpleGrid,
  Skeleton,
  Slider,
  Stack,
  Text,
  TextInput,
  Tooltip,
} from '@mantine/core';
import { DatePickerInput } from '@mantine/dates';
import { notifications } from '@mantine/notifications';
import { IconColumns2, IconDownload, IconFile, IconFileTypePdf, IconPhoto, IconTrash, IconUpload, IconZoomIn, IconZoomOut, IconZoomReset } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { useAuth } from '../auth/AuthProvider';
import { EmptyState } from '../components/EmptyState';
import type { DentalRecord } from '../dental/types';
import { api, apiBlob, apiDownload, apiUpload } from '../lib/api';
import { errorMessage } from '../lib/errors';
import { formatDate } from '../lib/format';
import type { Patient } from '../patients/types';
import { FILE_KINDS, type FileKind, type PatientFile } from './types';

const isImage = (f: PatientFile) => f.content_type.startsWith('image/');
const sizeText = (b: number) => (b >= 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);

/** Object URL for a protected file; revoked when the component goes away. */
export function useBlobUrl(path: string | null) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  useEffect(() => {
    if (!path) return;
    const ctrl = new AbortController();
    let made: string | null = null;
    setUrl(null);
    setError(null);
    apiBlob(path, ctrl.signal)
      .then((b) => {
        made = URL.createObjectURL(b);
        setUrl(made);
      })
      .catch((e) => {
        if ((e as Error).name !== 'AbortError') setError(e);
      });
    return () => {
      ctrl.abort();
      if (made) URL.revokeObjectURL(made);
    };
  }, [path]);
  return { url, error };
}

/** Patient images and documents (SPEC 8.5): X-rays, photos and scanned papers. */
export function FilesTab({ patient }: { patient: Patient }) {
  const { t } = useTranslation();
  const { lang } = usePrefs();
  const { can } = useAuth();
  const [kind, setKind] = useState<string | null>(null);
  const [tooth, setTooth] = useState<number | string>('');
  const [uploading, setUploading] = useState(false);
  const [open, setOpen] = useState<PatientFile | null>(null);
  const [picked, setPicked] = useState<number[]>([]);
  const [comparing, setComparing] = useState(false);
  const q = useQuery({
    queryKey: ['files', patient.id, kind, tooth],
    queryFn: () => api<PatientFile[]>(`/patients/${patient.id}/files`, { query: { kind, tooth: tooth || undefined } }),
  });
  const files = q.data ?? [];
  const pickedFiles = picked.map((id) => files.find((f) => f.id === id)).filter(Boolean) as PatientFile[];
  const togglePick = (f: PatientFile) => setPicked((p) => (p.includes(f.id) ? p.filter((x) => x !== f.id) : [...p.slice(-1), f.id]));

  return (
    <Stack data-testid="files-tab">
      <Group justify="space-between">
        <Group gap="xs">
          <Select
            placeholder={t('files.allKinds')}
            data={FILE_KINDS.map((k) => ({ value: k, label: t(`files.kinds.${k}`) }))}
            value={kind}
            onChange={setKind}
            clearable
            w={200}
          />
          <NumberInput placeholder={t('files.tooth')} value={tooth} onChange={setTooth} min={11} max={85} hideControls w={110} />
          {picked.length === 2 && (
            <Button variant="light" leftSection={<IconColumns2 size={16} />} onClick={() => setComparing(true)} data-testid="compare">
              {t('files.compare')}
            </Button>
          )}
        </Group>
        {can('file.upload') && (
          <Button leftSection={<IconUpload size={16} />} onClick={() => setUploading(true)} data-testid="upload-files">
            {t('files.upload')}
          </Button>
        )}
      </Group>
      {q.isPending ? (
        <Skeleton height={200} />
      ) : q.isError ? (
        <Alert color="red">{errorMessage(t, q.error, lang)}</Alert>
      ) : files.length === 0 ? (
        <Card>
          <EmptyState icon={IconPhoto} title={t('files.empty')} hint={can('file.upload') ? t('files.emptyHint') : ''} />
        </Card>
      ) : (
        <SimpleGrid cols={{ base: 2, sm: 3, md: 4, lg: 5 }} data-testid="files-grid">
          {files.map((f) => (
            <FileCard key={f.id} file={f} picked={picked.includes(f.id)} onPick={isImage(f) ? () => togglePick(f) : undefined} onOpen={() => setOpen(f)} />
          ))}
        </SimpleGrid>
      )}
      {picked.length === 1 && (
        <Text size="xs" c="dimmed">
          {t('files.pickAnother')}
        </Text>
      )}
      <UploadModal opened={uploading} patient={patient} onClose={() => setUploading(false)} />
      {open && <Viewer file={open} onClose={() => setOpen(null)} />}
      {comparing && pickedFiles.length === 2 && <Compare files={pickedFiles} onClose={() => setComparing(false)} />}
    </Stack>
  );
}

function FileCard({ file, picked, onPick, onOpen }: { file: PatientFile; picked: boolean; onPick?: () => void; onOpen: () => void }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const thumb = useBlobUrl(file.has_thumb ? `/files/${file.id}/thumb` : null);
  const Icon = file.content_type === 'application/pdf' ? IconFileTypePdf : IconFile;
  return (
    <Card padding="xs" withBorder style={{ cursor: 'pointer', outline: picked ? '2px solid var(--mantine-primary-color-filled)' : undefined }} data-testid={`file-${file.id}`}>
      <Card.Section onClick={onOpen} style={{ height: 140, display: 'grid', placeItems: 'center', background: 'var(--app-subtle, #f1f3f5)' }}>
        {file.has_thumb ? thumb.url ? <Image src={thumb.url} h={140} w="100%" fit="cover" alt={file.title || file.original_name} /> : <Loader size="sm" /> : <Icon size={48} stroke={1.2} />}
      </Card.Section>
      <Group justify="space-between" mt={6} wrap="nowrap" gap={4}>
        <Badge size="xs" variant="light">
          {t(`files.kinds.${file.kind}`)}
        </Badge>
        {onPick && <Checkbox size="xs" checked={picked} onChange={onPick} aria-label={t('files.compare')} />}
      </Group>
      <Text size="sm" fw={500} lineClamp={1} mt={4} onClick={onOpen}>
        {file.title || file.original_name}
      </Text>
      <Text size="xs" c="dimmed">
        {formatDate(file.taken_on, lang, digits)}
        {file.tooth_fdi ? ` · ${t('files.toothN', { n: file.tooth_fdi })}` : ''}
      </Text>
    </Card>
  );
}

function UploadModal({ opened, patient, onClose }: { opened: boolean; patient: Patient; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const qc = useQueryClient();
  const [list, setList] = useState<File[]>([]);
  const [kind, setKind] = useState<FileKind>('xray');
  const [title, setTitle] = useState('');
  const [takenOn, setTakenOn] = useState<Date | null>(new Date());
  const [visit, setVisit] = useState<string | null>(null);
  const [tooth, setTooth] = useState<number | string>('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const visits = useQuery({
    queryKey: ['dental', patient.id, 'for-files'],
    queryFn: () => api<DentalRecord>(`/patients/${patient.id}/dental`),
    enabled: opened && can('dental.view'),
    gcTime: 0,
  });
  const reset = () => {
    setList([]);
    setTitle('');
    setVisit(null);
    setTooth('');
    setError(null);
  };
  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      for (const f of list) {
        const form = new FormData();
        form.append('file', f);
        form.append('kind', kind);
        form.append('title', title || f.name.replace(/\.[^.]+$/, ''));
        if (takenOn) form.append('taken_on', dayjs(takenOn).format('YYYY-MM-DD'));
        if (visit) form.append('visit_id', visit);
        if (tooth) form.append('tooth_fdi', String(tooth));
        await apiUpload<PatientFile>(`/patients/${patient.id}/files`, form);
      }
      notifications.show({ color: 'green', message: t('files.uploaded', { n: list.length }) });
      await qc.invalidateQueries({ queryKey: ['files', patient.id] });
      reset();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal opened={opened} onClose={onClose} title={t('files.upload')} size="lg">
      <Stack>
        <FileInput
          label={t('files.choose')}
          multiple
          value={list}
          onChange={(v) => setList(v ?? [])}
          accept="image/*,application/pdf,.dcm"
          clearable
          data-testid="file-input"
        />
        <Text size="xs" c="dimmed">
          {t('files.allowed')}
        </Text>
        <SimpleGrid cols={2}>
          <Select label={t('files.kind')} data={FILE_KINDS.map((k) => ({ value: k, label: t(`files.kinds.${k}`) }))} value={kind} onChange={(v) => v && setKind(v as FileKind)} allowDeselect={false} />
          <DatePickerInput label={t('files.takenOn')} value={takenOn} onChange={setTakenOn} valueFormat="DD/MM/YYYY" />
          <TextInput label={t('files.title')} value={title} onChange={(e) => setTitle(e.currentTarget.value)} placeholder={t('files.titleHint')} maxLength={200} />
          <NumberInput label={t('files.tooth')} value={tooth} onChange={setTooth} min={11} max={85} hideControls />
        </SimpleGrid>
        {can('dental.view') && (
          <Select
            label={t('files.visit')}
            data={(visits.data?.visits ?? []).map((v) => ({ value: String(v.id), label: `${formatDate(v.visit_at, lang, digits)} · ${v.chief_complaint || v.procedure || '—'}`.slice(0, 80) }))}
            value={visit}
            onChange={setVisit}
            clearable
            placeholder={t('files.noVisit')}
          />
        )}
        {error !== null && <Alert color="red">{errorMessage(t, error, lang)}</Alert>}
        <Group justify="flex-end">
          <Button variant="default" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button leftSection={<IconUpload size={16} />} onClick={() => void submit()} loading={busy} disabled={list.length === 0} data-testid="confirm-upload">
            {t('files.uploadN', { n: list.length })}
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}

function ZoomableImage({ src, zoom, alt }: { src: string; zoom: number; alt: string }) {
  return (
    <div style={{ overflow: 'auto', height: '100%', background: '#111', display: 'grid', placeItems: zoom <= 1 ? 'center' : 'start' }}>
      <img src={src} alt={alt} style={{ width: `${zoom * 100}%`, maxWidth: zoom <= 1 ? '100%' : 'none', height: 'auto', display: 'block' }} />
    </div>
  );
}

function ZoomControls({ zoom, setZoom }: { zoom: number; setZoom: (z: number) => void }) {
  const { t } = useTranslation();
  return (
    <Group gap={6} wrap="nowrap">
      <Tooltip label={t('files.zoomOut')}>
        <ActionIcon variant="default" onClick={() => setZoom(Math.max(0.25, zoom - 0.25))} aria-label={t('files.zoomOut')}>
          <IconZoomOut size={16} />
        </ActionIcon>
      </Tooltip>
      <Slider value={zoom} onChange={setZoom} min={0.25} max={4} step={0.25} w={140} label={(v) => `${Math.round(v * 100)}%`} />
      <Tooltip label={t('files.zoomIn')}>
        <ActionIcon variant="default" onClick={() => setZoom(Math.min(4, zoom + 0.25))} aria-label={t('files.zoomIn')}>
          <IconZoomIn size={16} />
        </ActionIcon>
      </Tooltip>
      <Tooltip label={t('files.fit')}>
        <ActionIcon variant="default" onClick={() => setZoom(1)} aria-label={t('files.fit')}>
          <IconZoomReset size={16} />
        </ActionIcon>
      </Tooltip>
    </Group>
  );
}

function Viewer({ file, onClose }: { file: PatientFile; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const { can } = useAuth();
  const qc = useQueryClient();
  const content = useBlobUrl(`/files/${file.id}/content`);
  const [zoom, setZoom] = useState(1);
  const [kind, setKind] = useState<FileKind>(file.kind);
  const [title, setTitle] = useState(file.title);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    try {
      await api(`/files/${file.id}`, { method: 'PATCH', body: { version: file.version, kind, title } });
      await qc.invalidateQueries({ queryKey: ['files', file.patient_id] });
      notifications.show({ color: 'green', message: t('common.saved') });
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(t, e, lang) });
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!window.confirm(t('files.deleteConfirm'))) return;
    try {
      await api(`/files/${file.id}`, { method: 'DELETE' });
      await qc.invalidateQueries({ queryKey: ['files', file.patient_id] });
      onClose();
    } catch (e) {
      notifications.show({ color: 'red', message: errorMessage(t, e, lang) });
    }
  };
  return (
    <Modal opened onClose={onClose} fullScreen title={file.title || file.original_name} data-testid="file-viewer">
      <Stack h="calc(100vh - 90px)" gap="xs">
        <Group justify="space-between">
          <Group gap="xs">
            {isImage(file) && <ZoomControls zoom={zoom} setZoom={setZoom} />}
            <Text size="xs" c="dimmed">
              {formatDate(file.taken_on, lang, digits)} · {sizeText(file.size)}
              {file.width ? ` · ${file.width}×${file.height}` : ''} · {file.uploaded_by_name}
            </Text>
          </Group>
          <Group gap="xs">
            {can('file.upload') && (
              <>
                <Select size="xs" data={FILE_KINDS.map((k) => ({ value: k, label: t(`files.kinds.${k}`) }))} value={kind} onChange={(v) => v && setKind(v as FileKind)} allowDeselect={false} w={170} />
                <TextInput size="xs" value={title} onChange={(e) => setTitle(e.currentTarget.value)} maxLength={200} w={200} aria-label={t('files.title')} />
                <Button size="xs" onClick={() => void save()} loading={busy} disabled={kind === file.kind && title === file.title}>
                  {t('common.save')}
                </Button>
              </>
            )}
            <Button size="xs" variant="default" leftSection={<IconDownload size={14} />} onClick={() => void apiDownload(`/files/${file.id}/content`, { download: true }, file.original_name)}>
              {t('files.download')}
            </Button>
            {can('file.delete') && (
              <ActionIcon color="red" variant="subtle" onClick={() => void remove()} aria-label={t('common.delete')}>
                <IconTrash size={16} />
              </ActionIcon>
            )}
          </Group>
        </Group>
        <div style={{ flex: 1, minHeight: 0 }}>
          {content.error !== null ? (
            <Alert color="red">{errorMessage(t, content.error, lang)}</Alert>
          ) : !content.url ? (
            <Loader />
          ) : isImage(file) ? (
            <ZoomableImage src={content.url} zoom={zoom} alt={file.title} />
          ) : file.content_type === 'application/pdf' ? (
            <iframe src={content.url} title={file.title} style={{ width: '100%', height: '100%', border: 0 }} />
          ) : (
            <EmptyState icon={IconFile} title={t('files.noPreview')} hint={t('files.noPreviewHint')} />
          )}
        </div>
      </Stack>
    </Modal>
  );
}

/** Two images side by side with one zoom (SPEC 8.5), e.g. before and after. */
function Compare({ files, onClose }: { files: PatientFile[]; onClose: () => void }) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const [zoom, setZoom] = useState(1);
  const a = useBlobUrl(`/files/${files[0].id}/content`);
  const b = useBlobUrl(`/files/${files[1].id}/content`);
  return (
    <Modal opened onClose={onClose} fullScreen title={t('files.compare')} data-testid="file-compare">
      <Stack h="calc(100vh - 90px)" gap="xs">
        <ZoomControls zoom={zoom} setZoom={setZoom} />
        <SimpleGrid cols={2} style={{ flex: 1, minHeight: 0 }}>
          {[a, b].map((x, i) => (
            <Stack key={files[i].id} gap={4} style={{ minHeight: 0, height: '100%' }}>
              <Text size="sm" fw={500}>
                {files[i].title || files[i].original_name} · {formatDate(files[i].taken_on, lang, digits)}
              </Text>
              <div style={{ flex: 1, minHeight: 0 }}>{x.url ? <ZoomableImage src={x.url} zoom={zoom} alt={files[i].title} /> : <Loader />}</div>
            </Stack>
          ))}
        </SimpleGrid>
      </Stack>
    </Modal>
  );
}
