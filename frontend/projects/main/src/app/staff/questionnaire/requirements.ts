import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { Evidence, NewPoint, Point, QuestionnaireApi, Requirement, RequirementsResponse } from './questionnaire.api';

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
 * All texts are shown as text (the old pages rendered the parameter description as raw HTML).
 */
@Component({
  selector: 'zed-staff-requirements',
  imports: [FormsModule, RouterLink],
  template: `
    <div class="container form-page" id="zed_user_form">
      <div class="row mt-4">
        <div class="col-sm-10">
          <h3 class="registration-title text-center">Requirements</h3>
          @if (data(); as d) {
            <p class="text-center"><strong>{{ d.sectionType }} – {{ d.sectionCode }}. {{ d.sectionName }}</strong></p>
          }
        </div>
        <div class="col-sm-2">
          <a class="btn btn-primary" [routerLink]="['/staff/masters/parameters', sectionType]">&lt;&lt; BACK</a>
        </div>
      </div>

      @if (error()) {
        <div class="alert alert-danger" role="alert">{{ error() }}</div>
      }
      @if (success()) {
        <div class="alert alert-success" role="status">{{ success() }}</div>
      }

      @if (data()) {
        <form class="jumbotron" (ngSubmit)="addPoint()" novalidate>
          <div class="row">
            <div class="col-sm-10" style="margin-bottom: 9px">
              <div class="input-group mb-3">
                <label class="input-group-text" for="requirementName">Requirement</label>
                <textarea id="requirementName" name="requirementName" class="form-control" maxlength="1990" style="max-width: 100%; height: 100px"
                          [(ngModel)]="pointText"></textarea>
              </div>
            </div>
            <div class="col-sm-2">
              <div class="d-grid"><button type="submit" class="btn btn-primary btn-block">Add</button></div>
            </div>
          </div>
          @if (draft().length) {
            <div class="table-responsive">
              <table class="table table-striped table-bordered draft-points">
                <tbody>
                  @for (p of draft(); track $index; let i = $index) {
                    <tr>
                      <td>{{ i + 1 }}.</td>
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
                      <td style="width: 140px">
                        <button type="button" class="btn btn-primary btn-sm" style="width: 100px" (click)="openBullet(i)">Add Bullet</button>
                        <button type="button" class="btn btn-link btn-sm text-danger" (click)="removeDraftPoint(i)">Remove</button>
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="row justify-content-end">
              <div class="col-sm-2">
                <button type="button" class="btn btn-success btn-block w-100" [disabled]="saving()" (click)="save()">Save</button>
              </div>
            </div>
          }
        </form>

        <div class="table-responsive">
          <table class="table table-striped table-bordered bg-white requirements">
            <thead>
              <tr>
                <th>Code</th>
                <th>Requirements</th>
                <th>Evidences</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              @for (q of requirements(); track q.id) {
                <tr>
                  <th class="text-center" style="vertical-align: middle">{{ data()!.sectionCode }}.{{ q.requirementCode }}</th>
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
                    <h4 class="d-flex justify-content-between">
                      Mandatory:
                      <button type="button" class="btn btn-primary btn-sm" style="width: 110px" (click)="openEvidences(q, 'mandatory')">Add Evidences</button>
                    </h4>
                    <ol>
                      @for (e of q.mandatoryEvidences; track $index) {
                        <li>
                          {{ e.evidenceName }}
                          @if (e.validationRequired) { <small class="text-warning">(Validation Required)</small> }
                          @if (e.helpText) { <br />({{ e.helpText }}) }
                        </li>
                      }
                    </ol>
                    <hr />
                    <h4 class="d-flex justify-content-between">
                      Optional:
                      <button type="button" class="btn btn-primary btn-sm" style="width: 110px" (click)="openEvidences(q, 'optional')">Add Evidences</button>
                    </h4>
                    <ol>
                      @for (e of q.optionalEvidences; track $index) {
                        <li>
                          {{ e.evidenceName }}
                          @if (e.validationRequired) { <small class="text-warning">(Validation Required)</small> }
                          @if (e.helpText) { <br />({{ e.helpText }}) }
                        </li>
                      }
                    </ol>
                  </td>
                  <td style="vertical-align: middle; text-align: center">
                    @if (q.canRemove) {
                      <button type="button" class="btn btn-danger remove-requirement" (click)="removeRequirement(q)">Delete</button>
                    }
                  </td>
                </tr>
              } @empty {
                <tr><td colspan="4" style="padding: 0"><div class="no-data">No Data</div></td></tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>

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
                <input id="bulletText" name="bulletText" class="form-control" maxlength="2000" style="max-width: 100%" [(ngModel)]="bulletText" />
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
              <div class="row align-items-center">
                <div class="col-sm-12">
                  <input id="evidenceName" name="evidenceName" class="form-control" maxlength="2000" style="max-width: 100%" placeholder="Evidence" [(ngModel)]="ev.name" />
                </div>
                @if (ev.kind === 'mandatory') {
                  <div class="col-sm-12 mt-1">
                    <input id="evidenceHelp" name="evidenceHelp" class="form-control" maxlength="2000" style="max-width: 100%" placeholder="iButton" [(ngModel)]="ev.helpText" />
                  </div>
                }
                <div class="col-sm-10">
                  <div class="form-check">
                    <input class="form-check-input" type="checkbox" id="validationRequired" name="validationRequired" [(ngModel)]="ev.validationRequired" />
                    <label class="form-check-label" for="validationRequired">Validation Required</label>
                  </div>
                </div>
                <div class="col-sm-2" style="margin-top: 5px">
                  <button type="button" class="btn btn-default add-evidence" (click)="addEvidence()">ADD</button>
                </div>
              </div>
              @if (dialogError()) { <span class="help-block" role="alert">{{ dialogError() }}</span> }
              <table class="table table-striped table-bordered" style="margin-top: 10px">
                <thead>
                  <tr>
                    <th></th>
                    <th>Evidence</th>
                    <th>Validation Required</th>
                    @if (ev.kind === 'mandatory') { <th>iButton</th> }
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  @for (e of ev.saved; track $index; let i = $index) {
                    <tr>
                      <td>{{ i + 1 }}</td>
                      <td>{{ e.evidenceName }}</td>
                      <td>{{ e.validationRequired ? 'Yes' : '' }}</td>
                      @if (ev.kind === 'mandatory') { <td>{{ e.helpText }}</td> }
                      <td></td>
                    </tr>
                  }
                  @for (e of ev.added; track $index; let i = $index) {
                    <tr class="added">
                      <td>{{ ev.saved.length + i + 1 }}</td>
                      <td>{{ e.evidenceName }}</td>
                      <td>{{ e.validationRequired ? 'Yes' : '' }}</td>
                      @if (ev.kind === 'mandatory') { <td>{{ e.helpText }}</td> }
                      <td><button type="button" class="btn btn-link text-danger p-0" aria-label="Remove evidence" (click)="removeAdded(i)">&times;</button></td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
            <div class="modal-footer">
              @if (ev.added.length) {
                <button type="button" class="btn btn-default save-evidences" [disabled]="saving()" (click)="saveEvidences()">SAVE</button>
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
  `,
})
export class RequirementsPage {
  private readonly api = inject(QuestionnaireApi);
  private readonly route = inject(ActivatedRoute).snapshot.paramMap;

  protected readonly sectionType = this.route.get('sectionType') ?? 'Bronze';
  protected readonly sectionCode = this.route.get('sectionCode') ?? '';

  protected readonly data = signal<RequirementsResponse | null>(null);
  protected readonly requirements = computed(() => this.data()?.requirements ?? []);
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
   * A point's MasterOption.OptionImage, shown below it as the old page did (`<img src="~/{{o.OptionImage}}">`, a path under
   * the site root). Only a plain relative path is used; anything with a scheme or "//" is ignored.
   */
  protected optionImage(point: Point & { optionImage?: string | null }): string | null {
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
