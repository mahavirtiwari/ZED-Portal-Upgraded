import { ConfirmAsk } from '../confirm-dialog';

/**
 * 2026-11-17 (approved staff redesign, users pages): the small display helpers the agency, assessor, NEFT Admin and
 * operation admin lists share. Lists mask the SPOC / user mobile and e-mail ("99•••••111", "ma•••••@gmail.com"); the
 * record's own page shows the full values.
 */
const DOTS = '•••••';

/** "ma•••••@gmail.com" (the first two letters and the domain); "" when there is no address. */
export function maskEmail(email: string | null | undefined): string {
  const e = (email ?? '').trim();
  if (!e) return '';
  const at = e.indexOf('@');
  if (at < 0) return e.length <= 2 ? DOTS : e.slice(0, 2) + DOTS;
  return e.slice(0, Math.min(2, Math.max(at - 1, 1))) + DOTS + e.slice(at);
}

/** "99•••••111" (the first two and the last three digits); "" when there is no number. */
export function maskMobile(mobile: string | null | undefined): string {
  const m = (mobile ?? '').replace(/\s+/g, '');
  if (!m) return '';
  return m.length <= 5 ? DOTS + m.slice(-2) : m.slice(0, 2) + DOTS + m.slice(-3);
}

/** Up to two letters of a name for the row's badge (without Pvt, Ltd and the like). */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !/^(pvt|ltd|llp|co|of|the|and)$/i.test(w));
  return ((words[0]?.[0] ?? '') + (words[1]?.[0] ?? '')).toUpperCase() || '?';
}

/**
 * The "Send password reset link?" confirmation of a row menu or a record's head (popup-04): who gets the link and the
 * masked address it goes to. The mail goes out at once, so the toast after it has no Undo.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): as popup-04: a mail tile, "The user chooses the new
 * password." under the title, a card of the user (initials, name, "Assessor · ID", masked e-mail, ACTIVE) and two ticks.
 */
export function resetLinkAsk(name: string | null | undefined, userId: string, email: string | null | undefined, role = 'User'): ConfirmAsk {
  return {
    title: 'Send password reset link?',
    subtitle: 'The user chooses the new password.',
    icon: 'mail',
    person: {
      name: name || userId,
      initials: initialsOf(name || userId),
      line: `${role} · ${userId}`,
      email: maskEmail(email) || 'The registered e-mail address',
      status: 'Active',
    },
    points: ['The link works once, for a short time.', 'A newer link replaces any link sent earlier.'],
    pointStyle: 'tick',
    confirmLabel: 'Send link',
  };
}

/** The address of a "link sent" answer ("… (m******@zed.test)."), else the list's masked address. */
export function sentTo(message: string, fallback: string | null | undefined): string {
  return /\(([^()]*@[^()]*)\)/.exec(message)?.[1] ?? (maskEmail(fallback) || 'the registered e-mail address');
}
