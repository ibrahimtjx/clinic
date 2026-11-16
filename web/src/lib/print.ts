import { notifications } from '@mantine/notifications';

import i18n from '../i18n';
import { desktop, isDesktop } from './desktop';

/** Receipt-printer (80 mm) pages; everything else goes to the A4 printer. */
export const printKind = (path: string): 'a4' | 'receipt' => (/^\/print\/(receipt\/|slip\/|test\/receipt)/.test(path) ? 'receipt' : 'a4');

/**
 * Print a print page (e.g. "/print/invoice/12"). In the desktop app it goes straight to this PC's
 * printer without a dialog; in a browser it opens the preview, which shows the print dialog.
 */
export async function printDoc(path: string): Promise<void> {
  if (isDesktop()) {
    try {
      await desktop('print_url', {
        url: `${window.location.origin}${path}`,
        kind: printKind(path),
      });
      notifications.show({ color: 'green', message: i18n.t('print.sent') });
      return;
    } catch (e) {
      notifications.show({
        color: 'red',
        message: i18n.t('print.failed', { reason: String(e) }),
      });
      // Fall back to the preview so the user can still print with the dialog.
    }
  }
  window.open(path, '_blank', 'noopener');
}

/** Save a print page as PDF (desktop app: a save dialog; browser: the preview's print dialog). */
export async function savePdf(path: string, name: string): Promise<void> {
  if (!isDesktop()) {
    window.open(path, '_blank', 'noopener');
    return;
  }
  try {
    const saved = await desktop<string | null>('save_pdf', {
      url: `${window.location.origin}${path}`,
      name: `${name}.pdf`,
    });
    if (saved)
      notifications.show({
        color: 'green',
        message: i18n.t('print.pdfSaved', { path: saved }),
      });
  } catch (e) {
    notifications.show({
      color: 'red',
      message: i18n.t('print.failed', { reason: String(e) }),
    });
  }
}
