import { useEffect } from 'react';
import { useBlocker } from 'react-router';

import { UnsavedChangesModal } from '../components/UnsavedChangesModal';

/**
 * SPEC 3.5: warn before leaving a screen with unsaved changes (in-app navigation and closing the tab).
 * Render the returned element somewhere in the screen.
 */
export function useUnsavedGuard(dirty: boolean, save: () => Promise<boolean>) {
  const blocker = useBlocker(({ currentLocation, nextLocation }) => dirty && currentLocation.pathname !== nextLocation.pathname);

  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);

  return (
    <UnsavedChangesModal
      opened={blocker.state === 'blocked'}
      onKeepEditing={() => blocker.reset?.()}
      onDiscard={() => blocker.proceed?.()}
      onSave={async () => {
        if (await save()) blocker.proceed?.();
        else blocker.reset?.();
      }}
    />
  );
}
