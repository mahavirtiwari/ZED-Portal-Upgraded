import { zedDevice } from '../native';

/**
 * Offline sign-in credential.
 *
 * The legacy apps kept the password itself on the phone (MSME: LoginData.EncCred as plain UTF-8 bytes;
 * APPS-SECURITY "Passwords stored on the device") and compared it for the offline login. The new apps keep a
 * salted PBKDF2 hash instead, in the same column, so offline login works as before without the password being
 * readable. A legacy row still holding the plain password is accepted once and replaced by the hash.
 */
export const HASH_PREFIX = 'zed1$pbkdf2-sha256';
export const HASH_ITERATIONS = 20_000;

export type Hasher = {
  hash(password: string, saltHex: string, iterations: number): string;
  randomHex(bytes: number): string;
};

export const nativeHasher: Hasher = {
  hash: (p, s, i) => zedDevice().hashPassword(p, s, i),
  randomHex: b => zedDevice().randomHex(b),
};

export function isHashedCredential(stored: string): boolean {
  return stored.startsWith(HASH_PREFIX + '$');
}

/** zed1$pbkdf2-sha256$<iterations>$<salt hex>$<hash hex> */
export function hashCredential(password: string, hasher: Hasher = nativeHasher, iterations = HASH_ITERATIONS): string {
  const salt = hasher.randomHex(16);
  return `${HASH_PREFIX}$${iterations}$${salt}$${hasher.hash(password, salt, iterations)}`;
}

export type VerifyResult = { ok: boolean; /** Set when the stored value should be replaced (legacy plain text). */ upgrade?: string };

/**
 * Legacy rule (LauncherActivity.handleOfflineLogin): existingPassword.equals(password, ignoreCase = true).
 * The login screens upper-case the password before calling, as the legacy screens did.
 */
export function verifyCredential(stored: string | null, password: string, hasher: Hasher = nativeHasher): VerifyResult {
  if (stored == null) return { ok: false };
  if (isHashedCredential(stored)) {
    const parts = stored.split('$');
    const iterations = Number(parts[2]);
    const salt = parts[3] ?? '';
    const expected = parts[4] ?? '';
    const actual = hasher.hash(password.toUpperCase(), salt, iterations);
    return { ok: constantTimeEquals(actual, expected) };
  }
  const ok = stored.toUpperCase() === password.toUpperCase();
  return ok ? { ok, upgrade: hashCredential(password.toUpperCase(), hasher) } : { ok };
}

/** The value to store after an online login (hash of the upper-cased password, as the legacy compare ignored case). */
export function credentialToStore(password: string, hasher: Hasher = nativeHasher): string {
  return hashCredential(password.toUpperCase(), hasher);
}

function constantTimeEquals(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
