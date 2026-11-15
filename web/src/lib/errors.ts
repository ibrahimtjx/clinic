import type { TFunction } from 'i18next';

import { formatTime } from './format';
import { ApiError } from './api';

/** Turns an API error code into a translated message (errors.* in the i18n files). */
export function errorMessage(t: TFunction, err: unknown, lang: 'ar' | 'en' = 'ar'): string {
  if (err instanceof ApiError) {
    if (err.code === 'account_locked' && typeof err.detail?.until === 'string') {
      return t('errors.account_locked_until', { time: formatTime(err.detail.until, lang) });
    }
    if (err.code === 'stale_record') {
      return t('errors.stale_record', { name: (err.detail?.updated_by as string) ?? t('errors.someone') });
    }
    return t(`errors.${err.code}`, { defaultValue: t('errors.generic') });
  }
  return t('errors.generic');
}
