import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { PageHead } from '../../msme/shared/page-head';
import { staffCrumbs } from '../staff-crumbs';
import { ToastService } from '../toast';
import { agencyTypeLabel } from './incentive-agencies';
import { IncentiveAgencyType, OnsiteAgencyRequest, OnsiteDistrict, OnsiteSchemeOption, SchemeOnsiteApi } from './scheme-onsite.api';

/** A state of the form: the whole state, or the districts ticked (codes). */
interface AreaEdit {
  state: string;
  whole: boolean;
  districts: Set<string>;
  /** The state's districts (loaded when "Selected districts" is chosen). */
  options: OnsiteDistrict[] | null;
  filter: string;
}

/**
 * 2026-11-20 (the product owner): add or edit an incentive verification agency — its type (desktop or onsite verification: chosen
 * at creation, never changed), its details and SPOC, the states it serves and, per state, the whole state or its districts (the
 * allotment of its stage is by the unit's state and district), and the schemes it verifies (a desktop agency: any scheme; an onsite
 * agency: the Desktop + Onsite schemes). Created as an assessment agency login and kept apart from them (no assessment work).
 */
@Component({
  selector: 'zed-staff-incentive-agency-form',
  imports: [FormsModule, RouterLink, PageHead, TextPipe],
  host: { class: 'd-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="title()" [subtitle]="userId ?? null">
      <a routerLink="/staff/scheme-agencies" class="btn btn-default">{{ 'Back' | t: 'staff.schemeOnsite.form.back' }}</a>
    </zed-page-head>
    @if (error()) { <div class="alert alert-danger" role="alert"><strong>{{ error() }}</strong></div> }
    <form (ngSubmit)="submit()" novalidate>
      <section class="zed-card of-sec" aria-labelledby="of-type-h">
        <h4 id="of-type-h">{{ 'Type of agency' | t: 'staff.incentiveAgencies.form.typeTitle' }}<span class="req">*</span></h4>
        @if (userId) {
          <p class="m-0" data-type-fixed><b>{{ type() ? typeLabel(type()!) : '' }}</b> <small class="sub">{{ 'The type of an agency cannot be changed.' | t: 'staff.incentiveAgencies.form.typeFixed' }}</small></p>
        } @else {
          <div class="of-radios of-types" role="radiogroup" [attr.aria-label]="'Type of agency' | t: 'staff.incentiveAgencies.form.typeTitle'">
            <label><input type="radio" name="agencyType" value="Desktop" [checked]="type() === 'Desktop'" (change)="setType('Desktop')" /> {{ 'Desktop verification' | t: 'staff.incentiveAgencies.type.desktop' }}</label>
            <label><input type="radio" name="agencyType" value="Onsite" [checked]="type() === 'Onsite'" (change)="setType('Onsite')" /> {{ 'Onsite verification' | t: 'staff.incentiveAgencies.type.onsite' }}</label>
          </div>
          <p class="sub m-0">{{ 'Desktop and onsite verification are always done by different agencies: an agency is of one type only.' | t: 'staff.incentiveAgencies.form.typeHelp' }}</p>
        }
      </section>
      <section class="zed-card of-sec" aria-labelledby="of-org-h">
        <h4 id="of-org-h">{{ 'Agency' | t: 'staff.schemeOnsite.form.agencyTitle' }}</h4>
        <div class="of-grid">
          <div class="fld">
            <label for="of-name">{{ 'Agency name' | t: 'staff.schemeOnsite.form.name' }}<span class="req">*</span></label>
            <input id="of-name" name="userName" class="form-control" maxlength="100" [(ngModel)]="model.userName" required />
          </div>
          <div class="fld">
            <label for="of-gst">{{ 'GSTIN' | t: 'staff.schemeOnsite.form.gst' }}</label>
            <input id="of-gst" name="gstNumber" class="form-control" maxlength="20" [placeholder]="'15 characters (optional)' | t: 'staff.schemeOnsite.form.gstPlaceholder'" [(ngModel)]="model.gstNumber" />
          </div>
          <div class="fld of-wide">
            <label for="of-address">{{ 'Registered address' | t: 'staff.schemeOnsite.form.address' }}<span class="req">*</span></label>
            <textarea id="of-address" name="address" class="form-control" rows="2" maxlength="2000" [(ngModel)]="model.address" required></textarea>
          </div>
          <div class="fld">
            <label for="of-pin">{{ 'PIN code' | t: 'staff.schemeOnsite.form.pin' }}<span class="req">*</span></label>
            <input id="of-pin" name="pinCode" class="form-control" maxlength="6" inputmode="numeric" [(ngModel)]="model.pinCode" required />
          </div>
        </div>
      </section>

      <section class="zed-card of-sec" aria-labelledby="of-spoc-h">
        <h4 id="of-spoc-h">{{ 'SPOC contact' | t: 'staff.schemeOnsite.form.spocTitle' }}</h4>
        <div class="of-grid">
          <div class="fld">
            <label for="of-spoc">{{ 'SPOC name' | t: 'staff.schemeOnsite.form.spoc' }}<span class="req">*</span></label>
            <input id="of-spoc" name="spocName" class="form-control" maxlength="100" [(ngModel)]="model.spocName" required />
          </div>
          <div class="fld">
            <label for="of-email">{{ 'SPOC e-mail' | t: 'staff.schemeOnsite.form.email' }}<span class="req">*</span></label>
            <input id="of-email" name="emailId" type="email" class="form-control" maxlength="100" [(ngModel)]="model.emailId" required />
          </div>
          <div class="fld">
            <label for="of-mobile">{{ 'SPOC mobile' | t: 'staff.schemeOnsite.form.mobile' }}<span class="req">*</span></label>
            <input id="of-mobile" name="mobileNo" class="form-control" maxlength="10" inputmode="numeric" [(ngModel)]="model.mobileNo" required />
          </div>
        </div>
      </section>

      <section class="zed-card of-sec" aria-labelledby="of-area-h">
        <h4 id="of-area-h">{{ 'States and districts' | t: 'staff.schemeOnsite.form.areaTitle' }}<span class="req">*</span></h4>
        <p class="sub">{{ 'Applications go to the agencies of the unit’s plant state and district by round robin. Choose the whole state or some of its districts.' | t: 'staff.incentiveAgencies.form.areaHelp' }}</p>
        @for (a of areas(); track a.state) {
          <div class="of-area" [attr.data-state]="a.state">
            <div class="of-area-head">
              <b>{{ a.state }}</b>
              <div class="of-radios" role="radiogroup" [attr.aria-label]="'Coverage of {state}' | t: 'staff.schemeOnsite.form.coverageAria' : { state: a.state }">
                <label><input type="radio" [name]="'w-' + a.state" [checked]="a.whole" (change)="setWhole(a, true)" /> {{ 'Whole state' | t: 'staff.schemeOnsite.form.whole' }}</label>
                <label><input type="radio" [name]="'w-' + a.state" [checked]="!a.whole" (change)="setWhole(a, false)" /> {{ 'Selected districts' | t: 'staff.schemeOnsite.form.selected' }}</label>
              </div>
              <button type="button" class="btn btn-link btn-sm text-danger" (click)="removeState(a)">{{ 'Remove' | t: 'staff.schemeOnsite.form.removeState' }}</button>
            </div>
            @if (!a.whole) {
              @if (a.options === null) {
                <p class="sub m-0">{{ 'Loading the districts…' | t: 'staff.schemeOnsite.form.loadingDistricts' }}</p>
              } @else if (a.options.length === 0) {
                <p class="sub m-0">{{ 'No district is listed for this state (Admin → Master → LG Directory).' | t: 'staff.schemeOnsite.form.noDistricts' }}</p>
              } @else {
                <input type="search" class="form-control form-control-sm of-dfilter" [placeholder]="'Filter districts' | t: 'staff.schemeOnsite.form.filterDistricts'"
                       [attr.aria-label]="'Filter districts of {state}' | t: 'staff.schemeOnsite.form.filterAria' : { state: a.state }" [value]="a.filter" (input)="setFilter(a, $any($event.target).value)" />
                <div class="of-districts">
                  @for (d of shown(a); track d.code) {
                    <label><input type="checkbox" [checked]="a.districts.has(d.code)" (change)="toggleDistrict(a, d.code)" /> {{ d.name }}</label>
                  }
                </div>
                <small class="sub">{{ '{n} district(s) selected' | t: 'staff.schemeOnsite.form.selectedCount' : { n: a.districts.size } }}</small>
              }
            }
          </div>
        }
        <div class="of-add">
          <select class="form-select" [attr.aria-label]="'Add a state' | t: 'staff.schemeOnsite.form.addStateAria'" [ngModel]="pick" name="pickState" (ngModelChange)="pick = $event">
            <option value="">{{ '-- Add a state --' | t: 'staff.schemeOnsite.form.addStatePlaceholder' }}</option>
            @for (s of freeStates(); track s) { <option [value]="s">{{ s }}</option> }
          </select>
          <button type="button" class="btn btn-outline-primary" [disabled]="!pick" (click)="addState()">{{ 'Add state' | t: 'staff.schemeOnsite.form.addState' }}</button>
        </div>
      </section>

      <section class="zed-card of-sec" aria-labelledby="of-schemes-h">
        <h4 id="of-schemes-h">{{ type() === 'Desktop' ? ('Schemes verified at the desktop' | t: 'staff.incentiveAgencies.form.desktopSchemesTitle') : ('Schemes verified onsite' | t: 'staff.schemeOnsite.form.schemesTitle') }}<span class="req">*</span></h4>
        @if (!type()) {
          <p class="sub m-0">{{ 'Choose the type of agency first.' | t: 'staff.incentiveAgencies.form.typeFirst' }}</p>
        } @else {
          @for (s of schemes(); track s.code) {
            <label class="of-scheme"><input type="checkbox" [checked]="picked().has(s.code)" (change)="toggleScheme(s.code)" /> {{ s.name }} <small>({{ s.code }})</small>@if (!s.active) { <span class="zed-chip">{{ 'switched off' | t: 'staff.schemeOnsite.form.schemeOff' }}</span> }</label>
          } @empty {
            <p class="sub m-0">{{ type() === 'Desktop'
              ? ('No incentive scheme is defined yet (Admin → Incentive Schemes).' | t: 'staff.incentiveAgencies.form.noDesktopSchemes')
              : ('No scheme has the Desktop + Onsite verification flow yet (Admin → Incentive Schemes → Verification).' | t: 'staff.schemeOnsite.form.noSchemes') }}</p>
          }
        }
      </section>

      <div class="of-bar">
        <a routerLink="/staff/scheme-agencies" class="btn btn-default">{{ 'Cancel' | t: 'staff.schemeOnsite.form.cancel' }}</a>
        <button type="submit" class="btn btn-primary" id="of-save" [disabled]="saving()">{{ userId ? ('Save changes' | t: 'staff.schemeOnsite.form.save') : ('Create agency' | t: 'staff.schemeOnsite.form.create') }}</button>
      </div>
    </form>
    @if (loading()) { <div class="loadingdiv"><div class="loader"></div></div> }
  `,
  styles: `
    .of-sec { padding: 16px 20px; margin-bottom: 16px; }
    .of-sec h4 { font-size: 16px; margin-bottom: 10px; }
    .of-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(260px, 1fr)); gap: 12px 20px; }
    .of-wide { grid-column: 1 / -1; }
    .fld label { display: block; font-weight: 600; margin-bottom: 4px; }
    .req { color: #d64532; margin-left: 2px; }
    .of-area { border: 1px solid #dde7e8; border-radius: 10px; padding: 10px 14px; margin-bottom: 10px; }
    .of-area-head { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 18px; }
    .of-radios { display: flex; gap: 14px; margin-right: auto; }
    .of-types { margin-bottom: 6px; }
    .of-radios label { display: inline-flex; align-items: center; gap: 4px; font-weight: 400; margin: 0; cursor: pointer; }
    .of-dfilter { max-width: 260px; margin: 8px 0; }
    .of-districts { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 4px 14px; max-height: 240px; overflow: auto; }
    .of-districts label { display: flex; align-items: center; gap: 6px; font-weight: 400; margin: 0; font-size: 13px; }
    .of-add { display: flex; gap: 10px; max-width: 460px; }
    .of-scheme { display: flex; align-items: center; gap: 8px; font-weight: 400; margin: 4px 0; }
    .of-scheme small { color: #5f6f70; }
    .of-bar { display: flex; justify-content: flex-end; gap: 10px; margin-bottom: 24px; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class IncentiveAgencyFormPage {
  private readonly api = inject(SchemeOnsiteApi);
  private readonly toast = inject(ToastService);
  private readonly router = inject(Router);
  protected readonly userId = inject(ActivatedRoute).snapshot.paramMap.get('userId');

  protected readonly title = computed(() => this.userId
    ? t('staff.incentiveAgencies.form.editTitle', 'Edit incentive verification agency')
    : t('staff.incentiveAgencies.form.addTitle', 'Add incentive verification agency'));
  protected readonly crumbs = computed(() => staffCrumbs(
    { label: t('staff.incentiveAgencies.title', 'Incentive Verification Agencies'), link: '/staff/scheme-agencies' }, { label: this.title() }));
  protected readonly typeLabel = agencyTypeLabel;
  /** Chosen at creation; fixed afterwards. */
  protected readonly type = signal<IncentiveAgencyType | null>(null);
  private readonly onsiteSchemes = signal<OnsiteSchemeOption[]>([]);
  private readonly desktopSchemes = signal<OnsiteSchemeOption[]>([]);
  /** The schemes the chosen type may serve. */
  protected readonly schemes = computed(() => (this.type() === 'Desktop' ? this.desktopSchemes() : this.type() === 'Onsite' ? this.onsiteSchemes() : []));

  protected model = { userName: '', spocName: '', emailId: '', mobileNo: '', address: '', pinCode: '', gstNumber: '' };
  protected readonly states = signal<string[]>([]);
  protected readonly areas = signal<AreaEdit[]>([]);
  protected readonly picked = signal(new Set<string>());
  protected readonly freeStates = computed(() => this.states().filter((s) => !this.areas().some((a) => a.state.toUpperCase() === s.toUpperCase())));
  protected pick = '';
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    this.loading.set(true);
    try {
      const options = await firstValueFrom(this.api.options());
      this.states.set(options.states);
      this.onsiteSchemes.set(options.schemes ?? []);
      this.desktopSchemes.set(options.desktopSchemes ?? []);
      if (this.userId) {
        const d = await firstValueFrom(this.api.get(this.userId));
        this.model = {
          userName: d.userName ?? '', spocName: d.spocName ?? '', emailId: d.email ?? '', mobileNo: d.mobileNo ?? '', address: d.address ?? '',
          pinCode: d.pinCode ?? '', gstNumber: d.gstNumber ?? '',
        };
        this.type.set(d.type ?? 'Onsite');
        this.picked.set(new Set(d.schemes));
        this.areas.set(d.states.map((a) => ({ state: a.state, whole: a.districts.length === 0, districts: new Set(a.districts), options: null, filter: '' })));
        for (const a of this.areas()) if (!a.whole) void this.loadDistricts(a);
      }
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  /** A new agency's type; the schemes ticked that the type cannot serve are dropped. */
  protected setType(type: IncentiveAgencyType): void {
    this.type.set(type);
    const allowed = new Set(this.schemes().map((s) => s.code));
    this.picked.set(new Set([...this.picked()].filter((c) => allowed.has(c))));
  }

  protected addState(): void {
    if (!this.pick) return;
    this.areas.set([...this.areas(), { state: this.pick, whole: true, districts: new Set(), options: null, filter: '' }]);
    this.pick = '';
  }

  protected removeState(a: AreaEdit): void {
    this.areas.set(this.areas().filter((x) => x !== a));
  }

  protected setWhole(a: AreaEdit, whole: boolean): void {
    this.update(a, { whole });
    if (!whole && a.options === null) void this.loadDistricts(a);
  }

  private async loadDistricts(a: AreaEdit): Promise<void> {
    try {
      const list = await firstValueFrom(this.api.districts(a.state));
      this.update(this.areas().find((x) => x.state === a.state) ?? a, { options: list });
    } catch (err) {
      this.update(this.areas().find((x) => x.state === a.state) ?? a, { options: [] });
      this.error.set(apiErrorMessage(err));
    }
  }

  protected setFilter(a: AreaEdit, filter: string): void {
    this.update(a, { filter: filter ?? '' });
  }

  protected shown(a: AreaEdit): OnsiteDistrict[] {
    const f = a.filter.trim().toLowerCase();
    return (a.options ?? []).filter((d) => !f || d.name.toLowerCase().includes(f));
  }

  protected toggleDistrict(a: AreaEdit, code: string): void {
    const next = new Set(a.districts);
    if (next.has(code)) next.delete(code); else next.add(code);
    this.update(a, { districts: next });
  }

  protected toggleScheme(code: string): void {
    const next = new Set(this.picked());
    if (next.has(code)) next.delete(code); else next.add(code);
    this.picked.set(next);
  }

  private update(a: AreaEdit, change: Partial<AreaEdit>): void {
    this.areas.set(this.areas().map((x) => (x.state === a.state ? { ...x, ...change } : x)));
  }

  protected async submit(): Promise<void> {
    this.error.set('');
    const m = this.model;
    const type = this.type();
    if (!type) return this.error.set(t('staff.incentiveAgencies.form.error.type', 'Please select the type of agency: desktop verification or onsite verification.'));
    if (!m.userName.trim() || !m.spocName.trim() || !m.emailId.trim() || !m.mobileNo.trim() || !m.address.trim() || !m.pinCode.trim())
      return this.error.set(t('staff.schemeOnsite.form.error.required', 'Please fill in every required field.'));
    if (!/^\d{10}$/.test(m.mobileNo.trim())) return this.error.set(t('staff.schemeOnsite.form.error.mobile', 'Please enter a valid 10 digit SPOC mobile number.'));
    if (!/^\d{6}$/.test(m.pinCode.trim())) return this.error.set(t('staff.schemeOnsite.form.error.pin', 'Please enter a valid 6 digit PIN code.'));
    if (this.areas().length === 0) return this.error.set(t('staff.schemeOnsite.form.error.states', 'Please add at least one state the agency serves.'));
    const noDistrict = this.areas().find((a) => !a.whole && a.districts.size === 0);
    if (noDistrict) return this.error.set(t('staff.schemeOnsite.form.error.districts', '{state}: tick at least one district, or choose the whole state.', { state: noDistrict.state }));
    if (this.picked().size === 0)
      return this.error.set(type === 'Desktop'
        ? t('staff.incentiveAgencies.form.error.desktopSchemes', 'Please select at least one scheme the agency verifies at the desktop.')
        : t('staff.schemeOnsite.form.error.schemes', 'Please select at least one scheme the agency verifies onsite.'));
    const body: OnsiteAgencyRequest = {
      userName: m.userName.trim(), spocName: m.spocName.trim(), emailId: m.emailId.trim(), mobileNo: m.mobileNo.trim(), address: m.address.trim(),
      pinCode: m.pinCode.trim(), gstNumber: m.gstNumber.trim() || null,
      states: this.areas().map((a) => ({ state: a.state, districts: a.whole ? [] : [...a.districts] })),
      schemes: [...this.picked()],
      type,
    };
    this.saving.set(true);
    try {
      const r = this.userId ? await firstValueFrom(this.api.update(this.userId, body)) : await firstValueFrom(this.api.create(body));
      this.toast.success(r.message);
      await this.router.navigate(['/staff/scheme-agencies']);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
