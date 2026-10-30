import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ChecklistEvidence, ChecklistRequest, Evidence, Point, QuestionnaireApi, Requirement, RequirementsResponse } from './questionnaire.api';
import { CollapseCard } from '../collapse-card';
import { ExcelToolsComponent } from '../excel-tools';
import { ListSearchComponent, searchRows } from '../pager';

export const PURPOSE_MAX = 500;
export const ACTION_MAX = 100;
export const CHECKPOINT_MAX = 1990;
export const MAX_SAMPLE_BYTES = 2 * 1024 * 1024;

interface EvidenceForm extends ChecklistEvidence {
  uploading?: boolean;
}

interface CheckpointForm {
  optionCode: string | null;
  text: string;
  evidences: EvidenceForm[];
  actions: string[];
  /** Sub-points of the old layout (shown, not edited). */
  bullets: string[];
}

interface RequirementForm {
  /** The requirement being edited; null = a new one. */
  id: number | null;
  label: string;
  purpose: string;
  benefits: string;
  checkpoints: CheckpointForm[];
  /** Evidences of the whole requirement (added before checkpoints). */
  general: EvidenceForm[];
}

const newEvidence = (): EvidenceForm => ({ evidenceName: '', mandatory: true, sampleFile: null, helpText: null, validationRequired: false });
const newCheckpoint = (): CheckpointForm => ({ optionCode: null, text: '', evidences: [newEvidence()], actions: [''], bullets: [] });

/**
 * Requirements of a questionnaire parameter (Admin). Port of Views/Questionaire/Requirements.cshtml, in the V4 layout
 * (migration 0034): a requirement has its purpose and benefits (up to 500 characters each) and its Yes / No checkpoints;
 * each checkpoint has the evidence the unit shows when the answer is Yes (mandatory or not, each with an optional sample
 * copy) and the actions needed when the answer is No or Partial (up to 100 characters each). A requirement is added or
 * edited in the card at the top; the list shows each requirement with its purpose and benefits above a table of its
 * checkpoints. Export Excel / Upload Excel: one row per checkpoint. Points and bullets of the old layout show as
 * checkpoints with their sub-points; evidences added before checkpoints show as the whole requirement's.
 * All texts are shown as text (the old pages rendered the parameter description as raw HTML).
 */
@Component({
  selector: 'zed-staff-requirements',
  imports: [FormsModule, RouterLink, CollapseCard, ListSearchComponent, ExcelToolsComponent],
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
          <p class="page-sub"><strong>{{ d.sectionType }} – {{ d.sectionCode }}. {{ d.sectionName }}</strong> · each requirement: its purpose and benefits, and the Yes / No checkpoints the unit is assessed on.</p>
        }
      </div>
      <div class="page-actions">
        @if (data()?.checklistReady !== false) {
          <zed-excel-tools [api]="api.requirementsUrl(sectionType, sectionCode)" [title]="'Requirements of ' + sectionCode"
                           [fileName]="'requirements-' + sectionType.toLowerCase() + '-' + sectionCode.toLowerCase()" (applied)="load()" />
        }
        <a class="btn btn-default" [routerLink]="['/staff/masters/parameters', sectionType]">&lt;&lt; BACK</a>
      </div>
    </div>

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    @if (data(); as d) {
      @if (d.checklistReady === false) {
        <div class="alert alert-warning" role="status">Purpose, benefits and checkpoints cannot be saved yet: please ask the administrator to apply database migration 0034.</div>
      }
      <div class="req-stats">
        <div class="stat"><span class="stat-value">{{ stats().requirements }}</span><span class="stat-label">Requirements</span></div>
        <div class="stat"><span class="stat-value">{{ stats().checkpoints }}</span><span class="stat-label">Checkpoints</span></div>
        <div class="stat"><span class="stat-value">{{ stats().evidences }}</span><span class="stat-label">Evidences ({{ stats().mandatory }} mandatory)</span></div>
        <div class="stat"><span class="stat-value">{{ stats().actions }}</span><span class="stat-label">Actions needed</span></div>
      </div>

      <zed-collapse-card [title]="form()?.id ? 'Edit Requirement ' + form()!.label : 'Add Requirement'"
                         summary="Write the purpose and benefits, then add its checkpoints: the evidence for Yes and the action needed for No or Partial."
                         [open]="!!form()" (openChange)="toggleForm($event)">
        @if (form(); as f) {
          <form class="req-form" (ngSubmit)="save()" novalidate>
            <div class="two">
              <div class="field">
                <label for="purpose">Purpose <small class="count">{{ f.purpose.length }} / {{ purposeMax }}</small></label>
                <textarea id="purpose" name="purpose" class="form-control" rows="3" [maxlength]="purposeMax" [(ngModel)]="f.purpose"
                          placeholder="Why the requirement matters"></textarea>
              </div>
              <div class="field">
                <label for="benefits">Benefits <small class="count">{{ f.benefits.length }} / {{ purposeMax }}</small></label>
                <textarea id="benefits" name="benefits" class="form-control" rows="3" [maxlength]="purposeMax" [(ngModel)]="f.benefits"
                          placeholder="What the unit gains"></textarea>
              </div>
            </div>

            @for (c of f.checkpoints; track c; let i = $index) {
              <section class="cp" [attr.aria-label]="'Checkpoint ' + (i + 1)">
                <div class="cp-head">
                  <span class="no" aria-hidden="true">{{ i + 1 }}</span>
                  <div class="cp-text">
                    <label class="visually-hidden" [for]="'cp-' + i">Checkpoint {{ i + 1 }}</label>
                    <textarea [id]="'cp-' + i" [name]="'cp-' + i" class="form-control" rows="1" [maxlength]="checkpointMax" [(ngModel)]="c.text"
                              placeholder="The Yes / No question, e.g. Are the roles defined and documented?"></textarea>
                    @if (c.bullets.length) {
                      <ul class="bullets" aria-label="Earlier sub-points">@for (b of c.bullets; track $index) { <li>{{ b }}</li> }</ul>
                    }
                  </div>
                  <span class="answers" aria-hidden="true">Answer: <span class="chip c-yes">Yes</span><span class="chip c-no">No</span><span class="chip c-part">Partial</span></span>
                  @if (f.checkpoints.length > 1) {
                    <button type="button" class="btn btn-link x" [attr.aria-label]="'Remove checkpoint ' + (i + 1)" (click)="removeCheckpoint(i)">✕</button>
                  }
                </div>
                <div class="cp-body">
                  <div class="side">
                    <h5><span class="chip c-yes">If Yes</span> Evidence</h5>
                    @for (e of c.evidences; track e; let j = $index) {
                      <div class="ev">
                        <div class="item">
                          <input class="form-control" [name]="'ev-' + i + '-' + j" maxlength="2000" [(ngModel)]="e.evidenceName" placeholder="Evidence"
                                 [attr.aria-label]="'Evidence ' + (j + 1) + ' of checkpoint ' + (i + 1)" />
                          <label class="tick"><input type="checkbox" class="form-check-input" [name]="'evm-' + i + '-' + j" [(ngModel)]="e.mandatory" /> Mandatory</label>
                          <button type="button" class="btn btn-link x" aria-label="Remove evidence" (click)="removeEvidence(c.evidences, j)">✕</button>
                        </div>
                        <div class="sample">
                          <span>Sample copy (optional):</span>
                          @if (e.sampleFile) {
                            <a class="file" [href]="api.sampleUrl(sectionType, sectionCode, e.sampleFile)" target="_blank" rel="noopener">{{ e.sampleFile }}</a>
                            <button type="button" class="btn btn-link x" aria-label="Remove sample copy" (click)="e.sampleFile = null">✕</button>
                          } @else {
                            <label class="up">{{ e.uploading ? 'Uploading…' : '⬆ Upload sample' }}
                              <input type="file" class="visually-hidden" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx" [disabled]="e.uploading" (change)="uploadSample(e, $event)" /></label>
                            <span class="hint">PDF, image, Word or Excel, up to 2 MB</span>
                          }
                        </div>
                      </div>
                    }
                    <button type="button" class="btn btn-link add" (click)="c.evidences.push(newEvidence()); touch()">+ Add evidence</button>
                  </div>
                  <div class="side">
                    <h5><span class="chip c-no">If No</span><span class="chip c-part">or Partial</span> Action needed</h5>
                    @for (a of c.actions; track $index; let j = $index) {
                      <div class="item">
                        <input class="form-control" [name]="'ac-' + i + '-' + j" [maxlength]="actionMax" [ngModel]="a" (ngModelChange)="c.actions[j] = $event"
                               placeholder="Action needed" [attr.aria-label]="'Action ' + (j + 1) + ' of checkpoint ' + (i + 1)" />
                        <small class="count">{{ a.length }} / {{ actionMax }}</small>
                        <button type="button" class="btn btn-link x" aria-label="Remove action" (click)="c.actions.splice(j, 1); touch()">✕</button>
                      </div>
                    }
                    <button type="button" class="btn btn-link add" (click)="c.actions.push(''); touch()">+ Add action</button>
                  </div>
                </div>
              </section>
            }

            @if (f.general.length) {
              <section class="cp general" aria-label="Evidence of the whole requirement">
                <div class="cp-head"><div class="cp-text"><strong>Evidence of the whole requirement</strong>
                  <small class="d-block muted">Added before checkpoints. Keep them here, or remove them and add them under a checkpoint.</small></div></div>
                <div class="side">
                  @for (e of f.general; track e; let j = $index) {
                    <div class="item">
                      <input class="form-control" [name]="'gev-' + j" maxlength="2000" [(ngModel)]="e.evidenceName" [attr.aria-label]="'Evidence ' + (j + 1) + ' of the whole requirement'" />
                      <label class="tick"><input type="checkbox" class="form-check-input" [name]="'gevm-' + j" [(ngModel)]="e.mandatory" /> Mandatory</label>
                      <button type="button" class="btn btn-link x" aria-label="Remove evidence" (click)="removeEvidence(f.general, j)">✕</button>
                    </div>
                  }
                </div>
              </section>
            }

            @if (formError()) { <span class="help-block d-block mt-2" role="alert">{{ formError() }}</span> }
            <div class="foot">
              <button type="button" class="btn btn-outline-primary" (click)="f.checkpoints.push(newCheckpoint()); touch()">+ Add checkpoint</button>
              <span>
                <button type="button" class="btn btn-default" (click)="closeForm()">CANCEL</button>
                <button type="submit" class="btn btn-primary" [disabled]="saving() || d.checklistReady === false">{{ f.id ? 'UPDATE REQUIREMENT' : 'SAVE REQUIREMENT' }}</button>
              </span>
            </div>
          </form>
        }
      </zed-collapse-card>

      <zed-list-search [(value)]="search" placeholder="Search requirements" inputId="req-search" [found]="shown().length" />
      <div class="requirements">
        @for (q of shown(); track q.id) {
          <article class="req-card">
            <header class="req-head">
              <span class="req-code">{{ d.sectionCode }}.{{ q.requirementCode }}</span>
              <span class="req-meta">{{ q.points.length }} {{ q.points.length === 1 ? 'checkpoint' : 'checkpoints' }} ·
                {{ plural(q.mandatoryEvidences.length + q.optionalEvidences.length, 'evidence') }} · {{ plural(actionsOf(q), 'action') }}</span>
              <button type="button" class="btn btn-outline-primary btn-sm edit-requirement" [disabled]="d.checklistReady === false" (click)="edit(q)">EDIT</button>
              @if (q.canRemove) {
                <button type="button" class="btn btn-outline-danger btn-sm remove-requirement" (click)="removeRequirement(q)">DELETE</button>
              }
            </header>
            @if (q.purpose || q.benefits) {
              <div class="pb">
                <div><b>Purpose</b>{{ q.purpose || '—' }}</div>
                <div><b>Benefits</b>{{ q.benefits || '—' }}</div>
              </div>
            }
            <div class="table-responsive">
              <table class="table cp-table">
                <thead><tr><th scope="col" class="w-cp">Checkpoint (Yes / No)</th><th scope="col">If Yes – evidence</th><th scope="col">If No / Partial – action needed</th></tr></thead>
                <tbody>
                  @for (o of q.points; track o.id; let i = $index) {
                    <tr>
                      <td><span class="point-text">{{ i + 1 }}. {{ o.name }}</span>
                        @if (o.bullets.length) { <ul class="bullets">@for (s of o.bullets; track s.id) { <li>{{ s.name }}</li> }</ul> }
                        @if (optionImage(o); as src) { <img class="option-image" [src]="src" alt="" /> }
                      </td>
                      <td>@if (evidencesFor(q, o.optionCode); as list) {
                        @if (list.length) { <ul class="ev-list">@for (e of list; track $index) { <li>{{ e.evidenceName }}
                          @if (isMandatory(q, e)) { <span class="m">MANDATORY</span> }
                          @if (e.sampleFile) { <a class="samp" [href]="api.sampleUrl(sectionType, sectionCode, e.sampleFile)" target="_blank" rel="noopener">Sample copy</a> }
                        </li> }</ul> } @else { <span class="muted">—</span> }
                      }</td>
                      <td>@if (o.actions?.length) { <ul class="ev-list">@for (a of o.actions; track $index) { <li>{{ a }}</li> }</ul> } @else { <span class="muted">—</span> }</td>
                    </tr>
                  }
                  @if (evidencesFor(q, null); as general) {
                    @if (general.length) {
                      <tr class="general-row"><td><span class="muted">Evidence of the whole requirement</span></td>
                        <td colspan="2"><ul class="ev-list">@for (e of general; track $index) { <li>{{ e.evidenceName }}
                          @if (isMandatory(q, e)) { <span class="m">MANDATORY</span> }
                          @if (e.validationRequired) { <span class="m">VALIDATION REQUIRED</span> }
                        </li> }</ul></td></tr>
                    }
                  }
                </tbody>
              </table>
            </div>
          </article>
        } @empty {
          <div class="no-data">{{ requirements().length ? 'No requirement matches the search.' : 'No Data' }}</div>
        }
      </div>
    }
  `,
  styles: `
    .help-block { color: #a94442; font-size: 13px; }
    .muted { color: #8a9899; }
    .crumbs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; color: #5f6f70; margin-bottom: 6px; }
    .crumbs a { color: #2f7c83; text-decoration: none; font-weight: 600; }
    .crumbs a:hover { text-decoration: underline; }

    .req-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin-bottom: 16px; }
    .stat { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 12px 16px; display: flex; flex-direction: column; }
    .stat-value { font-size: 24px; font-weight: 700; color: #23474a; line-height: 1.2; }
    .stat-label { font-size: 13px; color: #5f6f70; }

    /* The add / edit card. */
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
    .field label { display: flex; justify-content: space-between; font-weight: 700; font-size: 13px; margin-bottom: 5px; color: #23474a; }
    .count { font-weight: 600; color: #5f6f70; font-size: 11.5px; white-space: nowrap; }
    .cp { border: 1px solid #dfe9ea; border-radius: 12px; margin-top: 14px; overflow: hidden; }
    .cp-head { display: flex; gap: 10px; align-items: flex-start; background: #eef6f6; padding: 10px 12px; }
    .no { flex: none; width: 26px; height: 26px; border-radius: 13px; background: #45a5ad; color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 12.5px; margin-top: 4px; }
    .cp-text { flex: 1 1 auto; min-width: 0; }
    .cp-text textarea { min-height: 38px; resize: vertical; }
    .answers { display: flex; gap: 6px; align-items: center; font-size: 12px; color: #5f6f70; white-space: nowrap; padding-top: 8px; }
    .chip { border-radius: 12px; padding: 2px 9px; font-weight: 700; font-size: 11.5px; }
    .c-yes { background: #e6f6ec; color: #1e7a3c; } .c-no { background: #fdeef0; color: #a8303a; } .c-part { background: #fff4d6; color: #8a6100; }
    .cp-body { display: grid; grid-template-columns: 1fr 1fr; }
    .side { padding: 12px; min-width: 0; }
    .cp-body .side + .side { border-left: 1px dashed #dfe9ea; }
    .side h5 { margin: 0 0 8px; font-size: 13px; font-weight: 700; display: flex; gap: 6px; align-items: center; color: #23474a; }
    .ev { margin-bottom: 9px; }
    .item { display: flex; gap: 8px; align-items: center; margin-bottom: 6px; }
    .item .form-control { flex: 1 1 auto; min-width: 0; }
    .tick { font-size: 12px; color: #5f6f70; display: flex; gap: 4px; align-items: center; white-space: nowrap; margin: 0; font-weight: 600; }
    .tick .form-check-input { margin: 0; }
    .x { color: #8a9899; font-weight: 700; text-decoration: none; padding: 0 4px; }
    .sample { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; color: #5f6f70; padding-left: 2px; }
    .file { background: #eef6f6; color: #2f7c83; border-radius: 6px; padding: 2px 8px; font-weight: 700; overflow-wrap: anywhere; }
    .up { border: 1px dashed #45a5ad; color: #2f7c83; border-radius: 6px; padding: 2px 8px; font-weight: 700; cursor: pointer; margin: 0; }
    .hint { color: #8a9899; }
    .add { font-weight: 700; font-size: 12.5px; padding: 2px 0; text-decoration: none; color: #2f7c83; }
    .bullets { margin: 6px 0 0; padding-left: 18px; color: #3b4b4c; list-style: disc; font-size: 13px; }
    .general .side { background: #fcfefe; }
    .foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
    .foot span { display: flex; gap: 8px; }

    /* A card per requirement: purpose and benefits, then its checkpoints. */
    .requirements { margin-top: 12px; }
    .req-card { background: #fff; border: 1px solid #dfe9ea; border-radius: 14px; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); margin-bottom: 14px; overflow: hidden; }
    .req-head { display: flex; align-items: center; gap: 10px; padding: 10px 16px; background: #f4fafa; border-bottom: 1px solid #dfe9ea; }
    .req-code { font-weight: 700; color: #fff; background: #45a5ad; border-radius: 14px; padding: 2px 12px; font-size: 14px; }
    .req-meta { color: #5f6f70; font-size: 13px; flex: 1 1 auto; }
    .pb { display: grid; grid-template-columns: 1fr 1fr; border-bottom: 1px solid #dfe9ea; font-size: 14px; }
    .pb div { padding: 10px 16px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .pb div + div { border-left: 1px solid #dfe9ea; }
    .pb b { display: block; font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: #2f7c83; margin-bottom: 3px; }
    .cp-table { margin: 0; font-size: 13.5px; table-layout: fixed; min-width: 640px; }
    .cp-table th:nth-child(2) { width: 33%; } .cp-table th:nth-child(3) { width: 25%; }
    .cp-table th { font-size: 11.5px; text-transform: uppercase; letter-spacing: .04em; color: #5f6f70; background: #fafcfc; font-weight: 700; }
    .cp-table td { vertical-align: top; overflow-wrap: anywhere; }
    .w-cp { width: 42%; }
    .point-text { white-space: pre-wrap; }
    .ev-list { margin: 0; padding-left: 18px; }
    .ev-list li { margin-bottom: 3px; }
    .m { font-size: 10.5px; font-weight: 700; color: #2f7c83; background: #eef6f6; border-radius: 4px; padding: 0 5px; margin-left: 4px; }
    .samp { font-size: 12px; font-weight: 700; color: #2f7c83; margin-left: 6px; }
    .general-row td { background: #fcfefe; }
    .option-image { display: block; max-width: 220px; margin-top: 6px; border-radius: 6px; border: 1px solid #dfe9ea; }

    @media (max-width: 991.98px) {
      .cp-body { grid-template-columns: minmax(0, 1fr); }
      .cp-body .side + .side { border-left: 0; border-top: 1px dashed #dfe9ea; }
      .answers { display: none; }
    }
    @media (max-width: 767.98px) {
      .req-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .two, .pb { grid-template-columns: minmax(0, 1fr); }
      .pb div + div { border-left: 0; border-top: 1px solid #dfe9ea; }
      .req-head { flex-wrap: wrap; }
    }
  `,
})
export class RequirementsPage {
  protected readonly api = inject(QuestionnaireApi);
  private readonly route = inject(ActivatedRoute).snapshot.paramMap;

  protected readonly sectionType = this.route.get('sectionType') ?? 'Bronze';
  protected readonly sectionCode = this.route.get('sectionCode') ?? '';
  protected readonly purposeMax = PURPOSE_MAX;
  protected readonly actionMax = ACTION_MAX;
  protected readonly checkpointMax = CHECKPOINT_MAX;
  protected readonly newEvidence = newEvidence;
  protected readonly newCheckpoint = newCheckpoint;

  protected readonly data = signal<RequirementsResponse | null>(null);
  protected readonly requirements = computed(() => this.data()?.requirements ?? []);
  /** The search box above the list (purpose, benefits, checkpoints, evidences and actions). */
  protected readonly search = signal('');
  protected readonly shown = computed(() => searchRows(this.requirements(), this.search()));
  protected readonly stats = computed(() => {
    const rows = this.requirements();
    return {
      requirements: rows.length,
      checkpoints: rows.reduce((n, q) => n + q.points.length, 0),
      evidences: rows.reduce((n, q) => n + q.mandatoryEvidences.length + q.optionalEvidences.length, 0),
      mandatory: rows.reduce((n, q) => n + q.mandatoryEvidences.length, 0),
      actions: rows.reduce((n, q) => n + this.actionsOf(q), 0),
    };
  });
  /** The level as the menu names it ("ZED-X" for ZEDX). */
  protected readonly levelLabel = computed(() => (this.sectionType.toUpperCase() === 'ZEDX' ? 'ZED-X' : this.sectionType));
  protected readonly form = signal<RequirementForm | null>(null);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');
  protected readonly formError = signal('');

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    try {
      this.data.set(await firstValueFrom(this.api.requirements(this.sectionType, this.sectionCode)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  /** Re-renders the form after an item was added or removed in place. */
  protected touch(): void {
    this.form.update((f) => (f ? { ...f } : f));
  }

  protected plural(n: number, word: string): string {
    return `${n} ${word}${n === 1 ? '' : 's'}`;
  }

  protected actionsOf(q: Requirement): number {
    return q.points.reduce((n, p) => n + (p.actions?.length ?? 0), 0);
  }

  protected isMandatory(q: Requirement, e: Evidence): boolean {
    return q.mandatoryEvidences.includes(e);
  }

  /** The evidences of a checkpoint (mandatory first), or of the whole requirement (optionCode null). */
  protected evidencesFor(q: Requirement, optionCode: string | null): Evidence[] {
    const of = (e: Evidence) => (e.optionCode ?? null) === (optionCode === null ? null : optionCode.trim());
    return [...q.mandatoryEvidences.filter(of), ...q.optionalEvidences.filter(of)];
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
    this.formError.set('');
  }

  protected toggleForm(open: boolean): void {
    if (open && !this.form()) this.startNew();
    if (!open) this.form.set(null);
  }

  protected startNew(): void {
    this.clearMessages();
    this.form.set({
      id: null, label: `${this.sectionCode}.${this.requirements().length + 1}`, purpose: '', benefits: '', checkpoints: [newCheckpoint()], general: [],
    });
  }

  protected closeForm(): void {
    this.form.set(null);
    this.formError.set('');
  }

  protected edit(q: Requirement): void {
    this.clearMessages();
    const evidence = (e: Evidence): EvidenceForm => ({
      evidenceName: e.evidenceName, mandatory: this.isMandatory(q, e), sampleFile: e.sampleFile ?? null, helpText: e.helpText, validationRequired: e.validationRequired,
    });
    this.form.set({
      id: q.id,
      label: `${this.sectionCode}.${q.requirementCode}`,
      purpose: q.purpose ?? '',
      benefits: q.benefits ?? '',
      checkpoints: q.points.map((p) => ({
        optionCode: p.optionCode.trim(),
        text: p.name,
        evidences: this.evidencesFor(q, p.optionCode).map(evidence),
        actions: [...(p.actions ?? [])],
        bullets: p.bullets.map((b) => b.name),
      })),
      general: this.evidencesFor(q, null).map(evidence),
    });
    window.scrollTo?.({ top: 0, behavior: 'smooth' });
  }

  protected removeCheckpoint(i: number): void {
    const f = this.form();
    if (!f) return;
    const c = f.checkpoints[i];
    if (c.optionCode && !window.confirm(`Remove checkpoint ${i + 1} with its evidence and actions?`)) return;
    f.checkpoints.splice(i, 1);
    this.touch();
  }

  protected removeEvidence(list: EvidenceForm[], j: number): void {
    list.splice(j, 1);
    this.touch();
  }

  protected async uploadSample(e: EvidenceForm, event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    this.formError.set('');
    if (file.size > MAX_SAMPLE_BYTES) {
      this.formError.set('The sample copy is larger than 2 MB.');
      return;
    }
    e.uploading = true;
    this.touch();
    try {
      e.sampleFile = (await firstValueFrom(this.api.uploadSample(this.sectionType, this.sectionCode, file))).fileName;
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
    } finally {
      e.uploading = false;
      this.touch();
    }
  }

  /** The form as the API takes it: empty evidences and actions are left out. */
  private request(f: RequirementForm): ChecklistRequest {
    const evidence = (e: EvidenceForm): ChecklistEvidence => ({
      evidenceName: e.evidenceName.trim(), mandatory: e.mandatory, sampleFile: e.sampleFile, helpText: e.helpText, validationRequired: e.validationRequired,
    });
    return {
      purpose: f.purpose.trim(),
      benefits: f.benefits.trim(),
      checkpoints: f.checkpoints.map((c) => ({
        optionCode: c.optionCode,
        text: c.text.trim(),
        evidences: c.evidences.filter((e) => e.evidenceName.trim()).map(evidence),
        actions: c.actions.map((a) => a.trim()).filter((a) => a),
      })),
      generalEvidences: f.general.filter((e) => e.evidenceName.trim()).map(evidence),
    };
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    this.clearMessages();
    const body = this.request(f);
    const blank = body.checkpoints.findIndex((c) => !c.text);
    if (!body.checkpoints.length || blank >= 0) {
      this.formError.set(body.checkpoints.length ? `Please write checkpoint ${blank + 1}, or remove it.` : 'Please add at least one checkpoint.');
      return;
    }
    if (f.checkpoints.some((c) => c.evidences.some((e) => e.uploading))) {
      this.formError.set('Please wait until the sample copy is uploaded.');
      return;
    }
    this.saving.set(true);
    try {
      const done = f.id
        ? await firstValueFrom(this.api.updateChecklist(this.sectionType, this.sectionCode, f.id, body))
        : await firstValueFrom(this.api.addChecklist(this.sectionType, this.sectionCode, body));
      this.success.set(done.message);
      this.form.set(null);
      await this.load();
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }

  protected async removeRequirement(q: Requirement): Promise<void> {
    if (!window.confirm(`Remove requirement ${this.data()?.sectionCode}.${q.requirementCode} with its checkpoints and evidences?`)) return;
    this.clearMessages();
    this.saving.set(true);
    try {
      this.success.set((await firstValueFrom(this.api.removeRequirement(this.sectionType, this.sectionCode, q.id))).message);
      if (this.form()?.id === q.id) this.form.set(null);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
