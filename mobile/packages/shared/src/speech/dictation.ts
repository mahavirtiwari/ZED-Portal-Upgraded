import { zedDevice } from '../native';

/**
 * Voice typing in comment boxes (2026-11-21, the user: "voice to text in all the mobile apps wherever comment box is
 * there"). The phone's own speech service listens (RecognizerIntent, packages/shared/android: ZedDeviceModule) and the
 * words are added to the box; the user can still correct them by typing. English (India) on a tap, Hindi on a long press.
 */
export const DICTATION_ENGLISH = 'en-IN';
export const DICTATION_HINDI = 'hi-IN';

let available: boolean | null = null;

/** Whether the phone can do voice typing (asked once). False when the native module is missing (tests, an old build). */
export function speechAvailable(): boolean {
  if (available != null) return available;
  try {
    const device = zedDevice() as Partial<ReturnType<typeof zedDevice>>;
    available = typeof device.isSpeechAvailable === 'function' && typeof device.recognizeSpeech === 'function' && device.isSpeechAvailable() === true;
  } catch {
    available = false;
  }
  return available;
}

/** Tests: forget the answer of {@link speechAvailable}. */
export function resetSpeechAvailabilityForTesting(): void {
  available = null;
}

/** Listens once; the words heard, or null when the user cancelled or nothing was heard. */
export async function dictate(language: string, prompt: string | null): Promise<string | null> {
  const heard = await zedDevice().recognizeSpeech(language, prompt);
  const text = heard?.trim();
  return text ? text : null;
}

export type AppendedDictation = {
  text: string;
  /** Part (or all) of what was said did not fit in the box's character limit. */
  cut: boolean;
};

const SENTENCE_END = /[.!?।]\s*$/;

/**
 * Adds the words heard to what is already in the box: after a space when needed, starting with a capital letter at the
 * start of the box or of a new sentence, cut to the box's limit.
 */
export function appendDictation(current: string, spoken: string, maxLength?: number | null): AppendedDictation {
  let words = spoken.trim().replace(/\s+/g, ' ');
  if (!words) return { text: current, cut: false };
  const startsSentence = current.trim() === '' || SENTENCE_END.test(current);
  if (startsSentence) words = words.charAt(0).toLocaleUpperCase() + words.slice(1);
  const separator = current === '' || /\s$/.test(current) ? '' : ' ';
  const joined = current + separator + words;
  if (maxLength == null || maxLength <= 0 || joined.length <= maxLength) return { text: joined, cut: false };
  const room = maxLength - current.length - separator.length;
  if (room <= 0) return { text: current, cut: true };
  return { text: current + separator + words.slice(0, room).trimEnd(), cut: true };
}
