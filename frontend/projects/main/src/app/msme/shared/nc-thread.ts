/**
 * The "Non-conformance conversation" of a requirement card in the NC rounds (global "zp-chat" styles,
 * styles/_zed-parameters.scss): the assessor's messages on the left (the remark that raised the NC, with the documents
 * it was raised on, and the verdict), the unit's replies on the right (comments, pictures and PDFs), oldest first.
 * Built by each page from the rows it already has; no API of its own.
 */
export type ThreadRow = Record<string, unknown>;

export interface ThreadFile {
  name: string;
  url: string;
  /** Tinted PDF chip (the document was opened). */
  opened?: boolean;
  /** The row to record as opened when clicked, where the page tracks it. */
  row?: ThreadRow;
}

export interface ThreadMessage {
  from: 'assessor' | 'msme';
  /** "NC1", "NC1 raised" … */
  round: string;
  date: string;
  text: string;
  /** The assessor's verdict (Yes / No / Partial), when the message carries one. */
  conformance: string;
  files: ThreadFile[];
  pictures: ThreadFile[];
}

const PICTURE = /\.(jpe?g|png|gif|webp|bmp)(\?|#|$)/i;

/** A file address that is a picture (shown as a thumbnail) rather than a PDF (shown as a chip). */
export function isPicture(url: string | null | undefined): boolean {
  return !!url && PICTURE.test(url);
}

/** Splits a message's files into pictures and PDFs; files without an address are left out. */
export function splitFiles(files: readonly ThreadFile[]): { files: ThreadFile[]; pictures: ThreadFile[] } {
  const withUrl = files.filter((f) => !!f.url);
  return { pictures: withUrl.filter((f) => isPicture(f.url)), files: withUrl.filter((f) => !isPicture(f.url)) };
}

export function message(from: ThreadMessage['from'], round: string, parts: Partial<Omit<ThreadMessage, 'from' | 'round'>> & { all?: ThreadFile[] }): ThreadMessage {
  const split = splitFiles(parts.all ?? []);
  return {
    from,
    round,
    date: parts.date ?? '',
    text: parts.text ?? '',
    conformance: parts.conformance ?? '',
    files: [...(parts.files ?? []), ...split.files],
    pictures: [...(parts.pictures ?? []), ...split.pictures],
  };
}

/** A message worth showing: it says something, carries a verdict or has files. */
export function hasContent(m: ThreadMessage): boolean {
  return !!(m.text || m.conformance || m.files.length || m.pictures.length);
}
