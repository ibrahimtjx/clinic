import { ActionIcon, Combobox, Textarea, Tooltip, useCombobox, type TextareaProps } from '@mantine/core';
import { IconQuote } from '@tabler/icons-react';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { usePhrases } from '../master/queries';
import type { PhraseField } from '../master/types';

/**
 * Free-text field with a saved-phrase picker (SPEC 3.7). The chosen phrase is inserted at the cursor.
 * Phrases come from Settings → Saved phrases for `fieldKey`, or can be passed in.
 */
export function PhraseTextarea({
  phrases: given,
  fieldKey,
  value,
  onChange,
  ...props
}: { phrases?: string[]; fieldKey?: PhraseField; value: string; onChange: (v: string) => void } & Omit<TextareaProps, 'value' | 'onChange'>) {
  const { t } = useTranslation();
  const saved = usePhrases(given ? undefined : fieldKey);
  const phrases = given ?? (saved.data ?? []).map((p) => p.text);
  const ref = useRef<HTMLTextAreaElement>(null);
  const [search, setSearch] = useState('');
  const combobox = useCombobox({ onDropdownClose: () => setSearch('') });

  const insert = (phrase: string) => {
    const el = ref.current;
    const start = el?.selectionStart ?? value.length;
    const end = el?.selectionEnd ?? value.length;
    const next = value.slice(0, start) + phrase + value.slice(end);
    onChange(next);
    combobox.closeDropdown();
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + phrase.length, start + phrase.length);
    });
  };

  const filtered = phrases.filter((p) => p.toLowerCase().includes(search.toLowerCase()));

  return (
    <Combobox store={combobox} onOptionSubmit={insert} position="bottom-end" width={280} withinPortal>
      <Textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.currentTarget.value)}
        autosize
        minRows={3}
        rightSection={
          <Combobox.Target>
            <Tooltip label={t('sample.phrases')}>
              <ActionIcon variant="subtle" aria-label={t('sample.phrases')} onClick={() => combobox.toggleDropdown()}>
                <IconQuote size={16} />
              </ActionIcon>
            </Tooltip>
          </Combobox.Target>
        }
        rightSectionProps={{ style: { alignItems: 'flex-start', paddingTop: 6 } }}
        {...props}
      />
      <Combobox.Dropdown>
        <Combobox.Search value={search} onChange={(e) => setSearch(e.currentTarget.value)} placeholder={t('common.search')} />
        <Combobox.Options>
          {filtered.length ? (
            filtered.map((p) => (
              <Combobox.Option value={p} key={p}>
                {p}
              </Combobox.Option>
            ))
          ) : (
            <Combobox.Empty>{t('palette.nothingFound')}</Combobox.Empty>
          )}
        </Combobox.Options>
      </Combobox.Dropdown>
    </Combobox>
  );
}
