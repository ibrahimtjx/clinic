import { fireEvent, screen } from '@testing-library/react';
import { useState } from 'react';

import { renderWithProviders } from '../test/render';
import { PhraseTextarea } from './PhraseTextarea';

function Harness() {
  const [v, setV] = useState('Pain . today');
  return <PhraseTextarea label="note" phrases={['on chewing', 'cold']} value={v} onChange={setV} />;
}

it('inserts a saved phrase at the cursor', async () => {
  localStorage.setItem('clinic.lang', JSON.stringify('en'));
  renderWithProviders(<Harness />);
  const ta = screen.getByLabelText('note') as HTMLTextAreaElement;
  ta.setSelectionRange(5, 5);
  fireEvent.click(screen.getByRole('button', { name: 'Saved phrases' }));
  fireEvent.click(await screen.findByText('on chewing'));
  expect(ta.value).toBe('Pain on chewing. today');
});
