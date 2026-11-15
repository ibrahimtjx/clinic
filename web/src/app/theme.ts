import {
  createTheme,
  type CSSVariablesResolver,
  type MantineColorsTuple,
  type MantineThemeOverride,
} from '@mantine/core';

/**
 * Design tokens (SPEC 4.2). This file is the only place colors are defined.
 * Components reference theme colors by name or the CSS variables below.
 */

// The single accent color: a calm clinical teal.
const accent: MantineColorsTuple = [
  '#e6f7f5',
  '#d2ede9',
  '#a6dad2',
  '#76c6ba',
  '#4fb5a6',
  '#36aa9a',
  '#25a493',
  '#14907f',
  '#008071',
  '#006f61',
];

// Cool neutral for backgrounds, borders and secondary text.
const neutral: MantineColorsTuple = [
  '#f6f7f9',
  '#eceef2',
  '#d7dbe2',
  '#bcc2cd',
  '#9aa2b1',
  '#7c8597',
  '#5f6879',
  '#454d5c',
  '#2b313c',
  '#171b22',
];

/** Semantic status tokens. Appointment status colors become configurable in M2; these are defaults. */
export const statusColors = {
  unconfirmed: 'neutral',
  confirmed: 'blue',
  arrived: 'cyan',
  withDoctor: 'violet',
  completed: 'green',
  noShow: 'orange',
  cancelled: 'red',
  postponed: 'yellow',
} as const;
export type StatusKey = keyof typeof statusColors;

/** Queue wait-time tokens (SPEC 7.1). */
export const waitColors = { ok: 'green', warn: 'yellow', late: 'red' } as const;

const FONT_AR = "'IBM Plex Sans Arabic', 'IBM Plex Sans', system-ui, sans-serif";
const FONT_EN = "'IBM Plex Sans', 'IBM Plex Sans Arabic', system-ui, sans-serif";

export function buildTheme(lang: 'ar' | 'en'): MantineThemeOverride {
  const fontFamily = lang === 'ar' ? FONT_AR : FONT_EN;
  return createTheme({
    colors: { accent, neutral },
    primaryColor: 'accent',
    primaryShade: { light: 7, dark: 5 },
    fontFamily,
    headings: {
      fontFamily,
      fontWeight: '600',
      sizes: {
        h1: { fontSize: '1.75rem', lineHeight: '1.3' },
        h2: { fontSize: '1.375rem', lineHeight: '1.35' },
        h3: { fontSize: '1.125rem', lineHeight: '1.4' },
        h4: { fontSize: '1rem', lineHeight: '1.45' },
      },
    },
    fontSizes: { xs: '0.75rem', sm: '0.8125rem', md: '0.875rem', lg: '1rem', xl: '1.125rem' },
    spacing: { xs: '0.5rem', sm: '0.75rem', md: '1rem', lg: '1.5rem', xl: '2rem' },
    radius: { xs: '4px', sm: '6px', md: '8px', lg: '12px', xl: '16px' },
    defaultRadius: 'md',
    shadows: {
      xs: '0 1px 2px rgb(23 27 34 / 0.05)',
      sm: '0 1px 3px rgb(23 27 34 / 0.06), 0 1px 2px rgb(23 27 34 / 0.04)',
      md: '0 4px 12px rgb(23 27 34 / 0.07)',
      lg: '0 10px 28px rgb(23 27 34 / 0.09)',
      xl: '0 18px 48px rgb(23 27 34 / 0.12)',
    },
    cursorType: 'pointer',
    components: {
      Card: { defaultProps: { shadow: 'sm', radius: 'md', withBorder: true, padding: 'lg' } },
      Paper: { defaultProps: { radius: 'md' } },
      Button: { defaultProps: { radius: 'md' } },
      Badge: { defaultProps: { variant: 'light', radius: 'sm', tt: 'none' } },
      Modal: { defaultProps: { centered: true, radius: 'md' } },
      Table: { defaultProps: { verticalSpacing: 'sm', highlightOnHover: true } },
      Tooltip: { defaultProps: { withArrow: true, openDelay: 300 } },
    },
  });
}

/** App-level surface tokens, exposed as CSS variables (--app-*). */
export const cssVariablesResolver: CSSVariablesResolver = (theme) => ({
  variables: {
    '--app-header-height': '60px',
    '--app-sidebar-width': '240px',
  },
  light: {
    '--app-bg': theme.colors.neutral[0],
    '--app-surface': theme.white,
    '--app-border': theme.colors.neutral[1],
    '--app-muted': theme.colors.neutral[6],
    '--app-nav-active-bg': theme.colors.accent[0],
    '--app-nav-active-fg': theme.colors.accent[8],
  },
  dark: {
    '--app-bg': theme.colors.dark[8],
    '--app-surface': theme.colors.dark[7],
    '--app-border': theme.colors.dark[5],
    '--app-muted': theme.colors.dark[2],
    '--app-nav-active-bg': 'rgb(37 164 147 / 0.15)',
    '--app-nav-active-fg': theme.colors.accent[3],
  },
});
