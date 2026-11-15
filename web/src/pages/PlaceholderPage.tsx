import { Button, Card, Title } from '@mantine/core';
import { IconPalette } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';

import type { NavItem } from '../app/nav';
import { EmptyState } from '../components/EmptyState';

export function PlaceholderPage({ item }: { item: NavItem }) {
  const { t } = useTranslation();
  const label = t(`nav.${item.key}`);
  return (
    <>
      <Title order={1} mb="lg">
        {label}
      </Title>
      <Card>
        <EmptyState
          icon={item.icon}
          title={t('common.comingSoon')}
          hint={t('placeholder.hint', { m: item.milestone })}
          action={
            <Button component={Link} to="/design" variant="light" leftSection={<IconPalette size={16} />}>
              {t('placeholder.openDesign')}
            </Button>
          }
        />
      </Card>
    </>
  );
}
