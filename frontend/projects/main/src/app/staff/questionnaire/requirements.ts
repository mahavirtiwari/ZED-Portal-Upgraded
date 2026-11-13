import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ChecklistEvidence, ChecklistRequest, Evidence, Point, QuestionnaireApi, Requirement, RequirementsResponse } from './questionnaire.api';
import { ExcelToolsComponent } from '../excel-tools';
import { levelName } from '../../msme/shared/levels';
import { ListSearchComponent, searchRows } from '../pager';
import { PortalSwitchComponent, QUESTIONNAIRE_PORTALS } from '../admin-portal';

export const PURPOSE_MAX = 500;
/** The requirement's text (Requirements.RequirementName), as the server allows (2026-11-13). */
export const REQUIREMENT_NAME_MAX = 2000;
/** Each action needed (500 since 2026-11-13, migration 0071). */
export const ACTION_MAX = 500;
export const CHECKPOINT_MAX = 1990;
export const MAX_SAMPLE_BYTES = 2 * 1024 * 1024;
/** dbo.Requirements.VideoUrl (migration 0056). */
export const VIDEO_MAX = 500;

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
  /** The requirement's text (required, 2026-11-13). */
  requirementName: string;
  purpose: string;
  benefits: string;
  /** The video tutorial's link (2026-11-07); empty = none. */
  videoUrl: string;
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
 * copy) and the actions needed when the answer is No or Partial (up to 500 characters each). A requirement is added or
 * edited in place. 2026-11-07 redesign (approved): the requirements as a list on the left (what each still lacks), the chosen
 * one on the right with its video tutorial (migration 0056), purpose, benefits and checkpoints, edited in the same panel; the
 * add buttons in colour. Export Excel / Upload Excel: one row per checkpoint. Points and bullets of the old layout show as
 * checkpoints with their sub-points; evidences added before checkpoints show as the whole requirement's.
 * All texts are shown as text (the old pages rendered the parameter description as raw HTML).
 */
@Component({
  selector: 'zed-staff-requirements',
  imports: [FormsModule, RouterLink, ListSearchComponent, ExcelToolsComponent, PortalSwitchComponent],
  template: `
    <zed-portal-switch [portals]="questionnairePortals" title="Questionnaire of" />
    <nav class="crumbs" aria-label="Breadcrumb">
      <a [routerLink]="['/staff/masters/parameters', sectionType]">Questionnaire</a>
      <span aria-hidden="true">›</span>
      <a [routerLink]="['/staff/masters/parameters', sectionType]">{{ levelLabel() }}</a>
      <span aria-hidden="true">›</span>
      <span>Parameter {{ sectionCode }}</span>
    </nav>
    <div class="page-head">
      <div>
        @if (data(); as d) {
          <h3 class="registration-title">{{ d.sectionCode }}. {{ d.sectionName }} <span class="lvl">· {{ levelLabel() }}</span></h3>
          <p class="page-sub summary">{{ plural(stats().requirements, 'requirement') }} · {{ plural(stats().checkpoints, 'checkpoint') }} ·
            {{ plural(stats().evidences, 'evidence') }} ({{ stats().mandatory }} mandatory) · {{ plural(stats().actions, 'action') }}</p>
        } @else {
          <h3 class="registration-title">Requirements</h3>
        }
      </div>
      <div class="page-actions">
        @if (data()?.checklistReady !== false) {
          <span class="xl-group"><span class="xl-group-label">This parameter</span>
            <zed-excel-tools [api]="api.requirementsUrl(sectionType, sectionCode)" [title]="'Requirements of ' + sectionCode"
                             [fileName]="'requirements-' + sectionType.toLowerCase() + '-' + sectionCode.toLowerCase()" (applied)="load()" /></span>
          <!-- 2026-11-13: every parameter of the level in one sheet (a Parameter column first). -->
          <span class="xl-group xl-group-all"><span class="xl-group-label">All {{ levelLabel() }} parameters</span>
            <zed-excel-tools [api]="api.levelRequirementsUrl(sectionType)" [title]="'Requirements of all ' + levelLabel() + ' parameters'"
                             [fileName]="'requirements-' + sectionType.toLowerCase() + '-all-parameters'" (applied)="load()" /></span>
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
      <div class="rq-layout">
        <!-- Left: the requirements, each with what it still lacks. -->
        <aside class="rq-list" aria-label="Requirements">
          <zed-list-search [(value)]="search" placeholder="Search requirements" inputId="req-search" [found]="shown().length" />
          <ul class="rq-items">
            @for (q of shown(); track q.id) {
              <li>
                <button type="button" class="rq-item" [class.on]="!form() && selected()?.id === q.id" [class.editing]="form()?.id === q.id"
                        [attr.aria-current]="selected()?.id === q.id ? 'true' : null" (click)="select(q)">
                  <span class="rq-code">{{ d.sectionCode }}.{{ q.requirementCode }}</span>
                  <span class="rq-name">{{ titleOf(q) }}</span>
                  @if (missing(q); as m) {
                    @if (m.length) {
                      <span class="rq-missing">Missing: {{ m.join(', ') }}</span>
                    } @else {
                      <span class="rq-ok">✓ Complete</span>
                    }
                  }
                </button>
              </li>
            } @empty {
              <li class="no-data">{{ requirements().length ? 'No requirement matches the search.' : 'No requirement yet.' }}</li>
            }
          </ul>
          <button type="button" class="btn rq-add add-requirement" [disabled]="d.checklistReady === false" (click)="startNew()">+ Add requirement</button>
        </aside>

        <!-- Right: the chosen requirement, or the editor in its place. -->
        <section class="rq-detail" id="rq-detail" aria-live="polite">
          @if (form(); as f) {
            <form class="req-form" (ngSubmit)="save()" novalidate>
              <div class="det-head">
                <h4>{{ f.id ? 'Edit requirement ' + f.label : 'New requirement ' + f.label }}</h4>
              </div>
              <div class="field">
                <label for="requirementName"><span>Requirement<span class="req">*</span></span> <small class="count">{{ f.requirementName.length }} / {{ requirementNameMax }}</small></label>
                <textarea id="requirementName" name="requirementName" class="form-control" rows="2" [maxlength]="requirementNameMax" [(ngModel)]="f.requirementName"
                          placeholder="What the unit must have or do, e.g. The organisation has a documented quality policy communicated to all staff"></textarea>
              </div>
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
              <div class="field video-field">
                <label for="video">Video tutorial <small class="count">optional</small></label>
                <input id="video" name="video" type="url" class="form-control" [maxlength]="videoMax" [(ngModel)]="f.videoUrl"
                       placeholder="https://www.youtube.com/watch?v=…" />
                <small class="hint">A link to a video that explains this requirement (YouTube or any https:// address).</small>
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
                    @if (f.checkpoints.length > 1) {
                      <button type="button" class="btn btn-link x" [attr.aria-label]="'Remove checkpoint ' + (i + 1)" (click)="removeCheckpoint(i)">✕</button>
                    }
                  </div>
                  <div class="cp-body">
                    <div class="side side-yes">
                      <h5><span class="chip c-yes">If Yes</span> Evidence to upload</h5>
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
                      <button type="button" class="btn btn-sm btn-add-evidence" (click)="c.evidences.push(newEvidence()); touch()">+ Add evidence</button>
                    </div>
                    <div class="side side-no">
                      <h5><span class="chip c-no">If No</span><span class="chip c-part">or Partial</span> Action needed</h5>
                      @for (a of c.actions; track $index; let j = $index) {
                        <div class="item">
                          <input class="form-control" [name]="'ac-' + i + '-' + j" [maxlength]="actionMax" [ngModel]="a" (ngModelChange)="c.actions[j] = $event"
                                 placeholder="Action needed" [attr.aria-label]="'Action ' + (j + 1) + ' of checkpoint ' + (i + 1)" />
                          <small class="count">{{ a.length }} / {{ actionMax }}</small>
                          <button type="button" class="btn btn-link x" aria-label="Remove action" (click)="c.actions.splice(j, 1); touch()">✕</button>
                        </div>
                      }
                      <button type="button" class="btn btn-sm btn-add-action" (click)="c.actions.push(''); touch()">+ Add action</button>
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
                <button type="button" class="btn btn-add-checkpoint" (click)="f.checkpoints.push(newCheckpoint()); touch()">+ Add checkpoint</button>
                <span>
                  <button type="button" class="btn btn-default" (click)="closeForm()">CANCEL</button>
                  <button type="submit" class="btn btn-primary" [disabled]="saving() || d.checklistReady === false">{{ f.id ? 'UPDATE REQUIREMENT' : 'SAVE REQUIREMENT' }}</button>
                </span>
              </div>
            </form>
          } @else if (selected(); as q) {
            <article class="req-card">
              <div class="det-head">
                <h4><span class="req-code">{{ d.sectionCode }}.{{ q.requirementCode }}</span> {{ q.requirementName?.trim() || 'Requirement ' + d.sectionCode + '.' + q.requirementCode }}</h4>
                <span class="det-actions">
                  <button type="button" class="btn btn-outline-primary btn-sm edit-requirement" [disabled]="d.checklistReady === false" (click)="edit(q)">EDIT</button>
                  @if (q.canRemove) {
                    <button type="button" class="btn btn-outline-danger btn-sm remove-requirement" (click)="removeRequirement(q)">DELETE</button>
                  }
                </span>
              </div>
              <p class="req-meta">{{ plural(q.points.length, 'checkpoint') }} ·
                {{ plural(q.mandatoryEvidences.length + q.optionalEvidences.length, 'evidence') }} · {{ plural(actionsOf(q), 'action') }}</p>
              <div class="video-row">
                @if (q.videoUrl) {
                  <a class="video-link" [href]="q.videoUrl" target="_blank" rel="noopener noreferrer">▶ Watch the video tutorial</a>
                } @else {
                  <span class="muted">No video tutorial yet</span>
                }
              </div>
              <div class="pb">
                <div><b>Purpose</b><span [class.empty]="!q.purpose">{{ q.purpose || 'Not written yet' }}</span></div>
                <div><b>Benefits</b><span [class.empty]="!q.benefits">{{ q.benefits || 'Not written yet' }}</span></div>
              </div>
              @for (o of q.points; track o.id; let i = $index) {
                <section class="cpv">
                  <div class="cpv-head"><span class="no" aria-hidden="true">{{ i + 1 }}</span><span class="point-text">{{ o.name }}</span></div>
                  @if (o.bullets.length) { <ul class="bullets">@for (s of o.bullets; track s.id) { <li>{{ s.name }}</li> }</ul> }
                  @if (optionImage(o); as src) { <img class="option-image" [src]="src" alt="" /> }
                  <div class="cpv-body">
                    <div class="cpv-col">
                      <p class="cpv-title t-yes">If Yes — evidence to upload</p>
                      @if (evidencesFor(q, o.optionCode); as list) {
                        @if (list.length) {
                          @for (e of list; track $index) {
                            <span class="tag tag-ev">{{ e.evidenceName }}
                              @if (isMandatory(q, e)) { <span class="m">MANDATORY</span> }
                              @if (e.sampleFile) { <a class="samp" [href]="api.sampleUrl(sectionType, sectionCode, e.sampleFile)" target="_blank" rel="noopener">Sample copy</a> }
                            </span>
                          }
                        } @else { <span class="muted">No evidence yet</span> }
                      }
                    </div>
                    <div class="cpv-col">
                      <p class="cpv-title t-no">If No / Partial — action needed</p>
                      @if (o.actions?.length) {
                        @for (a of o.actions; track $index) { <span class="tag tag-ac">{{ a }}</span> }
                      } @else { <span class="muted">No action yet</span> }
                    </div>
                  </div>
                </section>
              }
              @if (evidencesFor(q, null); as general) {
                @if (general.length) {
                  <section class="cpv general-row">
                    <p class="cpv-title">Evidence of the whole requirement</p>
                    @for (e of general; track $index) {
                      <span class="tag tag-ev">{{ e.evidenceName }}
                        @if (isMandatory(q, e)) { <span class="m">MANDATORY</span> }
                        @if (e.validationRequired) { <span class="m">VALIDATION REQUIRED</span> }
                      </span>
                    }
                  </section>
                }
              }
            </article>
          } @else {
            <div class="no-data">Choose a requirement on the left, or add one.</div>
          }
        </section>
      </div>
    }
  `,
  styles: `
    .help-block { color: #a94442; font-size: 13px; }
    .muted { color: #8a9899; font-size: 13px; }
    .crumbs { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; font-size: 13px; color: #5f6f70; margin-bottom: 6px; }
    .crumbs a { color: #2f7c83; text-decoration: none; font-weight: 600; }
    .crumbs a:hover { text-decoration: underline; }
    .lvl { font-size: 15px; color: #5f6f70; font-weight: 500; }
    .summary { color: #5f6f70; }

    /* Two panes: the list of requirements, and the chosen one (or the editor). */
    .rq-layout { display: grid; grid-template-columns: 300px minmax(0, 1fr); gap: 16px; align-items: start; }
    .rq-list { background: #fff; border: 1px solid #dfe9ea; border-radius: 14px; padding: 12px; position: sticky; top: 12px; }
    .rq-items { list-style: none; margin: 8px 0 0; padding: 0; max-height: 60vh; overflow-y: auto; }
    .rq-items li + li { margin-top: 6px; }
    .rq-item {
      display: flex; flex-direction: column; align-items: flex-start; gap: 4px; width: 100%; text-align: left; background: #fff;
      border: 1px solid #e3ecec; border-radius: 10px; padding: 9px 11px; cursor: pointer; transition: background-color .12s, border-color .12s;
    }
    .rq-item:hover { background: #f5fafa; border-color: #b9dfe2; }
    .rq-item.on { background: #e4f3f4; border-color: #45a5ad; }
    .rq-item.editing { border-style: dashed; border-color: #45a5ad; }
    .rq-code { font-weight: 700; color: #fff; background: #45a5ad; border-radius: 12px; padding: 1px 9px; font-size: 12px; }
    .rq-name { font-size: 13.5px; color: #23474a; line-height: 1.35; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
    .rq-missing { font-size: 11.5px; color: #8a5a00; }
    .rq-ok { font-size: 11.5px; color: #1e7a3c; font-weight: 600; }
    .rq-add { width: 100%; margin-top: 10px; border: 1px dashed #45a5ad; color: #2f7c83; background: #f5fafa; font-weight: 700; border-radius: 10px; }
    .rq-add:hover { background: #45a5ad; color: #fff; }
    .rq-detail { background: #fff; border: 1px solid #dfe9ea; border-radius: 14px; padding: 16px 18px; min-width: 0; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.06); }
    .det-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-bottom: 4px; flex-wrap: wrap; }
    .det-head h4 { margin: 0; font-size: 18px; font-weight: 700; color: #23474a; display: flex; align-items: center; gap: 8px; }
    .det-actions { display: flex; gap: 8px; }
    .req-code { font-weight: 700; color: #fff; background: #45a5ad; border-radius: 14px; padding: 2px 12px; font-size: 14px; }
    .req-meta { color: #5f6f70; font-size: 13px; margin: 0 0 10px; }
    .video-row { margin-bottom: 12px; }
    .video-link {
      display: inline-flex; align-items: center; gap: 6px; background: #fdeef0; color: #a8303a; border: 1px solid #f3c4c9; border-radius: 18px;
      padding: 4px 14px; font-weight: 700; font-size: 13px; text-decoration: none;
    }
    .video-link:hover { background: #a8303a; color: #fff; }

    /* Purpose and benefits. */
    .pb { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; font-size: 14px; }
    .pb div { border: 1px solid #e3ecec; border-radius: 10px; padding: 10px 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
    .pb b { display: block; font-size: 11.5px; text-transform: uppercase; letter-spacing: .05em; color: #2f7c83; margin-bottom: 3px; }
    .pb .empty { color: #8a5a00; }

    /* A checkpoint (view). */
    .cpv { border: 1px solid #e3ecec; border-radius: 12px; margin-bottom: 10px; overflow: hidden; }
    .cpv-head { display: flex; gap: 10px; align-items: flex-start; background: #f4fafa; padding: 9px 12px; font-size: 14px; font-weight: 600; color: #23474a; }
    .point-text { white-space: pre-wrap; overflow-wrap: anywhere; }
    .cpv .bullets { margin: 8px 12px 0 34px; }
    .cpv .option-image { margin: 8px 12px 0; }
    .cpv-body { display: grid; grid-template-columns: 1fr 1fr; }
    .cpv-col { padding: 10px 12px; min-width: 0; }
    .cpv-col + .cpv-col { border-left: 1px dashed #e3ecec; }
    .cpv-title { font-size: 12px; font-weight: 700; margin: 0 0 6px; color: #23474a; }
    .cpv-title.t-yes { color: #1e7a3c; } .cpv-title.t-no { color: #a8303a; }
    .general-row { padding: 10px 12px; background: #fcfefe; }
    .tag { display: inline-flex; flex-wrap: wrap; align-items: center; gap: 4px; border-radius: 14px; padding: 3px 10px; font-size: 12.5px; margin: 0 6px 6px 0; overflow-wrap: anywhere; }
    .tag-ev { background: #e6f6ec; color: #17602f; }
    .tag-ac { background: #fdeef0; color: #8a2630; }
    .m { font-size: 10px; font-weight: 700; color: #2f7c83; background: #fff; border-radius: 4px; padding: 0 5px; }
    .samp { font-size: 11.5px; font-weight: 700; color: #2f7c83; }

    /* The editor. */
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin-top: 10px; }
    .field label { display: flex; justify-content: space-between; font-weight: 700; font-size: 13px; margin-bottom: 5px; color: #23474a; }
    .video-field { margin-top: 12px; }
    .count { font-weight: 600; color: #5f6f70; font-size: 11.5px; white-space: nowrap; }
    .cp { border: 1px solid #dfe9ea; border-radius: 12px; margin-top: 14px; overflow: hidden; }
    .cp-head { display: flex; gap: 10px; align-items: flex-start; background: #eef6f6; padding: 10px 12px; }
    .no { flex: none; width: 24px; height: 24px; border-radius: 12px; background: #45a5ad; color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 12px; }
    .cp-head .no { margin-top: 6px; }
    .cp-text { flex: 1 1 auto; min-width: 0; }
    .cp-text textarea { min-height: 38px; resize: vertical; }
    .chip { border-radius: 12px; padding: 2px 9px; font-weight: 700; font-size: 11.5px; }
    .c-yes { background: #e6f6ec; color: #1e7a3c; } .c-no { background: #fdeef0; color: #a8303a; } .c-part { background: #fff4d6; color: #8a6100; }
    .cp-body { display: grid; grid-template-columns: 1fr 1fr; }
    .side { padding: 12px; min-width: 0; }
    .side-yes { background: #fbfefc; } .side-no { background: #fffbfb; }
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
    .hint { color: #8a9899; font-size: 12px; }
    /* The add buttons, in colour (2026-11-07): evidence green, action red, checkpoint teal. */
    .btn-add-evidence, .btn-add-action, .btn-add-checkpoint { color: #fff; font-weight: 700; border-radius: 8px; border: 0; padding: 5px 12px; font-size: 12.5px; }
    .btn-add-evidence { background: #2e8b4e; } .btn-add-evidence:hover { background: #1e7a3c; color: #fff; }
    .btn-add-action { background: #c9424e; } .btn-add-action:hover { background: #a8303a; color: #fff; }
    .btn-add-checkpoint { background: #45a5ad; padding: 7px 16px; font-size: 13.5px; } .btn-add-checkpoint:hover { background: #368289; color: #fff; }
    .bullets { margin: 6px 0 0; padding-left: 18px; color: #3b4b4c; list-style: disc; font-size: 13px; }
    .general .side { background: #fcfefe; }
    .foot { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 14px; flex-wrap: wrap; }
    .foot span { display: flex; gap: 8px; }
    .option-image { display: block; max-width: 220px; margin-top: 6px; border-radius: 6px; border: 1px solid #dfe9ea; }

    @media (max-width: 991.98px) {
      .rq-layout { grid-template-columns: minmax(0, 1fr); }
      .rq-list { position: static; }
      .rq-items { max-height: 260px; }
      .cp-body, .cpv-body { grid-template-columns: minmax(0, 1fr); }
      .cp-body .side + .side, .cpv-col + .cpv-col { border-left: 0; border-top: 1px dashed #dfe9ea; }
    }
    @media (max-width: 767.98px) {
      .two, .pb { grid-template-columns: minmax(0, 1fr); }
    }
  `,
})
export class RequirementsPage {
  protected readonly questionnairePortals = QUESTIONNAIRE_PORTALS;
  protected readonly api = inject(QuestionnaireApi);
  private readonly route = inject(ActivatedRoute).snapshot.paramMap;

  protected readonly sectionType = this.route.get('sectionType') ?? 'Bronze';
  protected readonly sectionCode = this.route.get('sectionCode') ?? '';
  protected readonly purposeMax = PURPOSE_MAX;
  protected readonly requirementNameMax = REQUIREMENT_NAME_MAX;
  protected readonly actionMax = ACTION_MAX;
  protected readonly checkpointMax = CHECKPOINT_MAX;
  protected readonly videoMax = VIDEO_MAX;
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
  /** The level as the menu names it: the Admin's name (Administration → Certification Levels; "ZED-X" for ZEDX). */
  protected readonly levelLabel = computed(() => (this.sectionType.toUpperCase() === 'ZEDX' ? levelName('ZEDX') : levelName(this.sectionType)));
  protected readonly form = signal<RequirementForm | null>(null);
  /** The requirement shown on the right (the first one until another is chosen). */
  private readonly selectedId = signal<number | null>(null);
  protected readonly selected = computed(() => {
    const rows = this.requirements();
    return rows.find((q) => q.id === this.selectedId()) ?? rows[0] ?? null;
  });
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

  /** The requirement's name in the list: its first checkpoint (requirements have no title of their own). */
  /** The requirement's text; older requirements without one show their first checkpoint. */
  protected titleOf(q: Requirement): string {
    return q.requirementName?.trim() || q.points[0]?.name?.trim() || `Requirement ${q.requirementCode}`;
  }

  /** What the requirement still lacks, shown under it in the list. */
  protected missing(q: Requirement): string[] {
    const m: string[] = [];
    if (!q.requirementName?.trim()) m.push('requirement text');
    if (!q.purpose) m.push('purpose');
    if (!q.benefits) m.push('benefits');
    if (!q.mandatoryEvidences.length && !q.optionalEvidences.length) m.push('evidence');
    if (!this.actionsOf(q)) m.push('action');
    return m;
  }

  /** Shows a requirement on the right (an open editor is closed after asking). */
  protected select(q: Requirement): void {
    if (this.form() && !window.confirm('Leave the requirement you are editing without saving?')) return;
    this.form.set(null);
    this.formError.set('');
    this.selectedId.set(q.id);
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

  protected startNew(): void {
    this.clearMessages();
    this.form.set({
      id: null, label: `${this.sectionCode}.${this.requirements().length + 1}`, requirementName: '', purpose: '', benefits: '', videoUrl: '', checkpoints: [newCheckpoint()], general: [],
    });
    this.reveal();
  }

  /** On a narrow screen the panel is below the list: bring it into view. */
  private reveal(): void {
    setTimeout(() => document.getElementById('rq-detail')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' }));
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
      requirementName: q.requirementName ?? '',
      purpose: q.purpose ?? '',
      benefits: q.benefits ?? '',
      videoUrl: q.videoUrl ?? '',
      checkpoints: q.points.map((p) => ({
        optionCode: p.optionCode.trim(),
        text: p.name,
        evidences: this.evidencesFor(q, p.optionCode).map(evidence),
        actions: [...(p.actions ?? [])],
        bullets: p.bullets.map((b) => b.name),
      })),
      general: this.evidencesFor(q, null).map(evidence),
    });
    this.selectedId.set(q.id);
    this.reveal();
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
      requirementName: f.requirementName.trim(),
      purpose: f.purpose.trim(),
      benefits: f.benefits.trim(),
      videoUrl: f.videoUrl.trim(),
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
    if (!body.requirementName) {
      this.formError.set('Please enter the requirement.');
      return;
    }
    if (body.videoUrl && !/^https?:\/\/[^\s/]+\.[^\s]+$/i.test(body.videoUrl)) {
      this.formError.set('The video link must be a web address starting with https://, e.g. a YouTube link.');
      return;
    }
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
