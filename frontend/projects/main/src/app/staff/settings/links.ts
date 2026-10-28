import { HttpClient } from '@angular/common/http';
import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
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
    <form class="zed-card link-card" [class.is-off]="!enabled()" (ngSubmit)="save()" novalidate>
      <div class="link-head">
        <span class="link-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1 1" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1-1" />
          </svg>
        </span>
        <div class="link-title">
          <h5 [id]="l.key + '-name'">
            {{ l.name }}
            <span class="status-badge" [class.is-active]="l.enabled" [class.is-inactive]="!l.enabled">{{ l.enabled ? 'Enabled' : 'Disabled' }}</span>
          </h5>
          <p>{{ l.shownOn }}</p>
        </div>
        <div class="form-check form-switch link-switch">
          <input class="form-check-input" type="checkbox" role="switch" [id]="l.key + '-enabled'" name="enabled"
                 [attr.aria-describedby]="l.key + '-name'" [ngModel]="enabled()" (ngModelChange)="enabled.set($event); message.set(null)" />
          <label class="form-check-label" [for]="l.key + '-enabled'">{{ enabled() ? 'Enabled' : 'Disabled' }}</label>
        </div>
      </div>

      <div class="link-body">
        <label [for]="l.key + '-url'">Web address</label>
        <div class="input-group">
          <input [id]="l.key + '-url'" name="url" type="url" class="form-control" maxlength="500" autocomplete="off"
                 [class.is-invalid]="!!problem()" [placeholder]="l.defaultUrl" [ngModel]="url()"
                 (ngModelChange)="url.set($event); problem.set(''); message.set(null)" />
          <a class="btn btn-outline-secondary" [href]="url().trim() || l.defaultUrl" target="_blank" rel="noopener" title="Open the address in a new tab">
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
          <span class="muted me-auto">Not saved yet.</span>
          <button type="button" class="btn btn-default" [disabled]="busy()" (click)="undo()">CANCEL</button>
        }
        <button type="submit" class="btn btn-primary" [disabled]="busy() || !dirty()">SAVE</button>
      </div>
    </form>
  `,
  styles: `
    .link-card { padding: 0; overflow: hidden; margin-bottom: 16px; }
    .link-head { display: flex; align-items: center; gap: 14px; padding: 16px 22px; border-bottom: 1px solid #e6eeef; }
    .link-icon { flex: 0 0 42px; height: 42px; border-radius: 12px; display: flex; align-items: center; justify-content: center;
      background: #eef6f6; color: #2e858c; transition: background .15s, color .15s; }
    .link-title { flex: 1 1 auto; min-width: 0; }
    .link-title h5 { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; margin: 0 0 4px; font-size: 16px; font-weight: 700; color: #23474a; }
    .link-title p { margin: 0; font-size: 13px; color: #5f6f70; }
    .link-switch { flex: 0 0 auto; display: flex; align-items: center; gap: 8px; margin: 0; padding-left: 0; }
    .link-switch .form-check-input { float: none; margin: 0; width: 2.6em; height: 1.4em; cursor: pointer; }
    .link-switch .form-check-input:checked { background-color: #45a5ad; border-color: #45a5ad; }
    .link-switch .form-check-label { min-width: 62px; font-weight: 600; color: #3b4b4c; cursor: pointer; }
    .link-body { padding: 16px 22px 4px; }
    .link-body > label { display: block; margin-bottom: 6px; font-weight: 600; font-size: 14px; color: #3b4b4c; }
    .input-group .form-control { max-width: none; }
    .input-group .btn { display: inline-flex; align-items: center; gap: 6px; }
    .link-hint { display: block; margin-top: 6px; font-size: 13px; color: #6c7a7b; overflow-wrap: anywhere; }
    .link-off-note { margin-top: 12px; padding: 8px 12px; border-radius: 8px; background: #f4f6f7; color: #5f6f70; font-size: 13px; }
    .link-card.is-off .link-icon { background: #eef1f2; color: #8a9798; }
    .link-card.is-off .input-group { opacity: .65; }
    .form-actions { align-items: center; margin-top: 12px; padding: 0 22px 16px; }
    @media (max-width: 575.98px) {
      .link-head { flex-wrap: wrap; padding: 14px 16px; }
      .link-switch { width: 100%; }
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
 * app stores, MSME KAWACH, the LGD Directory): each switched on or off, and where it goes. An empty address goes back to
 * the default.
 */
@Component({
  selector: 'zed-staff-links',
  imports: [LinkCard],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Links</h3>
        <p class="page-sub">The portal's links to pages outside it: switch each on or off and change where it goes.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (links(); as list) {
      <p class="links-summary muted">{{ enabledCount() }} of {{ list.length }} links enabled.</p>
      @for (l of list; track l.key) {
        <zed-staff-link-card [link]="l" (saved)="load()" />
      }
    }
  `,
  styles: `.links-summary { margin: -4px 0 12px; font-size: 13px; }`,
})
export class LinksPage {
  private readonly http = inject(HttpClient);

  protected readonly links = signal<PortalLink[] | null>(null);
  protected readonly enabledCount = computed(() => (this.links() ?? []).filter((l) => l.enabled).length);
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
