import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { INCENTIVE_GROUPS, IncentiveForm, IncentiveGroup, IncentivesApi, STATES } from './incentives.api';
import { MAX_INCENTIVE_DOC_BYTES } from './incentive-master';

type TextKey = 'incentive' | 'details' | 'ministryOrDepartment' | 'contactPerson' | 'mobileNo' | 'email' | 'videoLink' | 'webLink';
type LevelKey = 'applicableForBronze' | 'applicableForSilver' | 'applicableForGold';

function emptyForm(): IncentiveForm {
  return {
    incentiveType: '', incentive: '', details: '', ministryOrDepartment: '', contactPerson: '', webLink: '', email: '',
    mobileNo: '', videoLink: '', applicableForBronze: false, applicableForSilver: false, applicableForGold: false, activeStatus: true,
  };
}

/**
 * Create New Incentive / Edit Incentive (V4, as the LEAN portal's incentive form): the incentive's details, its
 * nodal contact and its resources (links and the two PDF documents, uploaded once the incentive is saved), with the
 * wording of its group. A saved incentive keeps its group, state and levels (SP_MASTER_UPDATE_INCENTIVE does not
 * change them), so they are shown but not editable.
 */
@Component({
  selector: 'zed-staff-incentive-form',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">{{ editId() ? 'Edit Incentive' : 'Create New Incentive' }} <span class="zed-chip">{{ group().label }}</span></h3>
        <p class="page-sub">{{ group().createSubtitle }}</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (loaded()) {
      <form (ngSubmit)="save()" novalidate>
        <div class="inc-form">
          <section class="zed-card" aria-labelledby="inc-details-h">
            <h5 class="inc-h" id="inc-details-h">Incentive details</h5>
            <label class="form-label" for="inc-incentive">Incentive title<span class="req">*</span></label>
            <input class="form-control" id="inc-incentive" name="incentive" maxlength="4000" placeholder="e.g. CLCS-TUS Capital Subsidy Scheme" [ngModel]="form().incentive" (ngModelChange)="patch('incentive', $event)" />
            <label class="form-label" for="inc-details">Description<span class="req">*</span></label>
            <textarea class="form-control" id="inc-details" name="details" rows="4" maxlength="4000" placeholder="Eligibility, quantum of assistance, application route and scope of the scheme." [ngModel]="form().details" (ngModelChange)="patch('details', $event)"></textarea>
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
            <span class="form-label">Activation level<span class="req">*</span></span>
            <div class="check-row" role="group" aria-label="Activation level">
              @for (l of levels; track l.key) {
                <label class="form-check-label"><input type="checkbox" class="form-check-input" [id]="'inc-' + l.key" [name]="l.key" [disabled]="!!editId()" [ngModel]="form()[l.key]" (ngModelChange)="patchLevel(l.key, $event)" /> {{ l.label }}</label>
              }
            </div>
            <small class="muted">{{ editId() ? 'The stakeholder, state and levels of a saved incentive stay as they are.' : 'Tick every level this incentive applies to.' }}</small>
            <label class="form-label" for="inc-ministryOrDepartment">{{ group().department }}<span class="req">*</span></label>
            <input class="form-control" id="inc-ministryOrDepartment" name="ministryOrDepartment" maxlength="4000" [placeholder]="group().departmentHint" [ngModel]="form().ministryOrDepartment" (ngModelChange)="patch('ministryOrDepartment', $event)" />

            <h5 class="inc-h mt-4">Nodal contact</h5>
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
            <h5 class="inc-h" id="inc-res-h">Attach resources</h5>
            <label class="form-label" for="inc-videoLink">Video link (tutorial / guide)</label>
            <input class="form-control" id="inc-videoLink" name="videoLink" maxlength="2000" placeholder="https://" [ngModel]="form().videoLink" (ngModelChange)="patch('videoLink', $event)" />
            <label class="form-label" for="inc-webLink">Portal / scheme link<span class="req">*</span></label>
            <input class="form-control" id="inc-webLink" name="webLink" maxlength="1000" placeholder="https://" [ngModel]="form().webLink" (ngModelChange)="patch('webLink', $event)" />
            <small class="muted">A full address starting with https://, or --- when there is none.</small>
            @for (n of [1, 2]; track n) {
              <label class="form-label" [for]="'inc-doc' + n">{{ n === 1 ? 'Guidelines' : 'Gazette / other document' }} (PDF, up to 2 MB)</label>
              <div class="doc-row">
                <input class="form-control" type="file" accept="application/pdf" [id]="'inc-doc' + n" (change)="pick(n === 1 ? 1 : 2, $event)" />
                @if (hasDocument()[n - 1]) {
                  <a [href]="docUrl(n)" target="_blank" rel="noopener" [attr.aria-label]="'Current document ' + n"><img src="Images/svgicons/pdf-icon.svg" alt="" height="26" /></a>
                }
              </div>
            }

            <h5 class="inc-h mt-4">Status</h5>
            <div class="form-check form-switch inc-switch">
              <input class="form-check-input" type="checkbox" role="switch" id="inc-active" name="activeStatus" [ngModel]="form().activeStatus" (ngModelChange)="patchActive($event)" />
              <label class="form-check-label" for="inc-active">{{ form().activeStatus ? 'Active: shown on the public incentive pages' : 'Inactive: not shown to MSMEs' }}</label>
            </div>
          </section>
        </div>
        <div class="form-actions">
          <span class="muted me-auto">All fields marked * are mandatory.</span>
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
    .inc-form { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); gap: 16px; align-items: start; }
    .inc-h { font-size: 13px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; color: #2f7c83; border-left: 3px solid #45a5ad; padding-left: 8px; margin-bottom: 4px; }
    .form-label { display: block; margin: 12px 0 4px; }
    .inc-pair { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .check-row { display: flex; flex-wrap: wrap; gap: 8px 20px; margin-bottom: 4px; }
    .check-row .form-check-input { margin-right: 6px; }
    .doc-row { display: flex; align-items: center; gap: 8px; }
    .inc-switch { display: flex; align-items: center; gap: 10px; padding-left: 0; margin-top: 8px; }
    .inc-switch .form-check-input { float: none; margin: 0; flex: none; }
    .form-actions { align-items: center; margin-top: 16px; }
    @media (max-width: 900px) { .inc-form, .inc-pair { grid-template-columns: 1fr; } }
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

  protected readonly group = signal<IncentiveGroup>(INCENTIVE_GROUPS[0]);
  protected readonly state = signal('');
  protected readonly editId = signal<number | null>(null);
  protected readonly form = signal<IncentiveForm>(emptyForm());
  protected readonly hasDocument = signal<[boolean, boolean]>([false, false]);
  private readonly files: [File | null, File | null] = [null, null];
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
      this.error.set('Please choose a valid PDF document (less than 2 MB).');
      return;
    }
    this.files[n - 1] = file;
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
      });
      this.hasDocument.set([item.hasDocument1, item.hasDocument2]);
      this.loaded.set(true);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
