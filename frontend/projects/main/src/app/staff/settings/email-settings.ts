import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

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
 */
@Component({
  selector: 'zed-staff-email-settings',
  imports: [FormsModule],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row justify-content-center mt-3">
        <div class="col-sm-10">
          <h3 class="registration-title">Email Settings</h3>
          @if (error()) {
            <div class="alert alert-danger" role="alert">{{ error() }}</div>
          }
          @if (success()) {
            <div class="alert alert-success" role="status">{{ success() }}</div>
          }
          @if (items().length) {
            <form class="jumbotron form-horizontal" (ngSubmit)="save()" novalidate>
              <p class="mb-3">One address, or several separated by commas or semicolons. Leave a box empty to use the server's configured address.</p>
              @for (group of groups(); track group.title) {
                @if (group.items.length) {
                  <h5 class="mt-2 mb-3">{{ group.title }}</h5>
                  @for (item of group.items; track item.key) {
                    <div class="row mb-3">
                      <label class="col-sm-4" [for]="item.key"><strong>{{ item.label }}</strong></label>
                      <div class="col-sm-8">
                        <input type="text" class="form-control" maxlength="400" autocomplete="off" [id]="item.key" [name]="item.key"
                               [placeholder]="item.default ? 'Configured: ' + item.default : 'Not configured'"
                               [ngModel]="values()[item.key]" (ngModelChange)="patch(item.key, $event)" />
                        <small class="text-muted d-block">{{ item.help }}</small>
                      </div>
                    </div>
                  }
                }
              }
              <div class="d-flex justify-content-end">
                <button type="submit" class="btn btn-primary" style="min-width: 200px" [disabled]="busy()">SAVE</button>
              </div>
            </form>
          }
        </div>
      </div>
    </div>
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .form-control { width: 100%; max-width: 100%; }
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
