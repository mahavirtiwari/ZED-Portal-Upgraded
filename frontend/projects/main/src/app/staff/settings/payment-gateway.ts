import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

/** A saved CCAvenue account as the API shows it: never a key, only whether one is saved. */
export interface SavedGateway {
  merchantId: string;
  accessCode: string;
  mode: 'live' | 'test';
  workingKeySet: boolean;
  reconciliationKeySet: boolean;
  mobileAccessCode: string | null;
  mobileWorkingKeySet: boolean;
}

export interface PaymentGatewayInfo {
  gateway: {
    /** "page": the account saved here is in use; "file": the server settings file's. */
    inUse: 'page' | 'file';
    problem: string | null;
    saved: SavedGateway | null;
    file: { configured: boolean; merchantId: string | null; mode: 'live' | 'test'; mobileConfigured: boolean };
    returnBase: string;
    testAllowed: boolean;
  };
  invoices: { enabled: boolean; erpReady: boolean; examples: string[] };
  /** Online payments (CCAvenue checkouts); on unless the Admin switched them off. */
  paymentsOn: boolean;
}

/**
 * Admin → Settings → Payment Gateway and Invoices (new in V4, main portal only).
 * CCAvenue: the account the portal uses, entered here (for example a new merchant account) instead of the server's
 * settings file. The keys are stored encrypted and never shown again; a blank key box keeps the saved key. "Use server
 * file again" removes the saved account. Online payments: on or off (off stops every new CCAvenue checkout). Invoices: on or off (off by default). On: each gateway payment gets an invoice
 * number by the unit's sector (ZEDM/2627/n, ZEDS/2627/n) and is posted to QCI's ERP; it needs the server's ERP setup.
 */
@Component({
  selector: 'zed-staff-payment-gateway',
  imports: [FormsModule],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">Payment Gateway and Invoices</h3>
        <p class="page-sub">The CCAvenue account of the payments, and whether payments get invoices.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }
    @if (info(); as i) {
      <form class="zed-card mb-3" (ngSubmit)="savePayments()" novalidate>
        <div class="card-head">
          <h5 class="card-title">Online payments</h5>
          <span class="status-badge" [class.is-active]="i.paymentsOn" data-testid="payments-state">{{ i.paymentsOn ? 'On' : 'Off' }}</span>
        </div>
        <div class="grid">
          <span class="lbl">Payments</span>
          <span>
            <label class="me-3"><input type="radio" name="payments" [value]="true" [ngModel]="paymentsOn()" (ngModelChange)="paymentsOn.set($event)" /> On</label>
            <label><input type="radio" name="payments" [value]="false" [ngModel]="paymentsOn()" (ngModelChange)="paymentsOn.set($event)" /> Off</label>
          </span>
        </div>
        <small class="muted d-block mt-2">
          Off: no new CCAvenue payment starts on the portal or in the apps (certification, surveillance, handholding); units see
          "Online payment is not available right now". Payments already started still complete, and an amount of zero is still recorded.
        </small>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="busy() || paymentsOn() === i.paymentsOn">Save</button>
        </div>
      </form>

      <form class="zed-card" (ngSubmit)="saveGateway()" novalidate>
        <div class="card-head">
          <h5 class="card-title">CCAvenue payment gateway</h5>
          <span class="status-badge" [class.is-active]="i.gateway.inUse === 'page'" data-testid="gateway-in-use">
            In use: {{ i.gateway.inUse === 'page' ? 'the account saved here' : 'server settings file' }}
          </span>
        </div>
        @if (i.gateway.problem) {
          <div class="alert alert-warning" role="alert">The saved account is not used: {{ i.gateway.problem }}.</div>
        }
        @if (i.gateway.inUse === 'file') {
          <p class="muted">
            Server settings file: {{ i.gateway.file.configured ? 'merchant ' + (i.gateway.file.merchantId ?? '') + ', ' + (i.gateway.file.mode === 'test' ? 'test' : 'live') + ' gateway' : 'no complete account' }}.
          </p>
        }
        <p class="muted">
          Before changing to another merchant account: switch Online payments off, wait about 30 minutes so payments in
          progress can finish, save the new account, then switch Online payments on again.
        </p>
        <div class="grid">
          <span class="lbl">Gateway</span>
          <span>
            <label class="me-3"><input type="radio" name="mode" value="live" [ngModel]="mode()" (ngModelChange)="mode.set($event)" /> Live</label>
            <label [class.text-muted]="!i.gateway.testAllowed">
              <input type="radio" name="mode" value="test" [disabled]="!i.gateway.testAllowed" [ngModel]="mode()" (ngModelChange)="mode.set($event)" /> Test
            </label>
            @if (!i.gateway.testAllowed) { <small class="muted d-block">The test gateway cannot be used on the live portal.</small> }
          </span>
          <label class="lbl" for="pg-merchant">Merchant ID</label>
          <input id="pg-merchant" name="merchantId" class="form-control" inputmode="numeric" maxlength="20" [(ngModel)]="merchantId" />
          <label class="lbl" for="pg-access">Access code (web)</label>
          <input id="pg-access" name="accessCode" class="form-control" maxlength="40" autocomplete="off" [(ngModel)]="accessCode" />
          <label class="lbl" for="pg-key">Working key (web)</label>
          <span>
            <input id="pg-key" name="workingKey" type="password" class="form-control" maxlength="64" autocomplete="new-password"
                   [placeholder]="i.gateway.saved?.workingKeySet ? 'Saved (hidden): leave blank to keep' : 'Not saved'" [(ngModel)]="workingKey" />
          </span>
          <label class="lbl" for="pg-rec">Reconciliation key</label>
          <input id="pg-rec" name="reconciliationKey" type="password" class="form-control" maxlength="64" autocomplete="new-password"
                 [placeholder]="i.gateway.saved?.reconciliationKeySet ? 'Saved (hidden): leave blank to keep' : 'Not saved'" [(ngModel)]="reconciliationKey" />
          <label class="lbl" for="pg-mob-access">Access code (app)</label>
          <input id="pg-mob-access" name="mobileAccessCode" class="form-control" maxlength="40" autocomplete="off" placeholder="For the MSME app (optional)" [(ngModel)]="mobileAccessCode" />
          <label class="lbl" for="pg-mob-key">Working key (app)</label>
          <input id="pg-mob-key" name="mobileWorkingKey" type="password" class="form-control" maxlength="64" autocomplete="new-password"
                 [placeholder]="i.gateway.saved?.mobileWorkingKeySet ? 'Saved (hidden): leave blank to keep' : 'Not saved'" [(ngModel)]="mobileWorkingKey" />
        </div>
        <small class="muted d-block mt-2">
          The keys are stored encrypted and never shown again. A saved account replaces the server file's within half a minute.
          Without the app's access code and key, payments from the MSME app are refused. CCAvenue's return address: {{ i.gateway.returnBase }}/Pay/…
        </small>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="busy()">Save</button>
          @if (i.gateway.saved) {
            <button type="button" class="btn btn-outline-secondary" [disabled]="busy()" (click)="useFile()">Use server file again</button>
          }
        </div>
      </form>

      <form class="zed-card mt-3" (ngSubmit)="saveInvoices()" novalidate>
        <div class="card-head">
          <h5 class="card-title">Invoices (QCI ERP posting)</h5>
          <span class="status-badge" [class.is-active]="i.invoices.enabled" data-testid="invoices-state">{{ i.invoices.enabled ? 'On' : 'Off' }}</span>
        </div>
        <div class="grid">
          <span class="lbl">Invoices</span>
          <span>
            <label class="me-3"><input type="radio" name="invoices" [value]="true" [ngModel]="invoicesOn()" (ngModelChange)="invoicesOn.set($event)" /> On</label>
            <label><input type="radio" name="invoices" [value]="false" [ngModel]="invoicesOn()" (ngModelChange)="invoicesOn.set($event)" /> Off</label>
          </span>
          <span class="lbl">Invoice numbers</span>
          <span>{{ i.invoices.examples[0] }} (Manufacturing), {{ i.invoices.examples[1] }} (Services): each sector has its own series</span>
          <span class="lbl">ERP on the server</span>
          <span [class.text-danger]="!i.invoices.erpReady">{{ i.invoices.erpReady ? 'Set up' : 'Not set up (needed before switching on)' }}</span>
        </div>
        <small class="muted d-block mt-2">
          On: after each gateway payment the customer, invoice and receipt go to the ERP, and the invoice PDF comes back through the
          Finance API. Off: payments work as usual and no invoice is made.
        </small>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="busy() || invoicesOn() === i.invoices.enabled">Save</button>
        </div>
      </form>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .card-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 8px; }
    .grid { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 10px 14px; align-items: center; max-width: 720px; }
    .lbl { color: #5f6f70; font-weight: 600; }
    .muted { color: #6b7a7b; font-size: 13px; }
    .form-actions { display: flex; gap: 8px; margin-top: 14px; }
    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class PaymentGatewayPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/payment-gateway';

  protected readonly info = signal<PaymentGatewayInfo | null>(null);
  protected readonly mode = signal<'live' | 'test'>('live');
  protected readonly invoicesOn = signal(false);
  protected readonly paymentsOn = signal(true);
  protected merchantId = '';
  protected accessCode = '';
  protected workingKey = '';
  protected reconciliationKey = '';
  protected mobileAccessCode = '';
  protected mobileWorkingKey = '';
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected async saveGateway(): Promise<void> {
    await this.run(() =>
      firstValueFrom(
        this.http.put<MessageResponse>(PaymentGatewayPage.url, {
          mode: this.mode(),
          merchantId: this.merchantId,
          accessCode: this.accessCode,
          workingKey: this.workingKey || null,
          reconciliationKey: this.reconciliationKey || null,
          mobileAccessCode: this.mobileAccessCode || null,
          mobileWorkingKey: this.mobileWorkingKey || null,
        }),
      ),
    );
  }

  protected async useFile(): Promise<void> {
    if (!confirm('Payments will use the account in the server settings file again. Continue?')) return;
    await this.run(() => firstValueFrom(this.http.delete<MessageResponse>(PaymentGatewayPage.url)));
  }

  protected async savePayments(): Promise<void> {
    await this.run(() => firstValueFrom(this.http.put<MessageResponse>(`${PaymentGatewayPage.url}/payments`, { enabled: this.paymentsOn() })));
  }

  protected async saveInvoices(): Promise<void> {
    await this.run(() => firstValueFrom(this.http.put<MessageResponse>(`${PaymentGatewayPage.url}/invoices`, { enabled: this.invoicesOn() })));
  }

  /** Runs a change, shows its message and reloads the page's data (the key boxes are emptied). */
  private async run(change: () => Promise<MessageResponse>): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await change();
      this.success.set(r.message);
      await this.load(false);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  private async load(showBusy = true): Promise<void> {
    if (showBusy) this.busy.set(true);
    try {
      const i = await firstValueFrom(this.http.get<PaymentGatewayInfo>(PaymentGatewayPage.url));
      this.info.set(i);
      const s = i.gateway.saved;
      this.mode.set(s?.mode ?? (i.gateway.testAllowed ? i.gateway.file.mode : 'live'));
      this.merchantId = s?.merchantId ?? '';
      this.accessCode = s?.accessCode ?? '';
      this.mobileAccessCode = s?.mobileAccessCode ?? '';
      this.workingKey = this.reconciliationKey = this.mobileWorkingKey = '';
      this.invoicesOn.set(i.invoices.enabled);
      this.paymentsOn.set(i.paymentsOn);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      if (showBusy) this.busy.set(false);
    }
  }
}
