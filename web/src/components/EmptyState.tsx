import { Stack, Text, ThemeIcon, Title } from '@mantine/core';
import type { Icon } from '@tabler/icons-react';
import type { ReactNode } from 'react';

/** Empty state: icon, short hint, and the main action (SPEC 4.2). */
export function EmptyState({ icon: IconC, title, hint, action }: { icon: Icon; title: string; hint: string; action?: ReactNode }) {
  return (
    <Stack align="center" gap="xs" py="xl" ta="center">
      <ThemeIcon size={52} radius="xl" variant="light">
        <IconC size={26} stroke={1.5} />
      </ThemeIcon>
      <Title order={4} mt="xs">
        {title}
      </Title>
      <Text size="sm" c="dimmed" maw={360}>
        {hint}
      </Text>
      {action && <div style={{ marginTop: 'var(--mantine-spacing-sm)' }}>{action}</div>}
    </Stack>
  );
}
