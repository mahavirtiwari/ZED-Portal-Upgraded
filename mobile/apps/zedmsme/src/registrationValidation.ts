/**
 * The registration entries' formats, as the portal and the server check them (MsmeRegistrationController: the Udyam
 * number and the 10 digit mobile) and as the legacy app checked them (Utils.validateFirstCharOfPhoneNumber,
 * Patterns.EMAIL_ADDRESS in RegistrationEmailDialogFragment).
 *
 * New in V4 (2.0): a wrong entry shows its message at once, while typing, not only on Proceed.
 */

export const UDYAM_PREFIX = 'UDYAM-';
/** The Udyam number's shape: A = a letter, 9 = a digit, anything else as written. */
const UDYAM_TEMPLATE = 'UDYAM-AA-99-9999999';
const UDYAM_PATTERN = /^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/;

export const UDYAM_ERROR = 'Please enter a valid Udyam Registration Number.';
export const MOBILE_START_ERROR = 'Mobile Number cannot begin with 0-5';
export const MOBILE_ERROR = 'Please enter a valid 10 digit mobile number.';
export const EMAIL_ERROR = 'Not a valid email';
export const EMAIL_MISMATCH = 'Email ID is not matching';

/** Upper case, only letters, digits and '-', and the "UDYAM-" prefix kept (a pasted number without it gets it). */
export function sanitizeUdyam(raw: string): string {
  let s = raw.toUpperCase().replace(/[^A-Z0-9-]/g, '');
  // A whole number typed or pasted after the prefix that stays in the field: keep one prefix.
  while (s.startsWith(UDYAM_PREFIX + 'UDYAM')) s = UDYAM_PREFIX + s.slice(UDYAM_PREFIX.length + 5).replace(/^-/, '');
  if (s.startsWith(UDYAM_PREFIX)) return s;
  if (UDYAM_PREFIX.startsWith(s)) return UDYAM_PREFIX;
  return UDYAM_PREFIX + s.replace(/^UDYAM-?/, '');
}

export const isValidUdyam = (s: string) => UDYAM_PATTERN.test(s);

/** False as soon as a character breaks the template (or there are too many): the entry can no longer be right. */
export function udyamCanBecomeValid(s: string): boolean {
  if (s.length > UDYAM_TEMPLATE.length) return false;
  for (let i = 0; i < s.length; i++) {
    const t = UDYAM_TEMPLATE.charAt(i);
    const c = s.charAt(i);
    if (t === 'A' ? !/[A-Z]/.test(c) : t === '9' ? !/\d/.test(c) : c !== t) return false;
  }
  return true;
}

/** The message under the Udyam number: at once for a wrong character; once left (`touched`), for an unfinished one. */
export function udyamError(s: string, touched: boolean): string | undefined {
  if (!udyamCanBecomeValid(s)) return UDYAM_ERROR;
  if (touched && s !== UDYAM_PREFIX && !isValidUdyam(s)) return UDYAM_ERROR;
  return undefined;
}

/** Digits only, at most 10; `startError` when the first digit is 0-5 (the legacy app then emptied the field). */
export function sanitizeMobile(raw: string): { value: string; startError: boolean } {
  const digits = raw.replace(/\D/g, '').slice(0, 10);
  if (digits.length > 0 && Number(digits[0]) < 6) return { value: '', startError: true };
  return { value: digits, startError: false };
}

export const isValidMobile = (s: string) => /^[6-9]\d{9}$/.test(s);

/** The message under the mobile number, once left with fewer than 10 digits. */
export function mobileError(s: string, touched: boolean): string | undefined {
  return touched && s.length > 0 && !isValidMobile(s) ? MOBILE_ERROR : undefined;
}

/** Android's Patterns.EMAIL_ADDRESS, which the legacy dialog used. */
const EMAIL_PATTERN = /^[a-zA-Z0-9+._%-]{1,256}@[a-zA-Z0-9][a-zA-Z0-9-]{0,64}(\.[a-zA-Z0-9][a-zA-Z0-9-]{0,25})+$/;

export const isValidEmail = (s: string) => EMAIL_PATTERN.test(s.trim());

/** False as soon as the entry has what no address can have: a space, a comma, a second '@', '..' after the '@'. */
export function emailCanBecomeValid(raw: string): boolean {
  const s = raw.trim();
  const at = s.indexOf('@');
  const local = at < 0 ? s : s.slice(0, at);
  if (!/^[a-zA-Z0-9+._%-]*$/.test(local) || local.length > 256) return false;
  if (at < 0) return true;
  if (local.length === 0) return false;
  const domain = s.slice(at + 1);
  // Labels joined by single dots; only a last dot may still wait for its label.
  return /^([a-zA-Z0-9][a-zA-Z0-9-]*(\.[a-zA-Z0-9][a-zA-Z0-9-]*)*\.?)?$/.test(domain);
}

/** The message under the e-mail: at once for a wrong character; once left (`touched`), for an incomplete address. */
export function emailError(s: string, touched: boolean): string | undefined {
  if (!emailCanBecomeValid(s)) return EMAIL_ERROR;
  if (touched && s.trim() !== '' && !isValidEmail(s)) return EMAIL_ERROR;
  return undefined;
}

/** The message under the confirmation: at once when it stops matching the start of the e-mail; once left, unless equal. */
export function confirmEmailError(email: string, confirm: string, touched: boolean): string | undefined {
  const a = email.trim().toLowerCase();
  const b = confirm.trim().toLowerCase();
  if (b === '') return undefined;
  if (!a.startsWith(b)) return EMAIL_MISMATCH;
  if (touched && a !== b) return EMAIL_MISMATCH;
  return undefined;
}
