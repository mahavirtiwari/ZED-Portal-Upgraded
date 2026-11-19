import { t } from '../../content/page-text';
import { ConfirmAsk } from '../confirm-dialog';

/**
 * 2026-11-17 (approved staff redesign, users pages): the small display helpers the agency, assessor, NEFT Admin and
 * operation admin lists share.
 * 2026-11-18 (the user: "do not hide email ID, mobile number, PAN number ... do not mask, do not hide"): every signed-in
 * page shows the mobile, e-mail and PAN in full (the masking helpers are gone).
 */

/** Up to two letters of a name for the row's badge (without Pvt, Ltd and the like). */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !/^(pvt|ltd|llp|co|of|the|and)$/i.test(w));
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
}

/** The value trimmed, "" when there is none (an e-mail or mobile shown in full). */
export function plain(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/**
 * The "Send password reset link?" confirmation of a row menu or a record's head (popup-04): who gets the link and the
 * address it goes to (in full since 2026-11-18). The mail goes out at once, so the toast after it has no Undo.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): as popup-04: a mail tile, "The user chooses the new
 * password." under the title, a card of the user (initials, name, "Assessor · ID", the e-mail, ACTIVE) and two ticks.
 */
export function resetLinkAsk(name: string | null | undefined, userId: string, email: string | null | undefined, role?: string): ConfirmAsk {
  return {
    title: t('staff.userLists.resetPopup.title', 'Send password reset link?'),
    subtitle: t('staff.userLists.resetPopup.subtitle', 'The user chooses the new password.'),
    icon: 'mail',
    person: {
      name: name || userId,
      initials: initialsOf(name || userId),
      line: t('staff.userLists.resetPopup.personLine', '{role} · {id}', { role: role ?? t('staff.userLists.resetPopup.roleUser', 'User'), id: userId }),
      email: plain(email) || t('staff.userLists.resetPopup.noEmail', 'The registered e-mail address'),
      status: t('staff.userLists.resetPopup.statusActive', 'Active'),
    },
    points: [t('staff.userLists.resetPopup.point1', 'The link works once, for a short time.'),
      t('staff.userLists.resetPopup.point2', 'A newer link replaces any link sent earlier.')],
    pointStyle: 'tick',
    confirmLabel: t('staff.userLists.resetPopup.confirmButton', 'Send link'),
  };
}

/** The address of a "link sent" answer ("… (meena@zed.test)."), else the list's address. */
export function sentTo(message: string, fallback: string | null | undefined): string {
  return /\(([^()]*@[^()]*)\)/.exec(message)?.[1] ?? (plain(fallback) || t('staff.userLists.toast.sentToFallback', 'the registered e-mail address'));
}
