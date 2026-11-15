import { Group, SegmentedControl, Stack, Text, Tooltip } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { usePrefs } from '../app/preferences';
import { formatDate } from '../lib/format';
import type { DentalVisit, Finding } from './types';

export type Dentition = 'permanent' | 'primary' | 'mixed';

/** Marker colors per category (theme color names). */
export const CATEGORY_COLORS: Record<string, string> = {
  restoration: 'blue',
  extraction: 'red',
  endodontic: 'orange',
  prosthetic: 'grape',
  orthodontic: 'teal',
  other: 'gray',
};

// FDI rows in the conventional view: the patient's right on the viewer's left.
const PERM_UPPER = [18, 17, 16, 15, 14, 13, 12, 11, 21, 22, 23, 24, 25, 26, 27, 28];
const PERM_LOWER = [48, 47, 46, 45, 44, 43, 42, 41, 31, 32, 33, 34, 35, 36, 37, 38];
const PRIM_UPPER = [55, 54, 53, 52, 51, 61, 62, 63, 64, 65];
const PRIM_LOWER = [85, 84, 83, 82, 81, 71, 72, 73, 74, 75];

const kind = (t: number) => {
  const n = t % 10;
  const primary = t >= 50;
  if (n <= 2) return 'incisor';
  if (n === 3) return 'canine';
  if (!primary && n <= 5) return 'premolar';
  return 'molar';
};
const WIDTH: Record<string, number> = { incisor: 30, canine: 32, premolar: 34, molar: 42 };
const GAP = 4;

interface Props {
  selected: number[];
  onToggle?: (tooth: number) => void;
  findings: Finding[];
  visits: DentalVisit[];
  dentition: Dentition;
  onDentition?: (d: Dentition) => void;
  printable?: boolean;
}

/**
 * Tooth chart (SPEC 8.2): SVG outlines, FDI numbering, click to select teeth for the current visit,
 * colored markers for teeth with history, hover for that tooth's history.
 */
export function ToothChart({ selected, onToggle, findings, visits, dentition, onDentition, printable }: Props) {
  const { t } = useTranslation();
  const rows: { teeth: number[]; upper: boolean }[] =
    dentition === 'permanent'
      ? [
          { teeth: PERM_UPPER, upper: true },
          { teeth: PERM_LOWER, upper: false },
        ]
      : dentition === 'primary'
        ? [
            { teeth: PRIM_UPPER, upper: true },
            { teeth: PRIM_LOWER, upper: false },
          ]
        : [
            { teeth: PERM_UPPER, upper: true },
            { teeth: PRIM_UPPER, upper: true },
            { teeth: PRIM_LOWER, upper: false },
            { teeth: PERM_LOWER, upper: false },
          ];
  const rowWidth = (teeth: number[]) => teeth.reduce((s, x) => s + WIDTH[kind(x)] + GAP, -GAP);
  const maxW = Math.max(...rows.map((r) => rowWidth(r.teeth)));
  const ROW_H = 92;

  return (
    <Stack gap="xs" align="center">
      {onDentition && !printable && (
        <SegmentedControl
          size="xs"
          value={dentition}
          onChange={(v) => onDentition(v as Dentition)}
          data={[
            { value: 'permanent', label: t('dental.permanent') },
            { value: 'primary', label: t('dental.primary') },
            { value: 'mixed', label: t('dental.mixed') },
          ]}
          data-testid="dentition"
        />
      )}
      {/* Charts are read the same way in every language: never mirrored. */}
      <div dir="ltr" style={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <svg
        viewBox={`-10 -6 ${maxW + 20} ${rows.length * ROW_H + 12}`}
        style={{ width: '100%', maxWidth: printable ? 680 : 760, userSelect: 'none' }}
        role="group"
        aria-label={t('dental.chart')}
        data-testid="tooth-chart"
      >
        {rows.map((row, ri) => {
          const offset = (maxW - rowWidth(row.teeth)) / 2;
          let x = offset;
          const y0 = ri * ROW_H;
          const midline = row.teeth.findIndex((n) => Math.floor(n / 10) === 2 || Math.floor(n / 10) === 6 || Math.floor(n / 10) === 3 || Math.floor(n / 10) === 7);
          return (
            <g key={ri}>
              {row.teeth.map((tooth, i) => {
                const w = WIDTH[kind(tooth)];
                const tx = x;
                x += w + GAP;
                return (
                  <Tooth
                    key={tooth}
                    tooth={tooth}
                    x={tx}
                    y={y0}
                    w={w}
                    upper={row.upper}
                    selected={selected.includes(tooth)}
                    findings={findings.filter((f) => f.tooth_fdi === tooth)}
                    visits={visits.filter((v) => v.teeth.includes(tooth))}
                    onClick={onToggle && !printable ? () => onToggle(tooth) : undefined}
                    midlineBefore={i === midline}
                  />
                );
              })}
            </g>
          );
        })}
      </svg>
      </div>
      {!printable && (
        <Group gap="md" justify="center">
          {Object.entries(CATEGORY_COLORS).map(([c, color]) => (
            <Group gap={4} key={c}>
              <svg width="10" height="10">
                <circle cx="5" cy="5" r="4" fill={`var(--mantine-color-${color}-6)`} />
              </svg>
              <Text size="xs" c="dimmed">
                {t(`dental.categories.${c}`)}
              </Text>
            </Group>
          ))}
        </Group>
      )}
    </Stack>
  );
}

function Tooth({
  tooth,
  x,
  y,
  w,
  upper,
  selected,
  findings,
  visits,
  onClick,
  midlineBefore,
}: {
  tooth: number;
  x: number;
  y: number;
  w: number;
  upper: boolean;
  selected: boolean;
  findings: Finding[];
  visits: DentalVisit[];
  onClick?: () => void;
  midlineBefore: boolean;
}) {
  const { t } = useTranslation();
  const { lang, digits } = usePrefs();
  const k = kind(tooth);
  const crownH = k === 'molar' ? 30 : k === 'premolar' ? 30 : 34;
  const rootH = 22;
  const roots = k === 'molar' ? (upper ? 3 : 2) : 1;
  // Upper teeth: roots above the crown; lower teeth: roots below.
  const crownY = upper ? y + rootH + 8 : y + 18;
  const rootY = upper ? y + 8 : crownY + crownH;
  const extracted = findings.some((f) => f.category === 'extraction');
  const cats = [...new Set(findings.map((f) => f.category))];
  const hasHistory = findings.length > 0 || visits.length > 0;
  const fill = selected ? 'var(--mantine-color-accent-2)' : 'var(--app-surface)';
  const stroke = selected ? 'var(--mantine-color-accent-7)' : 'var(--mantine-color-gray-5)';

  const shape = (
    <g
      onClick={onClick}
      style={{ cursor: onClick ? 'pointer' : 'default' }}
      data-testid={`tooth-${tooth}`}
      data-selected={selected || undefined}
      role={onClick ? 'button' : undefined}
      aria-pressed={onClick ? selected : undefined}
      aria-label={`${t('dental.tooth')} ${tooth}`}
      opacity={extracted ? 0.35 : 1}
    >
      {midlineBefore && <line x1={x - GAP / 2} x2={x - GAP / 2} y1={y + 4} y2={y + 84} stroke="var(--mantine-color-gray-4)" strokeDasharray="3 3" />}
      {Array.from({ length: roots }, (_, i) => {
        const rw = (w - 8) / roots;
        return (
          <path
            key={i}
            d={
              upper
                ? `M ${x + 4 + i * rw + 2} ${rootY + rootH} L ${x + 4 + i * rw + rw / 2} ${rootY} L ${x + 4 + (i + 1) * rw - 2} ${rootY + rootH} Z`
                : `M ${x + 4 + i * rw + 2} ${rootY} L ${x + 4 + i * rw + rw / 2} ${rootY + rootH} L ${x + 4 + (i + 1) * rw - 2} ${rootY} Z`
            }
            fill={fill}
            stroke={stroke}
            strokeWidth={1}
            strokeLinejoin="round"
          />
        );
      })}
      <rect x={x} y={crownY} width={w} height={crownH} rx={k === 'molar' ? 9 : 11} fill={fill} stroke={stroke} strokeWidth={selected ? 2 : 1.2} />
      {k === 'molar' && <path d={`M ${x + w / 2} ${crownY + 6} L ${x + w / 2} ${crownY + crownH - 6}`} stroke="var(--mantine-color-gray-3)" />}
      {extracted && (
        <path d={`M ${x + 3} ${crownY + 3} L ${x + w - 3} ${crownY + crownH - 3} M ${x + w - 3} ${crownY + 3} L ${x + 3} ${crownY + crownH - 3}`} stroke="var(--mantine-color-red-6)" strokeWidth={2} />
      )}
      <text x={x + w / 2} y={upper ? crownY + crownH + 13 : crownY - 5} textAnchor="middle" fontSize={11} fill={selected ? 'var(--mantine-color-accent-8)' : 'var(--app-muted)'} fontWeight={selected ? 700 : 400}>
        {tooth}
      </text>
      {cats.map((c, i) => (
        <circle key={c} cx={x + 7 + i * 8} cy={upper ? crownY + 7 : crownY + crownH - 7} r={3.2} fill={`var(--mantine-color-${CATEGORY_COLORS[c] ?? 'gray'}-6)`} data-testid={`marker-${tooth}-${c}`} />
      ))}
      {visits.length > 0 && cats.length === 0 && <circle cx={x + w - 7} cy={upper ? crownY + 7 : crownY + crownH - 7} r={2.5} fill="var(--mantine-color-gray-5)" />}
    </g>
  );

  if (!hasHistory) return shape;
  return (
    <Tooltip
      withinPortal
      multiline
      w={260}
      label={
        <Stack gap={2}>
          <Text size="xs" fw={700}>
            {t('dental.tooth')} {tooth}
          </Text>
          {findings.map((f) => (
            <Text size="xs" key={`f${f.id}`}>
              {formatDate(f.created_at, lang, digits)} · {t(`dental.categories.${f.category}`)}
              {f.description ? `: ${f.description}` : ''}
            </Text>
          ))}
          {visits.slice(0, 5).map((v) => (
            <Text size="xs" key={`v${v.id}`}>
              {formatDate(v.visit_at, lang, digits)} · {v.procedure || v.diagnosis || v.chief_complaint || '—'}
            </Text>
          ))}
        </Stack>
      }
    >
      {shape}
    </Tooltip>
  );
}
