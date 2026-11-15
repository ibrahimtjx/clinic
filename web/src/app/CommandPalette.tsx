import { Spotlight, type SpotlightActionGroupData } from '@mantine/spotlight';
import { IconLanguage, IconMoon, IconSearch } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';

import { DESIGN_ITEM, NAV_ITEMS } from './nav';
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

  const actions: SpotlightActionGroupData[] = [
    {
      group: t('palette.navigation'),
      actions: [...NAV_ITEMS, DESIGN_ITEM].map((item) => {
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
      shortcut={['mod + K']}
      nothingFound={t('palette.nothingFound')}
      highlightQuery
      limit={12}
      searchProps={{ leftSection: <IconSearch size={18} />, placeholder: t('palette.placeholder') }}
      radius="md"
    />
  );
}
