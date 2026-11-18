import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { apiErrorMessage, AuthService } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { PageHead } from '../../msme/shared/page-head';
import { ASSESSMENT_SYSTEM } from '../assessment/assessment-shared';
import { AttentionService } from '../attention';
import { ChipFilter, FilterChip } from '../chip-filter';
import { staffCrumbs } from '../staff-crumbs';
import { TableExport } from '../table-export';
import { ToastService } from '../toast';
import { QualityObservationItem } from './quality-observation-item';
import { QoDashboard, QoObservation, QoStanding, QoStatus, QualityApi } from './quality.api';

/**
 * 2026-11-16 (approved): Quality observations. The Master Admin and its operation admins: the dashboard (open / replied /
 * closed, reply and closing times, categories) with the ranking of the agencies and assessors (rank 1 = fewest weighted
 * observations per assessment: minor 1, major 3, critical 5; then the faster reply), and the list to close / reopen. An
 * agency: its observations to reply to. The figures come from each observation's time history.
 * 2026-11-17 (the user's staff design 19): the CSV in the title row, the rankings on the left with the open counts coloured,
 * "By category" as bars (the major / critical share in amber) and "How the score works" beside them.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files', staff-19): the ranking tables have the design's eight columns
 * (the average reply and close times are on the score's tooltip and in the CSV, no longer two extra columns that made the
 * headers and names wrap); no header wraps; values 12.5px, rank / open / score 16/800, the score with one decimal; the
 * Dashboard / Observations switch 36px at 13px. The header bell opens
 * the list with <code>?status=Open</code>.
 */
@Component({
  selector: 'zed-staff-quality-observations',
  imports: [FormsModule, QualityObservationItem, PageHead, ChipFilter],
  template: `
    <zed-page-head [crumbs]="crumbs" title="Quality Observations" [subtitle]="master() ? words.masterSub : words.agencySub">
      @if (master() && tab() === 'dashboard' && dash()) {
        <button type="button" class="btn btn-outline-primary qo-csv" (click)="exportCsv(dash()!)">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 4v11m0 0l-4-4m4 4l4-4M5 19h14" /></svg> Download ranking (CSV)
        </button>
      }
    </zed-page-head>
    @if (error()) { <div class="alert alert-danger" role="alert">{{ error() }}</div> }

    <div class="qo-filters">
      <label class="visually-hidden" for="qo-days">Period</label>
      <select id="qo-days" class="form-select" [ngModel]="days()" (ngModelChange)="days.set(+$event); load()">
        <option [ngValue]="30">Last 30 days</option>
        <option [ngValue]="90">Last 3 months</option>
        <option [ngValue]="365">Last year</option>
        <option [ngValue]="3650">All time</option>
      </select>
      @if (master()) {
        <div class="qo-seg" role="tablist" aria-label="View">
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'dashboard'" [class.on]="tab() === 'dashboard'" (click)="tab.set('dashboard')">Dashboard</button>
          <button type="button" role="tab" [attr.aria-selected]="tab() === 'list'" [class.on]="tab() === 'list'" (click)="tab.set('list')">Observations</button>
        </div>
      }
    </div>

    @if (master() && tab() === 'dashboard') {
      @if (dash(); as d) {
        <div class="qo-tiles" data-qo-tiles>
          <div class="qo-tile"><b>{{ d.total }}</b><span>Observations</span></div>
          <div class="qo-tile" [class.warn]="d.open > 0"><b>{{ d.open }}</b><span>Open</span></div>
          <div class="qo-tile"><b>{{ d.responded }}</b><span>Replied</span></div>
          <div class="qo-tile ok"><b>{{ d.closed }}</b><span>Closed</span></div>
          <div class="qo-tile"><b>{{ hours(d.avgReplyHours) }}</b><span>Avg. time to reply</span></div>
          <div class="qo-tile"><b>{{ hours(d.avgCloseHours) }}</b><span>Avg. time to close</span></div>
        </div>
        <div class="qo-grid">
          <div class="qo-main">
            @for (block of [{ title: words.agencies, rows: d.agencies }, { title: words.assessors, rows: d.assessors }]; track block.title) {
              <h4 class="qo-h">{{ block.title }} · ranking</h4>
              <div class="table-responsive qo-card">
                <table class="table table-zed qo-rank" [attr.data-qo-rank]="block.title">
                  <thead><tr><th>Rank</th><th>Name</th><th class="text-center">{{ words.units }}</th><th class="text-center">Open</th><th class="text-center">Closed</th>
                    <th class="text-center">Minor / Major / Critical</th><th class="text-center">Reopened</th><th class="text-center">Score</th></tr></thead>
                  <tbody>
                    @for (s of block.rows; track s.userId) {
                      <tr>
                        <td><b>{{ s.rank }}</b></td>
                        <td><span class="qo-name">{{ s.name || s.userId }}</span>&ngsp;<small class="d-block muted">{{ s.userId }}</small></td>
                        <td class="text-center">{{ s.assessments }}</td>
                        <td class="text-center"><span class="qo-open" [class.on]="s.open > 0">{{ s.open }}</span></td>
                        <td class="text-center">{{ s.closed }}</td>
                        <td class="text-center">{{ s.minor }} / {{ s.major }} / {{ s.critical }}</td>
                        <td class="text-center">{{ s.reopens }}</td>
                        <td class="text-center qo-big" [title]="'Avg. reply ' + hours(s.avgReplyHours) + ' · avg. close ' + hours(s.avgCloseHours)"><b>{{ score(s.score) }}</b></td>
                      </tr>
                    } @empty {
                      <tr><td colspan="8" class="text-center muted">No observations in this period.</td></tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
          <aside class="qo-side">
            @if (d.categories.length) {
              <section class="qo-card qo-box" aria-labelledby="qo-cat-h" data-qo-categories>
                <div class="qo-box-h"><span class="qo-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" /></svg></span>
                  <h4 id="qo-cat-h">By category</h4></div>
                <ul class="qo-cats">
                  @for (c of d.categories; track c.category) {
                    <li>
                      <div class="qo-cat-t"><span>{{ c.category }}</span><small>{{ c.total }} · {{ c.major }} major / critical</small></div>
                      <div class="qo-bar" role="img" [attr.aria-label]="c.total + ' observations, ' + c.major + ' major or critical'">
                        <span class="qo-bar-all" [style.width.%]="share(c.total, maxCategory(d))">
                          <span class="qo-bar-major" [style.width.%]="share(c.major, c.total)"></span>
                        </span>
                      </div>
                    </li>
                  }
                </ul>
              </section>
            }
            <section class="qo-card qo-box" aria-labelledby="qo-score-h" data-qo-score>
              <div class="qo-box-h"><span class="qo-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></svg></span>
                <h4 id="qo-score-h">How the score works</h4></div>
              <p class="qo-score">Points per {{ words.unit }} with an observation: minor 1, major 3, critical 5. A lower score ranks higher, then the faster reply.</p>
            </section>
          </aside>
        </div>
      }
    } @else {
      <div class="qo-filters">
        <zed-chip-filter label="Status" [chips]="statusChips()" [value]="status()" (valueChange)="status.set($any($event))" />
      </div>
      @for (o of shown(); track o.id) {
        <zed-qo-item [item]="o" [showUnit]="true" [canRespond]="!master()" [canClose]="canClose()" (changed)="changed($event)" />
      } @empty {
        <p class="muted">No observations.</p>
      }
    }
  `,
  styles: `
    .qo-csv { display: inline-flex; align-items: center; gap: 8px; border-radius: 8px; font-weight: 600; padding: 8px 18px; }
    .qo-csv svg, .qo-ico svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .qo-filters { display: flex; flex-wrap: wrap; gap: 12px; align-items: center; margin: 0 0 16px; }
    .qo-filters .form-select { width: auto; min-width: 190px; border-radius: 8px; }
    .qo-seg { display: inline-flex; background: #e8eff0; border-radius: 10px; padding: 3px; }
    .qo-seg button { height: 30px; border: 0; background: none; border-radius: 8px; padding: 0 22px; font-size: 13px; font-weight: 500; color: #17373b; }
    .qo-seg button.on { font-weight: 700; }
    .qo-seg button.on { background: var(--zt-dark, #1f5c61); color: #fff; }
    .qo-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 14px; margin: 0 0 18px; }
    .qo-tile, .qo-card { background: #fff; border: 1px solid #e1eaea; border-radius: 12px; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.05); }
    .qo-tile { padding: 14px 16px; display: flex; flex-direction: column; }
    .qo-tile b { font-size: 24px; font-weight: 800; color: var(--zt-ink, #173f44); line-height: 1.15; }
    .qo-tile span { font-size: 13px; color: #5f6f70; font-weight: 600; }
    .qo-tile.warn b, .qo-rank .qo-open.on { color: #9a5f06; }
    .qo-tile.ok b { color: #1e8a4c; }
    .qo-grid { display: grid; gap: 20px; align-items: start; }
    @media (min-width: 1200px) { .qo-grid { grid-template-columns: minmax(0, 1fr) 380px; } }
    .qo-main, .qo-side { min-width: 0; }
    .qo-h { font-size: 12px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; margin: 0 0 8px; color: #4a5c5e; }
    .qo-main .qo-card { margin-bottom: 18px; overflow: auto; }
    .qo-rank { margin: 0; }
    .qo-rank th { white-space: nowrap; }
    .qo-rank td { vertical-align: middle; font-size: 12.5px; font-weight: 500; color: #3d5559; }
    .qo-rank td:first-child, .qo-rank td.qo-big, .qo-rank .qo-open { font-size: 16px; font-weight: 800; color: #17373b; }
    .qo-name { font-size: 13.5px; font-weight: 700; color: #17373b; white-space: nowrap; }
    .qo-rank td small { font-size: 11.5px; }
    .qo-open { font-weight: 700; }
    .qo-box { margin-bottom: 18px; }
    .qo-box-h { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid #edf2f2; }
    .qo-box-h h4 { margin: 0; font-size: 16px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .qo-ico { flex: none; width: 30px; height: 30px; border-radius: 8px; background: #eef6f5; display: grid; place-items: center; color: var(--zt-dark, #1f5c61); }
    .qo-cats { list-style: none; margin: 0; padding: 12px 18px 14px; }
    .qo-cats li + li { margin-top: 12px; }
    .qo-cat-t { display: flex; justify-content: space-between; gap: 10px; font-size: 13.5px; color: #24393b; }
    .qo-cat-t small { color: #5f6f70; white-space: nowrap; }
    .qo-bar { height: 6px; border-radius: 3px; background: #edf2f2; margin-top: 5px; overflow: hidden; }
    .qo-bar-all { display: block; height: 100%; background: var(--zt-mid2, #2a8a8c); border-radius: 3px; overflow: hidden; }
    .qo-bar-major { display: block; height: 100%; background: #d4891c; }
    .qo-score { margin: 0; padding: 14px 18px 16px; font-size: 13.5px; color: #3d4f50; line-height: 1.55; }
    .muted { color: #5f6f70; }
  `,
})
export class QualityObservationsPage {
  private readonly api = inject(QualityApi);
  private readonly auth = inject(AuthService);
  private readonly exporter = inject(TableExport);
  private readonly toast = inject(ToastService);
  private readonly attention = inject(AttentionService);
  protected readonly crumbs = staffCrumbs({ label: 'Quality Observations' });
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
  protected readonly shown = computed(() => (this.status() ? this.items().filter((o) => o.status === this.status()) : this.items()));
  protected readonly statusChips = computed<FilterChip[]>(() => {
    const by = (s: QoStatus) => this.items().filter((o) => o.status === s).length;
    return [
      { key: '', label: 'All', count: this.items().length },
      { key: 'Open', label: 'Open', count: by('Open') },
      { key: 'Responded', label: 'Replied', count: by('Responded') },
      { key: 'Closed', label: 'Closed', count: by('Closed') },
    ];
  });

  constructor() {
    // The header bell links here with ?status=Open: the list, filtered.
    inject(ActivatedRoute).queryParamMap.pipe(takeUntilDestroyed()).subscribe((q) => {
      const s = q.get('status');
      if (s === 'Open' || s === 'Responded' || s === 'Closed') {
        this.status.set(s);
        this.tab.set('list');
      }
    });
    void this.load();
  }

  /** staff-19: the score with one decimal ("1.1", "3.0"). */
  protected score(v: number | null): string {
    return typeof v === 'number' && Number.isFinite(v) ? v.toFixed(1) : '—';
  }

  protected hours(h: number | null): string {
    if (h == null) return '—';
    return h >= 48 ? `${Math.round((h / 24) * 10) / 10} days` : `${h} h`;
  }

  /** Width of a bar, in % of the whole (0 when the whole is 0). */
  protected share(part: number, whole: number): number {
    return whole > 0 ? Math.min(100, Math.round((part / whole) * 1000) / 10) : 0;
  }

  protected maxCategory(d: QoDashboard): number {
    return Math.max(0, ...d.categories.map((c) => c.total));
  }

  protected async changed(message: string): Promise<void> {
    this.toast.success(message);
    void this.attention.refresh();
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
    const columns = ['Type', 'Rank', 'Name', 'User ID', 'Assessments', 'Total', 'Open', 'Replied', 'Closed', 'Minor', 'Major', 'Critical', 'Reopened', 'Avg reply (h)', 'Avg close (h)', 'Score'];
    const line = (s: QoStanding) => [s.kind, s.rank, s.name ?? '', s.userId, s.assessments, s.total, s.open, s.responded, s.closed, s.minor, s.major, s.critical,
      s.reopens, s.avgReplyHours ?? '', s.avgCloseHours ?? '', s.score];
    this.exporter.csv('quality-observations-ranking', { name: 'Ranking', columns, rows: [...d.agencies.map(line), ...d.assessors.map(line)] });
  }
}
