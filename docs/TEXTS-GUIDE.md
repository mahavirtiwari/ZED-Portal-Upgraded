# Page wording the Admin can change — conversion guide

Decision 2026-11-19 ("All page wording"): every heading, sub-line, help note, card title, empty-state message, notice,
button label, field label, placeholder, tooltip and toast of the applicant (MSME) and staff pages can be changed by the
Admin in **Administration → Texts → Page wording**, grouped by portal and page, with "Reset to standard".

The standard wording is written **once, in the page**. A build step collects it into a catalogue; only the Admin's changed
wording is stored and sent to the browser. Pilot pages: `msme/dashboard/*` and `staff/users/agencies.*` — copy them.

## The three tools

| Where the wording is | Write | Example |
|---|---|---|
| Template text | the `t` pipe | `{{ 'My Certifications' \| t: 'msme.dashboard.certifications.title' }}` |
| Template attribute / component input | the `t` pipe in a binding | `[placeholder]="'Search agencies' \| t: 'staff.agencies.search.placeholder'"` |
| With values | pipe arguments | `{{ 'Showing {from} to {to}' \| t: 'staff.x.showing' : { from: a, to: b } }}` |
| TypeScript (toasts, dialogs, chips, columns, crumbs, computed titles) | `t(key, standard, values?)` | `t('staff.agencies.toast.blocked', '{name} blocked', { name })` |
| HTML texts (disclaimers, pledges, instructions with lists/links) | keep `<zed-text key=…>` | Admin → Texts (Website tab), `ContentCatalogue*.cs` |

```ts
import { TextPipe, t } from '../../content/page-text';   // add TextPipe to the component's imports
```

* The pipe is memoised (declared impure only so it updates when the Admin's wording arrives); `t()` reads a signal, so a
  `computed()` or template using it updates too. No request per text: the wording comes in the one `api/content` call
  made at app start (`ContentService.preload()`, 304 with ETag afterwards).
* A **class field** evaluated once (`readonly title = 'X'`) must become a `computed(() => t(...))` (or a method / getter)
  — otherwise it keeps the standard wording if the Admin's arrives after the page was created. Same for arrays of chips,
  columns, menu items: build them in a `computed` or a method.
* In specs the Admin's wording is never loaded, so pages show the standard wording and existing specs keep working. To
  test a change: `setPageTexts([{ key, enabled: true, html: 'New wording' }])` and `setPageTexts([])` in `finally`.

## Keys

`<portal>.<page>.<element>[.<detail>]` — letters and digits, segments joined by dots, lower camel case.

* **portal**: `msme` (applicant pages, main build only), `staff` (all staff pages, every build), `public` (public pages,
  login, verify), `common` (shared widgets: pager, confirm dialog, menus — `common.pager.showing`).
* **page**: one word per page, as the Admin would name it: `dashboard`, `agencies`, `assessorForm`, `payment`. The Admin
  page groups by it ("Assessor form"). A page's sub-components use the page's name with a part:
  `msme.dashboard.levelCard.applyButton`. A flow that feels like its own page gets its own: `msme.apply.*`.
* **end the key with what it is** — the extractor reads the kind from it, and the Admin filters by kind:
  `…title` / `…heading` (heading), `…sub` / `…note` / `…text` / `…empty` / `…point1` (line), `…label` / `…column.x` /
  `…chip.x` / `…crumb.x` / `…filter.x` (label), `…button` / `…link` (button), `…placeholder`, `…aria` / `…tooltip`,
  `…toast.x` / `…error` / `…message` (message). Otherwise the template position decides (`<h3>`, `<button>`, `[placeholder]`).
* **One key, one wording.** The same words on two places of a page may share a key only if they must always stay the same
  (a column header and its mobile `data-label`). Different meanings get different keys even if the words match today.
* Never reuse an Admin → Texts (HTML) key; the extractor refuses it. Keys never change once shipped (the Admin's wording
  is stored by key) — rename only before a release.

## Values, plurals, sentences

* Values are `{name}` (single braces; the HTML texts use `{{Field}}`). The Admin can move them or leave them out, not add
  unknown ones (the API refuses those). Pass every value the standard wording uses.
* **Never build a sentence from pieces** (`'Block ' + word`, `` `${n} ${people}` ``): write the whole sentence with values
  — `'Block {word}'`. Joining two full sentences is fine.
* **Plurals**: two keys, chosen in code — `n === 1 ? t('….visit', '{count} visit') : t('….visits', '{count} visits')`.
* Inside a ternary in a template, wrap each pipe: `cond ? ('On' | t: '….on') : ('Off' | t: '….off')`.
* Key and standard wording must be **string literals** (no variables, no `${}`); the extractor fails otherwise.
* Write `&` and quotes plainly inside the literal (`'Accept & proceed →'`, `"Don't save"`), no HTML entities, no tags.
  The wording is shown as text, never as HTML.

## What not to convert

* **Data and codes**: names, IDs, statuses that come from the server (`a.IdStatus`, level names from Certification
  Levels), amounts, dates, e-mail addresses, enum values used in logic, CSS classes, routes, query values, file names.
* **Strings the code compares** (`r.label === 'Site visit'`): keep the code value and translate only what is shown (see
  `stepLabel()` in `dashboard.ts`, and the `id` of `LevelFact`).
* Wording the Admin already edits elsewhere: Admin → Texts HTML blocks (`<zed-text>`), incentive cards (Incentives),
  e-mail templates, level names/descriptions (Certification Levels), links (Links).
* Developer comments, console messages, log text.

## ARIA and attributes

* Convert `aria-label`, `title` (tooltip), `alt`, `placeholder` and the `label`/`title`/`subtitle` inputs of our
  components — screen readers read them: `[attr.aria-label]="'Close' | t: '….closeAria'"`.
* `aria-label` that repeats the visible text may share its key.
* Keep `aria-hidden` icons and decorative characters (`›`, `₹` icons) as they are.

## The catalogue (no manual upkeep)

```
cd frontend
npm run texts          # writes backend/src/Zed.Core/Content/PageTexts.json (also runs before npm run build)
npm run texts:check    # fails if it is out of date or a usage is wrong
npm run test:texts     # the extractor's tests, incl. "the committed catalogue is up to date" (also before npm test)
```

`tools/extract-texts.mjs` reads every `.html` and `.ts` of `projects/main/src/app` (no specs): the pipe in templates and
inline templates, and `t()` in files that import it from `content/page-text`. It writes each key once — standard wording,
`{values}`, portal/page from the key, kind, files — sorted, without dates. **Commit `PageTexts.json` with your page.** The
backend embeds it (Zed.Core), lists it to the Admin and checks the Admin's wording against it; `PageTextsTests` checks it.

Errors it reports: a key that is not `portal.page.name`, one key with two wordings, an HTML Texts key, a pipe or `t()` whose
key/wording is not a literal.

## Converting a page — checklist

1. `import { TextPipe, t }`, add `TextPipe` to `imports`.
2. Template: every visible text node, button, label, placeholder, tooltip, `aria-label`, empty state, loading text.
3. TypeScript: toasts, confirm dialogs (title, points, buttons, reason label/placeholder), chips, counts, menu items,
   crumbs, page titles/subtitles, column headers, error messages written in the page (server messages stay as they come).
4. Class fields → `computed`; code comparisons keep code values.
5. `npm run texts`, run **only the page's spec** (`npx ng test main --include=<path to spec>`), fix, commit the page,
   its spec and `PageTexts.json`.
6. Keep the component's styles under 8 kB (nothing in this guide adds style).

## Server side (for reference)

* Storage: `dbo.V4ContentBlocks` (where the Admin's Texts already are; migration 0016), by key, `BodyHtml` = the plain
  text, `Enabled` = 1. No row: the standard wording.
* `GET/PUT/DELETE api/staff/settings/page-texts[/{key}]` (Admin, per portal through the portal switch): PUT cleans the
  text (control characters, spaces), refuses HTML tags, unknown `{values}`, empty text and more than 300 characters
  (headings, labels, buttons, placeholders, tooltips) or 2000 (lines, messages, other); saving the standard wording resets.
* `GET api/content` adds the changed wording of the portal as `{ key, enabled: true, html: <plain text> }`, with an ETag
  (304 while nothing changed). A change shows on pages opened or reloaded within about a minute.
