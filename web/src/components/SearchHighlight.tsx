import { Mark } from '@mantine/core';
import type { ReactNode } from 'react';

import { matchRanges } from '../lib/normalize';

/** Highlights search words in `text`, matching Arabic spelling variants the way the search does. */
export function SearchHighlight({ text, query }: { text: string | null | undefined; query: string | undefined }): ReactNode {
  if (!text) return text ?? '';
  const ranges = query ? matchRanges(text, query) : [];
  if (!ranges.length) return text;
  const out: ReactNode[] = [];
  let pos = 0;
  ranges.forEach(([a, b], i) => {
    if (a > pos) out.push(text.slice(pos, a));
    out.push(
      <Mark key={i} color="yellow">
        {text.slice(a, b)}
      </Mark>,
    );
    pos = b;
  });
  if (pos < text.length) out.push(text.slice(pos));
  return <>{out}</>;
}
