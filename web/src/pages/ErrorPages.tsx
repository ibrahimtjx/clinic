import { Button, Group } from '@mantine/core';
import { IconAlertTriangle, IconHome, IconMapOff, IconRefresh } from '@tabler/icons-react';
import { useTranslation } from 'react-i18next';
import { isRouteErrorResponse, useRouteError } from 'react-router';

import { EmptyState } from '../components/EmptyState';

function Actions({ reload }: { reload?: boolean }) {
  const { t } = useTranslation();
  return (
    <Group justify="center">
      <Button component="a" href="/" leftSection={<IconHome size={16} />} variant={reload ? 'default' : 'filled'}>
        {t('errorPage.home')}
      </Button>
      {reload && (
        <Button leftSection={<IconRefresh size={16} />} onClick={() => window.location.reload()}>
          {t('errorPage.reload')}
        </Button>
      )}
    </Group>
  );
}

/** An address that does not exist, shown inside the app. */
export function NotFoundPage() {
  const { t } = useTranslation();
  return (
    <div data-testid="not-found">
      <EmptyState icon={IconMapOff} title={t('errorPage.notFound')} hint={t('errorPage.notFoundHint')} action={<Actions />} />
    </div>
  );
}

/** Instead of a blank or technical page when a screen fails: what happened and a way back. */
export function RouteErrorPage() {
  const { t } = useTranslation();
  const error = useRouteError();
  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <div data-testid="not-found" style={{ paddingTop: 80 }}>
        <EmptyState icon={IconMapOff} title={t('errorPage.notFound')} hint={t('errorPage.notFoundHint')} action={<Actions />} />
      </div>
    );
  }
  console.error(error);
  return (
    <div data-testid="route-error" style={{ paddingTop: 80 }}>
      <EmptyState icon={IconAlertTriangle} title={t('errorPage.crashed')} hint={t('errorPage.crashedHint')} action={<Actions reload />} />
    </div>
  );
}

