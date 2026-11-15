import { Badge, Group, Text } from '@mantine/core';
import { useDebouncedValue } from '@mantine/hooks';
import { Spotlight, type SpotlightActionData, type SpotlightActionGroupData, type SpotlightFilterFunction } from '@mantine/spotlight';
import { useState } from 'react';
import { IconLanguage, IconLock, IconMoon, IconSearch, IconUser, IconUserPlus } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { useAuth } from '../auth/AuthProvider';
import { SearchHighlight } from '../components/SearchHighlight';
import { normalize } from '../lib/normalize';
import { useQuickSearch } from '../patients/queries';
import { DESIGN_ITEM, visibleNav } from './nav';
import { usePrefs, useToggleTheme } from './preferences';

/**
 * Ctrl+K command palette (SPEC 4.1.2). M0 has navigation and preference actions;
 * patient, appointment and invoice search is added as each module lands.
 */
export function CommandPalette() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { lang, setLang } = usePrefs();
  const { toggle } = useToggleTheme();
  const { can, canAny, lock } = useAuth();
  const [query, setQuery] = useState('');
  const [debounced] = useDebouncedValue(query, 150);
  const patients = useQuickSearch(debounced, can('patient.view'));

  const patientGroup: SpotlightActionGroupData[] =
    debounced.trim() && patients.data?.length
      ? [
          {
            group: t('palette.patients'),
            actions: patients.data.map((p) => ({
              id: `patient-${p.id}`,
              label: p.name_ar,
              children: (
                <Group gap="sm" wrap="nowrap" w="100%">
                  <IconUser size={20} stroke={1.6} />
                  <div style={{ flex: 1 }}>
                    <Text size="sm" fw={500}>
                      <SearchHighlight text={p.name_ar} query={debounced} />
                    </Text>
                    <Text size="xs" c="dimmed">
                      {p.name_en && <SearchHighlight text={p.name_en} query={debounced} />}
                      {p.mobile && (
                        <span dir="ltr">
                          {' · '}
                          <SearchHighlight text={p.mobile} query={debounced} />
                        </span>
                      )}
                    </Text>
                  </div>
                  <Badge variant="light" color="neutral">
                    <SearchHighlight text={String(p.file_no)} query={debounced} />
                  </Badge>
                </Group>
              ),
              onClick: () => navigate(`/patients/${p.id}`),
            })),
          },
        ]
      : [];

  const actions: SpotlightActionGroupData[] = [
    ...patientGroup,
    {
      group: t('palette.navigation'),
      actions: [...visibleNav(canAny), DESIGN_ITEM].map((item) => {
        const Icon = item.icon;
        return {
          id: `nav-${item.key}`,
          label: t(`nav.${item.key}`),
          description: t('palette.goTo', { page: t(`nav.${item.key}`) }),
          leftSection: <Icon size={20} stroke={1.6} />,
          onClick: () => navigate(item.path),
        };
      }),
    },
    {
      group: t('palette.actions'),
      actions: [
        ...(can('patient.create')
          ? [{ id: 'new-patient', label: t('patients.new'), leftSection: <IconUserPlus size={20} stroke={1.6} />, onClick: () => navigate('/patients?new=1') }]
          : []),
        { id: 'lock', label: t('topbar.lock'), leftSection: <IconLock size={20} stroke={1.6} />, onClick: () => void lock() },
        { id: 'toggle-theme', label: t('palette.toggleTheme'), leftSection: <IconMoon size={20} stroke={1.6} />, onClick: toggle },
        {
          id: 'switch-language',
          label: t('palette.switchLanguage'),
          leftSection: <IconLanguage size={20} stroke={1.6} />,
          onClick: () => setLang(lang === 'ar' ? 'en' : 'ar'),
        },
      ],
    },
  ];

  return (
    <Spotlight
      actions={actions}
      query={query}
      onQueryChange={setQuery}
      filter={paletteFilter}
      shortcut={['mod + K']}
      nothingFound={t('palette.nothingFound')}
      highlightQuery
      limit={12}
      searchProps={{ leftSection: <IconSearch size={18} />, placeholder: t('palette.placeholder') }}
      radius="md"
    />
  );
}

/** Patients come already searched by the server; other actions match on their (normalized) label. */
const paletteFilter: SpotlightFilterFunction = (query, actions) => {
  const q = normalize(query.trim());
  const keep = (a: SpotlightActionData) => a.id.startsWith('patient-') || !q || normalize(`${a.label ?? ''} ${a.description ?? ''}`).includes(q);
  return actions
    .map((item) => ('actions' in item ? { ...item, actions: item.actions.filter(keep) } : item))
    .filter((item) => ('actions' in item ? item.actions.length > 0 : keep(item)));
};
