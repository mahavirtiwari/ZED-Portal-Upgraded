import { HttpClient } from '@angular/common/http';
import { Component, computed, inject, signal } from '@angular/core';
import { MessageResponse, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';

export type ChangeKind = 'addState' | 'renameState' | 'addDistrict' | 'renameDistrict' | 'deactivateDistrict';

export interface LgdChange {
  kind: ChangeKind;
  stateCode: string;
  stateName: string | null;
  districtCode: string | null;
  districtName: string | null;
  oldName: string | null;
}

export interface LgdPreview {
  statesInFile: number;
  districtsInFile: number;
  changes: LgdChange[];
}

const KIND_LABELS: Record<ChangeKind, string> = {
  addState: 'New state / UT',
  renameState: 'State renamed',
  addDistrict: 'New district',
  renameDistrict: 'District renamed',
  deactivateDistrict: 'No longer in LGD (deactivate)',
};

/**
 * Admin → Masters → LG Directory (new in V4): brings the States and Districts masters up to date with the Local
 * Government Directory. LGD has no open web service, so the Admin downloads its district list and uploads it; the page
 * shows what differs and applies only the ticked changes.
 */
@Component({
  selector: 'zed-staff-lgd-directory',
  template: `
    <div class="page-head">
      <div>
        <h3 class="registration-title">LG Directory</h3>
        <p class="page-sub">Bring the states and districts up to date with the Local Government Directory (LGD).</p>
      </div>
    </div>
    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }
    @if (success()) {
      <div class="alert alert-success" role="status">{{ success() }}</div>
    }

    <section class="zed-card">
      <ol class="lgd-steps">
        <li>On <a href="https://lgdirectory.gov.in/downloadDirectory.do" target="_blank" rel="noopener noreferrer">lgdirectory.gov.in → Download Directory</a>, download the list of <strong>all districts</strong> (CSV or Excel).</li>
        <li>Upload it here and check the changes.</li>
        <li>Tick the changes to make and apply them. Codes are LGD codes; names are stored in capitals.</li>
      </ol>
      <div class="lgd-upload">
        <input type="file" class="form-control" id="lgd-file" accept=".csv,.xlsx" aria-label="LGD district list" (change)="pickFile($event)" />
        <button type="button" class="btn btn-primary" [disabled]="busy() || !file" (click)="preview()">Check changes</button>
      </div>
    </section>

    @if (result(); as r) {
      <section class="zed-card" aria-labelledby="lgd-changes">
        <h5 class="lgd-h" id="lgd-changes">Changes <span class="zed-chip">{{ r.statesInFile }} states, {{ r.districtsInFile }} districts in the file</span></h5>
        @if (!r.changes.length) {
          <div class="no-data">The states and districts already match LGD.</div>
        } @else {
          <div class="lgd-summary">
            @for (k of kinds(); track k.kind) {
              <label class="lgd-kind"><input type="checkbox" class="form-check-input" [checked]="allTicked(k.kind)" (change)="tickKind(k.kind, $any($event.target).checked)" /> {{ k.label }} ({{ k.count }})</label>
            }
          </div>
          <div class="table-responsive lgd-list">
            <table class="table table-zed">
              <thead><tr><th style="width: 40px"></th><th>Change</th><th>State / UT</th><th>District</th><th>Now in ZED</th></tr></thead>
              <tbody>
                @for (c of r.changes; track $index; let i = $index) {
                  <tr>
                    <td><input type="checkbox" class="form-check-input" [attr.aria-label]="'Apply ' + labelOf(c)" [checked]="ticked().has(i)" (change)="tick(i)" /></td>
                    <td>{{ kindLabel(c.kind) }}</td>
                    <td>{{ c.stateName }} <small class="muted">({{ c.stateCode }})</small></td>
                    <td>{{ c.districtName }} @if (c.districtCode) { <small class="muted">({{ c.districtCode }})</small> }</td>
                    <td class="muted">{{ c.oldName ?? (c.kind.startsWith('add') ? '—' : '') }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
          <div class="form-actions">
            <span class="muted me-auto">{{ ticked().size }} of {{ r.changes.length }} ticked</span>
            <button type="button" class="btn btn-primary" [disabled]="busy() || !ticked().size" (click)="apply()">Apply ticked changes</button>
          </div>
        }
      </section>
    }
    @if (busy()) {
      <div class="loadingdiv"><div class="loader"></div></div>
    }
  `,
  styles: `
    .zed-card { margin-bottom: 16px; }
    .lgd-steps { padding-left: 18px; margin-bottom: 12px; }
    .lgd-upload { display: grid; grid-template-columns: 1fr auto; gap: 12px; max-width: 640px; }
    .lgd-h { font-weight: 700; color: #23474a; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
    .lgd-summary { display: flex; flex-wrap: wrap; gap: 8px 16px; margin-bottom: 12px; }
    .lgd-kind { display: inline-flex; align-items: center; gap: 6px; margin: 0; }
    .lgd-kind .form-check-input, .lgd-list .form-check-input { float: none; margin: 0; }
    .lgd-list { max-height: 520px; overflow: auto; }
    .form-actions { align-items: center; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class LgdDirectoryPage {
  private readonly http = inject(HttpClient);
  private static readonly url = '/api/staff/masters/lgd';

  protected file: File | null = null;
  protected readonly result = signal<LgdPreview | null>(null);
  protected readonly ticked = signal<Set<number>>(new Set());
  protected readonly kinds = computed(() => {
    const changes = this.result()?.changes ?? [];
    return (Object.keys(KIND_LABELS) as ChangeKind[])
      .map((kind) => ({ kind, label: KIND_LABELS[kind], count: changes.filter((c) => c.kind === kind).length }))
      .filter((k) => k.count > 0);
  });
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  protected kindLabel(kind: ChangeKind): string {
    return KIND_LABELS[kind];
  }

  protected labelOf(c: LgdChange): string {
    return `${KIND_LABELS[c.kind]} ${c.districtName ?? c.stateName ?? ''}`.trim();
  }

  protected pickFile(event: Event): void {
    this.file = (event.target as HTMLInputElement).files?.[0] ?? null;
    this.error.set('');
  }

  protected allTicked(kind: ChangeKind): boolean {
    const changes = this.result()?.changes ?? [];
    const idx = changes.map((c, i) => (c.kind === kind ? i : -1)).filter((i) => i >= 0);
    return idx.length > 0 && idx.every((i) => this.ticked().has(i));
  }

  protected tickKind(kind: ChangeKind, on: boolean): void {
    const next = new Set(this.ticked());
    (this.result()?.changes ?? []).forEach((c, i) => {
      if (c.kind !== kind) return;
      if (on) next.add(i);
      else next.delete(i);
    });
    this.ticked.set(next);
  }

  protected tick(i: number): void {
    const next = new Set(this.ticked());
    if (!next.delete(i)) next.add(i);
    this.ticked.set(next);
  }

  protected async preview(): Promise<void> {
    if (!this.file) return;
    const form = new FormData();
    form.append('file', this.file, this.file.name);
    this.busy.set(true);
    this.error.set('');
    this.success.set('');
    try {
      const r = await firstValueFrom(this.http.post<LgdPreview>(`${LgdDirectoryPage.url}/preview`, form));
      this.result.set(r);
      // New and renamed entries are ticked; deactivations are left for the Admin to tick.
      this.ticked.set(new Set(r.changes.map((c, i) => (c.kind === 'deactivateDistrict' ? -1 : i)).filter((i) => i >= 0)));
    } catch (err) {
      this.result.set(null);
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async apply(): Promise<void> {
    const r = this.result();
    if (!r) return;
    const changes = r.changes.filter((_, i) => this.ticked().has(i));
    if (!confirm(`Apply ${changes.length} change(s) to the states and districts?`)) return;
    this.busy.set(true);
    this.error.set('');
    try {
      this.success.set((await firstValueFrom(this.http.post<MessageResponse>(`${LgdDirectoryPage.url}/apply`, { changes }))).message);
      this.result.set(null);
      this.ticked.set(new Set());
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }
}
