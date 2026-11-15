import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';

import { fakeApi, makeMe, token } from '../test/fakeApi';
import { renderApp } from '../test/render';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('sign-in', () => {
  it('shows the login page without a session and signs in', async () => {
    const api = fakeApi({ me: null });
    const me = makeMe();
    api.on('POST /api/auth/login', (b) => {
      const { username, password } = b as { username: string; password: string };
      return username === 'amal' && password === 'Correct-Horse-9' ? [200, token(me)] : [401, { detail: { code: 'invalid_credentials' } }];
    });
    renderApp('/', 'en');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Username/), 'amal');
    await user.type(screen.getByLabelText(/^Password/), 'wrong-password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByTestId('login-error')).toHaveTextContent('Wrong username or password.');
    await user.type(screen.getByLabelText(/^Password/), 'Correct-Horse-9');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByTestId('server-time')).toBeInTheDocument();
    // The machine name travels with every request for the audit log.
    expect(api.calls.find((c) => c.path === '/api/auth/login')?.headers['X-Client-Machine']).toMatch(/^PC-/);
  });

  it('explains a locked account with the unlock time', async () => {
    const api = fakeApi({ me: null });
    api.on('POST /api/auth/login', () => [423, { detail: { code: 'account_locked', until: '2026-11-15T13:20:00+00:00' } }]);
    renderApp('/', 'en');
    const user = userEvent.setup();
    await user.type(await screen.findByLabelText(/Username/), 'amal');
    await user.type(screen.getByLabelText(/^Password/), 'whatever-123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByTestId('login-error')).toHaveTextContent('locked until 04:20 PM');
  });

  it('applies the user profile language on sign-in', async () => {
    fakeApi({ me: makeMe({ preferences: { lang: 'en', theme: null, digits: null } }) });
    renderApp('/', 'ar');
    await screen.findByTestId('server-time');
    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
  });

  it('forces a password change when required, keeping the app mounted', async () => {
    fakeApi({ me: makeMe({ must_change_password: true }) });
    renderApp('/', 'en');
    expect(await screen.findByTestId('must-change-password')).toBeInTheDocument();
    expect(screen.getByTestId('server-time')).toBeInTheDocument();
  });
});

describe('lock and quick switch', () => {
  it('locks from the user menu, keeps work, and unlocks with the PIN', async () => {
    const api = fakeApi();
    api.on('POST /api/auth/pin-login', (b) =>
      (b as { pin: string }).pin === '4826' ? [200, token(makeMe())] : [401, { detail: { code: 'invalid_credentials' } }],
    );
    renderApp('/design', 'en');
    const user = userEvent.setup();
    await screen.findByTestId('design-page');
    const name = screen.getAllByRole('textbox', { name: /Patient name/ })[0];
    await user.type(name, 'unsaved draft');

    await user.click(screen.getByTestId('user-menu'));
    await user.click(await screen.findByTestId('lock'));
    expect(await screen.findByTestId('lock-screen')).toBeInTheDocument();
    expect(api.calls.some((c) => c.path === '/api/auth/lock')).toBe(true);

    await user.type(screen.getByTestId('lock-pin'), '0000');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(await screen.findByTestId('lock-error')).toHaveTextContent('Wrong username or password.');

    await user.type(screen.getByTestId('lock-pin'), '4826');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));
    await waitFor(() => expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument());
    expect(screen.getAllByRole('textbox', { name: /Patient name/ })[0]).toHaveValue('unsaved draft');
  });

  it('lets another user switch in with their PIN', async () => {
    const api = fakeApi();
    const omar = makeMe({ id: 2, username: 'dr.omar', full_name_en: 'Dr. Omar', permissions: ['dental.view'] });
    api.on('POST /api/auth/pin-login', (b) => ((b as { username: string }).username === 'dr.omar' ? [200, token(omar)] : [401, {}]));
    renderApp('/', 'en');
    const user = userEvent.setup();
    await screen.findByTestId('server-time');
    await user.click(screen.getByTestId('user-menu'));
    await user.click(await screen.findByTestId('lock'));
    await user.click(await screen.findByTestId('lock-switch'));
    await user.type(screen.getByTestId('lock-username'), 'dr.omar');
    await user.type(screen.getByTestId('lock-pin'), '1357');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(screen.queryByTestId('lock-screen')).not.toBeInTheDocument());
    await user.click(screen.getByTestId('user-menu'));
    expect(await screen.findByTestId('current-user')).toHaveTextContent('Dr. Omar');
    expect(screen.queryByText('Appointments')).not.toBeInTheDocument();
  });

  it('locks automatically after the configured idle time', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    fakeApi({ me: makeMe({ security: { auto_lock_minutes: 1, lockout_attempts: 5, lockout_minutes: 15 } }) });
    renderApp('/', 'en');
    await screen.findByTestId('server-time');
    act(() => {
      fireEvent.mouseMove(document);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(61_000);
    });
    expect(await screen.findByTestId('lock-screen')).toBeInTheDocument();
  });

  it('moves to the lock screen when the server ends the session', async () => {
    const api = fakeApi();
    renderApp('/', 'en');
    await screen.findByTestId('server-time');
    api.on('PATCH /api/auth/me/preferences', () => [401, { detail: { code: 'session_ended' } }]);
    const user = userEvent.setup();
    await user.click(screen.getByTestId('user-menu'));
    await user.click(await screen.findByTestId('toggle-theme'));
    expect(await screen.findByTestId('lock-screen')).toBeInTheDocument();
  });
});
