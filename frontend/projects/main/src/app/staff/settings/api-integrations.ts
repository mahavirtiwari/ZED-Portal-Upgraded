import { HttpClient } from '@angular/common/http';
import { DatePipe } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
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

/** The sections of the page (its tabs). */
type Section = 'partners' | 'apis' | 'services';

/**
 * Administration → API Integrations (new in V4): the organisations that call ZED's partner APIs (banks and financial
 * institutions, state governments, Udyami Bharat, the RAMP dashboard, the QCI ERP), what each may call, Edit (name,
 * address, incentive submission) and Enable / Disable per partner (at once), an on/off switch per API group (within half
 * a minute); and, for information, the services ZED itself calls. Main only. V4 layout: the counts (partners enabled, APIs
 * on, the latest token, services), a tab per section, each partner with its initials, how it signs in and its activity,
 * the endpoints as chips, and each new secret with its own Copy.
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
      <button type="button" class="btn btn-primary" [disabled]="busy()" (click)="startAdd()">+ Add partner</button>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <div class="ai-stats">
      <div class="stat"><span class="stat-value">{{ stats().enabled }}<small>/{{ stats().partners }}</small></span><span class="stat-label">Partners enabled</span></div>
      <div class="stat"><span class="stat-value">{{ stats().apisOn }}<small>/{{ stats().apis }}</small></span><span class="stat-label">Partner APIs on</span></div>
      <div class="stat"><span class="stat-value stat-text">{{ stats().lastToken ? (stats().lastToken!.on | date: 'dd-MM-yyyy HH:mm') : '—' }}</span>
        <span class="stat-label">Latest token{{ stats().lastToken ? ': ' + stats().lastToken!.name : '' }}</span></div>
      <div class="stat"><span class="stat-value">{{ stats().servicesInUse }}</span><span class="stat-label">Services ZED calls</span></div>
    </div>

    <div class="ai-tabs" role="tablist" aria-label="Sections">
      @for (t of tabs; track t.key) {
        <button type="button" role="tab" class="ai-tab" [class.active]="tab() === t.key" [attr.aria-selected]="tab() === t.key" (click)="tab.set(t.key)">
          {{ t.label }} <span class="tab-count">{{ tabCount(t.key) }}</span>
        </button>
      }
    </div>

    <section class="zed-card" aria-labelledby="ai-clients" [hidden]="tab() !== 'partners'">
      <div class="ai-head">
        <div>
          <h5 class="ai-h m-0" id="ai-clients">Partners</h5>
          <p class="muted m-0">Each partner holds its own key. Disabled, its key and the tokens it already holds are refused.</p>
        </div>
        <input type="search" class="form-control ai-search" placeholder="Search partner, client ID or access" aria-label="Search partners"
               [value]="partners.search()" (input)="partners.setSearch($any($event.target).value)" />
      </div>
      <div class="table-responsive">
        <table class="table table-zed ai-table">
          <thead>
            <tr><th>Partner</th><th>May call</th><th>Activity</th><th class="text-center">Status</th><th class="text-center ai-actions-h">Action</th></tr>
          </thead>
          <tbody>
            @for (c of partners.page(); track c.id) {
              <tr [class.ai-off]="!c.enabled">
                <td>
                  <div class="partner">
                    <span class="avatar" aria-hidden="true">{{ initials(c.name) }}</span>
                    <div class="partner-text">
                      <strong>{{ c.name }}</strong>
                      <div class="partner-meta">
                        <span class="auth-chip" [class.static]="!c.clientId">{{ c.clientId ? 'Client ID + key' : 'Key only' }}</span>
                        @if (c.maySubmitIncentives) { <span class="auth-chip incentive">Submits incentives</span> }
                      </div>
                      @if (c.clientId) { <small class="d-block muted">Client ID <code>{{ c.clientId }}</code></small> }
                      @if (c.baseUrl) { <small class="d-block muted ai-url" [title]="c.baseUrl">{{ c.baseUrl }}</small> }
                    </div>
                  </div>
                </td>
                <td>@for (a of c.access; track a) { <span class="ai-chip">{{ a }}</span> }</td>
                <td class="activity">
                  <div><span class="act-label">Registered</span> {{ c.createdDate ? (c.createdDate | date: 'dd-MM-yyyy') : '—' }}</div>
                  <div><span class="act-label">Last token</span> {{ c.lastTokenOn ? (c.lastTokenOn | date: 'dd-MM-yyyy HH:mm') : 'never' }}</div>
                </td>
                <td class="text-center">
                  <span class="status-badge" [class.is-active]="c.enabled" [class.is-rejected]="!c.enabled">{{ c.enabled ? 'Enabled' : 'Disabled' }}</span>
                  @if (c.updatedOn) { <small class="d-block muted mt-1">{{ c.updatedBy }} · {{ c.updatedOn | date: 'dd-MM-yyyy' }}</small> }
                </td>
                <td class="text-center ai-actions">
                  <button type="button" class="btn btn-outline-primary btn-sm" [disabled]="busy()" [attr.aria-label]="'Edit ' + c.name" (click)="edit(c)">Edit</button>
                  <button type="button" class="btn btn-sm" [class.btn-outline-danger]="c.enabled" [class.btn-outline-primary]="!c.enabled" [disabled]="busy()"
                          [attr.aria-label]="(c.enabled ? 'Disable ' : 'Enable ') + c.name" (click)="setClient(c, !c.enabled)">{{ c.enabled ? 'Disable' : 'Enable' }}</button>
                </td>
              </tr>
            } @empty {
              <tr><td colspan="5" style="padding: 0"><div class="no-data">{{ partners.search() ? 'No partner matches the search.' : 'No partners are registered. Use "+ Add partner" to register one.' }}</div></td></tr>
            }
          </tbody>
        </table>
      </div>
      @if (partners.all().length) {
        <zed-pager [pager]="partners" />
      }
    </section>

    <section class="zed-card" aria-labelledby="ai-groups" [hidden]="tab() !== 'apis'">
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
            <p class="mb-2 group-desc">{{ g.description }}</p>
            <small class="used-by"><span class="act-label">Used by</span> {{ g.usedBy }}</small>
            <div class="endpoints">
              @for (ep of g.endpoints; track ep) { <code class="ep">{{ ep }}</code> }
            </div>
          </div>
        }
      </div>
    </section>

    <section class="zed-card" aria-labelledby="ai-outbound" [hidden]="tab() !== 'services'">
      <h5 class="ai-h" id="ai-outbound">Services ZED calls</h5>
      <p class="muted">For information: these are set up on the server; the captcha and the mail servers have their own settings pages.</p>
      <div class="ai-services">
        @for (o of outbound(); track o.name) {
          <div class="service" [class.ai-off]="!o.inV4">
            <span class="svc-dot" [class.on]="o.inV4" aria-hidden="true"></span>
            <div class="svc-text">
              <strong>{{ o.name }}</strong>
              <small class="d-block muted">{{ o.purpose }}</small>
              <small class="d-block svc-at"><span class="act-label">Managed at</span> {{ o.managedAt }}</small>
            </div>
            <span class="status-badge" [class.is-active]="o.inV4" [class.is-inactive]="!o.inV4">{{ o.inV4 ? 'In use' : 'Not used' }}</span>
          </div>
        }
      </div>
    </section>

    @if (editing(); as e) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="ai-edit-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <div class="d-flex align-items-center gap-2">
                  <span class="avatar" aria-hidden="true">{{ initials(e.name) }}</span>
                  <h3 class="registration-title m-0" id="ai-edit-title">Edit partner</h3>
                </div>
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
                  <span class="label-like">Sign-in</span>
                  <span>
                    @if (e.clientId) { <span class="auth-chip">Client ID + key</span> <code class="ms-1">{{ e.clientId }}</code> } @else { <span class="auth-chip static">Key only</span> }
                    <small class="muted d-block mt-1">The client ID and the key stay as they are.</small>
                  </span>
                  <span class="label-like">Incentive submission</span>
                  <label class="toggle-card form-switch" for="ai-incentives">
                    <input id="ai-incentives" type="checkbox" role="switch" class="form-check-input" name="maySubmitIncentives" [(ngModel)]="e.maySubmitIncentives" />
                    <span>May submit incentive disbursements to ZED</span>
                  </label>
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
                    <label class="choice-card" [class.active]="a.kind === 'token'"><input type="radio" class="form-check-input" name="kind" value="token" [(ngModel)]="a.kind" />
                      <span><strong>Client ID and key</strong> takes a token, then calls the APIs <small class="muted d-block">Banks, states, dashboards (the usual partner)</small></span></label>
                    <label class="choice-card" [class.active]="a.kind === 'static'"><input type="radio" class="form-check-input" name="kind" value="static" [(ngModel)]="a.kind" />
                      <span><strong>Key alone</strong>, sent with each call <small class="muted d-block">Certificate lookups, as the oldest partners</small></span></label>
                  </div>
                  <span class="label-like top">Also</span>
                  <div class="ai-kinds">
                    <label class="toggle-card form-switch"><input type="checkbox" role="switch" class="form-check-input" name="maySubmitIncentives" [(ngModel)]="a.maySubmitIncentives" />
                      <span>May submit incentive disbursements to ZED</span></label>
                    <label class="toggle-card form-switch"><input type="checkbox" role="switch" class="form-check-input" name="encrypted" [(ngModel)]="a.encrypted" />
                      <span>Lists answered encrypted <small class="muted d-block">AES key, as the RAMP dashboard</small></span></label>
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
                @if (c.clientId) { <dt>Client ID</dt><dd><code>{{ c.clientId }}</code><button type="button" class="btn btn-link btn-sm copy-one" (click)="copyOne('Client ID', c.clientId)">{{ copiedOne() === 'Client ID' ? 'Copied' : 'Copy' }}</button></dd> }
                <dt>Key (client secret)</dt><dd><code class="ai-secret">{{ c.secret }}</code><button type="button" class="btn btn-link btn-sm copy-one" (click)="copyOne('Key', c.secret)">{{ copiedOne() === 'Key' ? 'Copied' : 'Copy' }}</button></dd>
                @if (c.aesKey) { <dt>AES key</dt><dd><code class="ai-secret">{{ c.aesKey }}</code><button type="button" class="btn btn-link btn-sm copy-one" (click)="copyOne('AES key', c.aesKey)">{{ copiedOne() === 'AES key' ? 'Copied' : 'Copy' }}</button></dd> }
                @if (c.aesIv) { <dt>AES IV</dt><dd><code class="ai-secret">{{ c.aesIv }}</code><button type="button" class="btn btn-link btn-sm copy-one" (click)="copyOne('AES IV', c.aesIv)">{{ copiedOne() === 'AES IV' ? 'Copied' : 'Copy' }}</button></dd> }
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
    .page-head { align-items: center; }
    .ai-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; min-width: 0; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-value small { font-size: 15px; color: #8a9899; font-weight: 600; }
    .stat-value.stat-text { font-size: 16px; padding: 4px 0 3px; }
    .stat-label { font-size: 13px; color: #5f6f70; overflow-wrap: anywhere; }

    .ai-tabs { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
    .ai-tab { display: inline-flex; align-items: center; gap: 8px; padding: 7px 18px; border-radius: 20px; border: 1px solid #d9eef0; background: #d9eef0;
      color: #174a4e; font-weight: 600; font-size: 14px; cursor: pointer; }
    .ai-tab:hover { background: #c5e5e8; border-color: #45a5ad; }
    .ai-tab.active { background: #23656b; border-color: #23656b; color: #fff; }
    .tab-count { font-size: 12px; background: rgba(255,255,255,.25); border-radius: 10px; padding: 0 8px; }
    .ai-tab:not(.active) .tab-count { background: #eef6f6; color: #23474a; }

    .zed-card { margin-bottom: 16px; }
    .ai-h { font-weight: 700; color: #23474a; display: flex; align-items: center; gap: 8px; }
    .ai-head { display: flex; justify-content: space-between; align-items: flex-end; gap: 12px; flex-wrap: wrap; margin-bottom: 12px; }
    .ai-search { flex: 0 1 340px; }
    .ai-table td { vertical-align: middle; }
    .ai-table tbody tr:hover { background: #f7fbfb; }
    .partner { display: flex; gap: 12px; align-items: flex-start; min-width: 220px; }
    .avatar { flex: 0 0 38px; width: 38px; height: 38px; border-radius: 19px; display: inline-grid; place-items: center; font-weight: 800; font-size: 13px;
      color: #fff; background: linear-gradient(135deg, #45a5ad, #23474a); letter-spacing: .03em; }
    .partner-text { min-width: 0; }
    .partner-text strong { color: #232527; }
    .partner-meta { display: flex; flex-wrap: wrap; gap: 4px; margin: 3px 0; }
    .auth-chip { display: inline-block; font-size: 11px; font-weight: 700; border-radius: 10px; padding: 1px 8px; background: #eef6f6; color: #2f7c83; }
    .auth-chip.static { background: #f1f0fb; color: #3f3a7a; }
    .auth-chip.incentive { background: #fff4d6; color: #8a6100; }
    .ai-chip { display: inline-block; font-size: 12px; padding: 2px 8px; margin: 2px 4px 2px 0; border-radius: 10px; background: #eef6f6; color: #2f7c83; }
    .ai-url { display: block; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .activity { font-size: 13px; white-space: nowrap; }
    .act-label { display: inline-block; min-width: 70px; color: #5f6f70; font-size: 12px; font-weight: 600; }
    .ai-off td, .ai-off.ai-group, .ai-off.service { opacity: .6; }
    .ai-actions { white-space: nowrap; }
    .ai-actions .btn + .btn { margin-left: 6px; }
    .ai-actions-h { width: 170px; }

    .ai-switch { display: inline-flex; align-items: center; gap: 8px; margin: 0; cursor: pointer; white-space: nowrap; }
    .ai-switch .form-check-input { float: none; margin: 0; width: 2.2em; height: 1.2em; }
    .ai-groups { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 12px; }
    .ai-group { display: flex; flex-direction: column; border: 1px solid #dfe9ea; border-top: 4px solid #45a5ad; border-radius: 12px; padding: 14px; background: #fff; }
    .ai-group.ai-off { border-top-color: #cbd5d6; border-style: dashed; border-top-style: solid; }
    .ai-group-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 6px; }
    .ai-group-head strong { color: #23474a; font-size: 15px; }
    .group-desc { font-size: 13.5px; color: #3b4b4c; }
    .used-by { font-size: 12.5px; color: #3b4b4c; margin-bottom: 8px; }
    .endpoints { display: flex; flex-wrap: wrap; gap: 4px; margin-top: auto; }
    .ep { font-size: 11.5px; background: #f4f8f8; color: #23474a; border: 1px solid #e3ecec; border-radius: 6px; padding: 1px 6px; }

    .ai-services { display: flex; flex-direction: column; gap: 8px; }
    .service { display: flex; align-items: center; gap: 12px; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 14px; }
    .svc-dot { flex: none; width: 10px; height: 10px; border-radius: 5px; background: #b7c3c4; }
    .svc-dot.on { background: #2e9e5b; }
    .svc-text { flex: 1 1 auto; min-width: 0; }
    .svc-text strong { color: #232527; }
    .svc-at { margin-top: 2px; color: #3b4b4c; }

    .ai-kinds { display: flex; flex-direction: column; gap: 8px; }
    .choice-card, .toggle-card { display: flex; gap: 10px; align-items: flex-start; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; margin: 0; cursor: pointer; font-weight: 400; }
    .choice-card.active { border-color: #45a5ad; background: #f4fafa; }
    /* The skin makes pop-up labels bold; on these cards only the option's name is. */
    .modal .modal-popup label.choice-card, .modal .modal-popup label.toggle-card { font-weight: 400; color: #232527; }
    .choice-card .form-check-input, .toggle-card .form-check-input { flex: none; margin: 3px 0 0; float: none; }
    .toggle-card.form-switch { padding-left: 12px; }
    .toggle-card.form-switch .form-check-input { margin-left: 0; width: 2em; }
    .ai-secrets { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 8px 12px; margin-bottom: 12px; align-items: center; }
    .ai-secrets dt { font-weight: 600; color: #3b4b4c; }
    .ai-secrets dd { margin: 0; display: flex; align-items: center; gap: 8px; background: #f4f8f8; border-radius: 8px; padding: 6px 10px; }
    .ai-secrets dd code { flex: 1 1 auto; }
    .copy-one { flex: none; padding: 0; }
    .ai-secret { word-break: break-all; user-select: all; }
    .label-like { font-weight: 600; color: #3b4b4c; font-size: 14px; }
    .label-like.top { align-self: start; padding-top: 8px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    @media (max-width: 767.98px) {
      .ai-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .ai-search { flex-basis: 100%; }
    }
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
  /** Which of the new partner's values was copied last (its own Copy button). */
  protected readonly copiedOne = signal('');
  protected readonly tabs: readonly { key: Section; label: string }[] = [
    { key: 'partners', label: 'Partners' },
    { key: 'apis', label: 'Partner APIs' },
    { key: 'services', label: 'Services ZED calls' },
  ];
  protected readonly tab = signal<Section>('partners');
  protected readonly stats = computed(() => {
    const all = this.partners.all();
    const groups = this.groups();
    const last = all.filter((c) => c.lastTokenOn).sort((a, b) => (b.lastTokenOn! > a.lastTokenOn! ? 1 : -1))[0];
    return {
      partners: all.length,
      enabled: all.filter((c) => c.enabled).length,
      apis: groups.length,
      apisOn: groups.filter((g) => g.enabled).length,
      lastToken: last ? { name: last.name, on: last.lastTokenOn! } : null,
      servicesInUse: this.outbound().filter((o) => o.inV4).length,
    };
  });
  protected readonly editError = signal('');
  protected readonly error = signal('');
  protected readonly success = signal('');

  constructor() {
    void this.load();
  }

  protected tabCount(section: Section): number {
    return section === 'partners' ? this.partners.all().length : section === 'apis' ? this.groups().length : this.outbound().length;
  }

  /** "AP" for Andhra Pradesh, "RD" for RAMP Dashboard: the partner's badge. */
  protected initials(name: string): string {
    const words = name.replace(/[^A-Za-z0-9 ]/g, ' ').split(/\s+/).filter((w) => w && !/^(of|the|and|govt)$/i.test(w));
    return (words.length > 1 ? words[0][0] + words[1][0] : (words[0] ?? '?').slice(0, 2)).toUpperCase();
  }

  protected async copyOne(label: string, value: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(value);
      this.copiedOne.set(label);
    } catch {
      // The value can still be selected and copied by hand.
    }
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
      this.copiedOne.set('');
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
