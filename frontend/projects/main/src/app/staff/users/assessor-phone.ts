import { HttpClient, HttpContext } from '@angular/common/http';
import { Component, computed, input } from '@angular/core';
import { MessageResponse } from '@zed/shared';
import { Observable } from 'rxjs';
import { t } from '../../content/page-text';
import { ConfirmAsk } from '../confirm-dialog';

/**
 * One phone per staff user (2026-11-18, the user: "Master admin will release the mobile then assessor can use new one"):
 * an assessor (Main, Surveillance) or a consultant (Consultancy) signs in to the app on the registered phone only, until the
 * Admin or the Master Admin releases it (api/staff/assessor-mobile). Shared by the lists (the Phone chip and the row menu's
 * Release mobile) and the details card (AssessorMobilePanel).
 */

/** The registered phone of a user (or a refused sign-in today), as the lists show it (GET api/staff/assessor-mobile). */
export interface PhoneSummary {
  userId: string;
  /** The app's key (SA, SURV) and name ("Site assessment app"). */
  app: string | null;
  appName: string | null;
  /** "Samsung SM-A515F" (make and model as the app sends them). */
  model: string | null;
  make: string | null;
  /** The last sign-in on the registered phone (server time); null when no phone is registered. */
  lastLoginAt: string | null;
  /** A sign-in or call from another phone was refused today. */
  refusedToday: boolean;
  lastRefusedAt: string | null;
}

export type PhoneTone = 'ok' | 'none' | 'warn';

/** The chip of a user's phone: "Registered · Samsung SM-A515F", "Not registered", or "Refused sign-in today" (amber). */
export function phoneChip(p: PhoneSummary | null | undefined): { label: string; tone: PhoneTone; title: string } {
  const model = p?.model?.trim() || p?.make?.trim() || '';
  if (p?.refusedToday) {
    return {
      label: t('staff.assessorMobile.chip.refused', 'Refused sign-in today'),
      tone: 'warn',
      title: model ? t('staff.assessorMobile.chip.refusedModelTooltip', 'A sign-in from another phone was refused today. Registered: {model}.', { model })
        : t('staff.assessorMobile.chip.refusedTooltip', 'A sign-in from another phone was refused today.'),
    };
  }
  if (p?.lastLoginAt || model)
    return { label: model ? t('staff.assessorMobile.chip.registeredModel', 'Registered · {model}', { model }) : t('staff.assessorMobile.chip.registered', 'Registered'),
      tone: 'ok', title: t('staff.assessorMobile.chip.registeredTooltip', 'The app signs in on this phone only.') };
  return { label: t('staff.assessorMobile.chip.notRegistered', 'Not registered'), tone: 'none',
    title: t('staff.assessorMobile.chip.notRegisteredTooltip', 'No phone registered: the next sign-in registers the phone it comes from.') };
}

/** The user has a phone that can be released (registered, as the list knows it). */
export function hasPhone(p: PhoneSummary | null | undefined): boolean {
  return !!(p?.lastLoginAt || p?.model || p?.make);
}

/** The phones of the users of this portal's apps, by user id (upper case). */
export function phonesById(list: PhoneSummary[] | null | undefined): Map<string, PhoneSummary> {
  const map = new Map<string, PhoneSummary>();
  for (const p of list ?? []) if (p?.userId) map.set(p.userId.trim().toUpperCase(), p);
  return map;
}

/**
 * The "Release mobile?" confirmation (popup-03 style): what releasing does and a required reason (kept in the release
 * history). `word` is "assessor" or "consultant".
 */
export function releaseMobileAsk(name: string | null | undefined, userId: string, model: string | null | undefined, word: string): ConfirmAsk {
  const phone = model?.trim();
  return {
    title: t('staff.assessorMobile.release.title', 'Release the mobile of {name}?', { name: name?.trim() || userId }),
    subtitle: phone ? `${userId} · ${phone}` : userId,
    icon: 'unlock',
    tone: 'warn',
    points: [
      phone ? t('staff.assessorMobile.release.point1Model', 'The {word} can no longer use the app on the {phone}.', { word, phone })
        : t('staff.assessorMobile.release.point1', 'The {word} can no longer use the app on the registered phone.', { word }),
      t('staff.assessorMobile.release.point2', 'The next sign-in registers the phone it comes from; only that phone can be used then.'),
      t('staff.assessorMobile.release.point3', 'The release, with your reason, is kept in the release history.'),
    ],
    confirmLabel: t('staff.assessorMobile.release.confirmButton', 'Release Mobile'),
    reason: {
      label: t('staff.assessorMobile.release.reasonLabel', 'Reason for releasing'),
      placeholder: t('staff.assessorMobile.release.reasonPlaceholder', 'e.g. phone lost, phone replaced'), maxLength: 500,
      requiredMessage: t('staff.assessorMobile.release.reasonRequired', 'Please enter the reason for releasing the mobile.'),
    },
  };
}

/** The API of the registered phones (Admin and Master Admin; never agencies). */
export const PHONES_URL = '/api/staff/assessor-mobile';

export function loadPhones(http: HttpClient, context?: HttpContext): Observable<PhoneSummary[]> {
  return http.get<PhoneSummary[]>(PHONES_URL, { context });
}

/** Releases the user's phone(s) of this portal's apps with the reason; the next sign-in registers the new phone. */
export function releasePhone(http: HttpClient, userId: string, reason: string, context?: HttpContext): Observable<MessageResponse> {
  return http.post<MessageResponse>(`${PHONES_URL}/${encodeURIComponent(userId)}/release`, { reason }, { context });
}

/** The Phone chip of a list row. */
@Component({
  selector: 'zed-phone-chip',
  template: `
    @let c = chip();
    <span [class]="'ph-chip is-' + c.tone" [title]="c.title" data-phone>
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zM11 18h2" /></svg>
      <span class="ph-text">{{ c.label }}</span>
    </span>
  `,
  styles: `
    :host { display: inline-block; max-width: 100%; vertical-align: middle; }
    .ph-chip { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; padding: 3px 9px; border-radius: 11px; font-size: 11px; font-weight: 700;
      line-height: 16px; white-space: nowrap; background: #e6f2f3; color: #24666b; }
    .ph-chip.is-none { background: #ecf0f0; color: #6f8487; }
    .ph-chip.is-warn { background: #fdf2dc; color: #9a5f06; }
    .ph-chip svg { flex: none; width: 12px; height: 12px; fill: none; stroke: currentColor; stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .ph-text { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
  `,
})
export class PhoneChip {
  readonly phone = input<PhoneSummary | null | undefined>(null);
  protected readonly chip = computed(() => phoneChip(this.phone()));
}
