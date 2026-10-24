/**
 * Form rules of the legacy view helpers (viewhelpers/*, global/ViewUtils.kt, Constants).
 */
export const REQUIRED = 'Required';
export const DATA_ERROR = 'Missing/Invalid Data';
export const ENTER_REQUIRED_DATA = 'Please enter all the required data';
export const INVALID_VALUE = 'Invalid Value';

/** TextInputHelper.getValue: blank counts as missing; the text itself is returned untrimmed. */
export function valueOrNull(text: string | null | undefined): string | null {
  return text == null || text.trim() === '' ? null : text;
}

export function isBlank(text: string | null | undefined): boolean {
  return text == null || text.trim() === '';
}

/** numeric_input_layout: inputType="number", maxLength 20. */
export const NUMERIC_MAX_LENGTH = 20;

export function numericFilter(text: string): string {
  return text.replace(/[^0-9]/g, '').substring(0, NUMERIC_MAX_LENGTH);
}

/**
 * ViewUtils.setPercentageValidator: once the text has more than one digit and is outside 0..100, the last typed
 * character is deleted (a KEYCODE_DEL is sent).
 */
export function percentageFilter(_previous: string, next: string): string {
  const s = numericFilter(next);
  if (s.length > 1) {
    const n = Number(s);
    if (n < 0 || n > 100) return s.substring(0, s.length - 1);
  }
  return s;
}

/** Utils.validateFirstCharOfPhoneNumber. */
export const MOBILE_FIRST_DIGIT_ERROR = 'Mobile Number cannot begin with 0-5';
export function isValidMobileStart(text: string): boolean {
  const t = text.trim();
  if (t === '') return true;
  const first = Number(t[0]);
  return isNaN(first) || first >= 6;
}

/** Utils.ONLY_ALPHABETS */
export const ONLY_ALPHABETS = /^[a-zA-Z ]+$/;

export const EMAIL_PATTERN = /^[a-zA-Z0-9+._%\-]{1,256}@[a-zA-Z0-9][a-zA-Z0-9\-]{0,64}(\.[a-zA-Z0-9][a-zA-Z0-9\-]{0,25})+$/;

/** integer/comment_length: counter of the multi-line remarks fields. */
export const COMMENT_LENGTH = 500;
