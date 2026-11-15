import { Badge, Box, Group, HoverCard, Stack, Text, Tooltip } from '@mantine/core';
import { IconCoin, IconHourglass, IconShieldCheck, IconUserPlus } from '@tabler/icons-react';
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { formatDateTime, formatTime } from '../lib/format';
import { nameOf } from '../master/queries';
import type { AppointmentStatus, Doctor, Service, VisitType } from '../master/types';
import classes from './CalendarGrid.module.css';
import { hhmm, localDate, minutesOf, todayStr, weekdayOf } from './time';
import type { Appointment } from './types';

export const PX_PER_MIN = 1.6;
const SNAP = 5;

export interface Column {
  key: string;
  date: string;
  doctor: Doctor;
  label: ReactNode;
}

export interface MoveTarget {
  doctor_id: number;
  date: string;
  start: number;
  end: number;
}

interface Props {
  columns: Column[];
  appointments: Appointment[];
  statuses: Map<number, AppointmentStatus>;
  visitTypes: Map<number, VisitType>;
  services: Map<number, Service>;
  startMin: number;
  endMin: number;
  nowMin: number;
  onSlotClick: (col: Column, minutes: number) => void;
  onCardClick: (a: Appointment) => void;
  onMove: (a: Appointment, target: MoveTarget) => void;
  cardMenu: (a: Appointment) => ReactNode;
  canEdit: boolean;
}

interface Drag {
  appt: Appointment;
  mode: 'move' | 'resize';
  x0: number;
  y0: number;
  colKey: string;
  delta: number;
  moved: boolean;
}

/**
 * Time grid: one column per doctor (day view) or per day (week view), time running down (SPEC 6.1).
 * Non-working time and breaks are shaded. Cards can be dragged to another time or column and their
 * bottom edge dragged to resize; the page asks for confirmation before saving.
 */
export function CalendarGrid(p: Props) {
  const { t } = useTranslation();
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  dragRef.current = drag;
  // The browser fires a click on the column after a drag ends: ignore it.
  const dragEndedAt = useRef(0);
  const height = (p.endMin - p.startMin) * PX_PER_MIN;
  const y = (m: number) => (m - p.startMin) * PX_PER_MIN;

  const colOf = (a: Appointment) => p.columns.find((c) => c.doctor.id === a.doctor_id && c.date === localDate(a.starts_at));

  useEffect(() => {
    if (!drag) return;
    const move = (e: PointerEvent) => {
      const d = dragRef.current!;
      const dy = e.clientY - d.y0;
      const moved = d.moved || Math.abs(dy) > 4 || Math.abs(e.clientX - d.x0) > 4;
      const delta = Math.round(dy / PX_PER_MIN / SNAP) * SNAP;
      let colKey = d.colKey;
      if (d.mode === 'move') {
        const el = document.elementsFromPoint(e.clientX, e.clientY).find((n) => (n as HTMLElement).dataset?.colKey) as HTMLElement | undefined;
        if (el?.dataset.colKey) colKey = el.dataset.colKey;
      }
      setDrag({ ...d, delta, colKey, moved });
    };
    const up = () => {
      const d = dragRef.current!;
      setDrag(null);
      dragEndedAt.current = Date.now();
      if (!d.moved) {
        p.onCardClick(d.appt);
        return;
      }
      const s0 = minutesOf(d.appt.starts_at);
      const e0 = minutesOf(d.appt.ends_at);
      const col = p.columns.find((c) => c.key === d.colKey)!;
      const target =
        d.mode === 'move'
          ? { doctor_id: col.doctor.id, date: col.date, start: s0 + d.delta, end: e0 + d.delta }
          : { doctor_id: d.appt.doctor_id, date: localDate(d.appt.starts_at), start: s0, end: Math.max(s0 + SNAP, e0 + d.delta) };
      if (target.start < 0 || target.end > 24 * 60) return;
      const original = colOf(d.appt);
      if (target.start === s0 && target.end === e0 && original?.key === col.key) return;
      p.onMove(d.appt, target);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up, { once: true });
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null]);

  const byColumn = useMemo(() => {
    const m = new Map<string, Appointment[]>();
    for (const a of p.appointments) {
      const c = colOf(a);
      if (!c) continue;
      m.set(c.key, [...(m.get(c.key) ?? []), a]);
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.appointments, p.columns]);

  const hours: number[] = [];
  for (let m = Math.ceil(p.startMin / 60) * 60; m < p.endMin; m += 60) if (m > p.startMin) hours.push(m);

  return (
    <div className={classes.wrap} data-testid="calendar-grid">
      <div className={classes.header}>
        <div className={classes.gutter} />
        {p.columns.map((c) => (
          <div key={c.key} className={classes.colHeader}>
            {c.label}
          </div>
        ))}
      </div>
      <div className={classes.body} style={{ height }}>
        <div className={classes.gutter}>
          {hours.map((m) => (
            <div key={m} className={classes.hourLabel} style={{ top: y(m) }}>
              <TimeLabel minutes={m} />
            </div>
          ))}
        </div>
        {p.columns.map((c) => {
          const day = weekdayOf(c.date);
          const sched = c.doctor.schedules.filter((s) => s.weekday === day);
          const items = byColumn.get(c.key) ?? [];
          const lanes = layoutLanes(items);
          const isToday = c.date === todayStr();
          return (
            <div
              key={c.key}
              className={classes.col}
              data-col-key={c.key}
              data-testid={`col-${c.doctor.id}-${c.date}`}
              onClick={(e) => {
                if ((e.target as HTMLElement).closest('[data-card]') || Date.now() - dragEndedAt.current < 400) return;
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                const mins = p.startMin + (e.clientY - rect.top) / PX_PER_MIN;
                const slot = c.doctor.slot_minutes || 15;
                p.onSlotClick(c, Math.floor(mins / slot) * slot);
              }}
            >
              {sched
                .filter((s) => s.kind === 'work')
                .map((s, i) => {
                  const a = toMin(s.start_time);
                  const b = toMin(s.end_time);
                  return <div key={i} className={classes.work} style={{ top: y(a), height: (b - a) * PX_PER_MIN }} />;
                })}
              {sched
                .filter((s) => s.kind === 'break')
                .map((s, i) => {
                  const a = toMin(s.start_time);
                  const b = toMin(s.end_time);
                  return (
                    <div key={`b${i}`} className={classes.break} style={{ top: y(a), height: (b - a) * PX_PER_MIN }}>
                      <Text size="xs" c="dimmed">
                        {t('doctors.break')}
                      </Text>
                    </div>
                  );
                })}
              {hours.map((m) => (
                <div key={m} className={classes.hourLine} style={{ top: y(m) }} />
              ))}
              {isToday && p.nowMin >= p.startMin && p.nowMin <= p.endMin && <div className={classes.now} style={{ top: y(p.nowMin) }} />}
              {items.map((a) => {
                const dragging = drag?.appt.id === a.id && drag.moved;
                const s0 = minutesOf(a.starts_at);
                const e0 = minutesOf(a.ends_at);
                const lane = lanes.get(a.id)!;
                return (
                  <Card
                    key={a.id}
                    a={a}
                    {...p}
                    top={y(s0)}
                    h={(e0 - s0) * PX_PER_MIN}
                    lane={lane}
                    faded={dragging}
                    onPointerDown={(e, mode) => {
                      if (!p.canEdit || e.button !== 0) return;
                      e.stopPropagation();
                      setDrag({ appt: a, mode, x0: e.clientX, y0: e.clientY, colKey: c.key, delta: 0, moved: false });
                    }}
                  />
                );
              })}
              {drag?.moved && drag.colKey === c.key && <Ghost drag={drag} y={y} />}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Ghost({ drag, y }: { drag: Drag; y: (m: number) => number }) {
  const s0 = minutesOf(drag.appt.starts_at);
  const e0 = minutesOf(drag.appt.ends_at);
  const s = drag.mode === 'move' ? s0 + drag.delta : s0;
  const e = drag.mode === 'move' ? e0 + drag.delta : Math.max(s0 + SNAP, e0 + drag.delta);
  return (
    <div className={classes.ghost} style={{ top: y(s), height: (e - s) * PX_PER_MIN }} data-testid="drag-ghost">
      <Text size="xs" fw={600}>
        {hhmm(s)} – {hhmm(e)}
      </Text>
    </div>
  );
}

function Card({
  a,
  statuses,
  visitTypes,
  services,
  top,
  h,
  lane,
  faded,
  onPointerDown,
  cardMenu,
}: Props & {
  a: Appointment;
  top: number;
  h: number;
  lane: { index: number; count: number };
  faded: boolean;
  onPointerDown: (e: React.PointerEvent, mode: 'move' | 'resize') => void;
}) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const st = statuses.get(a.status_id);
  const vt = a.visit_type_id ? visitTypes.get(a.visit_type_id) : undefined;
  const svc = a.service_id ? services.get(a.service_id) : undefined;
  const color = st?.color ?? 'neutral';
  const width = 100 / lane.count;
  const compact = h < 40;

  return (
    <HoverCard openDelay={450} closeDelay={100} position="left" withinPortal shadow="md" width={290} disabled={faded}>
      <HoverCard.Target>
        <div
          data-card
          data-testid={`appt-${a.id}`}
          className={classes.card}
          style={{
            top,
            height: Math.max(h - 2, 14),
            insetInlineStart: `calc(${lane.index * width}% + 2px)`,
            width: `calc(${width}% - 4px)`,
            background: `var(--mantine-color-${color}-light)`,
            borderInlineStartColor: `var(--mantine-color-${color}-filled)`,
            opacity: faded ? 0.35 : a.blocks_slot ? 1 : 0.7,
            textDecoration: st?.key === 'cancelled' ? 'line-through' : undefined,
          }}
          onPointerDown={(e) => onPointerDown(e, 'move')}
        >
          <Group gap={4} wrap="nowrap" justify="space-between" align="flex-start">
            <Text size="xs" fw={600} lineClamp={1} style={{ flex: 1 }}>
              {a.patient ? nameOf(a.patient, lang) : '—'}
              {!compact && a.patient && (
                <Text span size="xs" c="dimmed" fw={400}>
                  {' '}
                  · {a.patient.file_no}
                </Text>
              )}
            </Text>
            <Group gap={2} wrap="nowrap" onPointerDown={(e) => e.stopPropagation()}>
              {a.patient?.is_new && (
                <Tooltip label={t('visitBadges.new')}>
                  <IconUserPlus size={12} color="var(--mantine-color-blue-6)" />
                </Tooltip>
              )}
              {a.patient?.is_insured && (
                <Tooltip label={t('visitBadges.insured')}>
                  <IconShieldCheck size={12} color="var(--mantine-color-teal-6)" />
                </Tooltip>
              )}
              {a.patient?.has_balance && (
                <Tooltip label={t('visitBadges.balance')}>
                  <IconCoin size={12} color="var(--mantine-color-red-6)" />
                </Tooltip>
              )}
              {a.is_waiting_list && (
                <Tooltip label={t('appointments.waitingFlag')}>
                  <IconHourglass size={12} color="var(--mantine-color-orange-6)" />
                </Tooltip>
              )}
              {cardMenu(a)}
            </Group>
          </Group>
          {!compact && (
            <Group gap={4} wrap="nowrap" mt={2}>
              <Text size="xs" c="dimmed">
                {formatTime(a.starts_at, lang, digits)}
              </Text>
              {vt && (
                <Badge size="xs" variant="light" color={vt.color}>
                  {nameOf(vt, lang)}
                </Badge>
              )}
              {st && (
                <Badge size="xs" variant="filled" color={st.color}>
                  {nameOf(st, lang)}
                </Badge>
              )}
            </Group>
          )}
          <div className={classes.resize} onPointerDown={(e) => onPointerDown(e, 'resize')} data-testid={`resize-${a.id}`} />
        </div>
      </HoverCard.Target>
      <HoverCard.Dropdown>
        <Stack gap={4} data-testid="appt-popover">
          <Text fw={600}>{a.patient ? nameOf(a.patient, lang) : '—'}</Text>
          <Detail label={t('patients.fileNo')} value={a.patient?.file_no} />
          <Detail label={t('patients.fields.mobile')} value={a.patient?.mobile && <span dir="ltr">{a.patient.mobile}</span>} />
          <Detail label={t('sample.time')} value={`${formatTime(a.starts_at, lang, digits)} – ${formatTime(a.ends_at, lang, digits)}`} />
          <Detail label={t('sample.visitType')} value={vt && nameOf(vt, lang)} />
          <Detail label={t('appointments.service')} value={svc && nameOf(svc, lang)} />
          <Detail label={t('sample.status')} value={st && nameOf(st, lang)} />
          <Detail label={t('sample.note')} value={a.note} />
          {a.cancel_reason && <Detail label={t('appointments.cancelReason')} value={a.cancel_reason} />}
          <Detail label={t('appointments.created')} value={`${a.created_by_name ?? '—'} · ${formatDateTime(a.created_at, lang, digits)}`} />
          {a.confirmed_at && <Detail label={t('appointments.confirmed')} value={`${a.confirmed_by_name ?? '—'} · ${formatDateTime(a.confirmed_at, lang, digits)}`} />}
          <Detail label={t('appointments.sms')} value={a.exclude_sms ? t('appointments.smsExcluded') : t('patients.smsSoon')} />
          <Detail label={t('appointments.count')} value={a.patient?.appointment_count} />
        </Stack>
      </HoverCard.Dropdown>
    </HoverCard>
  );
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  if (value === undefined || value === null || value === '') return null;
  return (
    <Group gap="xs" wrap="nowrap" align="flex-start">
      <Text size="xs" c="dimmed" w={90} style={{ flexShrink: 0 }}>
        {label}
      </Text>
      <Text size="xs">{value}</Text>
    </Group>
  );
}

function TimeLabel({ minutes }: { minutes: number }) {
  const { lang, digits } = usePrefs();
  const d = new Date(Date.UTC(2000, 0, 1, Math.floor(minutes / 60) - 3, minutes % 60));
  return <Box component="span">{formatTime(d, lang, digits)}</Box>;
}

const toMin = (hms: string) => {
  const [h, m] = hms.split(':').map(Number);
  return h * 60 + m;
};

/** Side-by-side lanes for overlapping cards in one column. */
export function layoutLanes(items: Appointment[]): Map<number, { index: number; count: number }> {
  const sorted = [...items].sort((a, b) => a.starts_at.localeCompare(b.starts_at) || b.ends_at.localeCompare(a.ends_at));
  const out = new Map<number, { index: number; count: number }>();
  let cluster: Appointment[] = [];
  let clusterEnd = '';
  let laneEnds: string[] = [];
  const flush = () => {
    const count = laneEnds.length;
    for (const a of cluster) out.set(a.id, { index: out.get(a.id)!.index, count });
    cluster = [];
    laneEnds = [];
  };
  for (const a of sorted) {
    if (cluster.length && a.starts_at >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= a.starts_at);
    if (lane < 0) {
      lane = laneEnds.length;
      laneEnds.push(a.ends_at);
    } else laneEnds[lane] = a.ends_at;
    out.set(a.id, { index: lane, count: 1 });
    cluster.push(a);
    clusterEnd = clusterEnd > a.ends_at ? clusterEnd : a.ends_at;
  }
  flush();
  return out;
}
