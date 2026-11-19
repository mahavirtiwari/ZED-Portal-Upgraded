import { HttpClient } from '@angular/common/http';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ConfirmService } from '../confirm-dialog';

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

/** 2026-11-15: the QCI ERP account as the API shows it: never the secret, only whether one is saved. */
export interface ErpInfo {
  /** "page": the account saved here; "file": the server settings file's; "none": no account. */
  inUse: 'page' | 'file' | 'none';
  problem: string | null;
  saved: {
    tenantId: string; clientId: string; clientSecretSet: boolean; companyBaseUrl: string; scope: string | null;
    customerEndpoint: string | null; invoiceEndpoint: string | null; receiptEndpoint: string | null;
  } | null;
  fileConfigured: boolean;
  defaults: { scope: string; customerEndpoint: string; invoiceEndpoint: string; receiptEndpoint: string };
}

type Section = 'payments' | 'gateway' | 'erp' | 'invoices';

/** 2026-11-15: the invoice setup (what the procedures had fixed); an empty field keeps today's value. */
export interface InvoiceSetupValues {
  seriesManufacturing: string;
  seriesServices: string;
  board: string;
  portal: string;
  locationCode: string;
  feeLedger: string;
  itemBronze: string;
  itemSilver: string;
  itemGold: string;
  excludedUdyam: string[];
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
  invoices: { enabled: boolean; erpReady: boolean; examples: string[]; erp?: ErpInfo | null; setup?: { values: InvoiceSetupValues; defaults: InvoiceSetupValues } | null };
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
      <!-- 2026-11-15 (the user): side by side as Questionnaire: the sections on the left, the chosen one on the right. -->
      <div class="pg-layout">
      <nav class="pg-nav" aria-label="Sections">
        <button type="button" class="pg-item" [class.active]="section() === 'payments'" [attr.aria-current]="section() === 'payments'" (click)="section.set('payments')">
          <span><strong>Online payments</strong><small>Payments on the portal and in the apps</small></span>
          <span class="chip" [class.is-good]="i.paymentsOn" [class.is-bad]="!i.paymentsOn">{{ i.paymentsOn ? 'On' : 'Off' }}</span>
        </button>
        <button type="button" class="pg-item" [class.active]="section() === 'gateway'" [attr.aria-current]="section() === 'gateway'" (click)="section.set('gateway')">
          <span><strong>CCAvenue payment gateway</strong><small>{{ i.gateway.inUse === 'page' ? 'The account saved here' : 'The server settings file' }}</small></span>
          <span class="chip" [class.is-good]="i.gateway.inUse === 'page' || i.gateway.file.configured">{{ i.gateway.inUse === 'page' || i.gateway.file.configured ? 'Set up' : 'Not set' }}</span>
        </button>
        <button type="button" class="pg-item" [class.active]="section() === 'erp'" [attr.aria-current]="section() === 'erp'" (click)="section.set('erp')">
          <span><strong>QCI ERP connection</strong><small>Business Central account of the invoices</small></span>
          <span class="chip" [class.is-good]="i.invoices.erpReady" [class.is-warn]="!i.invoices.erpReady">{{ i.invoices.erpReady ? 'Set up' : 'Not set' }}</span>
        </button>
        <button type="button" class="pg-item" [class.active]="section() === 'invoices'" [attr.aria-current]="section() === 'invoices'" (click)="section.set('invoices')">
          <span><strong>Invoices</strong><small>Invoice numbers and ERP posting</small></span>
          <span class="chip" [class.is-good]="i.invoices.enabled">{{ i.invoices.enabled ? 'On' : 'Off' }}</span>
        </button>
      </nav>
      <div class="pg-detail">
      <form class="zed-card" [hidden]="section() !== 'payments'" (ngSubmit)="savePayments()" novalidate>
        <div class="card-head">
          <h5 class="card-title">Online payments</h5>
          <span class="status-badge" [class.is-active]="i.paymentsOn" data-testid="payments-state">{{ i.paymentsOn ? 'On' : 'Off' }}</span>
        </div>
        <div class="grid">
          <span class="lbl">Payments</span>
          <span class="rc-group" role="radiogroup" aria-label="Payments">
            <label class="rc" [class.on]="paymentsOn() === true"><input type="radio" name="payments" [value]="true" [ngModel]="paymentsOn()" (ngModelChange)="paymentsOn.set($event)" /> On</label>
            <label class="rc" [class.on]="paymentsOn() === false"><input type="radio" name="payments" [value]="false" [ngModel]="paymentsOn()" (ngModelChange)="paymentsOn.set($event)" /> Off</label>
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

      <form class="zed-card" [hidden]="section() !== 'gateway'" (ngSubmit)="saveGateway()" novalidate>
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
            <span class="rc-group" role="radiogroup" aria-label="Gateway">
              <label class="rc" [class.on]="mode() === 'live'"><input type="radio" name="mode" value="live" [ngModel]="mode()" (ngModelChange)="mode.set($event)" /> Live</label>
              <label class="rc" [class.on]="mode() === 'test'" [class.is-disabled]="!i.gateway.testAllowed">
                <input type="radio" name="mode" value="test" [disabled]="!i.gateway.testAllowed" [ngModel]="mode()" (ngModelChange)="mode.set($event)" /> Test
              </label>
            </span>
            @if (!i.gateway.testAllowed) { <small class="muted d-block mt-1">The test gateway cannot be used on the live portal.</small> }
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
            <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="useFile()">Use server file again</button>
          }
        </div>
      </form>

      <form class="zed-card" [hidden]="section() !== 'invoices'" (ngSubmit)="saveInvoices()" novalidate>
        <div class="card-head">
          <h5 class="card-title">Invoices (QCI ERP posting)</h5>
          <span class="status-badge" [class.is-active]="i.invoices.enabled" data-testid="invoices-state">{{ i.invoices.enabled ? 'On' : 'Off' }}</span>
        </div>
        <div class="grid">
          <span class="lbl">Invoices</span>
          <span class="rc-group" role="radiogroup" aria-label="Invoices">
            <label class="rc" [class.on]="invoicesOn() === true"><input type="radio" name="invoices" [value]="true" [ngModel]="invoicesOn()" (ngModelChange)="invoicesOn.set($event)" /> On</label>
            <label class="rc" [class.on]="invoicesOn() === false"><input type="radio" name="invoices" [value]="false" [ngModel]="invoicesOn()" (ngModelChange)="invoicesOn.set($event)" /> Off</label>
          </span>
          @if (!i.invoices.setup) {
            <span class="lbl">Invoice numbers</span>
            <span>{{ i.invoices.examples[0] }} (Manufacturing), {{ i.invoices.examples[1] }} (Services): each sector has its own series</span>
          }
          <span class="lbl">QCI ERP connection</span>
          <span [class.text-danger]="!i.invoices.erpReady">
            {{ i.invoices.erpReady ? 'Set up' : 'Not set up (needed before switching on)' }}
            <button type="button" class="btn btn-link p-0 ms-1 align-baseline" (click)="section.set('erp')">{{ i.invoices.erpReady ? 'View' : 'Set it up' }}</button>
          </span>
        </div>
        <small class="muted d-block mt-2">
          On: after each gateway payment the customer, invoice and receipt go to the ERP, and the invoice PDF comes back through the
          Finance API. Off: payments work as usual and no invoice is made.
        </small>

        @if (i.invoices.setup; as setup) {
          <!-- 2026-11-15 (the user): the setup of the invoices; an empty field keeps today's value (shown greyed). -->
          <section class="inv-sec" aria-labelledby="inv-numbers">
            <h6 id="inv-numbers" class="inv-title">Invoice numbers</h6>
            <div class="grid">
              <label class="lbl" for="inv-series-m">Manufacturing series</label>
              <span class="inv-pair">
                <input id="inv-series-m" name="seriesManufacturing" class="form-control inv-short" maxlength="10" autocomplete="off"
                       [placeholder]="setup.defaults.seriesManufacturing" [(ngModel)]="inv.seriesManufacturing" />
                <span class="muted">e.g. {{ (inv.seriesManufacturing || setup.defaults.seriesManufacturing).toUpperCase() }}/{{ fy(i) }}/1</span>
              </span>
              <label class="lbl" for="inv-series-s">Services series</label>
              <span class="inv-pair">
                <input id="inv-series-s" name="seriesServices" class="form-control inv-short" maxlength="10" autocomplete="off"
                       [placeholder]="setup.defaults.seriesServices" [(ngModel)]="inv.seriesServices" />
                <span class="muted">e.g. {{ (inv.seriesServices || setup.defaults.seriesServices).toUpperCase() }}/{{ fy(i) }}/1</span>
              </span>
            </div>
            <small class="muted d-block mt-1">Letters and digits. Each sector keeps its own counter, which starts again at 1 every 1 April.</small>
          </section>

          <section class="inv-sec" aria-labelledby="inv-erp">
            <h6 id="inv-erp" class="inv-title">Values sent to the ERP</h6>
            <div class="grid">
              <label class="lbl" for="inv-board">Board</label>
              <input id="inv-board" name="board" class="form-control inv-short" maxlength="30" autocomplete="off" [placeholder]="setup.defaults.board" [(ngModel)]="inv.board" />
              <label class="lbl" for="inv-portal">Portal · Location code</label>
              <span class="inv-pair">
                <input id="inv-portal" name="portal" class="form-control inv-short" maxlength="30" autocomplete="off" aria-label="Portal" [placeholder]="setup.defaults.portal" [(ngModel)]="inv.portal" />
                <input id="inv-location" name="locationCode" class="form-control inv-short" maxlength="30" autocomplete="off" aria-label="Location code" [placeholder]="setup.defaults.locationCode" [(ngModel)]="inv.locationCode" />
              </span>
              <label class="lbl" for="inv-ledger">Fee ledger</label>
              <input id="inv-ledger" name="feeLedger" class="form-control" maxlength="100" autocomplete="off" [placeholder]="setup.defaults.feeLedger" [(ngModel)]="inv.feeLedger" />
            </div>
          </section>

          <section class="inv-sec" aria-labelledby="inv-items">
            <h6 id="inv-items" class="inv-title">Item name on the invoice, by level</h6>
            <div class="grid">
              <label class="lbl" for="inv-bronze">Bronze</label>
              <input id="inv-bronze" name="itemBronze" class="form-control" maxlength="100" autocomplete="off" [placeholder]="setup.defaults.itemBronze" [(ngModel)]="inv.itemBronze" />
              <label class="lbl" for="inv-silver">Silver</label>
              <input id="inv-silver" name="itemSilver" class="form-control" maxlength="100" autocomplete="off" [placeholder]="setup.defaults.itemSilver" [(ngModel)]="inv.itemSilver" />
              <label class="lbl" for="inv-gold">Gold</label>
              <input id="inv-gold" name="itemGold" class="form-control" maxlength="100" autocomplete="off" [placeholder]="setup.defaults.itemGold" [(ngModel)]="inv.itemGold" />
            </div>
          </section>

          <section class="inv-sec" aria-labelledby="inv-units">
            <h6 id="inv-units" class="inv-title">Units never invoiced (test units)</h6>
            <div class="inv-tags" data-testid="inv-units">
              @for (u of units(); track u) {
                <span class="inv-tag">{{ u }}<button type="button" class="inv-x" [attr.aria-label]="'Remove ' + u" (click)="removeUnit(u)">×</button></span>
              } @empty {
                <span class="muted">None: every unit's payment is posted.</span>
              }
            </div>
            <div class="inv-pair mt-2">
              <input id="inv-unit" name="newUnit" class="form-control inv-unit" maxlength="25" autocomplete="off" placeholder="UDYAM-XX-00-0000000"
                     aria-label="Add a UDYAM number" [(ngModel)]="newUnit" (keydown.enter)="$event.preventDefault(); addUnit()" />
              <button type="button" class="btn btn-outline-primary" (click)="addUnit()">Add</button>
              <span class="muted">Payments of these units are not posted to the ERP.</span>
            </div>
            @if (unitProblem()) {
              <small class="text-danger d-block mt-1" role="alert">{{ unitProblem() }}</small>
            }
          </section>
        }
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="busy() || (!i.invoices.setup && invoicesOn() === i.invoices.enabled)">Save</button>
        </div>
      </form>

      <!-- 2026-11-15 (the user): the ERP account entered here, as the CCAvenue account (else the server file's). -->
      <form class="zed-card" [hidden]="section() !== 'erp'" (ngSubmit)="saveErp()" novalidate>
        <div class="card-head">
          <h5 class="card-title">QCI ERP connection (Business Central)</h5>
          <span class="status-badge" [class.is-active]="erpInUse(i) === 'page'" data-testid="erp-in-use">
            In use: {{ erpInUse(i) === 'page' ? 'the account saved here' : erpInUse(i) === 'file' ? 'server settings file' : 'none' }}
          </span>
        </div>
        @if (i.invoices.erp?.problem; as problem) {
          <div class="alert alert-warning" role="alert">The saved account is not used: {{ problem }}</div>
        }
        <div class="grid">
          <label class="lbl" for="erp-tenant">Tenant ID</label>
          <input id="erp-tenant" name="tenantId" class="form-control" maxlength="100" autocomplete="off" placeholder="Azure directory ID or domain" [(ngModel)]="erpTenantId" />
          <label class="lbl" for="erp-client">Client ID</label>
          <input id="erp-client" name="clientId" class="form-control" maxlength="100" autocomplete="off" placeholder="Application (client) ID" [(ngModel)]="erpClientId" />
          <label class="lbl" for="erp-secret">Client secret</label>
          <input id="erp-secret" name="clientSecret" type="password" class="form-control" maxlength="500" autocomplete="new-password"
                 [placeholder]="i.invoices.erp?.saved?.clientSecretSet ? 'Saved (hidden): leave blank to keep' : 'Not saved'" [(ngModel)]="erpClientSecret" />
          <label class="lbl" for="erp-base">Company base URL</label>
          <input id="erp-base" name="companyBaseUrl" class="form-control" maxlength="500" autocomplete="off"
                 placeholder="https://api.businesscentral.dynamics.com/v2.0/<tenant>/Production/ODataV4/Company('…')/" [(ngModel)]="erpBaseUrl" />
          <label class="lbl" for="erp-scope">Scope</label>
          <input id="erp-scope" name="scope" class="form-control" maxlength="300" autocomplete="off" [placeholder]="i.invoices.erp?.defaults?.scope ?? ''" [(ngModel)]="erpScope" />
          <label class="lbl" for="erp-customer">Customer endpoint</label>
          <input id="erp-customer" name="customerEndpoint" class="form-control" maxlength="100" autocomplete="off" [placeholder]="i.invoices.erp?.defaults?.customerEndpoint ?? ''" [(ngModel)]="erpCustomerEndpoint" />
          <label class="lbl" for="erp-invoice">Invoice endpoint</label>
          <input id="erp-invoice" name="invoiceEndpoint" class="form-control" maxlength="100" autocomplete="off" [placeholder]="i.invoices.erp?.defaults?.invoiceEndpoint ?? ''" [(ngModel)]="erpInvoiceEndpoint" />
          <label class="lbl" for="erp-receipt">Receipt endpoint</label>
          <input id="erp-receipt" name="receiptEndpoint" class="form-control" maxlength="100" autocomplete="off" [placeholder]="i.invoices.erp?.defaults?.receiptEndpoint ?? ''" [(ngModel)]="erpReceiptEndpoint" />
        </div>
        <small class="muted d-block mt-2">
          The client secret is stored encrypted and never shown again. Scope and endpoints left empty use the defaults shown.
          A saved account is used from the next payment; the Invoices switch decides whether invoices are made.
        </small>
        <div class="form-actions">
          <button type="submit" class="btn btn-primary" [disabled]="busy()">Save</button>
          @if (i.invoices.erp?.saved) {
            <button type="button" class="btn btn-outline-primary" [disabled]="busy()" (click)="useErpFile()">Use server file again</button>
          }
        </div>
      </form>
      </div>
      </div>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    /* The state badge next to the title (not floating far right), in sentence case. */
    .card-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; margin-bottom: 8px; }
    .card-head .card-title { margin: 0; }
    .card-head .status-badge { text-transform: none; letter-spacing: 0; white-space: nowrap; }
    /* 2026-11-15: the sections on the left (as Questionnaire), the chosen one on the right. */
    .pg-layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start; }
    .pg-nav { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 8px; position: sticky; top: 72px; display: flex; flex-direction: column; gap: 9px; }
    .pg-item { position: relative; display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%; text-align: left; border: 1px solid transparent;
      border-radius: 8px; background: transparent; padding: 10px 12px; color: #23474a; min-height: 76px; }
    .pg-item > span:first-child { min-width: 0; }
    /* A clear line between the sections (the user, 2026-11-15). */
    .pg-item:not(:last-child)::after { content: ''; position: absolute; left: 4px; right: 4px; bottom: -5px; height: 1px; background: #c5d6d8; pointer-events: none; }
    .pg-item .chip { white-space: nowrap; }
    .pg-item:hover { background: #f4f8f8; }
    .pg-item.active { background: #eef6f6; border-color: #9cc9cd; }
    .pg-item strong { display: block; font-size: 14px; }
    .pg-item small { display: block; font-size: 12px; color: #7a8a8b; }
    .pg-item .chip { flex: none; border-radius: 12px; padding: 2px 10px; font-size: 12px; font-weight: 700; background: #eef1f1; color: #5f6f70; }
    .pg-item .chip.is-good { background: #e3f4e8; color: #1e7a3c; }
    .pg-item .chip.is-warn { background: #fdf1dc; color: #a86a12; }
    .pg-item .chip.is-bad { background: #fbe4e1; color: #b03a2e; }
    .pg-detail > .zed-card { margin: 0; }
    .pg-detail > form[hidden] { display: none !important; }
    @media (max-width: 900px) { .pg-layout { grid-template-columns: minmax(0, 1fr); } .pg-nav { position: static; } }
    .grid { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 10px 14px; align-items: center; max-width: 900px; }
    /* Long values (URLs, endpoints) use the full column instead of a fixed narrow box. */
    .grid > .form-control, .grid > span > .form-control { width: 100%; max-width: none; }
    /* Styled radio cards instead of the browser's native radios. */
    .rc-group { display: inline-flex; flex-wrap: wrap; gap: 8px; }
    .rc { display: inline-flex; align-items: center; gap: 8px; margin: 0; min-height: 36px; padding: 6px 16px 6px 12px; border: 1px solid #cbd9da; border-radius: 8px;
      background: #fff; color: #23474a; font-weight: 600; cursor: pointer; text-transform: none; }
    .rc:hover { border-color: #45a5ad; }
    .rc.on { border-color: var(--zt-dark, #23656b); background: #eef6f6; box-shadow: inset 0 0 0 1px var(--zt-dark, #23656b); }
    .rc input { width: 16px; height: 16px; margin: 0; accent-color: var(--zt-dark, #23656b); cursor: pointer; }
    .rc.is-disabled { opacity: .55; cursor: not-allowed; }
    .rc.is-disabled input { cursor: not-allowed; }
    .lbl { color: #5f6f70; font-weight: 600; }
    .muted { color: #6b7a7b; font-size: 13px; }
    .form-actions { display: flex; gap: 8px; margin-top: 14px; justify-content: flex-end; }
    .inv-sec { border-top: 1px solid #dfe9ea; margin-top: 14px; padding-top: 12px; }
    .inv-title { font-size: 12px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; color: var(--zt-mid2, #2f7c83); margin: 0 0 8px; }
    .inv-pair { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
    .inv-short { max-width: 160px; }
    .inv-unit { max-width: 240px; }
    .inv-tags { display: flex; flex-wrap: wrap; gap: 6px; }
    .inv-tag { display: inline-flex; align-items: center; gap: 4px; border: 1px solid #cbd9da; border-radius: 4px; padding: 2px 4px 2px 8px; font-size: 12.5px; background: #fff; }
    .inv-x { display: inline-grid; place-items: center; width: 24px; height: 24px; border: 0; border-radius: 4px; background: transparent; color: #b03a2e;
      font-size: 18px; line-height: 1; padding: 0; cursor: pointer; }
    .inv-x:hover { background: #fbe4e1; }
    @media (max-width: 600px) { .grid { grid-template-columns: 1fr; } }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class PaymentGatewayPage {
  private readonly http = inject(HttpClient);
  private readonly confirms = inject(ConfirmService);
  private static readonly url = '/api/staff/settings/payment-gateway';

  protected readonly info = signal<PaymentGatewayInfo | null>(null);
  protected readonly mode = signal<'live' | 'test'>('live');
  protected readonly invoicesOn = signal(false);
  protected readonly paymentsOn = signal(true);
  /** The invoice setup being edited (an empty field keeps today's value). */
  protected inv: Omit<InvoiceSetupValues, 'excludedUdyam'> = PaymentGatewayPage.emptySetup();
  protected readonly units = signal<string[]>([]);
  protected newUnit = '';
  protected readonly unitProblem = signal('');

  private static emptySetup(): Omit<InvoiceSetupValues, 'excludedUdyam'> {
    return { seriesManufacturing: '', seriesServices: '', board: '', portal: '', locationCode: '', feeLedger: '', itemBronze: '', itemSilver: '', itemGold: '' };
  }

  /** The financial year part of an invoice number (2627), from the example the server gives. */
  protected fy(i: PaymentGatewayInfo): string {
    return i.invoices.examples[0]?.split('/')[1] ?? '';
  }

  protected addUnit(): void {
    const u = this.newUnit.trim().toUpperCase();
    this.unitProblem.set('');
    if (!u) return;
    if (!/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/.test(u)) {
      this.unitProblem.set('Please enter a UDYAM number like UDYAM-UP-29-0003915.');
      return;
    }
    if (!this.units().includes(u)) this.units.update((list) => [...list, u]);
    this.newUnit = '';
  }

  protected removeUnit(u: string): void {
    this.units.update((list) => list.filter((x) => x !== u));
  }
  /** The section shown on the right. */
  protected readonly section = signal<Section>('payments');
  protected erpTenantId = '';
  protected erpClientId = '';
  protected erpClientSecret = '';
  protected erpBaseUrl = '';
  protected erpScope = '';
  protected erpCustomerEndpoint = '';
  protected erpInvoiceEndpoint = '';
  protected erpReceiptEndpoint = '';

  protected erpInUse(i: PaymentGatewayInfo): 'page' | 'file' | 'none' {
    return i.invoices.erp?.inUse ?? (i.invoices.erpReady ? 'file' : 'none');
  }

  protected async saveErp(): Promise<void> {
    await this.run(() =>
      firstValueFrom(
        this.http.put<MessageResponse>(`${PaymentGatewayPage.url}/erp`, {
          tenantId: this.erpTenantId,
          clientId: this.erpClientId,
          clientSecret: this.erpClientSecret || null,
          companyBaseUrl: this.erpBaseUrl,
          scope: this.erpScope || null,
          customerEndpoint: this.erpCustomerEndpoint || null,
          invoiceEndpoint: this.erpInvoiceEndpoint || null,
          receiptEndpoint: this.erpReceiptEndpoint || null,
        }),
      ),
    );
  }

  protected async useErpFile(): Promise<void> {
    if (!(await this.confirms.ask({ title: 'Use the Settings File Account?', message: 'ERP postings will use the account in the server settings file again.', confirmLabel: 'Continue' }))) return;
    await this.run(() => firstValueFrom(this.http.delete<MessageResponse>(`${PaymentGatewayPage.url}/erp`)));
  }
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
    if (!(await this.confirms.ask({ title: 'Use the Settings File Account?', message: 'Payments will use the account in the server settings file again.', confirmLabel: 'Continue' }))) return;
    await this.run(() => firstValueFrom(this.http.delete<MessageResponse>(PaymentGatewayPage.url)));
  }

  protected async savePayments(): Promise<void> {
    await this.run(() => firstValueFrom(this.http.put<MessageResponse>(`${PaymentGatewayPage.url}/payments`, { enabled: this.paymentsOn() })));
  }

  protected async saveInvoices(): Promise<void> {
    const body = this.info()?.invoices.setup
      ? { enabled: this.invoicesOn(), setup: { ...this.inv, excludedUdyam: this.units() } }
      : { enabled: this.invoicesOn() };
    await this.run(() => firstValueFrom(this.http.put<MessageResponse>(`${PaymentGatewayPage.url}/invoices`, body)));
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
      // A value equal to today's default shows as an empty field (its default greyed in it).
      const sv = i.invoices.setup;
      this.inv = PaymentGatewayPage.emptySetup();
      if (sv) {
        for (const k of Object.keys(this.inv) as (keyof typeof this.inv)[]) this.inv[k] = sv.values[k] === sv.defaults[k] ? '' : sv.values[k];
      }
      this.units.set(sv ? [...sv.values.excludedUdyam] : []);
      this.newUnit = '';
      this.unitProblem.set('');
      const e = i.invoices.erp?.saved;
      this.erpTenantId = e?.tenantId ?? '';
      this.erpClientId = e?.clientId ?? '';
      this.erpBaseUrl = e?.companyBaseUrl ?? '';
      this.erpScope = e?.scope ?? '';
      this.erpCustomerEndpoint = e?.customerEndpoint ?? '';
      this.erpInvoiceEndpoint = e?.invoiceEndpoint ?? '';
      this.erpReceiptEndpoint = e?.receiptEndpoint ?? '';
      this.erpClientSecret = '';
      this.paymentsOn.set(i.paymentsOn);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      if (showBusy) this.busy.set(false);
    }
  }
}
