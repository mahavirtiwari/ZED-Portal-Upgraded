import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';
import { withApiBase } from '../../api-base';

export interface AppFormValue {
  key: string;
  label: string;
  type: string;
  /** As text (several choices joined with ", "). */
  value: string;
  /** False: the Admin has disabled the field since (the answer is kept). */
  enabled: boolean;
  submittedBy: string | null;
  updatedOn: string | null;
  /** 2026-11-16: repeating entries of the Admin's own: each entry's columns (photos as addresses). */
  entries?: AppFormEntryCell[][] | null;
}

export interface AppFormEntryCell {
  label: string;
  type: string;
  text: string;
  photoUrls: string[];
}

export interface AppFormValues {
  form: string;
  name: string;
  app: string;
  values: AppFormValue[];
}

/**
 * "Additional information": answers to the fields the Admin added to the apps' Basic Information forms (Admin → App Forms)
 * for one unit and level. Shows nothing when there are none, or when the user may not see them.
 */
@Component({
  selector: 'zed-app-form-values',
  imports: [DatePipe],
  template: `
    @for (f of forms(); track f.form) {
      <div class="card mb-3 app-form-values">
        <div class="card-header"><strong>Additional information</strong> <small class="text-muted">· {{ f.app }}</small></div>
        <table class="table table-bordered table-zed mb-0">
          <tbody>
            @for (v of f.values; track v.key) {
              <tr>
                <th scope="row" style="width: 40%">{{ v.label }} @if (!v.enabled) { <small class="text-muted">(field disabled since)</small> }</th>
                <td>
                  @if (v.entries?.length) {
                    <div class="table-responsive">
                      <table class="table table-sm table-bordered mb-1 afv-entries" data-entries>
                        <thead><tr><th class="text-center">#</th>@for (c of v.entries![0]; track $index) { <th>{{ c.label }}</th> }</tr></thead>
                        <tbody>
                          @for (row of v.entries; track $index; let i = $index) {
                            <tr>
                              <td class="text-center">{{ i + 1 }}</td>
                              @for (c of row; track $index) {
                                <td>
                                  @if (c.type === 'photo') {
                                    @for (u of c.photoUrls; track u) {
                                      <a [href]="api(u)" target="_blank" rel="noopener"><img class="afv-photo" [src]="api(u)" [alt]="c.label + ' ' + (i + 1)" /></a>
                                    } @empty { <span class="text-muted">—</span> }
                                  } @else { {{ c.text || '—' }} }
                                </td>
                              }
                            </tr>
                          }
                        </tbody>
                      </table>
                    </div>
                  } @else { {{ v.value }} }
                  @if (v.updatedOn) { <small class="text-muted d-block">{{ v.updatedOn | date: 'dd-MM-yyyy HH:mm' }}</small> }
                </td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
  styles: `
    .afv-photo { width: 64px; height: 64px; object-fit: cover; border-radius: 6px; margin: 2px; border: 1px solid #dfe9ea; }
    .afv-entries th { font-size: 12.5px; }
  `,
})
export class AppFormValuesPanel {
  /** The API's own address of a file (the portal may run under a base path). */
  protected api(url: string): string {
    return withApiBase(url);
  }

  private readonly http = inject(HttpClient);

  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();
  protected readonly forms = signal<AppFormValues[]>([]);

  constructor() {
    effect(() => {
      const url = `/api/staff/app-form-values/${encodeURIComponent(this.zedId())}/${encodeURIComponent(this.certification())}`;
      untracked(() => void this.load(url));
    });
  }

  private async load(url: string): Promise<void> {
    try {
      this.forms.set(await firstValueFrom(this.http.get<AppFormValues[]>(url)));
    } catch {
      // Optional panel: no answers, or not visible to this user.
      this.forms.set([]);
    }
  }
}
