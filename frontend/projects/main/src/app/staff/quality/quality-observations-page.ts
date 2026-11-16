import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { apiErrorMessage, AuthService } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ASSESSMENT_SYSTEM } from '../assessment/assessment-shared';
import { QualityObservationItem } from './quality-observation-item';
import { QoDashboard, QoObservation, QoStanding, QoStatus, QualityApi } from './quality.api';

/**
 * 2026-11-16 (approved): Quality observations. The Master Admin and its operation admins: the dashboard (open / replied /
 * closed, reply and closing times, categories) with the ranking of the agencies and assessors (rank 1 = fewest weighted
 * observations per assessment: minor 1, major 3, critical 5; then the faster reply), and the list to close / reopen. An
 * agency: its observations to reply to. The figures come from each observation's time history.
 */
@Component({
  selector: 'zed-staff-quality-observations',
  imports: [FormsModule, QualityObservationItem],
  template: `
    <div class="page-head">
      <h3 class="registration-title">Quality Observations</h3>
      <p class="page-sub">{{ master() ? words.masterSub : words.agencySub }}</p>
    </div>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }
    @if (notice()) { <div class="alert alert-success" role="status">{{ notice() }}</div> }

    <div class="qo-filters">
      <label for="qo-days">Period</label>
      <select id="qo-days" class="form-select" [ngModel]="days()" (ngModelChange)="days.set(+$event); load()">
        <option [ngValue]="30">Last 30 days</option>
        <option [ngValue]="90">Last 3 months</option>
        <option [ngValue]="365">Last year</option>
        <option [ngValue]="3650">All time</option>
      </select>
      @if (master()) {
        <div class="btn-group" role="tablist">
          <button type="button" class="btn btn-sm" [class.btn-primary]="tab() === 'dashboard'" [class.btn-outline-primary]="tab() !== 'dashboard'" (click)="tab.set('dashboard')">Dashboard</button>
          <button type="button" class="btn btn-sm" [class.btn-primary]="tab() === 'list'" [class.btn-outline-primary]="tab() !== 'list'" (click)="tab.set('list')">Observations</button>
        </div>
      }
    </div>

    @if (master() && tab() === 'dashboard') {
      @if (dash(); as d) {
        <div class="qo-tiles" data-qo-tiles>
          <div class="qo-tile"><b>{{ d.total }}</b><span>Observations</span></div>
          <div class="qo-tile open"><b>{{ d.open }}</b><span>Open</span></div>
          <div class="qo-tile"><b>{{ d.responded }}</b><span>Replied</span></div>
          <div class="qo-tile ok"><b>{{ d.closed }}</b><span>Closed</span></div>
          <div class="qo-tile"><b>{{ hours(d.avgReplyHours) }}</b><span>Avg. time to reply</span></div>
          <div class="qo-tile"><b>{{ hours(d.avgCloseHours) }}</b><span>Avg. time to close</span></div>
        </div>
        @for (block of [{ title: words.agencies, rows: d.agencies }, { title: words.assessors, rows: d.assessors }]; track block.title) {
          <h4 class="qo-h">{{ block.title }} · ranking</h4>
          <div class="table-responsive">
            <table class="table table-zed" [attr.data-qo-rank]="block.title">
              <thead><tr><th>Rank</th><th>Name</th><th class="text-center">{{ words.units }}</th><th class="text-center">Open</th><th class="text-center">Closed</th>
                <th class="text-center">Minor / Major / Critical</th><th class="text-center">Reopened</th><th class="text-center">Avg. reply</th><th class="text-center">Avg. close</th><th class="text-center">Score</th></tr></thead>
              <tbody>
                @for (s of block.rows; track s.userId) {
                  <tr>
                    <td><b>{{ s.rank }}</b></td>
                    <td>{{ s.name || s.userId }} <small class="d-block muted">{{ s.userId }}</small></td>
                    <td class="text-center">{{ s.assessments }}</td>
                    <td class="text-center">{{ s.open }}</td>
                    <td class="text-center">{{ s.closed }}</td>
                    <td class="text-center">{{ s.minor }} / {{ s.major }} / {{ s.critical }}</td>
                    <td class="text-center">{{ s.reopens }}</td>
                    <td class="text-center">{{ hours(s.avgReplyHours) }}</td>
                    <td class="text-center">{{ hours(s.avgCloseHours) }}</td>
                    <td class="text-center">{{ s.score }}</td>
                  </tr>
                } @empty {
                  <tr><td colspan="10" class="text-center muted">No observations in this period.</td></tr>
                }
              </tbody>
            </table>
          </div>
        }
        <p class="qo-note">Score = points per {{ words.unit }} with an observation (minor 1, major 3, critical 5); a lower score ranks higher, then the faster reply.</p>
        @if (d.categories.length) {
          <h4 class="qo-h">By category</h4>
          <table class="table table-zed qo-cats">
            <thead><tr><th>Category</th><th class="text-center">Observations</th><th class="text-center">Major / critical</th></tr></thead>
            <tbody>@for (c of d.categories; track c.category) { <tr><td>{{ c.category }}</td><td class="text-center">{{ c.total }}</td><td class="text-center">{{ c.major }}</td></tr> }</tbody>
          </table>
        }
        <button type="button" class="btn btn-outline-secondary btn-sm" (click)="exportCsv(d)">Download ranking (CSV)</button>
      }
    } @else {
      <div class="qo-filters">
        <label for="qo-status">Status</label>
        <select id="qo-status" class="form-select" [ngModel]="status()" (ngModelChange)="status.set($event)">
          <option value="">All</option><option value="Open">Open</option><option value="Responded">Replied</option><option value="Closed">Closed</option>
        </select>
      </div>
      @for (o of shown(); track o.id) {
        <zed-qo-item [item]="o" [showUnit]="true" [canRespond]="!master()" [canClose]="canClose()" (changed)="changed($event)" />
      } @empty {
        <p class="muted">No observations.</p>
      }
    }
  `,
  styles: `
    .qo-filters { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin: 10px 0; }
    .qo-filters .form-select { width: auto; }
    .qo-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 10px; margin: 10px 0 16px; }
    .qo-tile { background: #fff; border: 1px solid #e3eaea; border-radius: 10px; padding: 10px 12px; display: flex; flex-direction: column; }
    .qo-tile b { font-size: 22px; color: #23474a; }
    .qo-tile span { font-size: 12px; color: #5f6f70; }
    .qo-tile.open b { color: #d97706; }
    .qo-tile.ok b { color: #2e9e4b; }
    .qo-h { font-size: 16px; margin: 16px 0 6px; color: #23474a; }
    .qo-note { font-size: 12px; color: #5f6f70; }
  `,
})
export class QualityObservationsPage {
  private readonly api = inject(QualityApi);
  private readonly auth = inject(AuthService);
  /** Handholding (consultancy portal) names consultants and consultant organisations; surveillance, surveillances. */
  protected readonly words = (() => {
    const system = inject(ASSESSMENT_SYSTEM);
    if (system === 'consultancy') return {
      agencies: 'Consultant organisations', assessors: 'Consultants', units: 'Milestones', unit: 'milestone',
      masterSub: "Observations of the ZED team on the handholding milestones, the consultant organisations' replies, and how each organisation and consultant ranks.",
      agencySub: 'Observations of the ZED team on your handholding milestones. Please reply to each; a major or critical one holds the final submit until you reply.',
    };
    const what = system === 'surveillance' ? 'surveillance' : 'assessment';
    return {
      agencies: 'Assessment agencies', assessors: 'Assessors', units: system === 'surveillance' ? 'Surveillances' : 'Assessments', unit: what,
      masterSub: `Observations of the ZED team on the ${what}s, the agencies' replies, and how each agency and assessor ranks.`,
      agencySub: `Observations of the ZED team on your ${what}s. Please reply to each; a major or critical one holds the final submit until you reply.`,
    };
  })();

  protected readonly master = computed(() => this.auth.currentUser()?.roleId === 7);
  protected readonly tab = signal<'dashboard' | 'list'>('dashboard');
  protected readonly days = signal(90);
  protected readonly status = signal<QoStatus | ''>('');
  protected readonly items = signal<QoObservation[]>([]);
  protected readonly canClose = signal(false);
  protected readonly dash = signal<QoDashboard | null>(null);
  protected readonly error = signal('');
  protected readonly notice = signal('');
  protected readonly shown = computed(() => (this.status() ? this.items().filter((o) => o.status === this.status()) : this.items()));

  constructor() {
    void this.load();
  }

  protected hours(h: number | null): string {
    if (h == null) return '—';
    return h >= 48 ? `${Math.round((h / 24) * 10) / 10} days` : `${h} h`;
  }

  protected async changed(message: string): Promise<void> {
    this.notice.set(message);
    await this.load();
  }

  protected async load(): Promise<void> {
    this.error.set('');
    try {
      const list = await firstValueFrom(this.api.list('', this.days()));
      this.items.set(list.items);
      this.canClose.set(list.canClose);
      if (this.master()) this.dash.set(await firstValueFrom(this.api.dashboard(this.days())));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    }
  }

  protected exportCsv(d: QoDashboard): void {
    const head = ['Type', 'Rank', 'Name', 'User ID', 'Assessments', 'Total', 'Open', 'Replied', 'Closed', 'Minor', 'Major', 'Critical', 'Reopened', 'Avg reply (h)', 'Avg close (h)', 'Score'];
    const line = (s: QoStanding) => [s.kind, s.rank, s.name ?? '', s.userId, s.assessments, s.total, s.open, s.responded, s.closed, s.minor, s.major, s.critical,
      s.reopens, s.avgReplyHours ?? '', s.avgCloseHours ?? '', s.score];
    const csv = [head, ...d.agencies.map(line), ...d.assessors.map(line)]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'quality-observations-ranking.csv';
    a.click();
    URL.revokeObjectURL(url);
  }
}
