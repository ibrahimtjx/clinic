import { Alert, Button, Card, Group, Select, SimpleGrid, Skeleton, Stack, Text, Title } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { IconCheck, IconDeviceDesktop, IconPrinter, IconRefresh } from '@tabler/icons-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { EmptyState } from '../components/EmptyState';
import { desktop, isDesktop, type DesktopInfo } from '../lib/desktop';
import { printDoc } from '../lib/print';

/** Per-PC settings of the desktop app (SPEC 3.8): printers, server, version and updates. */
export function ThisPcTab() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const info = useQuery({
    queryKey: ['desktop', 'config'],
    queryFn: () => desktop<DesktopInfo>('get_config'),
    enabled: isDesktop(),
  });
  const printers = useQuery({
    queryKey: ['desktop', 'printers'],
    queryFn: () => desktop<string[]>('list_printers'),
    enabled: isDesktop(),
  });
  const [a4, setA4] = useState('');
  const [receipt, setReceipt] = useState('');
  const [checking, setChecking] = useState(false);
  useEffect(() => {
    if (info.data) {
      setA4(info.data.a4_printer);
      setReceipt(info.data.receipt_printer);
    }
  }, [info.data]);

  if (!isDesktop()) return <EmptyState icon={IconDeviceDesktop} title={t('thisPc.browserTitle')} hint={t('thisPc.browserHint')} />;
  if (info.isPending) return <Skeleton height={240} />;
  const options = [{ value: '', label: t('thisPc.defaultPrinter') }, ...(printers.data ?? []).map((p) => ({ value: p, label: p }))];
  const save = async () => {
    await desktop('set_printers', { a4, receipt });
    await qc.invalidateQueries({ queryKey: ['desktop'] });
    notifications.show({
      color: 'green',
      icon: <IconCheck size={18} />,
      message: t('common.saved'),
    });
  };
  const update = async () => {
    setChecking(true);
    try {
      await desktop('check_update'); // restarts the app if an update was installed
      notifications.show({ message: t('thisPc.upToDate') });
    } catch (e) {
      notifications.show({ color: 'red', message: String(e) });
    } finally {
      setChecking(false);
    }
  };
  return (
    <Stack data-testid="this-pc">
      <Title order={2}>{t('settings.tabs.thisPc')}</Title>
      <Card withBorder>
        <Title order={4} mb="sm">
          {t('thisPc.printers')}
        </Title>
        <Text size="sm" c="dimmed" mb="sm">
          {t('thisPc.printersHint')}
        </Text>
        <SimpleGrid cols={{ base: 1, md: 2 }}>
          <Stack gap="xs">
            <Select label={t('thisPc.a4')} data={options} value={a4} onChange={(v) => setA4(v ?? '')} allowDeselect={false} />
            <Button variant="light" leftSection={<IconPrinter size={16} />} onClick={() => void printDoc('/print/test/a4')}>
              {t('thisPc.testPrint')}
            </Button>
          </Stack>
          <Stack gap="xs">
            <Select label={t('thisPc.receipt')} data={options} value={receipt} onChange={(v) => setReceipt(v ?? '')} allowDeselect={false} />
            <Button variant="light" leftSection={<IconPrinter size={16} />} onClick={() => void printDoc('/print/test/receipt')}>
              {t('thisPc.testPrint')}
            </Button>
          </Stack>
        </SimpleGrid>
        <Group mt="md">
          <Button onClick={() => void save()}>{t('common.save')}</Button>
        </Group>
        {printers.data?.length === 0 && (
          <Alert color="yellow" mt="sm">
            {t('thisPc.noPrinters')}
          </Alert>
        )}
      </Card>
      <Card withBorder>
        <Title order={4} mb="sm">
          {t('thisPc.app')}
        </Title>
        <SimpleGrid cols={{ base: 1, md: 3 }}>
          <Info label={t('thisPc.machine')} value={info.data?.machine} />
          <Info label={t('thisPc.server')} value={info.data?.server} />
          <Info label={t('thisPc.version')} value={info.data?.version} />
        </SimpleGrid>
        <Group mt="md">
          <Button variant="light" leftSection={<IconRefresh size={16} />} loading={checking} onClick={() => void update()}>
            {t('thisPc.checkUpdate')}
          </Button>
          <Button variant="subtle" color="red" onClick={() => window.confirm(t('thisPc.changeServerConfirm')) && void desktop('reset_server')}>
            {t('thisPc.changeServer')}
          </Button>
        </Group>
      </Card>
    </Stack>
  );
}

function Info({ label, value }: { label: string; value?: string | null }) {
  return (
    <Stack gap={0}>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text dir="ltr" ta="start">
        {value || '—'}
      </Text>
    </Stack>
  );
}
