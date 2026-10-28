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
 * All texts are shown as text (the old pages rendered the parameter description as raw HTML). V4 layout: page head with
 * BACK, the new requirement in a card, row buttons side by side.
 */
@Component({
  selector: 'zed-staff-requirements',
  imports: [FormsModule, RouterLink, CollapseCard, ListSearchComponent],
  template: `
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
      <zed-collapse-card title="Add Requirement" summary="Open to add a requirement point.">
        <form class="add-form" (ngSubmit)="addPoint()" novalidate>
          <div class="form-grid">
            <label class="top" for="requirementName">Requirement</label>
            <textarea id="requirementName" name="requirementName" class="form-control" maxlength="1990" rows="4" [(ngModel)]="pointText"></textarea>
          </div>
          <div class="form-actions">
            <button type="submit" class="btn btn-outline-primary">Add</button>
          </div>
          @if (draft().length) {
            <div class="table-responsive mt-3">
              <table class="table table-zed table-bordered draft-points">
                <tbody>
                  @for (p of draft(); track $index; let i = $index) {
                    <tr>
                      <td class="text-center" style="width: 48px">{{ i + 1 }}.</td>
                      <td>
                        {{ p.name }}
                        <ul>
                          @for (b of p.bullets; track $index; let j = $index) {
                            <li>
                              <span>{{ b }}</span>
                              <button type="button" class="btn btn-link text-danger p-0 ms-1" aria-label="Remove bullet" (click)="removeBullet(i, j)">&times;</button>
                            </li>
                          }
                        </ul>
                      </td>
                      <td class="text-center" style="width: 200px">
                        <div class="row-actions justify-content-center">
                          <button type="button" class="btn btn-primary" (click)="openBullet(i)">Add Bullet</button>
                          <button type="button" class="btn btn-outline-danger" (click)="removeDraftPoint(i)">Remove</button>
                        </div>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="form-actions">
              <button type="button" class="btn btn-primary" [disabled]="saving()" (click)="save()">Save</button>
            </div>
          }
        </form>
      </zed-collapse-card>

      <zed-list-search [(value)]="search" placeholder="Search requirements" inputId="req-search" [found]="shown().length" />
      <div class="table-responsive">
        <table class="table table-zed table-bordered requirements">
          <thead>
            <tr>
              <th class="text-center" style="width: 90px">Code</th>
              <th>Requirements</th>
              <th>Evidences</th>
              <th class="text-center" style="width: 110px">Actions</th>
            </tr>
          </thead>
          <tbody>
            @for (q of shown(); track q.id) {
              <tr>
                <td class="text-center"><strong>{{ data()!.sectionCode }}.{{ q.requirementCode }}</strong></td>
                <td style="width: 50%">
                  @for (o of q.points; track o.id; let i = $index; let last = $last) {
                    <div>
                      {{ o.name }}
                      @if (i > 0 && last) {
                        <button type="button" class="btn btn-link text-danger p-0 ms-1 remove-point" aria-label="Remove point" (click)="removePoint(q, o.id)">&times;</button>
                      }
                      <ul>
                        @for (s of o.bullets; track s.id) {
                          <li>{{ s.name }}</li>
                        }
                      </ul>
                      @if (optionImage(o); as src) {
                        <span><img class="option-image" [src]="src" alt="" /></span>
                      }
                    </div>
                  }
                </td>
                <td>
                  <div class="ev-head">
                    <span>Mandatory:</span>
                    <button type="button" class="btn btn-outline-primary btn-sm" (click)="openEvidences(q, 'mandatory')">Add Evidences</button>
                  </div>
                  <ol>
                    @for (e of q.mandatoryEvidences; track $index) {
                      <li>
                        {{ e.evidenceName }}
                        @if (e.validationRequired) { <span class="status-badge is-pending ms-1">(Validation Required)</span> }
                        @if (e.helpText) { <small class="d-block text-muted">({{ e.helpText }})</small> }
                      </li>
                    }
                  </ol>
                  <div class="ev-head border-top pt-2">
                    <span>Optional:</span>
                    <button type="button" class="btn btn-outline-primary btn-sm" (click)="openEvidences(q, 'optional')">Add Evidences</button>
                  </div>
                  <ol>
                    @for (e of q.optionalEvidences; track $index) {
                      <li>
                        {{ e.evidenceName }}
                        @if (e.validationRequired) { <span class="status-badge is-pending ms-1">(Validation Required)</span> }
                        @if (e.helpText) { <small class="d-block text-muted">({{ e.helpText }})</small> }
                      </li>
                    }
                  </ol>
                </td>
                <td class="text-center">
                  @if (q.canRemove) {
                    <div class="row-actions justify-content-center">
                      <button type="button" class="btn btn-outline-danger remove-requirement" (click)="removeRequirement(q)">Delete</button>
                    </div>
                  }
                </td>
              </tr>
            } @empty {
              <tr><td colspan="4" style="padding: 0"><div class="no-data">{{ requirements().length ? 'No requirement matches the search.' : 'No Data' }}</div></td></tr>
            }
          </tbody>
        </table>
      </div>
    }

    @if (bulletFor() !== null) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="bullet-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="bullet-title">Bullet Point</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="bulletFor.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <form (ngSubmit)="addBullet()" novalidate>
              <div class="modal-body">
                <label class="visually-hidden" for="bulletText">Bullet Point</label>
                <input id="bulletText" name="bulletText" class="form-control" maxlength="2000" [(ngModel)]="bulletText" />
              </div>
              <div class="modal-footer">
                <button type="submit" class="btn btn-default">OK</button>
              </div>
            </form>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }

    @if (evidenceDialog(); as ev) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="evidence-title">
        <div class="modal-dialog modal-popup">
          <div class="modal-content">
            <div class="modal-header">
              <div class="modal-title w-100 d-flex justify-content-between align-items-center">
                <h3 class="registration-title m-0" id="evidence-title">Evidence ({{ ev.kind === 'mandatory' ? 'Mandatory' : 'Optional' }})</h3>
                <button type="button" class="btn btn-link p-0" aria-label="Close" (click)="evidenceDialog.set(null)"><img src="Images/svgicons/close.svg" alt="" /></button>
              </div>
            </div>
            <div class="modal-body">
              <div class="form-grid">
                <label for="evidenceName">Evidence</label>
                <input id="evidenceName" name="evidenceName" class="form-control" maxlength="2000" placeholder="Evidence" [(ngModel)]="ev.name" />
                @if (ev.kind === 'mandatory') {
                  <label for="evidenceHelp">iButton</label>
                  <input id="evidenceHelp" name="evidenceHelp" class="form-control" maxlength="2000" placeholder="iButton" [(ngModel)]="ev.helpText" />
                }
                <span class="label"></span>
                <div class="d-flex justify-content-between align-items-center gap-2">
                  <div class="form-check m-0">
                    <input class="form-check-input" type="checkbox" id="validationRequired" name="validationRequired" [(ngModel)]="ev.validationRequired" />
                    <label class="form-check-label" for="validationRequired">Validation Required</label>
                  </div>
                  <button type="button" class="btn btn-outline-primary add-evidence" (click)="addEvidence()">ADD</button>
                </div>
              </div>
              @if (dialogError()) { <span class="help-block" role="alert">{{ dialogError() }}</span> }
              <table class="table table-zed table-bordered mt-3 mb-0">
                <thead>
                  <tr>
                    <th class="text-center"></th>
                    <th>Evidence</th>
                    <th class="text-center">Validation Required</th>
                    @if (ev.kind === 'mandatory') { <th>iButton</th> }
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of ev.saved; track $index; let i = $index) {
                    <tr>
                      <td class="text-center">{{ i + 1 }}</td>
                      <td>{{ e.evidenceName }}</td>
                      <td class="text-center">{{ e.validationRequired ? 'Yes' : '' }}</td>
                      @if (ev.kind === 'mandatory') { <td>{{ e.helpText }}</td> }
                      <td></td>
                    </tr>
                  }
                  @for (e of ev.added; track $index; let i = $index) {
                    <tr class="added">
                      <td class="text-center">{{ ev.saved.length + i + 1 }}</td>
                      <td>{{ e.evidenceName }}</td>
                      <td class="text-center">{{ e.validationRequired ? 'Yes' : '' }}</td>
                      @if (ev.kind === 'mandatory') { <td>{{ e.helpText }}</td> }
                      <td class="text-center"><button type="button" class="btn btn-link text-danger p-0" aria-label="Remove evidence" (click)="removeAdded(i)">&times;</button></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="modal-footer">
              @if (ev.added.length) {
                <button type="button" class="btn btn-primary save-evidences" [disabled]="saving()" (click)="saveEvidences()">SAVE</button>
              }
            </div>
          </div>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
  styles: `
    .help-block { color: #a94442; font-size: 13px; }
    table tbody tr td { font-size: 14px; }
    .form-grid > .top { align-self: start; padding-top: 8px; }
    .ev-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; font-weight: 700; color: #1f5c61; margin-bottom: 6px; }
    td ol, td ul { margin-bottom: 8px; padding-left: 20px; }
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
  }

  protected openBullet(i: number): void {
    this.bulletText = '';
    this.bulletFor.set(i);
  }

  /** OK adds the bullet and keeps the pop-up open for the next one, as before. */
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
