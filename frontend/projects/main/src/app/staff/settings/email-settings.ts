import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { CollapseCard } from '../collapse-card';
import { MailServersCard } from './mail-servers';

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
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    <zed-staff-mail-servers />
    @if (items().length) {
      <form class="addresses" (ngSubmit)="save()" novalidate>
        <h4 class="section-title">Office mailboxes</h4>
        <p class="text-muted mb-3">One address, or several separated by commas or semicolons. Leave a box empty to use the server's configured address.</p>
        @for (group of groups(); track group.title) {
          @if (group.items.length) {
            <zed-collapse-card [title]="group.title" [summary]="setCount(group.items) + ' of ' + group.items.length + ' set here'">
              <div class="form-grid">
                @for (item of group.items; track item.key) {
                  <label class="top" [for]="item.key">{{ item.label }}</label>
                  <div>
                    <input type="text" class="form-control" maxlength="400" autocomplete="off" [id]="item.key" [name]="item.key"
                           [placeholder]="item.default ? 'Configured: ' + item.default : 'Not configured'"
                           [ngModel]="values()[item.key]" (ngModelChange)="patch(item.key, $event)" />
                    <small class="text-muted d-block">{{ item.help }}</small>
                  </div>
                }
              </div>
            </zed-collapse-card>
          }
        }
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="busy()">SAVE</button>
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
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }`,
})
export class EmailSettingsPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/email';

  protected readonly items = signal<EmailSettingItem[]>([]);
  protected readonly values = signal<Record<string, string>>({});
  protected readonly groups = computed(() => [
    { title: 'Portal mails', items: this.items().filter((i) => !i.database) },
    { title: 'Database mails', items: this.items().filter((i) => i.database) },
  ]);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  constructor() {
    void this.load();
  }

  protected setCount(items: EmailSettingItem[]): number {
    return items.filter((i) => (this.values()[i.key] ?? '').trim()).length;
  }

  protected patch(key: string, value: string): void {
    this.values.update((v) => ({ ...v, [key]: value }));
  }

  protected async save(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(this.http.put<MessageResponse>(EmailSettingsPage.url, { values: this.values() }));
      this.success.set(r.message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    this.busy.set(true);
    try {
      const items = await firstValueFrom(this.http.get<EmailSettingItem[]>(EmailSettingsPage.url));
      this.items.set(items);
      this.values.set(Object.fromEntries(items.map((i) => [i.key, i.value ?? ''])));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
