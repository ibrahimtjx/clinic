import { useQuery } from '@tanstack/react-query';

import type { Appointment } from '../appointments/types';
import type { Doctor } from '../master/types';
import { useClinicInfo } from '../master/queries';
import { api } from './api';
import { desktop, isDesktop } from './desktop';
import { formatDate, formatTime } from './format';

export interface WhatsAppSettings {
  template_ar: string;
  template_en: string;
}

export const useWhatsAppSettings = () =>
  useQuery({ queryKey: ['settings', 'whatsapp'], queryFn: () => api<WhatsAppSettings>('/settings/whatsapp'), staleTime: 5 * 60_000 });

/** A Saudi mobile in the international form WhatsApp wants (9665XXXXXXXX), or null. */
export function waNumber(mobile: string | null | undefined): string | null {
  if (!mobile) return null;
  let d = mobile.replace(/[^\d+]/g, '').replace(/^\+/, '').replace(/^00/, '');
  if (/^05\d{8}$/.test(d)) d = `966${d.slice(1)}`;
  else if (/^5\d{8}$/.test(d)) d = `966${d}`;
  return /^\d{10,15}$/.test(d) ? d : null;
}

/** Fill the clinic's template: {patient} {date} {day} {time} {doctor} {room} {clinic} {phone}. */
export function fillTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (all, k: string) => (k in values ? values[k] : all));
}

export function reminderText(
  template: WhatsAppSettings,
  language: 'ar' | 'en',
  a: Appointment,
  doctor: Doctor | undefined,
  clinic: { name_ar: string; name_en: string; phone: string } | undefined,
): string {
  const ar = language === 'ar';
  const when = new Date(a.starts_at);
  const day = new Intl.DateTimeFormat(ar ? 'ar-SA-u-ca-gregory-nu-latn' : 'en-GB', { weekday: 'long', timeZone: 'Asia/Riyadh' }).format(when);
  return fillTemplate(ar ? template.template_ar : template.template_en, {
    patient: (ar ? a.patient?.name_ar : a.patient?.name_en || a.patient?.name_ar) ?? '',
    date: formatDate(when, language, 'latn'),
    day,
    time: formatTime(when, language, 'latn'),
    doctor: doctor ? (ar ? doctor.name_ar : doctor.name_en || doctor.name_ar) : '',
    room: doctor?.room ?? '',
    clinic: clinic ? (ar ? clinic.name_ar || clinic.name_en : clinic.name_en || clinic.name_ar) : '',
    phone: clinic?.phone ?? '',
  });
}

/** wa.me link; characters encodeURIComponent leaves alone are encoded too, so the link stays plain. */
export function waLink(number: string, text: string): string {
  const enc = encodeURIComponent(text).replace(/[!'()*~]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `https://wa.me/${number}?text=${enc}`;
}

/** Opens WhatsApp (desktop app or WhatsApp Web) with the message ready; the user presses Send. */
export async function openWhatsApp(url: string): Promise<void> {
  if (isDesktop()) {
    try {
      await desktop('open_whatsapp', { url });
      return;
    } catch {
      // An older desktop app without the command: fall back to the browser way.
    }
  }
  window.open(url, '_blank', 'noopener');
}

export function useReminder() {
  const settings = useWhatsAppSettings();
  const clinic = useClinicInfo();
  return {
    ready: !!settings.data,
    send: (a: Appointment, doctor: Doctor | undefined, language: 'ar' | 'en') => {
      const number = waNumber(a.patient?.mobile);
      if (!number || !settings.data) return false;
      void openWhatsApp(waLink(number, reminderText(settings.data, language, a, doctor, clinic.data)));
      return true;
    },
  };
}
