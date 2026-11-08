import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { PortalSwitchComponent } from '../admin-portal';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

export interface PortalLink {
  key: string;
  name: string;
  /** Where the pages show it, and what switching it off does. */
  shownOn: string;
  /** Saved here, or null (the default applies). */
  url: string | null;
  defaultUrl: string;
  /** Whether the pages show it. */
  enabled: boolean;
}

const API = '/api/staff/settings/links';

/** The server's rule: empty, or an absolute http(s) address of at most 500 characters. */
function addressProblem(value: string): string {
  const v = value.trim();
  if (!v) return '';
  if (v.length > 500) return 'The address is too long (500 characters at most).';
  try {
    const u = new URL(v);
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname.includes('.') ? '' : `'${v}' is not a web address.`;
  } catch {
    return `'${v}' is not a web address (e.g. https://zed.msme.gov.in/contact-us).`;
  }
}

/** One link: its switch, address and Save (only after a change). */
@Component({
  selector: 'zed-staff-link-card',
  imports: [FormsModule],
  template: `
    @let l = link();
    <form class="zed-card link-card" [class.is-off]="!enabled()" [class.is-dirty]="dirty()" (ngSubmit)="save()" novalidate>
      <div class="link-head">
        <span class="link-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
          </svg>
        </span>
        <div class="link-title">
          <h5 [id]="l.key + '-name'">{{ l.name }}</h5>
          <div class="link-badges">
            <span class="status-badge" [class.is-active]="l.enabled" [class.is-inactive]="!l.enabled">{{ l.enabled ? 'Enabled' : 'Disabled' }}</span>
            <span class="addr-chip" [class.own]="!!l.url">{{ l.url ? 'Own address' : 'Default address' }}</span>
          </div>
        </div>
        <div class="form-check form-switch link-switch">
          <input class="form-check-input" type="checkbox" role="switch" [id]="l.key + '-enabled'" name="enabled"
                 [attr.aria-describedby]="l.key + '-name'" [ngModel]="enabled()" (ngModelChange)="enabled.set($event); message.set(null)" />
          <label class="form-check-label" [for]="l.key + '-enabled'">{{ enabled() ? 'Enabled' : 'Disabled' }}</label>
        </div>
      </div>
      <p class="link-where"><span class="where-label">Shown on</span> {{ l.shownOn }}</p>

      <div class="link-body">
        <label [for]="l.key + '-url'">Web address</label>
        <div class="input-group">
          <input [id]="l.key + '-url'" name="url" type="url" class="form-control" maxlength="500" autocomplete="off"
                 [class.is-invalid]="!!problem()" [placeholder]="l.defaultUrl" [ngModel]="url()"
                 (ngModelChange)="url.set($event); problem.set(''); message.set(null)" />
          <a class="btn btn-outline-secondary" [href]="url().trim() || l.defaultUrl" target="_blank" rel="noopener" title="Open the address in a new tab to test it">
            Open
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5" />
            </svg>
          </a>
        </div>
        @if (problem()) {
          <small class="help-block d-block">{{ problem() }}</small>
        } @else if (url().trim()) {
          <small class="link-hint">Leave empty to use the default: <a [href]="l.defaultUrl" target="_blank" rel="noopener">{{ l.defaultUrl }}</a></small>
        } @else {
          <small class="link-hint">Empty: the default address (shown greyed in the box) is used.</small>
        }
        @if (!enabled()) {
          <div class="link-off-note" role="note">The link is switched off on the pages. The address is kept for when you enable it again.</div>
        }
        @if (message(); as m) {
          <div class="alert mt-3 mb-0" [class.alert-success]="m.ok" [class.alert-danger]="!m.ok" [attr.role]="m.ok ? 'status' : 'alert'">{{ m.text }}</div>
        }
      </div>

      <div class="form-actions">
        @if (dirty()) {
          <span class="unsaved me-auto">Not saved yet.</span>
          <button type="button" class="btn btn-default" [disabled]="busy()" (click)="undo()">CANCEL</button>
        }
        <button type="submit" class="btn btn-primary" [disabled]="busy() || !dirty()">SAVE</button>
      </div>
    </form>
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .link-card { display: flex; flex-direction: column; height: 100%; padding: 0; overflow: hidden; margin: 0; border-top: 4px solid #45a5ad;
      transition: border-color .15s, box-shadow .15s; }
    .link-card.is-off { border-top-color: #cbd5d6; }
    .link-card.is-dirty { border-color: #e9c46a; box-shadow: 0 0 0 1px #e9c46a; }
    .link-head { display: flex; align-items: flex-start; gap: 14px; padding: 16px 20px 8px; }
    .link-icon { flex: 0 0 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
      background: #eef6f6; color: #2e858c; transition: background .15s, color .15s; }
    .link-title { flex: 1 1 auto; min-width: 0; }
    .link-title h5 { margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #23474a; overflow-wrap: anywhere; }
    .link-badges { display: flex; flex-wrap: wrap; gap: 6px; }
    .addr-chip { display: inline-block; border-radius: 12px; padding: 2px 10px; font-size: 12px; font-weight: 600; background: #eef6f6; color: #2f7c83; white-space: nowrap; }
    .addr-chip.own { background: #f1f0fb; color: #3f3a7a; }
    .link-switch { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; margin: 8px 0 0; padding-left: 0; min-height: 0; }
    .link-switch .form-check-input { float: none; margin: 0; width: 2.6em; height: 1.4em; cursor: pointer; }
    .link-switch .form-check-input:checked { background-color: #45a5ad; border-color: #45a5ad; }
    .link-switch .form-check-label { min-width: 62px; font-weight: 600; color: #3b4b4c; cursor: pointer; }
    .link-where { margin: 0 20px; padding: 0 0 12px 56px; font-size: 13px; color: #5f6f70; border-bottom: 1px solid #e6eeef; overflow-wrap: anywhere; }
    .where-label { display: inline-block; margin-right: 4px; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #2f7c83; }
    .link-body { flex: 1 1 auto; padding: 14px 20px 4px; }
    .link-body > label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 14px; color: #3b4b4c; }
    .input-group { flex-wrap: nowrap; }
    .input-group .form-control { max-width: none; min-width: 0; }
    .input-group .btn { display: inline-flex; align-items: center; gap: 6px; }
    .link-hint { display: block; margin-top: 6px; font-size: 13px; color: #6c7a7b; overflow-wrap: anywhere; }
    .link-off-note { margin-top: 12px; padding: 8px 12px; border-radius: 8px; background: #f4f6f7; color: #5f6f70; font-size: 13px; }
    .link-card.is-off .link-icon { background: #eef1f2; color: #8a9798; }
    .link-card.is-off .input-group { opacity: .65; }
    .form-actions { align-items: center; margin-top: 12px; padding: 0 20px 16px; }
    .unsaved { font-weight: 600; color: #8a6100; }
    @media (max-width: 575.98px) {
      .link-head { flex-wrap: wrap; padding: 14px 16px 8px; }
      .link-switch { width: 100%; margin-top: 0; }
      .link-where { margin: 0 16px; padding-left: 0; }
      .link-body { padding: 14px 16px 4px; }
      .form-actions { padding: 0 16px 14px; }
    }
  `,
})
export class LinkCard {
  private readonly http = inject(HttpClient);

  readonly link = input.required<PortalLink>();
  /** After a save: the page reloads the list (the badges show what the server has). */
  readonly saved = output<void>();

  protected readonly url = signal('');
  protected readonly enabled = signal(true);
  protected readonly dirty = computed(() => (this.link().url ?? '') !== this.url().trim() || this.link().enabled !== this.enabled());
  protected readonly problem = signal('');
  protected readonly message = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    // The link as the server has it (first load, and again after a save).
    effect(() => {
      this.link();
      untracked(() => this.undo());
    });
  }

  protected undo(): void {
    this.url.set(this.link().url ?? '');
    this.enabled.set(this.link().enabled);
    this.problem.set('');
  }

  protected async save(): Promise<void> {
    const problem = addressProblem(this.url());
    this.problem.set(problem);
    if (problem) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const r = await firstValueFrom(
        this.http.put<MessageResponse>(`${API}/${this.link().key}`, { url: this.url().trim(), enabled: this.enabled() }),
      );
      this.message.set({ ok: true, text: r.message });
      this.saved.emit();
    } catch (err) {
      this.message.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }
}

/**
 * Admin → Links (new in V4): the links of the portal's pages to pages outside it (Contact ZED, the Ministry's logo, the
 * app stores, the LGD Directory): each switched on or off, and where it goes. An empty address goes back to
 * the default. V4 layout: the counts (links, enabled, own address, switched off), a card per link with where it shows,
 * whether it uses its own or the default address and an Open button to test it, and its own Save once changed.
 */
@Component({
  selector: 'zed-staff-links',
  imports: [LinkCard, PortalSwitchComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Links</h3>
        <p class="page-sub">The portal's links to pages outside it: switch each on or off and change where it goes.</p>
      </div>
    </div>
    <!-- One Admin (V4): the links of the portal chosen here (each portal keeps its own). -->
    <zed-portal-switch [portals]="['main']" />
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (links(); as list) {
      <div class="links-stats">
        <div class="stat"><span class="stat-value">{{ stats().total }}</span><span class="stat-label">Links</span></div>
        <div class="stat"><span class="stat-value is-on">{{ stats().enabled }}<small>/{{ stats().total }}</small></span><span class="stat-label">Enabled</span></div>
        <div class="stat"><span class="stat-value is-own">{{ stats().own }}</span><span class="stat-label">Own address</span></div>
        <div class="stat"><span class="stat-value is-off">{{ stats().off }}</span><span class="stat-label">Switched off</span></div>
      </div>
      @if (list.length) {
        <div class="links-grid">
          @for (l of list; track l.key) {
            <zed-staff-link-card [link]="l" (saved)="load()" />
          }
        </div>
      } @else {
        <div class="zed-card no-data">No links to set up.</div>
      }
    }
  `,
  styles: `
    .links-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-value small { font-size: 15px; color: #8a9899; font-weight: 600; }
    .stat-value.is-on { color: #1e7a3c; }
    .stat-value.is-own { color: #3f3a7a; }
    .stat-value.is-off { color: #8a9899; }
    .stat-label { font-size: 13px; color: #5f6f70; }
    .links-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 480px), 1fr)); gap: 16px; align-items: stretch; }
    @media (max-width: 575.98px) { .links-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  `,
})
export class LinksPage {
  private readonly http = inject(HttpClient);

  protected readonly links = signal<PortalLink[] | null>(null);
  /** The tiles above the cards, from what the server has (they change after a Save, not while typing). */
  protected readonly stats = computed(() => {
    const list = this.links() ?? [];
    const enabled = list.filter((l) => l.enabled).length;
    return { total: list.length, enabled, own: list.filter((l) => !!l.url).length, off: list.length - enabled };
  });
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    try {
      this.links.set((await firstValueFrom(this.http.get<{ links: PortalLink[] }>(API))).links);
      this.error.set('');
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }
}
