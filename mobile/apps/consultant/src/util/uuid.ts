import { zedDevice } from '@zed/shared';

/** UUID.randomUUID().toString() (PhotoInformation ids, product and raw-material row ids). */
export function randomUuid(): string {
  const h = zedDevice().randomHex(16).split('');
  h[12] = '4';
  h[16] = ((parseInt(h[16]!, 16) & 0x3) | 0x8).toString(16);
  const s = h.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}
