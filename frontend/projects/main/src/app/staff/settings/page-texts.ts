import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { ConfirmAsk, ConfirmDialog } from '../confirm-dialog';
import { IndianTimePipe } from '../utc-time';

/** A page wording as the API lists it (api/staff/settings/page-texts). */
export interface PageTextItem {
  key: string;
  /** msme, staff, public or common. */
  portal: string;
  page: string;
  pageName: string;
  kind: string;
  standard: string;
  /** The Admin's wording; null: the standard wording shows. */
  text: string | null;
  placeholders: string[];
  maxLength: number;
  updatedBy: string | null;
  /** UTC (shown in Indian time). */
  updatedOn: string | null;
}

interface Group {
  id: string;
  portal: string;
  pageName: string;
  rows: PageTextItem[];
  total: number;
  changed: number;
}

interface Editing {
  key: string;
  text: string;
  error: string;
}

/** Rows drawn at most while searching (each page group draws all of its own when opened). */
const SEARCH_LIMIT = 300;

/**
 * Administration → Texts → Page wording (2026-11-19, the user: "All page wording"): every heading, line, button, label,
 * placeholder, empty-state and message of the portal chosen above (the catalogue the build writes, so every wording is
 * listed before anyone changes one), grouped by portal and page, with search, a kind filter and "changed only". A wording
 * is edited in its row as plain text (its {values} as chips that go in at the cursor); Reset (confirmed) shows the
 * standard wording again. The Texts page holds it in its "Page wording" tab and calls reload() when the portal changes.
 */
@Component({
  selector: 'zed-page-texts',
  imports: [IndianTimePipe, FormsModule, ConfirmDialog, TextPipe],
  template: `
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (success()) { <div class="alert alert-success" role="status">{{ success() }}</div> }
    <div class="pt-bar">
      <input type="search" class="form-control pt-search" [placeholder]="'Search wording, page or key' | t: 'staff.pageTexts.search.placeholder'"
             [attr.aria-label]="'Search page wording' | t: 'staff.pageTexts.search.aria'" [ngModel]="search()" (ngModelChange)="search.set($event)" />
      <select class="form-select" [attr.aria-label]="'Portal' | t: 'staff.pageTexts.filter.portal'" [ngModel]="portal()" (ngModelChange)="portal.set($event)">
        <option value="">{{ 'All pages' | t: 'staff.pageTexts.filter.allPages' }}</option>
        @for (p of portals; track p.key) { <option [value]="p.key">{{ p.label() }}</option> }
      </select>
      <select class="form-select" [attr.aria-label]="'Kind' | t: 'staff.pageTexts.filter.kind'" [ngModel]="kind()" (ngModelChange)="kind.set($event)">
        <option value="">{{ 'All kinds' | t: 'staff.pageTexts.filter.allKinds' }}</option>
        @for (k of kinds; track k.key) { <option [value]="k.key">{{ k.label() }}</option> }
      </select>
      <label class="pt-changed"><input type="checkbox" [ngModel]="changedOnly()" (ngModelChange)="changedOnly.set($event)" />
        {{ 'Changed only' | t: 'staff.pageTexts.filter.changedOnly' }}</label>
      <span class="pt-count">{{ '{count} wordings · {changed} changed' | t: 'staff.pageTexts.count' : { count: items().length, changed: changedCount() } }}</span>
    </div>

    @for (g of groups(); track g.id) {
      <section class="zed-card pt-group">
        <button type="button" class="pt-head" [attr.aria-expanded]="isOpen(g)" (click)="toggle(g)">
          <span class="pt-arrow" [class.open]="isOpen(g)" aria-hidden="true">›</span>
          <span class="pt-portal">{{ portalName(g.portal) }}</span>
          <strong>{{ g.pageName }}</strong>
          <small>{{ '{count} wordings' | t: 'staff.pageTexts.group.count' : { count: g.total } }}@if (g.changed) { · {{ '{changed} changed' | t: 'staff.pageTexts.group.changed' : { changed: g.changed } }} }</small>
        </button>
        @if (isOpen(g)) {
          <ul class="pt-rows">
            @for (r of g.rows; track r.key) {
              <li class="pt-row" [class.is-changed]="!!r.text">
                <div class="pt-meta"><span class="pt-kind">{{ kindName(r.kind) }}</span><code>{{ r.key }}</code></div>
                @if (editing()?.key === r.key) {
                  @let e = editing()!;
                  <div class="pt-edit">
                    <textarea class="form-control" [rows]="r.maxLength > 300 ? 3 : 2" [attr.maxlength]="r.maxLength" [id]="'pt-' + r.key"
                              [attr.aria-label]="'Wording' | t: 'staff.pageTexts.edit.aria'" [ngModel]="e.text" (ngModelChange)="setText($event)"></textarea>
                    @if (r.placeholders.length) {
                      <div class="pt-chips">
                        <small>{{ 'Values filled in by the page:' | t: 'staff.pageTexts.edit.values' }}</small>
                        @for (p of r.placeholders; track p) {
                          <button type="button" class="pt-chip" (mousedown)="$event.preventDefault()" (click)="insert(r, p)">{{ braces(p) }}</button>
                        }
                      </div>
                    }
                    <small class="pt-std">{{ 'Standard: {text}' | t: 'staff.pageTexts.edit.standard' : { text: r.standard } }}</small>
                    @if (e.error) { <div class="text-danger small" role="alert">{{ e.error }}</div> }
                    <div class="pt-actions">
                      <button type="button" class="btn btn-primary btn-sm" [disabled]="busy()" (click)="save(r)">{{ 'Save' | t: 'staff.pageTexts.edit.saveButton' }}</button>
                      <button type="button" class="btn btn-default btn-sm" (click)="editing.set(null)">{{ 'Cancel' | t: 'staff.pageTexts.edit.cancelButton' }}</button>
                      <small class="pt-len">{{ e.text.length }} / {{ r.maxLength }}</small>
                    </div>
                  </div>
                } @else {
                  <p class="pt-text">{{ r.text ?? r.standard }}</p>
                  @if (r.text) {
                    <small class="pt-std">{{ 'Standard: {text}' | t: 'staff.pageTexts.edit.standard' : { text: r.standard } }}</small>
                    <small class="pt-std">{{ 'Changed by {user} on {date}' | t: 'staff.pageTexts.row.changedBy' : { user: r.updatedBy ?? '', date: (r.updatedOn | indianTime) } }}</small>
                  }
                  <div class="pt-actions">
                    <button type="button" class="btn btn-outline-primary btn-sm" (click)="edit(r)">{{ 'Edit' | t: 'staff.pageTexts.row.editButton' }}</button>
                    @if (r.text) { <button type="button" class="btn btn-outline-danger btn-sm" (click)="askReset(r)">{{ 'Reset to standard' | t: 'staff.pageTexts.row.resetButton' }}</button> }
                  </div>
                }
              </li>
            }
          </ul>
        }
      </section>
    } @empty {
      @if (!busy()) { <div class="zed-card no-data">{{ 'No page wording found' | t: 'staff.pageTexts.empty' }}</div> }
    }
    @if (truncated()) { <p class="pt-more">{{ 'The first {count} matches are shown. Refine the search to see the rest.' | t: 'staff.pageTexts.more' : { count: limit } }}</p> }

    @if (resetting(); as r) {
      <zed-confirm-dialog [ask]="resetAsk(r)" [busy]="busy()" [failed]="resetError()" (confirmed)="reset(r)" (cancel)="resetting.set(null)" />
    }
  `,
  styles: `
    .pt-bar { display: flex; flex-wrap: wrap; gap: 10px 14px; align-items: center; margin-bottom: 14px; }
    .pt-search { flex: 1 1 260px; max-width: 420px; }
    .pt-bar .form-select { width: auto; min-width: 150px; }
    .pt-changed { display: inline-flex; gap: 6px; align-items: center; margin: 0; font-weight: 600; text-transform: none; }
    .pt-count { margin-left: auto; font-size: 13px; color: #5f6f70; }
    .pt-group { padding: 0; margin-bottom: 10px; overflow: hidden; }
    .pt-head { display: flex; width: 100%; gap: 10px; align-items: baseline; padding: 12px 16px; border: 0; background: #fff; text-align: left; cursor: pointer; }
    .pt-head:hover { background: var(--zt-pale, #f7fbfb); }
    .pt-head strong { color: #17373b; }
    .pt-head small { margin-left: auto; color: #6f8487; }
    .pt-arrow { display: inline-block; width: 12px; transition: transform .15s; color: #6f8487; }
    .pt-arrow.open { transform: rotate(90deg); }
    .pt-portal { font-size: 11px; font-weight: 700; letter-spacing: .4px; text-transform: uppercase; color: var(--zt-mid2, #2f7c83); }
    .pt-rows { list-style: none; margin: 0; padding: 0; border-top: 1px solid #dfe9ea; }
    .pt-row { padding: 10px 16px; border-bottom: 1px solid #eef3f3; }
    .pt-row:last-child { border-bottom: 0; }
    .pt-row.is-changed { background: #fbfaf2; }
    .pt-meta { display: flex; gap: 8px; align-items: center; margin-bottom: 4px; }
    .pt-meta code { font-size: 11px; color: #6f8487; overflow-wrap: break-word; }
    .pt-kind { font-size: 11px; font-weight: 700; padding: 1px 8px; border-radius: 10px; background: #e6f2f3; color: #24666b; white-space: nowrap; }
    .pt-text { margin: 0 0 4px; color: #17373b; white-space: pre-line; overflow-wrap: break-word; }
    .pt-std { display: block; color: #6f8487; overflow-wrap: break-word; white-space: pre-line; }
    .pt-actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 6px; }
    .pt-len { margin-left: auto; color: #6f8487; }
    .pt-edit textarea { resize: vertical; }
    .pt-chips { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin: 6px 0; }
    .pt-chip { padding: 1px 9px; border: 1px solid #cfe3e5; border-radius: 12px; background: #eef6f6; color: #23474a; font: 600 12px/1.5 Consolas, monospace; cursor: pointer; }
    .pt-chip:hover { border-color: #45a5ad; }
    .pt-more { color: #6f8487; font-size: 13px; }
    @media (max-width: 767.98px) { .pt-count { margin-left: 0; flex-basis: 100%; } .pt-head { flex-wrap: wrap; } .pt-head small { margin-left: 22px; flex-basis: 100%; } }
  `,
})
export class PageTextsPanel {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/page-texts';

  protected readonly limit = SEARCH_LIMIT;
  protected readonly portals = [
    { key: 'msme', label: () => t('staff.pageTexts.portal.msme', 'MSME pages') },
    { key: 'staff', label: () => t('staff.pageTexts.portal.staff', 'Staff pages') },
    { key: 'public', label: () => t('staff.pageTexts.portal.public', 'Public pages') },
    { key: 'common', label: () => t('staff.pageTexts.portal.common', 'Every page') },
  ];
  protected readonly kinds = [
    { key: 'heading', label: () => t('staff.pageTexts.kind.heading', 'Headings') },
    { key: 'note', label: () => t('staff.pageTexts.kind.note', 'Lines and notes') },
    { key: 'label', label: () => t('staff.pageTexts.kind.label', 'Labels') },
    { key: 'button', label: () => t('staff.pageTexts.kind.button', 'Buttons and links') },
    { key: 'placeholder', label: () => t('staff.pageTexts.kind.placeholder', 'Placeholders') },
    { key: 'tooltip', label: () => t('staff.pageTexts.kind.tooltip', 'Tooltips and screen-reader text') },
    { key: 'message', label: () => t('staff.pageTexts.kind.message', 'Messages') },
    { key: 'text', label: () => t('staff.pageTexts.kind.text', 'Other wording') },
  ];

  protected readonly items = signal<PageTextItem[]>([]);
  protected readonly search = signal('');
  protected readonly portal = signal('');
  protected readonly kind = signal('');
  protected readonly changedOnly = signal(false);
  /** The page groups opened by the Admin (all open while searching or filtering). */
  private readonly opened = signal<ReadonlySet<string>>(new Set());
  protected readonly editing = signal<Editing | null>(null);
  protected readonly resetting = signal<PageTextItem | null>(null);
  protected readonly resetError = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  protected readonly changedCount = computed(() => this.items().filter((i) => i.text).length);
  private readonly filtering = computed(() => !!this.search().trim() || !!this.kind() || this.changedOnly());

  /** The groups (portal → page) of the wording that matches, in the catalogue's order; while searching, SEARCH_LIMIT rows at most. */
  private readonly matched = computed(() => {
    const q = this.search().trim().toLowerCase();
    const portal = this.portal();
    const kind = this.kind();
    const changed = this.changedOnly();
    const groups = new Map<string, Group>();
    let shown = 0;
    let truncated = false;
    for (const i of this.items()) {
      if (portal && i.portal !== portal) continue;
      const id = `${i.portal}.${i.page}`;
      let g = groups.get(id);
      if (!g) groups.set(id, (g = { id, portal: i.portal, pageName: i.pageName, rows: [], total: 0, changed: 0 }));
      g.total++;
      if (i.text) g.changed++;
      const hit = (!kind || i.kind === kind) && (!changed || !!i.text)
        && (!q || `${i.text ?? ''}\n${i.standard}\n${i.key}\n${i.pageName}`.toLowerCase().includes(q));
      if (!hit) continue;
      if (q && shown >= SEARCH_LIMIT) {
        truncated = true;
        continue;
      }
      g.rows.push(i);
      shown++;
    }
    return { groups: [...groups.values()].filter((g) => g.rows.length), truncated };
  });
  protected readonly groups = computed(() => this.matched().groups);
  protected readonly truncated = computed(() => this.matched().truncated);

  constructor() {
    void this.load();
  }

  /** Loads the wording again (the portal switch of the Texts page). */
  reload(): void {
    this.editing.set(null);
    this.error.set('');
    this.success.set('');
    this.items.set([]);
    void this.load();
  }

  protected isOpen(g: Group): boolean {
    return this.filtering() || this.opened().has(g.id);
  }

  protected toggle(g: Group): void {
    const next = new Set(this.opened());
    if (next.has(g.id)) next.delete(g.id);
    else next.add(g.id);
    this.opened.set(next);
  }

  protected portalName(key: string): string {
    return this.portals.find((p) => p.key === key)?.label() ?? key;
  }

  protected kindName(key: string): string {
    switch (key) {
      case 'heading': return t('staff.pageTexts.kindName.heading', 'Heading');
      case 'note': return t('staff.pageTexts.kindName.note', 'Line');
      case 'label': return t('staff.pageTexts.kindName.label', 'Label');
      case 'button': return t('staff.pageTexts.kindName.button', 'Button');
      case 'placeholder': return t('staff.pageTexts.kindName.placeholder', 'Placeholder');
      case 'tooltip': return t('staff.pageTexts.kindName.tooltip', 'Tooltip');
      case 'message': return t('staff.pageTexts.kindName.message', 'Message');
      default: return t('staff.pageTexts.kindName.text', 'Wording');
    }
  }

  protected braces(name: string): string {
    return `{${name}}`;
  }

  protected edit(r: PageTextItem): void {
    this.success.set('');
    this.editing.set({ key: r.key, text: r.text ?? r.standard, error: '' });
    setTimeout(() => document.getElementById('pt-' + r.key)?.focus());
  }

  protected setText(text: string): void {
    const e = this.editing();
    if (e) this.editing.set({ ...e, text, error: '' });
  }

  /** Puts the value at the cursor (in place of a selection). */
  protected insert(r: PageTextItem, name: string): void {
    const e = this.editing();
    if (!e) return;
    const box = document.getElementById('pt-' + r.key) as HTMLTextAreaElement | null;
    const at = box?.selectionStart ?? e.text.length;
    const end = box?.selectionEnd ?? at;
    const value = e.text.slice(0, at) + this.braces(name) + e.text.slice(end);
    this.editing.set({ ...e, text: value });
    const caret = at + name.length + 2;
    setTimeout(() => {
      box?.focus();
      box?.setSelectionRange(caret, caret);
    });
  }

  protected async save(r: PageTextItem): Promise<void> {
    const e = this.editing();
    if (!e) return;
    this.busy.set(true);
    try {
      const saved = await firstValueFrom(this.http.put<PageTextItem>(`${PageTextsPanel.url}/${encodeURIComponent(r.key)}`, { text: e.text }));
      this.replace(saved);
      this.editing.set(null);
      this.success.set(saved.text ? t('staff.pageTexts.saved', 'Wording saved. Pages opened or reloaded from now show it.')
        : t('staff.pageTexts.savedStandard', 'This is the standard wording: it is shown again.'));
    } catch (err) {
      this.editing.set({ ...e, error: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  protected askReset(r: PageTextItem): void {
    this.resetError.set('');
    this.resetting.set(r);
  }

  protected resetAsk(r: PageTextItem): ConfirmAsk {
    return {
      title: t('staff.pageTexts.reset.title', 'Show the standard wording again?'),
      subtitle: r.key,
      points: [t('staff.pageTexts.reset.point', 'Standard: {text}', { text: r.standard })],
      confirmLabel: t('staff.pageTexts.reset.confirmButton', 'Reset to standard'),
      icon: 'info',
    };
  }

  protected async reset(r: PageTextItem): Promise<void> {
    this.busy.set(true);
    try {
      this.replace(await firstValueFrom(this.http.delete<PageTextItem>(`${PageTextsPanel.url}/${encodeURIComponent(r.key)}`)));
      this.resetting.set(null);
      this.success.set(t('staff.pageTexts.resetDone', 'The standard wording is shown again.'));
    } catch (err) {
      this.resetError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private replace(item: PageTextItem): void {
    this.items.update((list) => list.map((i) => (i.key === item.key ? item : i)));
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      this.items.set(await firstValueFrom(this.http.get<PageTextItem[]>(PageTextsPanel.url)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
