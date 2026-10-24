import React from 'react';
import { Linking, StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import { colors } from '../theme';

/**
 * The simple HTML of the Admin texts (`<p>`, `<br>`, `<ol>`/`<ul>`/`<li>`, `<b>`, `<i>`, `<u>`, `<a href>`), shown as
 * Html.fromHtml showed it in the legacy apps. Other tags are dropped, their text kept. Text without any tag is
 * plain text: its line breaks are kept.
 */
export type HtmlRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; href?: string };
export type HtmlBlock = { runs: HtmlRun[]; marker?: string; indent: number };

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', rupee: '₹' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

export function hasHtmlTags(s: string): boolean {
  return /<\/?[a-z][^>]*>/i.test(s);
}

export function parseSimpleHtml(html: string): HtmlBlock[] {
  if (!hasHtmlTags(html)) {
    const text = decodeEntities(html).trim();
    return text ? [{ runs: [{ text }], indent: 0 }] : [];
  }
  const blocks: HtmlBlock[] = [];
  const lists: Array<{ ordered: boolean; n: number }> = [];
  const hrefs: string[] = [];
  let bold = 0;
  let italic = 0;
  let underline = 0;
  let current: HtmlBlock = { runs: [], indent: 0 };

  const flush = () => {
    // Trim the block's edges (HTML collapses them).
    const runs = current.runs;
    while (runs.length && runs[0]!.text.trim() === '' && runs[0]!.text !== '\n') runs.shift();
    if (runs.length) runs[0] = { ...runs[0]!, text: runs[0]!.text.replace(/^ +/, '') };
    while (runs.length && runs[runs.length - 1]!.text.trim() === '' && runs[runs.length - 1]!.text !== '\n') runs.pop();
    if (runs.length) runs[runs.length - 1] = { ...runs[runs.length - 1]!, text: runs[runs.length - 1]!.text.replace(/ +$/, '') };
    if (runs.length || current.marker) blocks.push(current);
    current = { runs: [], indent: lists.length };
  };
  const add = (text: string) => {
    if (!text) return;
    current.runs.push({
      text,
      ...(bold ? { bold: true } : {}),
      ...(italic ? { italic: true } : {}),
      ...(underline ? { underline: true } : {}),
      ...(hrefs.length ? { href: hrefs[hrefs.length - 1] } : {}),
    });
  };

  const re = /<(\/?)([a-zA-Z0-9]+)([^>]*)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    if (m[4] != null) {
      const text = decodeEntities(m[4].replace(/\s+/g, ' '));
      // A space right after a line break or at the start of a block is not shown.
      const last = current.runs[current.runs.length - 1];
      add(!last || last.text.endsWith('\n') || last.text.endsWith(' ') ? text.replace(/^ /, '') : text);
      continue;
    }
    const closing = m[1] === '/';
    const tag = m[2]!.toLowerCase();
    switch (tag) {
      case 'p':
      case 'div':
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
        flush();
        if (tag[0] === 'h') bold += closing ? -1 : 1;
        break;
      case 'br':
        add('\n');
        break;
      case 'ul':
      case 'ol':
        flush();
        if (closing) lists.pop();
        else lists.push({ ordered: tag === 'ol', n: 0 });
        current.indent = lists.length;
        break;
      case 'li':
        flush();
        if (!closing) {
          const list = lists[lists.length - 1];
          if (list) {
            list.n++;
            current.marker = list.ordered ? `${list.n}.` : '•';
          } else current.marker = '•';
          current.indent = Math.max(1, lists.length);
        }
        break;
      case 'b':
      case 'strong':
        bold = Math.max(0, bold + (closing ? -1 : 1));
        break;
      case 'i':
      case 'em':
        italic = Math.max(0, italic + (closing ? -1 : 1));
        break;
      case 'u':
        underline = Math.max(0, underline + (closing ? -1 : 1));
        break;
      case 'a':
        if (closing) hrefs.pop();
        else hrefs.push(/href\s*=\s*["']([^"']*)["']/i.exec(m[3] ?? '')?.[1] ?? '');
        break;
      default:
        break;
    }
  }
  flush();
  return blocks;
}

/** The text without markup, for alerts, toasts and check box labels. */
export function htmlToPlain(html: string): string {
  return parseSimpleHtml(html)
    .map(b => (b.marker ? `${b.marker} ` : '') + b.runs.map(r => r.text).join(''))
    .join('\n');
}

type Props = { html: string; style?: StyleProp<TextStyle>; paragraphGap?: number; testID?: string };

export function HtmlText({ html, style, paragraphGap = 8, testID }: Props) {
  const blocks = parseSimpleHtml(html);
  return (
    <View testID={testID}>
      {blocks.map((b, i) => (
        <View key={i} style={[styles.block, { marginTop: i === 0 ? 0 : paragraphGap, paddingLeft: Math.max(0, b.indent - 1) * 16 }]}>
          {b.marker ? <Text style={[styles.text, style, styles.marker]}>{b.marker}</Text> : null}
          <Text style={[styles.text, style, styles.flex]}>
            {b.runs.map((r, j) => (
              <Text
                key={j}
                style={[r.bold && styles.bold, r.italic && styles.italic, (r.underline || r.href) && styles.underline, r.href ? styles.link : null]}
                onPress={r.href ? () => Linking.openURL(r.href!).catch(() => undefined) : undefined}>
                {r.text}
              </Text>
            ))}
          </Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  block: { flexDirection: 'row' },
  text: { color: colors.textColor, fontSize: 15 },
  flex: { flex: 1 },
  marker: { marginRight: 6, minWidth: 18 },
  bold: { fontWeight: 'bold' },
  italic: { fontStyle: 'italic' },
  underline: { textDecorationLine: 'underline' },
  link: { color: colors.appColorDark },
});
