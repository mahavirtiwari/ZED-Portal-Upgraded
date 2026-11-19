// node --test tools/   (npm run test:texts; also before npm test)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { CATALOGUE, buildCatalogue, extractAll, extractFromSource, kindOf, placeholdersOf } from './extract-texts.mjs';

test('the committed catalogue is up to date (run "npm run texts" and commit it)', () => {
  const { text, problems } = extractAll();
  assert.deepEqual(problems, []);
  assert.equal(readFileSync(CATALOGUE, 'utf8').replace(/\r\n/g, '\n'), text);
});

test('reads the pipe in text, in bindings and in inline templates, and t() in code', () => {
  const html = [
    `<h3>{{ 'Assessment Agencies' | t: 'staff.agencies.title' }}</h3>`,
    `<input [placeholder]="'Search ID, name' | t: 'staff.agencies.search' " />`,
    `<p>{{ 'Showing {from} to {to}' | t: 'staff.agencies.showing' : { from: a, to: b } }}</p>`,
    `<button type="button">{{ "Don't save" | t: "staff.agencies.cancel" }}</button>`,
  ].join('\n');
  const a = extractFromSource('staff/users/agencies.html', html);
  assert.deepEqual(a.problems, []);
  assert.deepEqual(a.found.map((u) => [u.key, u.standard, u.kind, u.line]), [
    ['staff.agencies.title', 'Assessment Agencies', 'heading', 1],
    ['staff.agencies.search', 'Search ID, name', 'placeholder', 2],
    ['staff.agencies.showing', 'Showing {from} to {to}', 'note', 3],
    ['staff.agencies.cancel', "Don't save", 'button', 4],
  ]);

  const ts = [
    `import { TextPipe, t } from '../../content/page-text';`,
    '@Component({ template: `<h2>{{ \'My Incentives\' | t: \'msme.dashboard.incentives.title\' }}</h2>` })',
    `class X { f() { this.toast.success(t('staff.agencies.toast.blocked', '{name} blocked', { name }), t("staff.agencies.toast.done", 'It\\'s done')); } }`,
  ].join('\n');
  const b = extractFromSource('x.ts', ts);
  assert.deepEqual(b.problems, []);
  assert.deepEqual(b.found.map((u) => [u.key, u.standard, u.kind]), [
    ['msme.dashboard.incentives.title', 'My Incentives', 'heading'],
    ['staff.agencies.toast.blocked', '{name} blocked', 'message'],
    ['staff.agencies.toast.done', "It's done", 'message'],
  ]);
});

test('reports a usage it cannot read', () => {
  const html = `<p>{{ label | t: 'staff.x.label' }}</p><p>{{ 'A' | t: key }}</p>`;
  assert.equal(extractFromSource('a.html', html).problems.length, 2);
  const ts = "import { t } from './content/page-text';\nconst a = t(key, 'A');\nconst b = t('staff.x.y', `Hi ${name}`);";
  assert.equal(extractFromSource('a.ts', ts).problems.length, 2);
  // A file that does not import t from page-text may have its own t().
  assert.deepEqual(extractFromSource('b.ts', 'const t = (k) => k; t(key);').problems, []);
});

test('one wording per key, keys shaped portal.page.name, no Texts (HTML) key', () => {
  const u = (key, standard, file = 'a.html') => ({ key, standard, kind: 'text', file, line: 1 });
  const ok = buildCatalogue([u('staff.agencies.title', 'Agencies'), u('staff.agencies.title', 'Agencies', 'b.html'), u('msme.dashboard.refresh', 'Refresh')]);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.texts.map((x) => [x.key, x.portal, x.page, x.pageName, x.files.join()]), [
    ['msme.dashboard.refresh', 'msme', 'dashboard', 'Dashboard', 'a.html'],
    ['staff.agencies.title', 'staff', 'agencies', 'Agencies', 'a.html,b.html'],
  ]);
  const bad = buildCatalogue([u('staff.agencies.title', 'Agencies'), u('staff.agencies.title', 'Agency list'), u('Agencies', 'x'),
    u('staff.users.agencyLevel.disableNote', 'x')], new Set(['staff.users.agencylevel.disablenote']));
  assert.equal(bad.problems.length, 3);
});

test('kinds and values', () => {
  assert.equal(kindOf('staff.agencies.subtitle', null, 0), 'note');
  assert.equal(kindOf('staff.agencies.searchPlaceholder', null, 0), 'placeholder');
  assert.equal(kindOf('staff.agencies.chip.active', null, 0), 'label');
  assert.equal(kindOf('staff.agencies.blocked', null, 0), 'text');
  assert.equal(kindOf('staff.agencies.toast.blocked', null, 0), 'message');
  const tpl = `<zed-page-head [title]="'X' | t: 'a.b.c'" /><button [attr.aria-label]="'Y' | t: 'a.b.d'"></button><th>{{ 'Z' | t: 'a.b.e' }}</th>`;
  assert.equal(kindOf('a.b.c', tpl, tpl.indexOf("'X'")), 'heading');
  assert.equal(kindOf('a.b.d', tpl, tpl.indexOf("'Y'")), 'tooltip');
  assert.equal(kindOf('a.b.e', tpl, tpl.indexOf("'Z'")), 'label');
  assert.deepEqual(placeholdersOf('Showing {from} to {to} of {total} ({to})'), ['from', 'to', 'total']);
});
