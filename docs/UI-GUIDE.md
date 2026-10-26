# V4 page design guide (staff and MSME pages)

The pages keep the old screens' content and order; they are laid out with a few shared building blocks
(`frontend/projects/main/src/styles/_v4-skin.scss`). Reference page: `staff/masters/technologies.ts`.

## Frame
- The staff and MSME layouts give every page the menu bar's width and a light tinted background
  (`.staff-content`); a page does not add its own outer `container`, `row justify-content-center` or `col-sm-10` wrapper
  any more (they are neutralised, but new markup should not use them).
- The menu bar shows the role and the portal; the page's own heading names the page.

## Building blocks
| Block | Markup | Use |
|---|---|---|
| Page head | `<div class="page-head"><div><h3 class="registration-title">Title</h3><p class="page-sub">One line on what the page is for.</p></div><div class="page-actions">buttons</div></div>` | Every page starts with it. Actions (Add, Back, Export) go right, not in a separate row. |
| Card | `<div class="zed-card">` (optional `<h4>` title) | Forms, filter panels, summaries. Replaces `jumbotron`, grey `panel` boxes. |
| Filters | `<div class="filter-bar"><div class="filter"><label class="form-label">State</label><select class="form-select">…</select></div>…</div>` | All list filters in one wrapping row, inside a `zed-card` when there are several. `filter wide` for a search box. |
| Form | `<div class="form-grid"><label for=x>Name<span class="req">*</span></label><input id=x class="form-control">…</div>` then `<div class="form-actions">` | Label/field pairs in two columns (one on phones). No fixed pixel widths on inputs. |
| Table | `<div class="table-responsive"><table class="table table-zed table-bordered">` | Header row in `thead`; no `bg-white`, no inline widths except narrow fixed columns (code, status, actions). |
| Chips | `<span class="zed-chip">` | Lists inside a cell (sectors, categories, sub-roles). |
| Status | `<span class="status-badge is-active">Active</span>` (`is-inactive`, `is-pending`, `is-rejected`, `is-info`, `is-success`) | Any status / yes-no column instead of plain text or a coloured button. |
| Row actions | `<div class="row-actions">` with `btn btn-outline-primary` (Edit, View), `btn btn-outline-danger` (Delete, Deactivate, Block, Reject), `btn btn-primary` (the one main action) | Buttons side by side, small, not stacked with `<br>`. |
| Long text | `<div class="clamp-3" [title]="text">` + a `more`/`less` link | Descriptions, remarks in tables. |
| Pager | `ClientPager` / `ServerPager` + `<zed-pager>` | Every list longer than a page; a search box (`filter wide`) when the old page had one or the list is long. |

## Rules
- Colours mean something: teal = normal action, red outline = destructive, solid red only for a final destructive
  confirmation. Never a red Edit or a teal Delete.
- Labels in sentence or title case as the old page had them; buttons may keep the old wording (SAVE, BACK) but not
  ALL CAPS for new ones.
- No inline `style="width: …px"` on inputs or buttons; no `<br><br>` for spacing.
- Table alignment (asked by the user): short columns are centred, header and cells (`class="text-center"`): S.No, codes,
  ZED ID, numbers and amounts, dates, levels, status badges, and the Actions column (`row-actions justify-content-center`).
  Names of short entities (parameter, sector) may be centred too; long text (descriptions, remarks, addresses) stays left.
- Empty lists keep the `no-data` row ("No Data" or a sentence).
- Keep every existing behaviour, field, validation message and API call; this is layout only.
