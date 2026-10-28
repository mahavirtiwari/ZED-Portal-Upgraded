import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ClientPager, PagerComponent } from '../pager';

export interface ApiClientItem {
  id: number;
  name: string;
  clientId: string | null;
  createdDate: string | null;
  baseUrl: string | null;
  access: string[];
  lastTokenOn: string | null;
  enabled: boolean;
  /** Its key may submit incentive disbursements. */
  maySubmitIncentives: boolean;
  updatedBy: string | null;
  updatedOn: string | null;
}

interface NewPartnerForm {
  name: string;
  baseUrl: string;
  /** "token": client ID and key, takes tokens (the usual partner); "static": a key sent with each lookup. */
  kind: 'token' | 'static';
  maySubmitIncentives: boolean;
  encrypted: boolean;
}

/** The new partner's secrets, shown once. */
interface PartnerCreated {
  message: string;
  id: number;
  clientId: string | null;
  secret: string;
  aesKey: string | null;
  aesIv: string | null;
}

interface PartnerForm {
  id: number;
  clientId: string | null;
  name: string;
  baseUrl: string;
  maySubmitIncentives: boolean;
}

export interface ApiGroupItem {
  key: string;
  name: string;
  usedBy: string;
  description: string;
  endpoints: string[];
  enabled: boolean;
}

export interface OutboundItem {
  name: string;
  purpose: string;
  managedAt: string;
  inV4: boolean;
}

/**
 * Administration → API Integrations (new in V4): the organisations that call ZED's partner APIs (banks and financial
 * institutions, state governments, Udyami Bharat, the RAMP dashboard, the QCI ERP), what each may call, Edit (name,
 * address, incentive submission) and Enable / Disable per partner (at once), an on/off switch per API group (within half
 * a minute); and, for information, the services ZED itself calls. Main only.
 */
@Component({
  selector: 'zed-staff-api-integrations',
  imports: [DatePipe, FormsModule, PagerComponent],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">API Integrations</h3>
        <p class="page-sub">The partners that call ZED's APIs and the services ZED calls. Disable a partner or an API to stop its calls.</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <section class="zed-card" aria-labelledby="ai-clients">
      <div class="ai-head">
        <h5 class="ai-h m-0" id="ai-clients">Partners <span class="zed-chip">{{ partners.all().length }}</span></h5>
        <button type="button" class="btn btn-primary btn-sm" [disabled]="busy()" (click)="startAdd()">+ Add partner</button>
      </div>
      <p class="muted">Each partner holds its own key. Disabled, its key and the tokens it already holds are refused.</p>
      <div class="filter-bar mb-3">
        <div class="filter wide">
          <input type="search" class="form-control" placeholder="Search partner, client ID or access" aria-label="Search partners"
                 [value]="partners.search()" (input)="partners.setSearch($any($event.target).value)" />
        </div>
      </div>
      <div class="table-responsive">
        <table class="table table-zed">
          <thead>
            <tr><th>Partner</th><th>May call</th><th>Registered</th><th>Last token</th><th class="text-center">Status</th><th class="text-center ai-actions-h">Action</th></tr>
          </thead>
          <tbody>
            @for (c of partners.page(); track c.id) {
              <tr [class.ai-off]="!c.enabled">
                <td>
                  <strong>{{ c.name }}</strong>
                  @if (c.clientId) { <small class="d-block muted">Client ID {{ c.clientId }}</small> }
                  @if (c.baseUrl) { <small class="d-block muted ai-url">{{ c.baseUrl }}</small> }
                </td>
                <td>@for (a of c.access; track a) { <span class="ai-chip">{{ a }}</span> }</td>
                <td>{{ c.createdDate ? (c.createdDate | date: 'dd-MM-yyyy') : '—' }}</td>
                <td>{{ c.lastTokenOn ? (c.lastTokenOn | date: 'dd-MM-yyyy HH:mm') : '—' }}</td>
                <td class="text-center">
                  <span class="status-badge" [class.is-active]="c.enabled" [class.is-rejected]="!c.enabled">{{ c.enabled ? 'Enabled' : 'Disabled' }}</span>
                  @if (c.updatedOn) { <small class="d-block muted mt-1">{{ c.updatedBy }} · {{ c.updatedOn | date: 'dd-MM-yyyy' }}</small> }
                </td>
                <td class="text-center ai-actions">
                  <button type="button" class="btn btn-outline-primary btn-sm" [disabled]="busy()" [attr.aria-label]="'Edit ' + c.name" (click)="edit(c)">Edit</button>
                  <button type="button" class="btn btn-sm" [class.btn-outline-danger]="c.enabled" [class.btn-outline-success]="!c.enabled" [disabled]="busy()"
                          [attr.aria-label]="(c.enabled ? 'Disable ' : 'Enable ') + c.name" (click)="setClient(c, !c.enabled)">{{ c.enabled ? 'Disable' : 'Enable' }}</button>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="6" style="padding: 0"><div class="no-data">{{ partners.search() ? 'No partner matches the search.' : 'No partners are registered. Use "+ Add partner" to register one.' }}</div></td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (partners.all().length) {
        <zed-pager [pager]="partners" />
      }
    </section>

    <section class="zed-card" aria-labelledby="ai-groups">
      <h5 class="ai-h" id="ai-groups">Partner APIs</h5>
      <p class="muted">Switch an API off for every partner at once. Its calls are then answered "switched off".</p>
      <div class="ai-groups">
        @for (g of groups(); track g.key) {
          <div class="ai-group" [class.ai-off]="!g.enabled">
            <div class="ai-group-head">
              <strong>{{ g.name }}</strong>
              <label class="ai-switch form-switch">
                <input type="checkbox" class="form-check-input" role="switch" [checked]="g.enabled" [disabled]="busy()" [attr.aria-label]="(g.enabled ? 'Switch off ' : 'Switch on ') + g.name" (change)="setGroup(g, $any($event.target))" />
                <span>{{ g.enabled ? 'On' : 'Off' }}</span>
              </label>
            </div>
            <small class="muted d-block">Used by: {{ g.usedBy }}</small>
            <p class="mb-1">{{ g.description }}</p>
            <small class="ai-endpoints">{{ g.endpoints.join(' · ') }}</small>
          </div>
        }
      </div>
    </section>

    <section class="zed-card" aria-labelledby="ai-outbound">
      <h5 class="ai-h" id="ai-outbound">Services ZED calls</h5>
      <p class="muted">For information: these are set up on the server; the captcha and the mail servers have their own settings pages.</p>
      <div class="table-responsive">
        <table class="table table-zed">
          <thead><tr><th>Service</th><th>Used for</th><th>Managed at</th><th class="text-center">In V4</th></tr></thead>
          <tbody>
            @for (o of outbound(); track o.name) {
              <tr [class.ai-off]="!o.inV4">
                <td><strong>{{ o.name }}</strong></td>
                <td>{{ o.purpose }}</td>
                <td>{{ o.managedAt }}</td>
                <td class="text-center"><span class="status-badge" [class.is-active]="o.inV4">{{ o.inV4 ? 'In use' : 'Not used' }}</span></td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    </section>
    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="ai-edit-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="ai-edit-title">Edit partner</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="editing.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="saveEdit()" novalidate>
              <div class="modal-body">
                <div class="form-grid">
                  <label for="ai-name">Partner name<span class="req">*</span></label>
                  <input id="ai-name" name="name" class="form-control" maxlength="200" [(ngModel)]="e.name" />
                  <label for="ai-url">Its address</label>
                  <input id="ai-url" name="baseUrl" type="url" class="form-control" maxlength="500" placeholder="https://" [(ngModel)]="e.baseUrl" />
                  <span class="label-like">Client ID</span>
                  <span>{{ e.clientId ?? 'None (static key)' }} <small class="muted d-block">The client ID and the key stay as they are.</small></span>
                  <span class="label-like">Incentive submission</span>
                  <label class="form-check-label ai-check"><input type="checkbox" class="form-check-input" name="maySubmitIncentives" [(ngModel)]="e.maySubmitIncentives" /> May submit incentive disbursements to ZED</label>
                </div>
                @if (editError()) { <span class="help-block" role="alert">{{ editError() }}</span> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="editing.set(null)">CANCEL</button>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">UPDATE</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (adding(); as a) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="ai-add-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="ai-add-title">Add partner</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="adding.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="saveAdd()" novalidate>
              <div class="modal-body">
                <div class="form-grid">
                  <label for="ai-add-name">Partner name<span class="req">*</span></label>
                  <input id="ai-add-name" name="name" class="form-control" maxlength="200" placeholder="e.g. SIDBI" [(ngModel)]="a.name" />
                  <label for="ai-add-url">Its address</label>
                  <input id="ai-add-url" name="baseUrl" type="url" class="form-control" maxlength="500" placeholder="https://" [(ngModel)]="a.baseUrl" />
                  <span class="label-like top" id="ai-add-kind">How it calls ZED<span class="req">*</span></span>
                  <div class="ai-kinds" role="radiogroup" aria-labelledby="ai-add-kind">
                    <label class="ai-check"><input type="radio" class="form-check-input" name="kind" value="token" [(ngModel)]="a.kind" />
                      <span>Client ID and key: takes a token, then calls the APIs <small class="muted d-block">Banks, states, dashboards (the usual partner)</small></span></label>
                    <label class="ai-check"><input type="radio" class="form-check-input" name="kind" value="static" [(ngModel)]="a.kind" />
                      <span>Key alone, sent with each call <small class="muted d-block">Certificate lookups, as the oldest partners</small></span></label>
                  </div>
                  <span class="label-like">Also</span>
                  <div class="ai-kinds">
                    <label class="ai-check"><input type="checkbox" class="form-check-input" name="maySubmitIncentives" [(ngModel)]="a.maySubmitIncentives" /> May submit incentive disbursements to ZED</label>
                    <label class="ai-check"><input type="checkbox" class="form-check-input" name="encrypted" [(ngModel)]="a.encrypted" /> Lists answered encrypted (AES key, as the RAMP dashboard)</label>
                  </div>
                </div>
                @if (addError()) { <span class="help-block" role="alert">{{ addError() }}</span> }
              </div>
              <div class="modal-footer">
                <button type="button" class="btn btn-default" (click)="adding.set(null)">CANCEL</button>
                <button type="submit" class="btn btn-primary" [disabled]="busy()">ADD PARTNER</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (created(); as c) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="ai-created-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <h3 class="registration-title m-0" id="ai-created-title">Partner added</h3>
            </div>
            <div class="modal-body">
              <div class="alert alert-warning" role="alert">Copy these now and give them to the partner securely. The key is not shown again.</div>
              <dl class="ai-secrets">
                @if (c.clientId) { <dt>Client ID</dt><dd><code>{{ c.clientId }}</code></dd> }
                <dt>Key (client secret)</dt><dd><code class="ai-secret">{{ c.secret }}</code></dd>
                @if (c.aesKey) { <dt>AES key</dt><dd><code class="ai-secret">{{ c.aesKey }}</code></dd> }
                @if (c.aesIv) { <dt>AES IV</dt><dd><code class="ai-secret">{{ c.aesIv }}</code></dd> }
              </dl>
              <button type="button" class="btn btn-outline-primary btn-sm" (click)="copy(c)">{{ copied() ? 'Copied' : 'Copy all' }}</button>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-primary" (click)="created.set(null)">DONE</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .zed-card { margin-bottom: 16px; }
    .ai-h { font-weight: 700; color: #23474a; display: flex; align-items: center; gap: 8px; }
    .ai-chip { display: inline-block; font-size: 12px; padding: 2px 8px; margin: 2px 4px 2px 0; border-radius: 10px; background: #eef6f6; color: #2f7c83; }
    .ai-url { word-break: break-all; }
    .ai-off td, .ai-off.ai-group { opacity: .6; }
    .ai-switch { display: inline-flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; white-space: nowrap; }
    .ai-switch .form-check-input { float: none; margin: 0; width: 2.2em; height: 1.2em; }
    .ai-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
    .ai-group { border: 1px solid #dfe9ea; border-radius: 12px; padding: 14px; background: #fff; }
    .ai-group-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 4px; }
    .ai-endpoints { color: #5f6f70; font-family: monospace; word-break: break-word; }
    .ai-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 6px; }
    .ai-kinds { display: flex; flex-direction: column; gap: 8px; }
    .ai-kinds .ai-check { align-items: flex-start; }
    .ai-kinds .form-check-input { margin-top: 3px; flex: none; }
    .ai-secrets { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 6px 12px; margin-bottom: 12px; }
    .ai-secrets dt { font-weight: 600; color: #3b4b4c; }
    .ai-secrets dd { margin: 0; }
    .ai-secret { word-break: break-all; user-select: all; }
    .ai-actions { white-space: nowrap; }
    .ai-actions .btn + .btn { margin-left: 6px; }
    .ai-actions-h { width: 170px; }
    .ai-check { display: flex; align-items: center; gap: 8px; margin: 0; }
    .ai-check .form-check-input { margin: 0; }
    .label-like { font-weight: 600; color: #3b4b4c; font-size: 14px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class ApiIntegrationsPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/settings/integrations';

  /** The partners, ten at a time; a switch keeps the page. */
  protected readonly partners = new ClientPager<ApiClientItem>(10);
  protected readonly groups = signal<ApiGroupItem[]>([]);
  protected readonly outbound = signal<OutboundItem[]>([]);
  protected readonly busy = signal(false);
  protected readonly editing = signal<PartnerForm | null>(null);
  protected readonly adding = signal<NewPartnerForm | null>(null);
  protected readonly addError = signal('');
  /** The new partner's secrets until the Admin closes them (never loaded again). */
  protected readonly created = signal<PartnerCreated | null>(null);
  protected readonly copied = signal(false);
  protected readonly editError = signal('');
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected async setClient(c: ApiClientItem, enabled: boolean): Promise<void> {
    if (!enabled && !confirm(`Disable ${c.name}? Its calls to ZED will be refused.`)) return;
    await this.run(() => this.http.put<MessageResponse>(`${ApiIntegrationsPage.url}/clients/${c.id}`, { enabled }));
  }

  protected startAdd(): void {
    this.addError.set('');
    this.adding.set({ name: '', baseUrl: '', kind: 'token', maySubmitIncentives: false, encrypted: false });
  }

  protected async saveAdd(): Promise<void> {
    const a = this.adding();
    if (!a) return;
    const url = a.baseUrl.trim();
    if (!a.name.trim()) return this.addError.set("Please enter the partner's name.");
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return this.addError.set('The address must be a full http(s):// address, or empty.');
    this.addError.set('');
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(this.http.post<PartnerCreated>(`${ApiIntegrationsPage.url}/clients`, { ...a, name: a.name.trim(), baseUrl: url }));
      this.adding.set(null);
      this.copied.set(false);
      this.created.set(r);
      this.success.set(r.message);
      await this.load(false);
    } catch (err) {
      this.addError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async copy(c: PartnerCreated): Promise<void> {
    const lines = [c.clientId && `Client ID: ${c.clientId}`, `Key: ${c.secret}`, c.aesKey && `AES key: ${c.aesKey}`, c.aesIv && `AES IV: ${c.aesIv}`];
    try {
      await navigator.clipboard.writeText(lines.filter(Boolean).join('\n'));
      this.copied.set(true);
    } catch {
      // The values can still be selected and copied by hand.
    }
  }

  protected edit(c: ApiClientItem): void {
    this.editError.set('');
    this.editing.set({ id: c.id, clientId: c.clientId, name: c.name, baseUrl: c.baseUrl ?? '', maySubmitIncentives: c.maySubmitIncentives });
  }

  protected async saveEdit(): Promise<void> {
    const e = this.editing();
    if (!e) return;
    const url = e.baseUrl.trim();
    if (!e.name.trim()) return this.editError.set("Please enter the partner's name.");
    if (url && !/^https?:\/\/[^\s]+$/i.test(url)) return this.editError.set('The address must be a full http(s):// address, or empty.');
    this.editError.set('');
    const ok = await this.run(
      () => this.http.put<MessageResponse>(`${ApiIntegrationsPage.url}/clients/${e.id}/details`, { name: e.name.trim(), baseUrl: url, maySubmitIncentives: e.maySubmitIncentives }),
      undefined, undefined, (m) => this.editError.set(m),
    );
    if (ok) this.editing.set(null);
  }

  protected async setGroup(g: ApiGroupItem, input: HTMLInputElement): Promise<void> {
    const enabled = input.checked;
    if (!enabled && !confirm(`Switch off ${g.name} for every partner?`)) {
      input.checked = true;
      return;
    }
    await this.run(() => this.http.put<MessageResponse>(`${ApiIntegrationsPage.url}/groups/${g.key}`, { enabled }), input, !enabled);
  }

  private async run(call: () => import('rxjs').Observable<MessageResponse>, input?: HTMLInputElement, revertTo?: boolean,
                    fail: (message: string) => void = (m) => this.error.set(m)): Promise<boolean> {
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      this.success.set((await firstValueFrom(call())).message);
      await this.load(false);
      return true;
    } catch (err) {
      if (input && revertTo !== undefined) input.checked = revertTo;
      fail(apiErrorMessage(err));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async load(showBusy = true): Promise<void> {
    if (showBusy) this.busy.set(true);
    try {
      const [clients, groups, outbound] = await Promise.all([
        firstValueFrom(this.http.get<ApiClientItem[]>(`${ApiIntegrationsPage.url}/clients`)),
        firstValueFrom(this.http.get<ApiGroupItem[]>(`${ApiIntegrationsPage.url}/groups`)),
        firstValueFrom(this.http.get<OutboundItem[]>(`${ApiIntegrationsPage.url}/outbound`)),
      ]);
      this.partners.refresh(clients);
      this.groups.set(groups);
      this.outbound.set(outbound);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      if (showBusy) this.busy.set(false);
    }
  }
}
