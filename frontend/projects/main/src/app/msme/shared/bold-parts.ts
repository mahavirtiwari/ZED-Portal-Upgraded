/**
 * A sentence of page wording with one value shown in bold ("Your payment towards <strong>{milestone}</strong> is successful."):
 * the sentence comes whole from t() with the value as a marker, and is cut around it, so the Admin can reword it (and move or
 * leave out the value) without the page building it from pieces. Template:
 *   @let p = line(); {{ p.before }}<strong>{{ p.bold }}</strong>{{ p.after }}
 */
export interface BoldParts {
  before: string;
  bold: string;
  after: string;
}

/** The marker to pass as the bold value's {value} to t(). */
export const BOLD = '\u0000';

/** <paramref name="text"/> (from t() with BOLD as the value) cut around the marker; the bold part is <paramref name="bold"/>. */
export function boldParts(text: string, bold: string): BoldParts {
  const i = text.indexOf(BOLD);
  return i < 0 ? { before: text, bold: '', after: '' } : { before: text.slice(0, i), bold, after: text.slice(i + BOLD.length).split(BOLD).join('') };
}
