import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CollapseCard } from '../collapse-card';
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
 * V4 layout: a card per group (portal / database mails), below the mail servers (SMTP) per module (<zed-staff-mail-servers>).
 */
@Component({
  selector: 'zed-staff-email-settings',
  imports: [FormsModule, MailServersCard, CollapseCard],
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
      <form class="addresses" (ngSubmit)="save()" novalidate>
        <h4 class="section-title">Office mailboxes</h4>
        <p class="text-muted mb-3">One address, or several separated by commas or semicolons. Leave a box empty to use the server's configured address.</p>
        @for (group of groups(); track group.title) {
          @if (group.items.length) {
            <zed-collapse-card [title]="group.title" [summary]="setCount(group.items) + ' of ' + group.items.length + ' set here'"
                               [open]="openGroups()[group.title] ?? false" (openChange)="setOpen(group.title, $event)">
              <div class="form-grid">
                @for (item of group.items; track item.key) {
                  <label class="top" [for]="item.key">{{ item.label }}</label>
                  <div>
                    <input type="text" class="form-control" maxlength="400" autocomplete="off" [id]="item.key" [name]="item.key"
                           [class.is-invalid]="!!problems()[item.key]"
                           [placeholder]="item.default ? 'Configured: ' + item.default : 'Not configured'"
                           [ngModel]="values()[item.key]" (ngModelChange)="patch(item.key, $event)" />
                    @if (problems()[item.key]; as p) {
                      <small class="help-block">{{ p }}</small>
                    }
                    <small class="text-muted d-block">{{ item.help }}</small>
                  </div>
                }
              </div>
            </zed-collapse-card>
          }
        }
        @if (formMessage(); as m) {
          <div class="alert mt-3 mb-0" [class.alert-success]="m.ok" [class.alert-danger]="!m.ok" [attr.role]="m.ok ? 'status' : 'alert'">{{ m.text }}</div>
        }
        <div class="form-actions">
          @if (changed()) { <span class="unsaved">Unsaved changes</span> }
          <button type="submit" class="btn btn-primary" [disabled]="busy() || !changed()">SAVE</button>
        </div>
      </form>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .form-grid > label.top { align-self: start; padding-top: 8px; }
    .section-title { font-size: 18px; font-weight: 700; color: #23474a; margin: 22px 0 6px; }
    .form-actions { align-items: center; }
    .unsaved { color: #8a6100; font-size: 13px; font-weight: 600; margin-right: auto; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
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
  protected readonly openGroups = signal<Record<string, boolean>>({});
  protected readonly groups = computed(() => [
    { title: 'Portal mails', items: this.items().filter((i) => !i.database) },
    { title: 'Database mails', items: this.items().filter((i) => i.database) },
  ]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  constructor() {
    void this.load();
  }

  protected setCount(items: EmailSettingItem[]): number {
    return items.filter((i) => (this.values()[i.key] ?? '').trim()).length;
  }

  protected patch(key: string, value: string): void {
    this.values.update((v) => ({ ...v, [key]: value }));
    if (this.problems()[key]) this.problems.update(({ [key]: _, ...rest }) => rest);
    this.formMessage.set(null);
  }

  protected setOpen(title: string, open: boolean): void {
    this.openGroups.update((g) => ({ ...g, [title]: open }));
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
      // Open the cards that hold the boxes to correct.
      for (const g of this.groups()) if (g.items.some((i) => problems[i.key])) this.setOpen(g.title, true);
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
