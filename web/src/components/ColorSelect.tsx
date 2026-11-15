import { ColorSwatch, Group, Select, Text, type SelectProps } from '@mantine/core';
import { useTranslation } from 'react-i18next';

import { COLORS, type ColorName } from '../master/types';

/** Picks one of the theme's named colors (no free hex values: SPEC 4.2). */
export function ColorSelect({ value, onChange, ...props }: { value: ColorName; onChange: (c: ColorName) => void } & Omit<SelectProps, 'value' | 'onChange' | 'data'>) {
  const { t } = useTranslation();
  const swatch = (c: string) => <ColorSwatch color={`var(--mantine-color-${c}-filled)`} size={16} />;
  return (
    <Select
      data={COLORS.map((c) => ({ value: c, label: t(`colors.${c}`) }))}
      value={value}
      onChange={(v) => v && onChange(v as ColorName)}
      leftSection={swatch(value)}
      renderOption={({ option }) => (
        <Group gap="xs">
          {swatch(option.value)}
          <Text size="sm">{option.label}</Text>
        </Group>
      )}
      allowDeselect={false}
      {...props}
    />
  );
}
