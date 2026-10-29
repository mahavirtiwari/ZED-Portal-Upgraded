import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Evidence, NewPoint, Point, QuestionnaireApi, Requirement, RequirementsResponse } from './questionnaire.api';
import { CollapseCard } from '../collapse-card';
import { ListSearchComponent, searchRows } from '../pager';

type EvidenceKind = 'mandatory' | 'optional';

interface EvidenceDialog {
  requirement: Requirement;
  kind: EvidenceKind;
  /** Evidences already saved (kept as they are; the old dialog could only add). */
  saved: Evidence[];
  added: Evidence[];
  name: string;
  helpText: string;
  validationRequired: boolean;
}

/**
 * Requirements of a questionnaire parameter (Admin). Port of Views/Questionaire/Requirements.cshtml
 * (Questionaire/Requirements?sid={code}&sectionType={level}): build a requirement from points and
 * bullets, add mandatory/optional evidences, remove the last requirement or the last extra point.
 * All texts are shown as text (the old pages rendered the parameter description as raw HTML). V4 layout: a breadcrumb and
 * page head with BACK, the parameter's counts, the new requirement built in a card (bullets typed in place, no pop-up),
 * a card per requirement with its points beside its mandatory and optional evidences, and the evidence pop-up as a list.
 */
@Component({
  selector: 'zed-staff-requirements',
  imports: [FormsModule, RouterLink, CollapseCard, ListSearchComponent],
  template: `
    <nav class="crumbs" aria-label="Breadcrumb">
      <a [routerLink]="['/staff/masters/parameters', sectionType]">Questionnaire</a>
      <span aria-hidden="true">›</span>
      <a [routerLink]="['/staff/masters/parameters', sectionType]">{{ levelLabel() }}</a>
      <span aria-hidden="true">›</span>
      <span>Parameter {{ sectionCode }}</span>
    </nav>
    <div class="page-head">
      <div>
        <h3 class="registration-title">Requirements</h3>
        @if (data(); as d) {
          <p class="page-sub"><strong>{{ d.sectionType }} – {{ d.sectionCode }}. {{ d.sectionName }}</strong></p>
        }
      </div>
      <div class="page-actions">
        <a class="btn btn-default" [routerLink]="['/staff/masters/parameters', sectionType]">&lt;&lt; BACK</a>
      </div>
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    @if (data()) {
      <div class="req-stats">
        <div class="stat"><span class="stat-value">{{ stats().requirements }}</span><span class="stat-label">Requirements</span></div>
        <div class="stat"><span class="stat-value">{{ stats().points }}</span><span class="stat-label">Points</span></div>
        <div class="stat"><span class="stat-value">{{ stats().mandatory }}</span><span class="stat-label">Mandatory evidences</span></div>
        <div class="stat"><span class="stat-value">{{ stats().optional }}</span><span class="stat-label">Optional evidences</span></div>
      </div>

      <zed-collapse-card title="Add Requirement" summary="Write its points one by one, add bullets under a point, then save the requirement." [(open)]="adding">
        <form class="add-form" (ngSubmit)="addPoint()" novalidate>
          <label class="step-label" for="requirementName"><span class="step-no">1</span> Point</label>
          <textarea id="requirementName" name="requirementName" class="form-control" maxlength="1990" rows="3" placeholder="Text of the point" [(ngModel)]="pointText"></textarea>
          <div class="form-actions mt-2">
            <button type="submit" class="btn btn-outline-primary">Add point</button>
          </div>
        </form>
        @if (draft().length) {
          <div class="step-label mt-2"><span class="step-no">2</span> Points of the new requirement ({{ nextCode() }})</div>
          <ol class="draft-points">
            @for (p of draft(); track $index; let i = $index) {
              <li class="draft-point">
                <div class="draft-head">
                  <span class="draft-text">{{ p.name }}</span>
                  <div class="row-actions">
                    <button type="button" class="btn btn-primary" (click)="openBullet(i)">Add Bullet</button>
                    <button type="button" class="btn btn-outline-danger" (click)="removeDraftPoint(i)">Remove</button>
                  </div>
                </div>
                @if (p.bullets.length) {
                  <ul class="bullets">
                    @for (b of p.bullets; track $index; let j = $index) {
                      <li>
                        <span>{{ b }}</span>
                        <button type="button" class="btn btn-link text-danger p-0 ms-1" aria-label="Remove bullet" (click)="removeBullet(i, j)">&times;</button>
                      </li>
                    }
                  </ul>
                }
                @if (bulletFor() === i) {
                  <form class="bullet-form" (ngSubmit)="addBullet()" novalidate>
                    <label class="visually-hidden" for="bulletText">Bullet Point</label>
                    <input id="bulletText" name="bulletText" class="form-control" maxlength="2000" placeholder="Bullet point, then Enter" [(ngModel)]="bulletText" />
                    <button type="submit" class="btn btn-outline-primary">OK</button>
                    <button type="button" class="btn btn-default bullet-done" (click)="bulletFor.set(null)">Done</button>
                  </form>
                }
              </li>
            }
          </ol>
          <div class="form-actions">
            <button type="button" class="btn btn-default" (click)="draft.set([])">Clear</button>
            <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="save()">Save</button>
          </div>
        }
      </zed-collapse-card>

      <zed-list-search [(value)]="search" placeholder="Search requirements" inputId="req-search" [found]="shown().length" />
      <div class="requirements">
        @for (q of shown(); track q.id) {
          <article class="req-card">
            <header class="req-head">
              <span class="req-code">{{ data()!.sectionCode }}.{{ q.requirementCode }}</span>
              <span class="req-meta">{{ q.points.length }} {{ q.points.length === 1 ? 'point' : 'points' }} ·
                {{ q.mandatoryEvidences.length + q.optionalEvidences.length }} evidences</span>
              @if (q.canRemove) {
                <button type="button" class="btn btn-outline-danger btn-sm remove-requirement" (click)="removeRequirement(q)">Delete</button>
              }
            </header>
            <div class="req-body">
              <div class="req-points">
                <ol>
                  @for (o of q.points; track o.id; let i = $index; let last = $last) {
                    <li>
                      <span class="point-text">{{ o.name }}</span>
                      @if (i > 0 && last) {
                        <button type="button" class="btn btn-link text-danger p-0 ms-1 remove-point" title="Remove point" aria-label="Remove point" (click)="removePoint(q, o.id)">&times;</button>
                      }
                      @if (o.bullets.length) {
                        <ul class="bullets">
                          @for (s of o.bullets; track s.id) {
                            <li>{{ s.name }}</li>
                          }
                        </ul>
                      }
                      @if (optionImage(o); as src) {
                        <span><img class="option-image" [src]="src" alt="" /></span>
                      }
                    </li>
                  }
                </ol>
              </div>
              <div class="req-evidences">
                @for (g of evidenceGroups; track g.kind) {
                  <div class="ev-group">
                    <div class="ev-head">
                      <span>{{ g.label }} <span class="ev-count">{{ evidencesOf(q, g.kind).length }}</span></span>
                      <button type="button" class="btn btn-outline-primary btn-sm" (click)="openEvidences(q, g.kind)">Add Evidences</button>
                    </div>
                    @if (evidencesOf(q, g.kind).length) {
                      <ol class="ev-list">
                        @for (e of evidencesOf(q, g.kind); track $index) {
                          <li>
                            {{ e.evidenceName }}
                            @if (e.validationRequired) { <span class="status-badge is-pending ms-1">(Validation Required)</span> }
                            @if (e.helpText) { <small class="d-block text-muted">({{ e.helpText }})</small> }
                          </li>
                        }
                      </ol>
                    } @else {
                      <p class="ev-none">None yet.</p>
                    }
                  </div>
                }
              </div>
            </div>
          </article>
        } @empty {
          <div class="no-data">{{ requirements().length ? 'No requirement matches the search.' : 'No Data' }}</div>
        }
      </div>
    }

    @if (evidenceDialog(); as ev) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
        <div class="modal-dialog modal-popup modal-lg">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-start">
                <div>
                  <h3 class="registration-title m-0" id="evidence-title">Evidence ({{ ev.kind === 'mandatory' ? 'Mandatory' : 'Optional' }})</h3>
                  <small class="text-muted d-block">Requirement {{ data()?.sectionCode }}.{{ ev.requirement.requirementCode }}</small>
                </div>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="evidenceDialog.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <div class="ev-form">
                <div class="ev-field">
                  <label for="evidenceName">Evidence<span class="req">*</span></label>
                  <input id="evidenceName" name="evidenceName" class="form-control" maxlength="2000" placeholder="What the unit uploads" [(ngModel)]="ev.name" />
                </div>
                @if (ev.kind === 'mandatory') {
                  <div class="ev-field">
                    <label for="evidenceHelp">iButton <small class="text-muted fw-normal">(help shown to the unit)</small></label>
                    <input id="evidenceHelp" name="evidenceHelp" class="form-control" maxlength="2000" placeholder="iButton" [(ngModel)]="ev.helpText" />
                  </div>
                }
                <div class="ev-form-foot">
                  <div class="form-check m-0">
                    <input class="form-check-input" type="checkbox" id="validationRequired" name="validationRequired" [(ngModel)]="ev.validationRequired" />
                    <label class="form-check-label" for="validationRequired">Validation Required</label>
                  </div>
                  <button type="button" class="btn btn-outline-primary add-evidence" (click)="addEvidence()">ADD</button>
                </div>
                @if (dialogError()) { <span class="help-block" role="alert">{{ dialogError() }}</span> }
              </div>

              <div class="ev-dialog-list">
                <div class="ev-dialog-title">{{ ev.saved.length + ev.added.length }} {{ ev.kind === 'mandatory' ? 'mandatory' : 'optional' }} evidences</div>
                <ol>
                  @for (e of ev.saved; track $index) {
                    <li>
                      <span class="ev-name">{{ e.evidenceName }}</span>
                      @if (e.validationRequired) { <span class="status-badge is-pending">Validation Required</span> }
                      @if (ev.kind === 'mandatory' && e.helpText) { <small class="d-block text-muted">iButton: {{ e.helpText }}</small> }
                    </li>
                  }
                  @for (e of ev.added; track $index; let i = $index) {
                    <li class="added">
                      <span class="ev-name">{{ e.evidenceName }}</span>
                      <span class="status-badge is-info">New</span>
                      @if (e.validationRequired) { <span class="status-badge is-pending">Validation Required</span> }
                      <button type="button" class="btn btn-link text-danger p-0 ms-1" aria-label="Remove evidence" (click)="removeAdded(i)">&times;</button>
                      @if (ev.kind === 'mandatory' && e.helpText) { <small class="d-block text-muted">iButton: {{ e.helpText }}</small> }
                    </li>
                  }
                </ol>
                @if (!ev.saved.length && !ev.added.length) { <p class="ev-none m-0">None yet: add the first above.</p> }
              </div>
            </div>
            <div class="modal-footer">
              <button type="button" class="btn btn-default" (click)="evidenceDialog.set(null)">CANCEL</button>
              <button type="button" class="btn btn-primary save-evidences" [disabled]="saving() || !ev.added.length" (click)="saveEvidences()">SAVE</button>
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
  styles: `
    .help-block { color: #a94442; font-size: 13px; }
    .crumbs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; color: #5f6f70; margin-bottom: 6px; }
    .crumbs a { color: #2f7c83; text-decoration: none; font-weight: 600; }
    .crumbs a:hover { text-decoration: underline; }

    .req-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-label { font-size: 13px; color: #5f6f70; }

    /* Building a requirement. */
    .step-label { display: flex; align-items: center; gap: 8px; font-weight: 600; color: #3b4b4c; font-size: 14px; margin-bottom: 6px; }
    .step-no { width: 22px; height: 22px; border-radius: 11px; background: #45a5ad; color: #fff; font-size: 12px; font-weight: 700;
      display: inline-flex; align-items: center; justify-content: center; }
    .draft-points { list-style: none; padding: 0; margin: 0 0 4px; counter-reset: dp; }
    .draft-point { counter-increment: dp; border: 1px solid #dfe9ea; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; background: #fbfdfd; }
    .draft-head { display: flex; gap: 12px; justify-content: space-between; align-items: flex-start; }
    .draft-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .draft-text::before { content: counter(dp) '. '; font-weight: 700; color: #2f7c83; }
    .draft-point .btn { text-transform: none; }
    .bullet-form { display: flex; gap: 8px; margin-top: 8px; }
    .bullet-form .form-control { flex: 1 1 auto; }

    /* A card per requirement: its points on the left, its evidences on the right. */
    .requirements { margin-top: 12px; }
    .req-card { background: #fff; border: 1px solid #dfe9ea; border-radius: 14px; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); margin-bottom: 14px; overflow: hidden; }
    .req-head { display: flex; align-items: center; gap: 12px; padding: 10px 16px; background: #f4fafa; border-bottom: 1px solid #dfe9ea; }
    .req-code { font-weight: 700; color: #fff; background: #45a5ad; border-radius: 14px; padding: 2px 12px; font-size: 14px; }
    .req-meta { color: #5f6f70; font-size: 13px; flex: 1 1 auto; }
    .req-body { display: grid; grid-template-columns: minmax(0, 3fr) minmax(0, 2fr); }
    .req-points { padding: 14px 16px; font-size: 14px; color: #232527; }
    .req-points ol { margin: 0; padding-left: 20px; }
    .req-points li { margin-bottom: 8px; }
    .point-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .bullets { margin: 6px 0 0; padding-left: 18px; color: #3b4b4c; list-style: disc; }
    .bullets li { margin-bottom: 3px; }
    .option-image { display: block; max-width: 220px; margin-top: 6px; border-radius: 6px; border: 1px solid #dfe9ea; }
    .req-evidences { padding: 14px 16px; border-left: 1px solid #dfe9ea; background: #fcfefe; }
    .ev-group + .ev-group { border-top: 1px dashed #dfe9ea; margin-top: 10px; padding-top: 10px; }
    .ev-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: 700; color: #1f5c61; margin-bottom: 6px; font-size: 14px; }
    .ev-count { display: inline-block; min-width: 22px; text-align: center; background: #eef6f6; color: #23474a; border-radius: 10px; font-size: 12px; padding: 0 6px; margin-left: 4px; }
    .ev-list { margin: 0; padding-left: 20px; font-size: 13.5px; }
    .ev-list li { margin-bottom: 4px; overflow-wrap: anywhere; }
    .ev-none { color: #8a9899; font-size: 13px; margin: 0; }

    /* The evidence pop-up. */
    .ev-form { border: 1px solid #dfe9ea; border-radius: 12px; padding: 14px; background: #fbfdfd; }
    .ev-field { margin-bottom: 10px; }
    .ev-field label { display: block; font-weight: 600; font-size: 14px; color: #3b4b4c; margin-bottom: 4px; }
    .ev-form-foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
    .ev-dialog-list { margin-top: 14px; }
    .ev-dialog-title { font-weight: 700; color: #23474a; font-size: 14px; margin-bottom: 6px; }
    .ev-dialog-list ol { margin: 0; padding-left: 20px; }
    .ev-dialog-list li { padding: 6px 0; border-bottom: 1px solid #eef3f3; overflow-wrap: anywhere; }
    .ev-dialog-list li.added { background: #f4fafa; }
    .ev-name { margin-right: 6px; }

    @media (max-width: 767.98px) {
      .req-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .req-body { grid-template-columns: minmax(0, 1fr); }
      .req-evidences { border-left: 0; border-top: 1px solid #dfe9ea; }
      .draft-head { flex-direction: column; }
    }
  `,
})
export class RequirementsPage {
  private readonly api = inject(QuestionnaireApi);
  private readonly route = inject(ActivatedRoute).snapshot.paramMap;

  protected readonly sectionType = this.route.get('sectionType') ?? 'Bronze';
  protected readonly sectionCode = this.route.get('sectionCode') ?? '';

  protected readonly data = signal<RequirementsResponse | null>(null);
  protected readonly requirements = computed(() => this.data()?.requirements ?? []);
  /** The search box above the list (requirement, points and evidences). */
  protected readonly search = signal('');
  protected readonly shown = computed(() => searchRows(this.requirements(), this.search()));
  protected readonly stats = computed(() => {
    const rows = this.requirements();
    return {
      requirements: rows.length,
      points: rows.reduce((n, q) => n + q.points.length, 0),
      mandatory: rows.reduce((n, q) => n + q.mandatoryEvidences.length, 0),
      optional: rows.reduce((n, q) => n + q.optionalEvidences.length, 0),
    };
  });
  /** The level as the menu names it ("ZED-X" for ZEDX). */
  protected readonly levelLabel = computed(() => (this.sectionType.toUpperCase() === 'ZEDX' ? 'ZED-X' : this.sectionType));
  /** The code the new requirement will get (the procedure numbers them in order). */
  protected readonly nextCode = computed(() => `${this.sectionCode}.${this.requirements().length + 1}`);
  protected readonly evidenceGroups: readonly { kind: EvidenceKind; label: string }[] = [
    { kind: 'mandatory', label: 'Mandatory' },
    { kind: 'optional', label: 'Optional' },
  ];
  /** The Add Requirement card: open while a requirement is being built. */
  protected readonly adding = signal(false);
  protected readonly draft = signal<NewPoint[]>([]);
  protected readonly bulletFor = signal<number | null>(null);
  protected readonly evidenceDialog = signal<EvidenceDialog | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly dialogError = signal('');
  protected pointText = '';
  protected bulletText = '';

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    try {
      this.data.set(await firstValueFrom(this.api.requirements(this.sectionType, this.sectionCode)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  /**
   * A point's Options.OptionImage, shown below it as the old page did (`<img src="~/{{o.OptionImage}}">`, a path under
   * the site root). Only a plain relative path is used; anything with a scheme or "//" is ignored.
   */
  protected optionImage(point: Point): string | null {
    const path = point.optionImage?.trim().replace(/^~?\/+/, '');
    return path && !/^[a-z][a-z0-9+.-]*:|^\/\/|\\/i.test(path) ? '/' + path : null;
  }

  private clearMessages(): void {
    this.error.set('');
    this.success.set('');
  }

  protected addPoint(): void {
    this.clearMessages();
    const name = this.pointText.trim();
    if (!name) {
      this.error.set('Please enter the requirement text.');
      return;
    }
    this.draft.update((d) => [...d, { name, bullets: [] }]);
    this.pointText = '';
  }

  protected removeDraftPoint(i: number): void {
    this.draft.update((d) => d.filter((_, k) => k !== i));
    this.bulletFor.set(null);
  }

  protected evidencesOf(q: Requirement, kind: EvidenceKind): Evidence[] {
    return kind === 'mandatory' ? q.mandatoryEvidences : q.optionalEvidences;
  }

  protected openBullet(i: number): void {
    this.bulletText = '';
    this.bulletFor.set(i);
  }

  /** OK (or Enter) adds the bullet and keeps the box open for the next one; Done closes it. */
  protected addBullet(): void {
    const i = this.bulletFor();
    const text = this.bulletText.trim();
    if (i === null) return;
    if (text) this.draft.update((d) => d.map((p, k) => (k === i ? { ...p, bullets: [...p.bullets, text] } : p)));
    this.bulletText = '';
  }

  protected removeBullet(i: number, j: number): void {
    this.draft.update((d) => d.map((p, k) => (k === i ? { ...p, bullets: p.bullets.filter((_, m) => m !== j) } : p)));
  }

  protected async save(): Promise<void> {
    this.clearMessages();
    if (!this.draft().length) {
      this.error.set('Please enter valid data.');
      return;
    }
    this.saving.set(true);
    try {
      this.success.set((await firstValueFrom(this.api.addRequirement(this.sectionType, this.sectionCode, this.draft()))).message);
      this.draft.set([]);
      this.bulletFor.set(null);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected openEvidences(requirement: Requirement, kind: EvidenceKind): void {
    this.dialogError.set('');
    this.evidenceDialog.set({
      requirement,
      kind,
      saved: kind === 'mandatory' ? requirement.mandatoryEvidences : requirement.optionalEvidences,
      added: [],
      name: '',
      helpText: '',
      validationRequired: false,
    });
  }

  protected addEvidence(): void {
    const ev = this.evidenceDialog();
    if (!ev) return;
    const name = ev.name.trim();
    if (!name) {
      this.dialogError.set('Please enter the evidence.');
      return;
    }
    this.dialogError.set('');
    this.evidenceDialog.set({
      ...ev,
      added: [...ev.added, { evidenceName: name, helpText: ev.kind === 'mandatory' ? ev.helpText.trim() || null : null, validationRequired: ev.validationRequired }],
      name: '',
      helpText: '',
      validationRequired: false,
    });
  }

  protected removeAdded(i: number): void {
    const ev = this.evidenceDialog();
    if (ev) this.evidenceDialog.set({ ...ev, added: ev.added.filter((_, k) => k !== i) });
  }

  /** Saves both lists (the procedure replaces all evidences of the requirement). */
  protected async saveEvidences(): Promise<void> {
    const ev = this.evidenceDialog();
    if (!ev) return;
    const q = ev.requirement;
    const mandatory = ev.kind === 'mandatory' ? [...ev.saved, ...ev.added] : q.mandatoryEvidences;
    const optional = ev.kind === 'optional' ? [...ev.saved, ...ev.added] : q.optionalEvidences;
    this.saving.set(true);
    this.clearMessages();
    try {
      this.success.set((await firstValueFrom(this.api.saveEvidences(this.sectionType, this.sectionCode, q.id, mandatory, optional))).message);
      this.evidenceDialog.set(null);
      await this.load();
    } catch (err) {
      this.dialogError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected async removeRequirement(q: Requirement): Promise<void> {
    if (!window.confirm(`Remove requirement ${this.data()?.sectionCode}.${q.requirementCode} with its points and evidences?`)) return;
    await this.run(() => this.api.removeRequirement(this.sectionType, this.sectionCode, q.id));
  }

  protected async removePoint(q: Requirement, pointId: number): Promise<void> {
    if (!window.confirm('Remove this point?')) return;
    await this.run(() => this.api.removePoint(this.sectionType, this.sectionCode, q.id, pointId));
  }

  private async run(call: () => ReturnType<QuestionnaireApi['removePoint']>): Promise<void> {
    this.clearMessages();
    this.saving.set(true);
    try {
      this.success.set((await firstValueFrom(call())).message);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
