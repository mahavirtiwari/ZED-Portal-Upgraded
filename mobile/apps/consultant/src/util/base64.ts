import { utf8Decode, utf8Encode } from '@zed/shared';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** android.util.Base64.encode(bytes, DEFAULT): wrapped every 76 characters and ending with a line break. */
export function base64EncodeDefault(text: string): string {
  const bytes = utf8Encode(text);
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]!;
    const b = bytes[i + 1];
    const c = bytes[i + 2];
    out += ALPHABET[a >> 2]! + ALPHABET[((a & 3) << 4) | ((b ?? 0) >> 4)]!;
    out += b == null ? '=' : ALPHABET[((b & 15) << 2) | ((c ?? 0) >> 6)]!;
    out += c == null ? '=' : ALPHABET[c & 63]!;
  }
  return (out.match(/.{1,76}/g) ?? ['']).join('\n') + '\n';
}

/** Base64.decode(text, DEFAULT): line breaks and padding are ignored. */
export function base64Decode(text: string): string {
  const clean = text.replace(/[^A-Za-z0-9+/]/g, '');
  const bytes: number[] = [];
  for (let i = 0; i < clean.length; i += 4) {
    const n = [0, 1, 2, 3].map(j => (i + j < clean.length ? ALPHABET.indexOf(clean[i + j]!) : -1));
    bytes.push((n[0]! << 2) | (n[1]! >> 4));
    if (n[2]! >= 0) bytes.push(((n[1]! & 15) << 4) | (n[2]! >> 2));
    if (n[3]! >= 0) bytes.push(((n[2]! & 3) << 6) | n[3]!);
  }
  return utf8Decode(new Uint8Array(bytes));
}
