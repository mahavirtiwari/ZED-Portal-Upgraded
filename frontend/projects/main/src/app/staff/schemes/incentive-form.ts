import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { INCENTIVE_GROUPS, IncentiveDisplay, IncentiveForm, IncentiveGroup, IncentivesApi, STATES } from './incentives.api';
import { GROUP_CARD, MAX_INCENTIVE_DOC_BYTES } from './incentive-master';

type TextKey = 'incentive' | 'details' | 'ministryOrDepartment' | 'contactPerson' | 'mobileNo' | 'email' | 'videoLink' | 'webLink' | 'cardHighlight';
type LevelKey = 'applicableForBronze' | 'applicableForSilver' | 'applicableForGold';

function emptyForm(): IncentiveForm {
  return {
    incentiveType: '', incentive: '', details: '', ministryOrDepartment: '', contactPerson: '', webLink: '', email: '',
    mobileNo: '', videoLink: '', applicableForBronze: false, applicableForSilver: false, applicableForGold: false, activeStatus: true,
    displayOn: 'Card', cardHighlight: '',
  };
}

/** The stakeholder cards of "My Incentives" on the MSME dashboard (their picture and fixed text), for the preview. */
const STAKEHOLDER_CARD: Record<IncentiveGroup['key'], { image: string; text: string }> = {
  ministry: { image: '/Images/Dashboard/dash-msme.PNG', text: 'Incentives by MoMSME through its schemes, for ZED Certified MSMEs' },
  state: { image: '/Images/Dashboard/stateUts.png', text: 'Incentives by States/UTs for ZED Certified MSMEs' },
  financial: { image: '/Images/Dashboard/financial-Institution.png', text: 'Incentives by Financial Institutions for ZED Certified MSMEs' },
  others: { image: '/Images/Dashboard/incentive.png', text: 'Incentives by Central Ministries/Other Organisations for ZED Certified MSMEs' },
};

/**
 * Create New Incentive / Edit Incentive (V4, as the LEAN portal's incentive form): the incentive's details, its
 * nodal contact and its resources (links and the two PDF documents, uploaded once the incentive is saved), with the
 * wording of its group. A saved incentive keeps its group, state and levels (SP_MASTER_UPDATE_INCENTIVE does not
 * change them), so they are shown but not editable. "Where it appears" (V4): its own card in "My Incentives" of the MSME
 * dashboard, or listed inside its stakeholder card (Ministry of MSME, States/UTs, ...), as before. V4 layout: numbered
 * sections (details, levels as choice cards, nodal contact, resources, where it appears and status) beside a live
 * preview of the card as the MSME dashboard shows it, and a save bar that says when there are unsaved changes.
 */
@Component({
  selector: 'zed-staff-incentive-form',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ editId() ? 'Edit Incentive' : 'Create New Incentive' }} <span class="zed-chip">{{ group().label }}</span></h3>
        <p class="page-sub">{{ editId() ? group().subtitle : group().createSubtitle }}</p>
      </div>
      <a class="btn btn-default" [routerLink]="['/staff/incentives', group().key]" [queryParams]="stateParams()">← Back to the list</a>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (loaded()) {
      <form (ngSubmit)="save()" novalidate>
        <div class="inc-form">
          <div class="inc-sections">
            <section class="zed-card" aria-labelledby="inc-details-h">
              <h5 class="inc-h" id="inc-details-h"><span class="inc-step">1</span> Incentive details</h5>
              <label class="form-label" for="inc-incentive">Incentive title<span class="req">*</span></label>
              <input class="form-control" id="inc-incentive" name="incentive" maxlength="4000" placeholder="e.g. CLCS-TUS Capital Subsidy Scheme" [ngModel]="form().incentive" (ngModelChange)="patch('incentive', $event)" />
              <label class="form-label" for="inc-details">Description<span class="req">*</span></label>
              <textarea class="form-control" id="inc-details" name="details" rows="4" maxlength="4000" placeholder="Eligibility, quantum of assistance, application route and scope of the scheme." [ngModel]="form().details" (ngModelChange)="patch('details', $event)"></textarea>
              <small class="muted d-block text-end">{{ form().details.length }} / 4000</small>
              <div class="inc-pair">
                <div>
                  <label class="form-label" for="inc-group">Stakeholder<span class="req">*</span></label>
                  <select class="form-select" id="inc-group" name="group" [disabled]="!!editId()" [ngModel]="group().key" (ngModelChange)="pickGroup($event)">
                    @for (g of groups; track g.key) { <option [value]="g.key">{{ g.label }}</option> }
                  </select>
                </div>
                @if (group().key === 'state') {
                  <div>
                    <label class="form-label" for="inc-state">State / UT<span class="req">*</span></label>
                    <select class="form-select" id="inc-state" name="state" [disabled]="!!editId()" [ngModel]="state()" (ngModelChange)="state.set($event)">
                      <option value="">Select state</option>
                      @for (s of states; track s.id) { <option [value]="s.name">{{ s.name }}</option> }
                    </select>
                  </div>
                }
              </div>
              <label class="form-label" for="inc-ministryOrDepartment">{{ group().department }}<span class="req">*</span></label>
              <input class="form-control" id="inc-ministryOrDepartment" name="ministryOrDepartment" maxlength="4000" [placeholder]="group().departmentHint" [ngModel]="form().ministryOrDepartment" (ngModelChange)="patch('ministryOrDepartment', $event)" />
            </section>

            <section class="zed-card" aria-labelledby="inc-levels-h">
              <h5 class="inc-h" id="inc-levels-h"><span class="inc-step">2</span> Activation level<span class="req">*</span></h5>
              <div class="level-options" role="group" aria-label="Activation level">
                @for (l of levels; track l.key) {
                  <label class="level-option" [class]="'lv-' + l.label.toLowerCase()" [class.is-on]="form()[l.key]" [class.is-locked]="!!editId()">
                    <input type="checkbox" class="form-check-input" [id]="'inc-' + l.key" [name]="l.key" [disabled]="!!editId()" [ngModel]="form()[l.key]" (ngModelChange)="patchLevel(l.key, $event)" />
                    <span class="level-body"><span class="level-name">{{ l.label }}</span><span class="level-help">Units with {{ l.label }} certification</span></span>
                  </label>
                }
              </div>
              <small class="muted d-block mt-2">{{ editId() ? 'The stakeholder, state and levels of a saved incentive stay as they are.' : 'Tick every level this incentive applies to.' }}</small>
            </section>

            <section class="zed-card" aria-labelledby="inc-contact-h">
              <h5 class="inc-h" id="inc-contact-h"><span class="inc-step">3</span> Nodal contact</h5>
              <label class="form-label" for="inc-contactPerson">Contact person with designation<span class="req">*</span></label>
              <input class="form-control" id="inc-contactPerson" name="contactPerson" maxlength="2000" placeholder="e.g. Shri A. Kumar, Deputy Director" [ngModel]="form().contactPerson" (ngModelChange)="patch('contactPerson', $event)" />
              <div class="inc-pair">
                <div>
                  <label class="form-label" for="inc-mobileNo">Mobile / phone number<span class="req">*</span></label>
                  <input class="form-control" id="inc-mobileNo" name="mobileNo" maxlength="15" [ngModel]="form().mobileNo" (ngModelChange)="patch('mobileNo', $event)" />
                </div>
                <div>
                  <label class="form-label" for="inc-email">Official e-mail<span class="req">*</span></label>
                  <input class="form-control" id="inc-email" name="email" type="email" maxlength="200" [ngModel]="form().email" (ngModelChange)="patch('email', $event)" />
                </div>
              </div>
            </section>

            <section class="zed-card" aria-labelledby="inc-res-h">
              <h5 class="inc-h" id="inc-res-h"><span class="inc-step">4</span> Attach resources</h5>
              <div class="inc-pair">
                <div>
                  <label class="form-label" for="inc-webLink">Portal / scheme link<span class="req">*</span></label>
                  <input class="form-control" id="inc-webLink" name="webLink" maxlength="1000" placeholder="https://" [ngModel]="form().webLink" (ngModelChange)="patch('webLink', $event)" />
                  <small class="muted">A full address starting with https://, or --- when there is none.</small>
                </div>
                <div>
                  <label class="form-label" for="inc-videoLink">Video link (tutorial / guide)</label>
                  <input class="form-control" id="inc-videoLink" name="videoLink" maxlength="2000" placeholder="https://" [ngModel]="form().videoLink" (ngModelChange)="patch('videoLink', $event)" />
                </div>
              </div>
              <div class="inc-pair">
                @for (n of [1, 2]; track n) {
                  <div>
                    <label class="form-label" [for]="'inc-doc' + n">{{ n === 1 ? 'Guidelines' : 'Gazette / other document' }} (PDF, up to 2 MB)</label>
                    <div class="doc-row">
                      <input class="form-control" type="file" accept="application/pdf" [id]="'inc-doc' + n" (change)="pick(n === 1 ? 1 : 2, $event)" />
                      @if (hasDocument()[n - 1]) {
                        <a [href]="docUrl(n)" target="_blank" rel="noopener" [attr.aria-label]="'Current document ' + n"><img src="Images/svgicons/pdf-icon.svg" alt="" height="26" /></a>
                      }
                    </div>
                  </div>
                }
              </div>
            </section>

            <section class="zed-card" aria-labelledby="inc-where-h">
              <h5 class="inc-h" id="inc-where-h"><span class="inc-step">5</span> Where it appears</h5>
              <div class="where-options" role="radiogroup" aria-labelledby="inc-where-h">
                @for (o of places; track o.value) {
                  <label class="where-option" [class.is-on]="form().displayOn === o.value" [for]="'inc-where-' + o.value">
                    <input class="form-check-input" type="radio" name="displayOn" [id]="'inc-where-' + o.value" [value]="o.value"
                           [ngModel]="form().displayOn" (ngModelChange)="patchDisplay($event)" />
                    <span class="where-body">
                      <span class="where-title">{{ o.title }}</span>
                      <span class="where-help">{{ o.value === 'Card' ? o.help.replace('{group}', groupCard()) : o.help }}</span>
                    </span>
                  </label>
                }
              </div>
              @if (form().displayOn === 'Dashboard') {
                <label class="form-label" for="inc-cardHighlight">Card highlight</label>
                <input class="form-control" id="inc-cardHighlight" name="cardHighlight" maxlength="300" placeholder="e.g. Up to Rs. 5,00,000/-"
                       [ngModel]="form().cardHighlight" (ngModelChange)="patch('cardHighlight', $event)" />
                <small class="muted">Shown in colour on the card, before the first lines of the description. The card's Avail button shows the full details.</small>
              }

              <h5 class="inc-h mt-4">Status</h5>
              <div class="form-check form-switch inc-switch" [class.is-on]="form().activeStatus">
                <input class="form-check-input" type="checkbox" role="switch" id="inc-active" name="activeStatus" [ngModel]="form().activeStatus" (ngModelChange)="patchActive($event)" />
                <label class="form-check-label" for="inc-active">{{ form().activeStatus ? 'Active: shown on the public incentive pages' : 'Inactive: not shown to MSMEs' }}</label>
              </div>
            </section>
          </div>

          <aside class="inc-preview" aria-label="Preview">
            <h4>Preview</h4>
            @if (form().displayOn === 'Dashboard') {
              <p class="pv-where">Its own card in "My Incentives" on the MSME dashboard</p>
              <div class="pv-card" [class.is-off]="!form().activeStatus">
                <div class="pv-card-head">
                  <img src="/Images/Dashboard/incentive.png" alt="" />
                  <span class="pv-avail" aria-hidden="true">Avail</span>
                </div>
                <div class="pv-card-body">
                  <div class="pv-title">{{ form().incentive.trim() || 'Incentive title' }}</div>
                  <p class="pv-text">@if (form().cardHighlight.trim()) { <span class="pv-spot">{{ form().cardHighlight }}</span> } {{ form().details.trim() || 'The first lines of the description show here.' }}</p>
                </div>
              </div>
            } @else {
              <p class="pv-where">Listed inside the {{ groupCard() }} card of the MSME dashboard</p>
              <div class="pv-card" [class.is-off]="!form().activeStatus">
                <div class="pv-card-head">
                  <img [src]="stakeholderCard().image" alt="" [class.pv-wide]="group().key === 'ministry'" />
                  <span class="pv-avail" aria-hidden="true">Avail</span>
                </div>
                <div class="pv-card-body">
                  <div class="pv-title">{{ groupCard() }}</div>
                  <p class="pv-text">{{ stakeholderCard().text }}</p>
                </div>
              </div>
              <p class="pv-where mt-3">Avail opens the incentive page, where it shows as</p>
              <div class="pv-row" [class.is-off]="!form().activeStatus">
                <strong>{{ form().incentive.trim() || 'Incentive title' }}</strong>
                <small class="muted d-block">{{ form().ministryOrDepartment.trim() || group().departmentHint }}</small>
              </div>
            }

            <dl class="pv-facts">
              <div><dt>Applies to</dt><dd>
                @for (l of chosenLevels(); track l) { <span class="lv-chip" [class]="'lv-' + l.toLowerCase()">{{ l }}</span> }
                @if (!chosenLevels().length) { <span class="pv-missing">No level ticked yet</span> }
              </dd></div>
              <div><dt>Status</dt><dd>
                <span class="status-badge" [class.is-active]="form().activeStatus" [class.is-inactive]="!form().activeStatus">{{ form().activeStatus ? 'Active' : 'Inactive' }}</span>
              </dd></div>
            </dl>
            <small class="muted d-block">MSMEs not certified at these levels see the card faded.</small>
          </aside>
        </div>
        <div class="form-actions save-bar" [class.is-dirty]="dirty()">
          @if (dirty()) { <span class="unsaved me-auto">Not saved yet. All fields marked * are mandatory.</span> }
          @else { <span class="muted me-auto">All fields marked * are mandatory.</span> }
          <a class="btn btn-default" [routerLink]="['/staff/incentives', group().key]" [queryParams]="stateParams()">Cancel</a>
          <button type="submit" class="btn btn-primary" [disabled]="busy()">Save Incentive</button>
        </div>
      </form>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .page-head { align-items: center; }
    .inc-form { display: grid; grid-template-columns: minmax(0, 1fr) 340px; gap: 16px; align-items: start; }
    .inc-sections { display: flex; flex-direction: column; gap: 16px; min-width: 0; }
    .inc-sections .zed-card { margin: 0; }
    .inc-h { display: flex; align-items: center; gap: 8px; font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: #2f7c83; margin-bottom: 4px; }
    .inc-step { flex: none; width: 24px; height: 24px; border-radius: 12px; display: inline-grid; place-items: center; background: #45a5ad; color: #fff; font-size: 12px; }
    .form-label { display: block; margin: 12px 0 4px; }
    .inc-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 0 12px; }
    .doc-row { display: flex; align-items: center; gap: 8px; }
    .doc-row .form-control { min-width: 0; }

    .level-options { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; margin-top: 10px; }
    .level-option { --accent: #45a5ad; display: flex; gap: 10px; align-items: flex-start; margin: 0; padding: 12px 14px; border: 1px solid #dfe9ea;
      border-left: 4px solid var(--accent); border-radius: 10px; background: #fff; cursor: pointer; font-weight: 400; }
    .level-option.lv-bronze { --accent: #d07b5c; }
    .level-option.lv-silver { --accent: #9aa5ab; }
    .level-option.lv-gold { --accent: #c9a227; }
    .level-option:hover { border-color: var(--accent); }
    .level-option.is-on { background: #f4fafa; box-shadow: inset 0 0 0 1px var(--accent); border-color: var(--accent); }
    .level-option.is-locked { cursor: default; opacity: .85; }
    .level-option .form-check-input { flex: none; margin: 3px 0 0; float: none; }
    .level-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
    .level-name { font-weight: 700; color: #23474a; }
    .level-help { font-size: 12.5px; color: #5f6f70; }

    .inc-switch { display: flex; align-items: center; gap: 10px; padding: 10px 14px; margin-top: 8px; border: 1px solid #dfe9ea; border-radius: 10px; background: #f6f8f8; }
    .inc-switch.is-on { background: #f1faf4; border-color: #bfe3cc; }
    .inc-switch .form-check-input { float: none; margin: 0; flex: none; }
    .where-options { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 8px; }
    .where-option { display: flex; gap: 10px; align-items: flex-start; margin: 0; padding: 12px 14px; border: 1px solid #dfe9ea; border-radius: 10px;
      background: #fff; cursor: pointer; transition: border-color .15s, background .15s; }
    .where-option:hover { border-color: #45a5ad; }
    .where-option.is-on { border-color: #45a5ad; background: #eef6f6; box-shadow: inset 0 0 0 1px #45a5ad; }
    .where-option .form-check-input { flex: 0 0 auto; margin: 3px 0 0; }
    .where-body { display: flex; flex-direction: column; gap: 2px; }
    .where-title { font-weight: 700; color: #23474a; }
    .where-help { font-size: 13px; color: #5f6f70; }

    /* The preview: the card as the MSME dashboard draws it ("My Incentives"). */
    .inc-preview { position: sticky; top: 12px; background: #f4f8f8; border: 1px solid #dfe9ea; border-radius: 12px; padding: 14px; min-width: 0; }
    .inc-preview h4 { font-size: 13px; font-weight: 700; color: #23474a; text-transform: uppercase; letter-spacing: .04em; margin: 0 0 6px; }
    .pv-where { font-size: 12.5px; color: #5f6f70; margin: 0 0 8px; }
    .pv-card { background: #fff; border: 1px solid #ddd; border-radius: 8px; box-shadow: 0 8px 16px rgba(0, 0, 0, .1); overflow: hidden; }
    .pv-card.is-off, .pv-row.is-off { opacity: .5; }
    .pv-card-head { display: flex; justify-content: space-between; align-items: flex-start; padding: 16px 16px 0; }
    .pv-card-head img { width: 80px; max-height: 70px; object-fit: contain; }
    .pv-card-head img.pv-wide { width: 130px; }
    .pv-avail { background: #45a5ad; color: #fff; font-size: 12px; font-weight: 600; border-radius: 4px; padding: 4px 10px; text-transform: uppercase; }
    .pv-card-body { padding: 10px 16px 16px; }
    .pv-title { font-weight: 700; font-size: 17px; color: #232527; margin-bottom: 6px; overflow-wrap: anywhere; }
    .pv-text { margin: 0; font-size: 14px; color: #232527; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
    .pv-spot { color: #27aae1; font-weight: 700; }
    .pv-row { background: #fff; border: 1px solid #dfe9ea; border-radius: 8px; padding: 10px 12px; overflow-wrap: anywhere; }
    .pv-facts { margin: 14px 0 6px; font-size: 13px; }
    .pv-facts > div { display: grid; grid-template-columns: 80px minmax(0, 1fr); gap: 8px; padding: 6px 0; border-top: 1px solid #e3ecec; align-items: center; }
    .pv-facts dt { font-weight: 600; color: #5f6f70; }
    .pv-facts dd { margin: 0; display: flex; flex-wrap: wrap; gap: 4px; }
    .pv-missing { color: #a8303a; font-size: 12.5px; }
    .lv-chip { display: inline-block; font-size: 12px; font-weight: 700; border-radius: 12px; padding: 2px 10px; }
    .lv-chip.lv-bronze { background: #fbeee8; color: #8a4a33; }
    .lv-chip.lv-silver { background: #eef1f2; color: #4f5b60; }
    .lv-chip.lv-gold { background: #fbf3d9; color: #7a6110; }

    /* Save bar: stays at the bottom of the window. */
    .save-bar { position: sticky; bottom: 0; z-index: 5; align-items: center; margin-top: 16px; padding: 12px 16px; background: #fff;
      border: 1px solid #dfe9ea; border-radius: 12px; box-shadow: 0 -2px 12px rgba(16, 61, 64, 0.08); }
    .save-bar.is-dirty { border-color: #e9c46a; background: #fffcf2; }
    .unsaved { font-weight: 600; color: #8a6100; }
    @media (max-width: 1100px) {
      .inc-form { grid-template-columns: minmax(0, 1fr); }
      .inc-preview { position: static; }
    }
    @media (max-width: 640px) {
      .inc-pair, .where-options, .level-options { grid-template-columns: minmax(0, 1fr); }
      .save-bar .me-auto { flex-basis: 100%; }
    }
  `,
})
export class IncentiveFormPage {
  private readonly api = inject(IncentivesApi);
  private readonly router = inject(Router);

  protected readonly groups = INCENTIVE_GROUPS;
  protected readonly states = STATES;
  protected readonly levels: { key: LevelKey; label: string }[] = [
    { key: 'applicableForBronze', label: 'Bronze' }, { key: 'applicableForSilver', label: 'Silver' }, { key: 'applicableForGold', label: 'Gold' },
  ];

  protected readonly places: { value: IncentiveDisplay; title: string; help: string }[] = [
    { value: 'Dashboard', title: 'Main dashboard', help: 'Its own card in "My Incentives" on every MSME\'s dashboard.' },
    { value: 'Card', title: 'Stakeholder card', help: 'Listed inside the {group} card of the dashboard.' },
  ];

  protected readonly group = signal<IncentiveGroup>(INCENTIVE_GROUPS[0]);
  protected readonly state = signal('');
  protected readonly editId = signal<number | null>(null);
  protected readonly form = signal<IncentiveForm>(emptyForm());
  /** The form as loaded (or empty), to tell whether there are unsaved changes. */
  private readonly initial = signal(JSON.stringify(emptyForm()));
  protected readonly hasDocument = signal<[boolean, boolean]>([false, false]);
  private readonly files: [File | null, File | null] = [null, null];
  private readonly filesChosen = signal(0);
  protected readonly dirty = computed(() => this.filesChosen() > 0 || JSON.stringify(this.form()) !== this.initial());
  protected readonly chosenLevels = computed(() => this.levels.filter((l) => this.form()[l.key]).map((l) => l.label));
  protected readonly stakeholderCard = computed(() => STAKEHOLDER_CARD[this.group().key]);
  protected readonly loaded = signal(false);
  protected readonly busy = signal(false);
  protected readonly error = signal('');

  constructor() {
    const route = inject(ActivatedRoute).snapshot;
    this.group.set(INCENTIVE_GROUPS.find((g) => g.key === route.paramMap.get('group')) ?? INCENTIVE_GROUPS[0]);
    this.state.set(STATES.find((s) => s.name === route.queryParamMap.get('state'))?.name ?? '');
    const id = Number(route.paramMap.get('id'));
    if (id > 0) {
      this.editId.set(id);
      void this.load(id);
    } else {
      this.loaded.set(true);
    }
  }

  protected patch(key: TextKey, value: string): void {
    this.form.update((f) => ({ ...f, [key]: value }));
  }

  protected patchLevel(key: LevelKey, value: boolean): void {
    this.form.update((f) => ({ ...f, [key]: !!value }));
  }

  protected patchDisplay(value: IncentiveDisplay): void {
    this.form.update((f) => ({ ...f, displayOn: value === 'Dashboard' ? 'Dashboard' : 'Card' }));
  }

  /** The dashboard card that lists the group's incentives. */
  protected groupCard(): string {
    return GROUP_CARD[this.group().key];
  }

  protected patchActive(value: boolean): void {
    this.form.update((f) => ({ ...f, activeStatus: !!value }));
  }

  /** Another stakeholder: its wording and list; what was typed stays. */
  protected pickGroup(key: string): void {
    const g = INCENTIVE_GROUPS.find((x) => x.key === key);
    if (!g) return;
    this.group.set(g);
    void this.router.navigate(['/staff/incentives', g.key, 'new'], { queryParams: this.stateParams(), replaceUrl: true });
  }

  protected stateParams(): Record<string, string> | null {
    return this.group().key === 'state' && this.state() ? { state: this.state() } : null;
  }

  protected pick(n: 1 | 2, event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;
    this.error.set('');
    if (file && (file.size > MAX_INCENTIVE_DOC_BYTES || !/\.pdf$/i.test(file.name))) {
      input.value = '';
      this.files[n - 1] = null;
      this.filesChosen.set(this.files.filter(Boolean).length);
      this.error.set('Please choose a valid PDF document (less than 2 MB).');
      return;
    }
    this.files[n - 1] = file;
    this.filesChosen.set(this.files.filter(Boolean).length);
  }

  protected docUrl(n: number): string {
    return `/api/staff/schemes/incentive-master/${this.editId()}/documents/${n}`;
  }

  protected async save(): Promise<void> {
    const type = this.group().type ?? this.state();
    const f = { ...this.form(), incentiveType: type };
    const missing = this.missing(f);
    if (missing) {
      this.error.set(missing);
      window.scrollTo?.({ top: 0 });
      return;
    }
    this.busy.set(true);
    this.error.set('');
    try {
      const id = this.editId();
      let message: string;
      let savedId: number | null = id;
      if (id) {
        message = (await firstValueFrom(this.api.update(id, f))).message;
      } else {
        const r = await firstValueFrom(this.api.create(f));
        message = r.message;
        savedId = r.id;
      }
      const docs = this.files.map((file, i) => ({ file, n: (i + 1) as 1 | 2 })).filter((d) => d.file);
      if (docs.length && savedId) {
        for (const d of docs) await firstValueFrom(this.api.uploadDocument(savedId, d.n, type, d.file!));
        message += ' Documents attached.';
      } else if (docs.length) {
        message += ' Attach the documents from the list.';
      }
      await this.router.navigate(['/staff/incentives', this.group().key], { queryParams: this.stateParams(), state: { message } });
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      window.scrollTo?.({ top: 0 });
    } finally {
      this.busy.set(false);
    }
  }

  private missing(f: IncentiveForm): string | null {
    if (this.group().key === 'state' && !this.state()) return 'Please select the state.';
    const required: [TextKey, string][] = [
      ['incentive', 'Incentive title'], ['details', 'Description'], ['ministryOrDepartment', this.group().department],
      ['contactPerson', 'Contact person'], ['mobileNo', 'Mobile / phone number'], ['email', 'Official e-mail'], ['webLink', 'Portal / scheme link'],
    ];
    const empty = required.find(([k]) => !String(f[k] ?? '').trim());
    if (empty) return `${empty[1]} required.`;
    if (!f.applicableForBronze && !f.applicableForSilver && !f.applicableForGold) return 'Please tick the levels the incentive applies to.';
    return null;
  }

  private async load(id: number): Promise<void> {
    const type = this.group().type ?? this.state();
    this.busy.set(true);
    try {
      const item = type ? (await firstValueFrom(this.api.catalogue(type))).find((i) => Number(i.incentive['Id']) === id) : undefined;
      if (!item) {
        this.error.set('This incentive was not found.');
        return;
      }
      const r = item.incentive;
      const s = (k: string) => (r[k] === null || r[k] === undefined ? '' : String(r[k]));
      this.form.set({
        incentiveType: type, incentive: s('Incentive'), details: s('Details'), ministryOrDepartment: s('MinistryOrDepartment'),
        contactPerson: s('ContactPerson'), webLink: s('WebLink'), email: s('Email'), mobileNo: s('MobileNo'), videoLink: s('VideoLink'),
        applicableForBronze: !!r['ApplicableForBronze'], applicableForSilver: !!r['ApplicableForSilver'], applicableForGold: !!r['ApplicableForGold'],
        activeStatus: !!r['ActiveStatus'],
        displayOn: s('DisplayOn') === 'Dashboard' ? 'Dashboard' : 'Card', cardHighlight: s('CardHighlight'),
      });
      this.initial.set(JSON.stringify(this.form()));
      this.hasDocument.set([item.hasDocument1, item.hasDocument2]);
      this.loaded.set(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
