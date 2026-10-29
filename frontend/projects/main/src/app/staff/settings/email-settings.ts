import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { EMAIL_PATTERN, MailServersCard } from './mail-servers';

interface EmailSettingItem {
  key: string;
  label: string;
  help: string;
  /** Used by the database procedures' mail (sent by the jobs service). */
  database: boolean;
  value: string | null;
  /** From the server configuration; used while no value is saved. */
  default: string | null;
}

/**
 * Admin → Email Settings (new in V4): the office mailboxes this portal's mails and its database procedures' mails go to.
 * One address or several separated by commas or semicolons; an empty box goes back to the server configuration (shown).
 * V4 layout: the mail servers (SMTP) per module (<zed-staff-mail-servers>), then the mailboxes in one card, by group (portal /
 * database mails), each with the address its mails go to now (set here, the configured one, or none), and the save bar
 * kept in view while there are changes.
 */
@Component({
  selector: 'zed-staff-email-settings',
  imports: [FormsModule, MailServersCard],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Email Settings</h3>
        <p class="page-sub">The mail servers this portal sends with, and the office mailboxes its mails go to.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    <zed-staff-mail-servers />
    @if (items().length) {
      <form class="addresses zed-card" (ngSubmit)="save()" novalidate>
        <div class="mb-head">
          <div>
            <h4 class="section-title">Office mailboxes</h4>
            <p class="muted m-0">One address, or several separated by commas or semicolons. Leave a box empty to use the server's configured address.</p>
          </div>
          <div class="mb-count" [class.warn]="missingCount()">
            <strong>{{ setCount(items()) }}</strong> of {{ items().length }} set here
            @if (missingCount()) { <small>{{ missingCount() }} with no address</small> }
          </div>
        </div>
        @for (group of groups(); track group.title) {
          @if (group.items.length) {
            <section class="mb-group" [attr.aria-label]="group.title">
              <h5 class="group-title">{{ group.title }} <span class="group-count">{{ setCount(group.items) }} of {{ group.items.length }} set here</span></h5>
              @for (item of group.items; track item.key) {
                <div class="mb-row" [class.has-problem]="!!problems()[item.key]">
                  <div class="mb-label">
                    <label [for]="item.key">{{ item.label }}</label>
                    <small class="muted d-block">{{ item.help }}</small>
                  </div>
                  <div class="mb-field">
                    <input type="text" class="form-control" maxlength="400" autocomplete="off" [id]="item.key" [name]="item.key"
                           [class.is-invalid]="!!problems()[item.key]"
                           [placeholder]="item.default ? 'Configured: ' + item.default : 'Not configured'"
                           [ngModel]="values()[item.key]" (ngModelChange)="patch(item.key, $event)" />
                    @if (problems()[item.key]; as p) {
                      <small class="help-block">{{ p }}</small>
                    }
                    <div class="mb-uses">
                      @switch (uses(item)) {
                        @case ('own') { <span class="uses-dot own"></span> Set here: {{ recipients(values()[item.key]) }} }
                        @case ('configured') { <span class="uses-dot"></span> Uses the configured {{ item.default }} }
                        @default { <span class="uses-dot none"></span> No address: nothing is sent to this mailbox }
                      }
                      @if (uses(item) === 'own' && item.default) {
                        <button type="button" class="btn btn-link p-0 use-configured" (click)="patch(item.key, '')">Use configured</button>
                      }
                    </div>
                  </div>
                </div>
              }
            </section>
          }
        }
        @if (formMessage(); as m) {
          <div class="alert mt-3 mb-0" [class.alert-success]="m.ok" [class.alert-danger]="!m.ok" [attr.role]="m.ok ? 'status' : 'alert'">{{ m.text }}</div>
        }
        <div class="form-actions save-bar" [class.is-dirty]="changed()">
          @if (changed()) { <span class="unsaved">Unsaved changes</span> } @else { <span class="muted me-auto">All changes saved.</span> }
          <button type="submit" class="btn btn-primary" [disabled]="busy() || !changed()">SAVE</button>
        </div>
      </form>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .addresses { margin-top: 18px; }
    .mb-head { display: flex; flex-wrap: wrap; justify-content: space-between; align-items: flex-start; gap: 12px; padding-bottom: 12px; border-bottom: 1px solid #eef3f3; }
    .section-title { font-size: 16px; font-weight: 700; color: #23474a; margin: 0 0 4px; }
    .mb-count { text-align: right; font-size: 13px; color: #5f6f70; background: #eef6f6; border-radius: 10px; padding: 6px 12px; }
    .mb-count strong { font-size: 18px; color: #23474a; }
    .mb-count small { display: block; color: #8a6100; font-weight: 600; }
    .mb-count.warn { background: #fff8e6; }
    .mb-group { margin-top: 14px; }
    .group-title { display: flex; align-items: baseline; gap: 10px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; color: #2f7c83; margin: 0 0 4px; }
    .group-count { font-size: 12px; font-weight: 400; text-transform: none; letter-spacing: 0; color: #5f6f70; }
    .mb-row { display: grid; grid-template-columns: minmax(0, 2fr) minmax(0, 3fr); gap: 8px 24px; padding: 12px 0; border-bottom: 1px solid #eef3f3; }
    .mb-row:last-child { border-bottom: 0; }
    .mb-label label { font-weight: 600; color: #232527; font-size: 14px; margin: 0; }
    .mb-label small { font-size: 12.5px; margin-top: 2px; }
    .mb-uses { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; margin-top: 6px; font-size: 12.5px; color: #3b4b4c; overflow-wrap: anywhere; }
    .uses-dot { display: inline-block; width: 8px; height: 8px; border-radius: 4px; background: #45a5ad; }
    .uses-dot.own { background: #2e9e5b; }
    .uses-dot.none { background: #e0a43a; }
    .use-configured { font-size: 12.5px; }
    .save-bar { position: sticky; bottom: 0; z-index: 5; align-items: center; margin: 14px -20px -18px; padding: 12px 20px; background: #fff;
      border-top: 1px solid #dfe9ea; border-radius: 0 0 14px 14px; }
    .save-bar.is-dirty { background: #fffcf2; border-top-color: #e9c46a; }
    .unsaved { color: #8a6100; font-size: 13px; font-weight: 600; margin-right: auto; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 767.98px) {
      .mb-row { grid-template-columns: minmax(0, 1fr); }
      .mb-count { text-align: left; }
    }`,
})
export class EmailSettingsPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/email';

  protected readonly items = signal<EmailSettingItem[]>([]);
  protected readonly values = signal<Record<string, string>>({});
  /** The values as loaded: Save is offered only when something differs. */
  private readonly loaded = signal<Record<string, string>>({});
  protected readonly changed = computed(() => {
    const now = this.values();
    const was = this.loaded();
    return Object.keys(now).some((k) => (now[k] ?? '').trim() !== (was[k] ?? '').trim());
  });
  /** A problem per box, found on Save (the server's rules: valid addresses, at most 10, 400 characters). */
  protected readonly problems = signal<Record<string, string>>({});
  /** The result of Save, shown next to the button. */
  protected readonly formMessage = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly groups = computed(() => [
    { title: 'Portal mails', items: this.items().filter((i) => !i.database) },
    { title: 'Database mails', items: this.items().filter((i) => i.database) },
  ]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  constructor() {
    void this.load();
  }

  /** The mailboxes whose mails go nowhere: nothing saved and nothing configured. */
  protected readonly missingCount = computed(() => this.items().filter((i) => this.uses(i) === 'none').length);

  /** Where a box's mails go now: its own addresses, the configured one, or nowhere. */
  protected uses(item: EmailSettingItem): 'own' | 'configured' | 'none' {
    if ((this.values()[item.key] ?? '').trim()) return 'own';
    return item.default ? 'configured' : 'none';
  }

  /** "a@x.in, b@x.in": the addresses of a box as they will be saved. */
  protected recipients(value: string | undefined): string {
    return (value ?? '').split(/[,;]/).map((p) => p.trim()).filter((p) => p).join(', ');
  }

  protected setCount(items: EmailSettingItem[]): number {
    return items.filter((i) => (this.values()[i.key] ?? '').trim()).length;
  }

  protected patch(key: string, value: string): void {
    this.values.update((v) => ({ ...v, [key]: value }));
    if (this.problems()[key]) this.problems.update(({ [key]: _, ...rest }) => rest);
    this.formMessage.set(null);
  }

  /** The problem of one box, or ''. */
  private static problem(value: string): string {
    const parts = value.split(/[,;]/).map((p) => p.trim()).filter((p) => p);
    if (parts.length > 10) return 'Please enter at most 10 addresses.';
    const bad = parts.find((p) => p.length > 254 || !EMAIL_PATTERN.test(p));
    if (bad) return `'${bad}' is not a valid e-mail address.`;
    if (parts.join('; ').length > 400) return 'The addresses are too long.';
    return '';
  }

  protected async save(): Promise<void> {
    if (this.busy() || !this.changed()) return;
    const problems: Record<string, string> = {};
    for (const item of this.items()) {
      const p = EmailSettingsPage.problem(this.values()[item.key] ?? '');
      if (p) problems[item.key] = p;
    }
    this.problems.set(problems);
    const bad = this.items().filter((i) => problems[i.key]);
    if (bad.length) {
      this.formMessage.set({ ok: false, text: `Please correct ${bad.map((i) => i.label).join(', ')}.` });
      return;
    }
    this.busy.set(true);
    this.formMessage.set(null);
    try {
      const r = await firstValueFrom(this.http.put<MessageResponse>(EmailSettingsPage.url, { values: this.values() }));
      await this.load();
      this.formMessage.set({ ok: true, text: r.message });
    } catch (err) {
      this.formMessage.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      const items = await firstValueFrom(this.http.get<EmailSettingItem[]>(EmailSettingsPage.url));
      this.items.set(items);
      const values = Object.fromEntries(items.map((i) => [i.key, i.value ?? '']));
      this.values.set(values);
      this.loaded.set(values);
      this.problems.set({});
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
