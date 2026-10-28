import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

interface LinksResponse {
  /** Saved here, or null (the server's configured address applies). */
  contactUrl: string | null;
  defaultContactUrl: string;
}

/**
 * Admin → Links (new in V4): where "Contact ZED" goes on the MSME pages, the registration and the login pages (the ZED
 * website's contact page). An empty box goes back to the server's configured address, shown in it.
 */
@Component({
  selector: 'zed-staff-links',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Links</h3>
        <p class="page-sub">Pages outside the portal that its menus open.</p>
      </div>
    </div>
    @if (loaded(); as l) {
      <form class="zed-card" (ngSubmit)="save()" novalidate>
        <div class="form-grid">
          <label for="contactUrl" class="top">Contact ZED</label>
          <div>
            <div class="link-row">
              <input id="contactUrl" name="contactUrl" type="url" class="form-control" maxlength="500" autocomplete="off"
                     [class.is-invalid]="!!problem()" [placeholder]="l.defaultContactUrl" [(ngModel)]="contactUrl" (ngModelChange)="problem.set(''); message.set(null)" />
              <a class="btn btn-outline-primary" [href]="contactUrl.trim() || l.defaultContactUrl" target="_blank" rel="noopener">Open</a>
            </div>
            @if (problem()) { <small class="help-block">{{ problem() }}</small> }
            <small class="text-muted d-block">"Contact ZED" in the MSME menu and on the registration and login pages opens this page in a new tab.
              Leave it empty to use {{ l.defaultContactUrl }}.</small>
          </div>
        </div>
        @if (message(); as m) {
          <div class="alert mt-3 mb-0" [class.alert-success]="m.ok" [class.alert-danger]="!m.ok" role="status">{{ m.text }}</div>
        }
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="busy()">SAVE</button>
        </div>
      </form>
    }
  `,
  styles: `.link-row { display: flex; gap: 8px; } .link-row .btn { flex: 0 0 auto; }`,
})
export class LinksPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/links';

  protected readonly loaded = signal<LinksResponse | null>(null);
  protected contactUrl = '';
  protected readonly problem = signal('');
  protected readonly message = signal<{ ok: boolean; text: string } | null>(null);
  protected readonly busy = signal(false);

  constructor() {
    void this.load();
  }

  /** The server's rule: empty, or an absolute http(s) address of at most 500 characters. */
  private static check(value: string): string {
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

  protected async save(): Promise<void> {
    const problem = LinksPage.check(this.contactUrl);
    this.problem.set(problem);
    if (problem) return;
    this.busy.set(true);
    this.message.set(null);
    try {
      const r = await firstValueFrom(this.http.put<MessageResponse>(LinksPage.url, { contactUrl: this.contactUrl.trim() }));
      this.message.set({ ok: true, text: r.message });
      await this.load();
    } catch (err) {
      this.message.set({ ok: false, text: apiErrorMessage(err) });
    } finally {
      this.busy.set(false);
    }
  }

  private async load(): Promise<void> {
    try {
      const l = await firstValueFrom(this.http.get<LinksResponse>(LinksPage.url));
      this.contactUrl = l.contactUrl ?? '';
      this.loaded.set(l);
    } catch (err) {
      this.message.set({ ok: false, text: apiErrorMessage(err) });
    }
  }
}
