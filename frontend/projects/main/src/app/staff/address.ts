/**
 * 2026-11-21 (UI audit W8): an address as stored (Udyam's "Flat/Door/Block No: 12, Name of Premises/Building: , Block:- , …",
 * or parts joined by the procedures) without its empty parts: a part that is blank, only a dash, or a label with no value
 * ("Block:- ", "Road/Street/Lane: ") is left out; the other parts keep their order, joined by ", ".
 */
export function cleanAddress(value: unknown): string {
  const s = value === null || value === undefined ? '' : String(value);
  return s
    .split(',')
    .map((p) => p.replace(/\s+/g, ' ').trim())
    .filter((p) => p && !/^[-–.\s]+$/.test(p) && !/^[^:]{1,60}:[\s\-–.]*$/.test(p))
    .join(', ');
}

/** Address parts (fields of a row) joined by ", ", each cleaned and the empty ones left out. */
export function joinAddress(...parts: unknown[]): string {
  return parts.map(cleanAddress).filter(Boolean).join(', ');
}
