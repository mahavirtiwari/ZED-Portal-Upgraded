import { DatePipe } from '@angular/common';
import { HttpClient } from '@angular/common/http';
import { Component, effect, inject, input, signal, untracked } from '@angular/core';
import { firstValueFrom } from 'rxjs';

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
        <table class="table table-bordered table-zed bg-white mb-0">
          <tbody>
            @for (v of f.values; track v.key) {
              <tr>
                <th scope="row" style="width: 40%">{{ v.label }} @if (!v.enabled) { <small class="text-muted">(field disabled since)</small> }</th>
                <td>{{ v.value }} @if (v.updatedOn) { <small class="text-muted d-block">{{ v.updatedOn | date: 'dd-MM-yyyy HH:mm' }}</small> }</td>
              </tr>
            }
          </tbody>
        </table>
      </div>
    }
  `,
})
export class AppFormValuesPanel {
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
