import { Badge, type BadgeProps } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { statusColors, type StatusKey } from '../app/theme';

/** Soft tinted status chip (SPEC 4.1.5). Never a saturated row. */
export function StatusChip({ status, ...props }: { status: StatusKey } & Omit<BadgeProps, 'color'>) {
  const { t } = useTranslation();
  return (
    <Badge color={statusColors[status]} variant="light" leftSection={<Dot />} {...props}>
      {t(`status.${status}`)}
    </Badge>
  );
}

function Dot() {
  return <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', display: 'inline-block' }} />;
}
