import {
  confirmEmailError,
  EMAIL_ERROR,
  EMAIL_MISMATCH,
  emailCanBecomeValid,
  emailError,
  isValidEmail,
  isValidMobile,
  isValidUdyam,
  MOBILE_ERROR,
  mobileError,
  sanitizeMobile,
  sanitizeUdyam,
  UDYAM_ERROR,
  UDYAM_PREFIX,
  udyamCanBecomeValid,
  udyamError,
} from '../src/registrationValidation';

describe('Udyam number', () => {
  it('upper-cases, drops other characters and keeps the UDYAM- prefix', () => {
    expect(sanitizeUdyam('udyam-up-29-0003915')).toBe('UDYAM-UP-29-0003915');
    expect(sanitizeUdyam('UDYAM-u p_29')).toBe('UDYAM-UP29');
    expect(sanitizeUdyam('UDYA')).toBe(UDYAM_PREFIX); // deleting into the prefix
    expect(sanitizeUdyam('')).toBe(UDYAM_PREFIX);
    expect(sanitizeUdyam('UP-29-0003915')).toBe('UDYAM-UP-29-0003915'); // pasted without the prefix
    expect(sanitizeUdyam('UDYAM-UDYAM-UP-29-0003915')).toBe('UDYAM-UP-29-0003915'); // pasted after the prefix
    expect(sanitizeUdyam('UDYAM-UDYAMUP')).toBe('UDYAM-UP');
    expect(sanitizeUdyam('UDYAMUP-29-0003915')).toBe('UDYAM-UP-29-0003915');
  });

  it('is valid only as UDYAM-XX-99-9999999 (the portal and server format)', () => {
    expect(isValidUdyam('UDYAM-UP-29-0003915')).toBe(true);
    expect(isValidUdyam('UDYAM-UP-29-000391')).toBe(false);
    expect(isValidUdyam('UDYAM-U1-29-0003915')).toBe(false);
    expect(isValidUdyam('UDYAM-UP-2A-0003915')).toBe(false);
  });

  it('shows the message as soon as a character breaks the format', () => {
    expect(udyamCanBecomeValid('UDYAM-U')).toBe(true);
    expect(udyamCanBecomeValid('UDYAM-UP-2')).toBe(true);
    expect(udyamCanBecomeValid('UDYAM-1')).toBe(false); // a digit where the state letters go
    expect(udyamCanBecomeValid('UDYAM-UPX')).toBe(false); // no '-' after the state
    expect(udyamCanBecomeValid('UDYAM-UP-2X')).toBe(false);
    expect(udyamCanBecomeValid('UDYAM-UP-29-00039155')).toBe(false); // too long
    expect(udyamError('UDYAM-1', false)).toBe(UDYAM_ERROR);
    expect(udyamError('UDYAM-UP-29', false)).toBeUndefined();
  });

  it('shows the message for an unfinished number once the field is left, not for an untouched prefix', () => {
    expect(udyamError('UDYAM-UP-29', true)).toBe(UDYAM_ERROR);
    expect(udyamError(UDYAM_PREFIX, true)).toBeUndefined();
    expect(udyamError('UDYAM-UP-29-0003915', true)).toBeUndefined();
  });
});

describe('Mobile number', () => {
  it('keeps 10 digits at most and empties the field when it begins with 0-5 (legacy)', () => {
    expect(sanitizeMobile('98-765 43210 9')).toEqual({ value: '9876543210', startError: false });
    expect(sanitizeMobile('5999999999')).toEqual({ value: '', startError: true });
    expect(sanitizeMobile('0')).toEqual({ value: '', startError: true });
    expect(sanitizeMobile('')).toEqual({ value: '', startError: false });
  });

  it('needs 10 digits; the message shows once the field is left', () => {
    expect(isValidMobile('9876543210')).toBe(true);
    expect(isValidMobile('987654321')).toBe(false);
    expect(mobileError('98765', false)).toBeUndefined();
    expect(mobileError('98765', true)).toBe(MOBILE_ERROR);
    expect(mobileError('', true)).toBeUndefined();
    expect(mobileError('9876543210', true)).toBeUndefined();
  });
});

describe('E-mail', () => {
  it('accepts addresses as Android Patterns.EMAIL_ADDRESS does', () => {
    expect(isValidEmail('pledge@acme.test')).toBe(true);
    expect(isValidEmail(' first.last+zed@mail.example.co.in ')).toBe(true);
    expect(isValidEmail('pledge@acme')).toBe(false);
    expect(isValidEmail('pledge@@acme.test')).toBe(false);
    expect(isValidEmail('ple dge@acme.test')).toBe(false);
  });

  it('shows the message at once for what no address can have', () => {
    expect(emailCanBecomeValid('pledge@ac')).toBe(true);
    expect(emailCanBecomeValid('pledge@acme.')).toBe(true);
    expect(emailCanBecomeValid('ple dge')).toBe(false);
    expect(emailCanBecomeValid('pledge,acme')).toBe(false);
    expect(emailCanBecomeValid('pledge@acme@')).toBe(false);
    expect(emailCanBecomeValid('@acme')).toBe(false);
    expect(emailCanBecomeValid('pledge@acme..test')).toBe(false);
    expect(emailCanBecomeValid('pledge@.acme')).toBe(false);
    expect(emailError('ple dge', false)).toBe(EMAIL_ERROR);
    expect(emailError('pledge@ac', false)).toBeUndefined();
  });

  it('shows the message for an incomplete address once the field is left', () => {
    expect(emailError('pledge@acme', true)).toBe(EMAIL_ERROR);
    expect(emailError('pledge@acme.test', true)).toBeUndefined();
    expect(emailError('', true)).toBeUndefined();
  });

  it('flags the confirmation as soon as it stops matching (case aside), and when different once left', () => {
    expect(confirmEmailError('pledge@acme.test', 'Pledge@', false)).toBeUndefined();
    expect(confirmEmailError('pledge@acme.test', 'other', false)).toBe(EMAIL_MISMATCH);
    expect(confirmEmailError('pledge@acme.test', 'pledge@acme', true)).toBe(EMAIL_MISMATCH);
    expect(confirmEmailError('pledge@acme.test', 'PLEDGE@ACME.TEST', true)).toBeUndefined();
    expect(confirmEmailError('pledge@acme.test', '', true)).toBeUndefined();
  });
});
