#!/usr/bin/env node
/**
 * The catalogue of the page wording the Admin can change (Administration → Texts → Page wording; docs/TEXTS-GUIDE.md).
 *
 * Reads every template and TypeScript file of projects/main/src/app (specs aside) for
 *   {{ 'Standard wording' | t: 'portal.page.key' }}      (also in [attr]="'…' | t: '…'" bindings and inline templates)
 *   t('portal.page.key', 'Standard wording', { values })  (in files that import t from content/page-text)
 * and writes backend/src/Zed.Core/Content/PageTexts.json: each key once, with its standard wording, its {values}, the
 * portal and page (from the key), its kind (heading, label, button, note, placeholder, tooltip, message, text: by the key's
 * last parts, e.g. ….title / ….saveButton / ….toast.saved, else by where it is in the template) and the files
 * that use it. The backend serves it to the Admin page and checks the Admin's wording against it.
 *
 *   node tools/extract-texts.mjs           writes the catalogue (npm run texts; also before npm run build)
 *   node tools/extract-texts.mjs --check   fails when the catalogue is out of date or a usage is wrong (npm run texts:check)
 *
 * Fails (exit 1) on a key with two different standard wordings, a key that is not portal.page.name, a key that is also a
 * Texts (HTML) key of Zed.Core/Content/ContentCatalogue*.cs, and a pipe or t() call whose key or wording is not a literal.
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const FRONTEND = resolve(here, '..');
export const APP_DIR = join(FRONTEND, 'projects', 'main', 'src', 'app');
export const CATALOGUE = resolve(FRONTEND, '..', 'backend', 'src', 'Zed.Core', 'Content', 'PageTexts.json');
const BLOCKS_DIR = resolve(FRONTEND, '..', 'backend', 'src', 'Zed.Core', 'Content');

export const PORTALS = { msme: 'MSME pages', staff: 'Staff pages', public: 'Public pages', common: 'Every page' };
export const KEY_PATTERN = /^(msme|staff|public|common)\.[a-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/;

// A quoted literal ('…' or "…", with \-escapes).
const LIT = String.raw`(['"])((?:\\.|(?!\1)[^\\\n])*)\1`;
/** 'Standard' | t: 'key' (the values after a second colon are not read). */
const PIPE = new RegExp(String.raw`${LIT}\s*\|\s*t\s*:\s*(['"])([^'"\n]*)\3`, 'g');
const ANY_PIPE = /\|\s*t\s*:/g;
/** t('key', 'Standard' …) — not obj.t( or a function named t declared in the file. */
const CALL = /(?<![\w$.])t\(\s*(['"`])([^'"`\n]*)\1\s*,\s*(['"`])((?:\\.|(?!\3)[^\\])*)\3/g;
const ANY_CALL = /(?<![\w$.])t\((?!\s*\))/g; // "t()" alone is a mention in a comment
const IMPORTS_T = /import\s*\{[^}]*\bt\b[^}]*\}\s*from\s*['"][^'"]*content\/page-text['"]/;

const unescape = (s) => s.replace(/\\(.)/g, (_, c) => ({ n: '\n', t: '\t' })[c] ?? c);
const lineOf = (src, index) => src.slice(0, index).split('\n').length;

/** The {values} a wording uses. */
export const placeholdersOf = (text) => [...new Set([...text.matchAll(/\{([A-Za-z][A-Za-z0-9_]*)\}/g)].map((m) => m[1]))];

/** "agencyLevels" → "Agency levels". */
export const humanise = (s) => {
  const w = s.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/[-_]/g, ' ').toLowerCase();
  return w.charAt(0).toUpperCase() + w.slice(1);
};

// ----- kind -----

const BY_NAME = [
  [/^(title|heading|head|header)$/, 'heading'],
  [/^(placeholder)$/, 'placeholder'],
  [/^(aria|tooltip|hint)$/, 'tooltip'],
  [/^(button|btn|action|link|cta)$/, 'button'],
  [/^(label|column|col|th|field|chip|chips|tab|option|count|counts|filter|menu|step|steps|fact|facts|status)$/, 'label'],
  [/^(crumb|crumbs)$/, 'label'],
  [/^(sub|subtitle|note|help|intro|lead|line|text|body|empty|none|point\d*|keys?)$/, 'note'],
  [/^(toast|error|success|message|confirm|warning|failed|saved)$/, 'message'],
];
const BY_ATTR = { placeholder: 'placeholder', 'aria-label': 'tooltip', title: 'tooltip', label: 'label', value: 'button', alt: 'tooltip' };
const BY_INPUT = { title: 'heading', subtitle: 'note', label: 'label', placeholder: 'placeholder', note: 'note' };
const BY_TAG = { h1: 'heading', h2: 'heading', h3: 'heading', h4: 'heading', h5: 'heading', h6: 'heading', legend: 'heading', caption: 'heading',
  button: 'button', a: 'button', label: 'label', th: 'label', dt: 'label', option: 'label', p: 'note', small: 'note', li: 'note' };
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

/** The element a template position is in (the innermost open tag before it). */
function enclosingTag(template, index) {
  const stack = [];
  const tag = /<(\/?)([A-Za-z][\w-]*)\b[^>]*?(\/?)>/g;
  let m;
  while ((m = tag.exec(template)) && m.index < index) {
    if (m.index + m[0].length > index) break; // inside this tag (an attribute)
    const name = m[2].toLowerCase();
    if (m[1]) {
      const at = stack.lastIndexOf(name);
      if (at >= 0) stack.length = at;
    } else if (!m[3] && !VOID.has(name)) stack.push(name);
  }
  return stack.at(-1) ?? null;
}

/** The kind of a usage: by the key's last part when it names one, else by where it is (the attribute, the element). */
export function kindOf(key, template, index) {
  // The parts after portal.page, last first: "staff.agencies.search.placeholder", "….searchPlaceholder", "….chip.active".
  for (const part of key.split('.').slice(2).reverse()) {
    const p = part.toLowerCase();
    const word = p.replace(/(?<=.)(title|heading|placeholder|button|label|note|toast|error|aria|tooltip)$/, ' $1').split(' ').at(-1);
    for (const [re, kind] of BY_NAME) if (re.test(p)) return kind;
    for (const [re, kind] of BY_NAME) if (re.test(word)) return kind;
  }
  if (template === null) return 'text';
  // [attr]="'…' | t: '…'" / [attr.aria-label]="…" / attr="{{ '…' | t: '…' }}"
  const before = template.slice(Math.max(0, index - 200), index);
  const attr = /(?:\[(?:attr\.)?([\w-]+)\]|\b([\w-]+))\s*=\s*"[^"]*$/.exec(before);
  const element = /<([A-Za-z][\w-]*)\b[^<>]*$/.exec(before);
  if (attr && element) {
    const name = (attr[1] ?? attr[2]).toLowerCase();
    const custom = element[1].includes('-');
    if (custom && BY_INPUT[name]) return BY_INPUT[name];
    if (!custom && BY_ATTR[name]) return BY_ATTR[name];
    return 'text';
  }
  const tag = enclosingTag(template, index);
  return (tag && BY_TAG[tag]) || 'text';
}

// ----- extraction -----

/** The inline templates of a component file (template: `…`), with where each starts; the whole file for .html. */
function templatesOf(file, src) {
  if (file.endsWith('.html')) return [{ text: src, start: 0 }];
  const out = [];
  const re = /\btemplate\s*:\s*`/g;
  let m;
  while ((m = re.exec(src))) {
    const start = m.index + m[0].length;
    let end = start;
    while (end < src.length && !(src[end] === '`' && src[end - 1] !== '\\')) end++;
    out.push({ text: src.slice(start, end), start });
    re.lastIndex = end + 1;
  }
  return out;
}

/**
 * The usages of one file: [{ key, standard, kind, file, line }], and the problems found ("file:line: …").
 * <paramref name="file"/> is the path shown (relative to the app folder).
 */
export function extractFromSource(file, src) {
  const found = [];
  const problems = [];
  for (const { text, start } of templatesOf(file, src)) {
    const ok = new Set();
    for (const m of text.matchAll(PIPE)) {
      const pipeAt = m.index + m[0].search(/\|\s*t\s*:/);
      ok.add(pipeAt);
      const key = m[4];
      found.push({ key, standard: unescape(m[2]), kind: kindOf(key, text, m.index), file, line: lineOf(src, start + m.index) });
    }
    for (const m of text.matchAll(ANY_PIPE)) {
      if (!ok.has(m.index)) problems.push(`${file}:${lineOf(src, start + m.index)}: the t pipe needs a quoted standard wording before it and a quoted key after it`);
    }
  }
  if (file.endsWith('.ts') && IMPORTS_T.test(src)) {
    const ok = new Set();
    for (const m of src.matchAll(CALL)) {
      ok.add(m.index);
      const key = m[2];
      const standard = m[4];
      if (m[3] === '`' && standard.includes('${')) {
        problems.push(`${file}:${lineOf(src, m.index)}: t('${key}', …) — use {values}, not \${…}, in the standard wording`);
        continue;
      }
      found.push({ key, standard: unescape(standard), kind: kindOf(key, null, 0), file, line: lineOf(src, m.index) });
    }
    for (const m of src.matchAll(ANY_CALL)) {
      if (!ok.has(m.index)) problems.push(`${file}:${lineOf(src, m.index)}: t() needs a quoted key and a quoted standard wording (no variables)`);
    }
  }
  return { found, problems };
}

/** The keys of Admin → Texts (HTML texts) in ContentCatalogue*.cs: a page wording key must not be one of them. */
export function blockKeys(dir = BLOCKS_DIR) {
  const keys = new Set();
  if (!existsSync(dir)) return keys;
  for (const f of readdirSync(dir).filter((f) => /^ContentCatalogue.*\.cs$/.test(f))) {
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/\b(?:Web|App)\(\s*"([^"]+)"/g)) keys.add(m[1].toLowerCase());
  }
  return keys;
}

/** Merges the usages into the catalogue (sorted by key) and adds the problems of the whole set. */
export function buildCatalogue(usages, blocks = new Set()) {
  const byKey = new Map();
  const problems = [];
  for (const u of usages) {
    if (!KEY_PATTERN.test(u.key)) {
      problems.push(`${u.file}:${u.line}: "${u.key}" is not a key: portal.page.name, portal one of ${Object.keys(PORTALS).join(', ')} (docs/TEXTS-GUIDE.md)`);
      continue;
    }
    if (blocks.has(u.key.toLowerCase())) problems.push(`${u.file}:${u.line}: "${u.key}" is already a key of Admin → Texts (ContentCatalogue); choose another`);
    if (!u.standard.trim()) problems.push(`${u.file}:${u.line}: "${u.key}" has no standard wording`);
    const had = byKey.get(u.key);
    if (!had) {
      byKey.set(u.key, { ...u, files: new Set([u.file]), at: `${u.file}:${u.line}` });
    } else if (had.standard !== u.standard) {
      problems.push(`${u.file}:${u.line}: "${u.key}" has another standard wording at ${had.at} ("${had.standard}" / "${u.standard}"); one key, one wording`);
    } else {
      had.files.add(u.file);
      // The first usage names the kind, unless it is only "text".
      if (had.kind === 'text' && u.kind !== 'text') had.kind = u.kind;
    }
  }
  const texts = [...byKey.values()]
    .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
    .map((u) => {
      const [portal, page] = u.key.split('.');
      return { key: u.key, standard: u.standard, kind: u.kind, portal, page, pageName: humanise(page), placeholders: placeholdersOf(u.standard), files: [...u.files].sort() };
    });
  return { texts, problems };
}

/** Every .html / .ts file of the app (specs aside), sorted. */
export function sourceFiles(dir = APP_DIR) {
  const out = [];
  const walk = (d) => {
    for (const name of readdirSync(d).sort()) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(html|ts)$/.test(name) && !name.endsWith('.spec.ts') && !name.endsWith('.d.ts')) out.push(p);
    }
  };
  walk(dir);
  return out;
}

/** The catalogue file's text (stable: no dates, sorted, LF). */
export function serialise(texts) {
  const head = { about: 'Page wording the Admin can change (Administration → Texts → Page wording). Written by frontend/tools/extract-texts.mjs (npm run texts): do not edit by hand.' };
  return JSON.stringify({ ...head, count: texts.length, texts }, null, 2) + '\n';
}

/** Reads the app and returns { text, problems, count } of the catalogue. */
export function extractAll(dir = APP_DIR) {
  const usages = [];
  const problems = [];
  for (const f of sourceFiles(dir)) {
    const r = extractFromSource(relative(dir, f).split(sep).join('/'), readFileSync(f, 'utf8'));
    usages.push(...r.found);
    problems.push(...r.problems);
  }
  const c = buildCatalogue(usages, blockKeys());
  return { text: serialise(c.texts), problems: [...problems, ...c.problems], count: c.texts.length };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const check = process.argv.includes('--check');
  const { text, problems, count } = extractAll();
  for (const p of problems) console.error(`extract-texts: ${p}`);
  if (problems.length) process.exit(1);
  const current = existsSync(CATALOGUE) ? readFileSync(CATALOGUE, 'utf8').replace(/\r\n/g, '\n') : '';
  if (check) {
    if (current !== text) {
      console.error(`extract-texts: ${relative(process.cwd(), CATALOGUE)} is out of date: run "npm run texts" and commit it.`);
      process.exit(1);
    }
    console.log(`extract-texts: the catalogue is up to date (${count} texts).`);
  } else if (current !== text) {
    writeFileSync(CATALOGUE, text, 'utf8');
    console.log(`extract-texts: wrote ${count} texts to ${relative(process.cwd(), CATALOGUE)}.`);
  } else {
    console.log(`extract-texts: the catalogue is up to date (${count} texts).`);
  }
}
