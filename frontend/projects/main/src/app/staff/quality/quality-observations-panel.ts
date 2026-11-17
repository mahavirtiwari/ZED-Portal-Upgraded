import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { QualityObservationItem } from './quality-observation-item';
import { ASSESSMENT_SYSTEM } from '../assessment/assessment-shared';
import { AttentionService } from '../attention';
import { ToastService } from '../toast';
import { QoSeverity, QoTarget, QoUnitView, QualityApi, aboutLabels } from './quality.api';

/** Points of each severity in the ranking (QualityObservations.Points on the server). */
export const QO_POINTS: Record<QoSeverity, number> = { Minor: 1, Major: 3, Critical: 5 };

/**
 * 2026-11-16 (approved): the "ZED quality observations" panel of a review page (desktop / site assessment details, the
 * remote assessment, the handholding milestone page). The Master Admin and its operation admins (with the "Quality
 * observations" screen) raise them on the whole assessment or on an item of the page, close and reopen them; the agency
 * replies; the assessor reads the ones about its own work. Hidden when the login may not see them (the API refuses).
 * A page asks for an observation on one of its items through {@link target} (its "+ Observation" buttons).
 * 2026-11-17 (the user's staff designs 14 and pop-up 06): "+ Observation" opens a pop-up (it was a form that pushed the page
 * down): what it is about, whose work (a switch), the reason (category) and its severity as three cards showing the points;
 * the severity stays the one the Admin set for the reason (shown, not chosen). With <code>rail</code> the panel is the right
 * rail of the details pages. <code>shown()</code> tells the page whether there is a panel at all.
 */
@Component({
  selector: 'zed-qo-panel',
  imports: [FormsModule, QualityObservationItem],
  host: { '(document:keydown.escape)': 'cancel()' },
  template: `
    @if (shown()) {
      @let v = view()!;
      <section class="qo-panel" [class.qo-rail]="rail()" data-qo-panel id="quality-observations" aria-labelledby="qo-panel-title">
        <div class="qo-head">
          <span class="qo-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 5h14v10H9l-4 4z" /></svg></span>
          <h4 id="qo-panel-title">ZED quality observations</h4>
        </div>
        <div class="qo-bar">
          <small>{{ openCount() }} open · {{ v.items.length }} in all</small>
          @if (v.canRaise) {
            <button type="button" class="btn btn-primary btn-sm qo-add" (click)="start(null)">+ Observation</button>
          }
        </div>
        <div class="qo-list">
          @for (o of v.items; track o.id) {
            <zed-qo-item [item]="o" [canRespond]="v.canRespond" [canClose]="v.canClose" (changed)="reload($event)" />
          } @empty {
            <p class="qo-empty">No observations yet.</p>
          }
        </div>
      </section>
    }

    @if (form(); as f) {
      <div class="modal d-block" tabindex="-1" role="dialog" aria-modal="true" aria-labelledby="qo-dlg-title" (click)="cancel()">
        <div class="modal-dialog modal-dialog-centered qo-dlg" (click)="$event.stopPropagation()">
          <form class="modal-content" (ngSubmit)="save()" novalidate data-qo-form>
            <div class="qo-dlg-head">
              <span class="qo-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M5 5h14v10H9l-4 4z" /></svg></span>
              <div class="qo-dlg-t">
                <h3 id="qo-dlg-title">Raise a quality observation</h3>
                <p>{{ heading() }}</p>
              </div>
              <button type="button" class="qo-x" aria-label="Close" (click)="cancel()">×</button>
            </div>
            <div class="qo-dlg-body">
              <label for="qo-target">About</label>
              <select id="qo-target" class="form-select" name="target" [ngModel]="f.targetKey" (ngModelChange)="patch('targetKey', $event)">
                @for (t of allTargets(); track key(t)) { <option [value]="key(t)">{{ t.label }}</option> }
              </select>

              <span class="qo-l" id="qo-about-l">Whose work</span>
              <div class="qo-seg" role="radiogroup" aria-labelledby="qo-about-l" data-qo-about>
                @for (a of abouts(); track a) {
                  <button type="button" role="radio" [attr.aria-checked]="f.about === a" [class.on]="f.about === a" [attr.data-about]="a"
                    (click)="patch('about', a)">{{ aboutLabel(a) }}</button>
                }
              </div>

              <!-- 2026-11-17 (approved): the Admin's reasons; the severity comes from the reason. -->
              <label for="qo-category">Category</label>
              <select id="qo-category" class="form-select" name="category" [ngModel]="f.category" (ngModelChange)="patch('category', $event)">
                <option value="">Select</option>
                @for (r of view()?.reasons ?? []; track r.id) { <option [value]="r.id">{{ r.text }}</option> }
              </select>

              <span class="qo-l">Severity</span>
              <div class="qo-sevs" role="radiogroup" aria-label="Severity (set by the reason)" aria-describedby="qo-sev-note">
                @for (s of severities; track s) {
                  <span class="qo-sev-card" role="radio" aria-disabled="true" [attr.aria-checked]="reason()?.severity === s" [class.on]="reason()?.severity === s"
                    [attr.data-sev]="s">
                    <span class="qo-dot" aria-hidden="true"></span>
                    <span><b>{{ s }}</b>&ngsp;<small>{{ points[s] }} point{{ points[s] === 1 ? '' : 's' }}</small></span>
                  </span>
                }
              </div>
              <small class="qo-sev-note" id="qo-sev-note" data-qo-severity>
                @if (reason(); as r) { {{ r.severity }}: set by the Admin for this reason. } @else { Choose the reason: its severity is set by the Admin. }
              </small>

              <label for="qo-text">Observation<span class="req">*</span></label>
              <textarea id="qo-text" class="form-control" name="text" rows="3" maxlength="2000" placeholder="What you observed, in a sentence or two"
                [ngModel]="f.text" (ngModelChange)="patch('text', $event)"></textarea>
              @if (holds()) { <p class="qo-warn" role="status">{{ blockingHint }}</p> }
              @if (formError()) { <div class="alert alert-danger py-1 mb-0 mt-2" role="alert">{{ formError() }}</div> }
            </div>
            <div class="qo-dlg-foot">
              <button type="button" class="btn btn-default" (click)="cancel()">Cancel</button>
              <button type="submit" class="btn btn-primary" [disabled]="busy()">Raise observation</button>
            </div>
          </form>
        </div>
      </div>
      <div class="modal-backdrop show"></div>
    }
  `,
  styles: `
    :host { display: block; }
    .qo-panel { border: 1px solid #e1eaea; background: #fff; border-radius: 12px; margin: 12px 0; box-shadow: 0 2px 8px rgba(16, 61, 64, 0.05); }
    .qo-rail { margin: 0 0 16px; }
    .qo-head { display: flex; align-items: center; gap: 12px; padding: 14px 18px; border-bottom: 1px solid #edf2f2; }
    .qo-head h4 { margin: 0; font-size: 16px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .qo-ico { flex: none; width: 32px; height: 32px; border-radius: 8px; background: #eef6f5; display: grid; place-items: center; color: var(--zt-dark, #1f5c61); }
    .qo-ico svg { width: 16px; height: 16px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linejoin: round; }
    .qo-bar { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 10px 18px 4px; }
    .qo-bar small { font-size: 13px; color: #5f6f70; }
    .qo-add { border-radius: 8px; font-weight: 600; padding: 6px 14px; }
    .qo-list { padding: 8px 14px 6px; }
    .qo-empty { font-size: 13px; color: #5f6f70; margin: 0 4px 8px; }
    .qo-dlg { max-width: 640px; }
    .qo-dlg .modal-content { border: 0; border-radius: 14px; overflow: hidden; }
    .qo-dlg-head { display: flex; align-items: flex-start; gap: 14px; padding: 18px 22px; border-bottom: 1px solid #edf2f2; }
    .qo-dlg-t { flex: 1; min-width: 0; }
    .qo-dlg-t h3 { margin: 0; font-size: 18px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .qo-dlg-t p { margin: 2px 0 0; font-size: 13px; color: #5f6f70; overflow-wrap: anywhere; }
    .qo-x { border: 0; background: #eef2f2; border-radius: 8px; width: 32px; height: 32px; font-size: 20px; line-height: 1; color: #3d4f50; }
    .qo-dlg-body { padding: 14px 22px 18px; display: flex; flex-direction: column; }
    .qo-dlg-body label, .qo-l { font-size: 13px; color: #3d4f50; margin: 10px 0 5px; font-weight: 600; }
    .req { color: #c0392b; }
    .qo-seg { display: inline-flex; flex-wrap: wrap; gap: 2px; align-self: flex-start; background: #eef2f2; border-radius: 10px; padding: 3px; }
    .qo-seg button { border: 1px solid transparent; background: none; border-radius: 8px; padding: 6px 16px; font-size: 13.5px; color: #3d4f50; }
    .qo-seg button.on { background: #fff; border-color: var(--zt-dark, #1f5c61); color: var(--zt-ink, #173f44); font-weight: 700; }
    .qo-sevs { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 10px; }
    .qo-sev-card { display: flex; align-items: center; gap: 10px; border: 1px solid #dfe7e8; border-radius: 10px; padding: 9px 12px; color: #7a8a8b; }
    .qo-sev-card b { display: block; font-size: 14px; }
    .qo-sev-card small { font-size: 12px; }
    .qo-dot { flex: none; width: 16px; height: 16px; border-radius: 50%; border: 2px solid #c9d6d7; }
    .qo-sev-card.on { border: 2px solid #c58a1b; background: #fdf6e7; color: #8a5a00; padding: 8px 11px; }
    .qo-sev-card.on[data-sev='Minor'] { border-color: var(--zt-mid2, #2a8a8c); background: #eef7f6; color: var(--zt-ink, #173f44); }
    .qo-sev-card.on[data-sev='Critical'] { border-color: #c0392b; background: #fdeeee; color: #a32d2d; }
    .qo-sev-card.on .qo-dot { border-color: currentColor; box-shadow: inset 0 0 0 3px #fff; background: currentColor; }
    .qo-sev-note { color: #5f6f70; margin-top: 5px; font-size: 12px; }
    .qo-warn { margin: 10px 0 0; padding: 8px 12px; border-radius: 8px; background: #fdf3e1; color: #8a5a00; font-size: 13px; }
    .qo-dlg-foot { display: flex; justify-content: flex-end; gap: 10px; padding: 14px 22px; border-top: 1px solid #edf2f2; }
    .qo-dlg-foot .btn { border-radius: 8px; padding: 8px 20px; font-weight: 600; }
    @media (max-width: 575.98px) { .qo-sevs { grid-template-columns: minmax(0, 1fr); } .qo-dlg-head, .qo-dlg-body, .qo-dlg-foot { padding-left: 16px; padding-right: 16px; } }
  `,
})
export class QualityObservationsPanel {
  private readonly api = inject(QualityApi);
  private readonly toast = inject(ToastService);
  private readonly attention = inject(AttentionService);
  private readonly system = inject(ASSESSMENT_SYSTEM);
  private readonly labels = aboutLabels(this.system);
  /** The whole assessment (the whole milestone in handholding). */
  private readonly overall: QoTarget = { type: 'Overall', id: null, label: this.system === 'consultancy' ? 'Whole milestone' : 'Whole assessment' };
  protected readonly blockingHint = this.system === 'consultancy'
    ? "A major or critical observation holds the consultant organisation's final submit until it replies."
    : "A major or critical observation holds the agency's final submit until it replies.";
  protected readonly severities: QoSeverity[] = ['Minor', 'Major', 'Critical'];
  protected readonly points = QO_POINTS;
  private readonly auth = inject(AuthService);
  /** Master Admin (and operation admins), agency, assessor: the logins that may see observations. */
  private static readonly Roles = [7, 2, 3];

  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();
  /** The unit's name, for the pop-up's heading (optional). */
  readonly unitName = input<string | null>(null);
  /** The right rail of a details page. */
  readonly rail = input(false);
  /** The page's items an observation can be about (requirements, products…); the whole assessment is always offered. */
  readonly targets = input<QoTarget[]>([]);
  /** Which assessors the page has (Desktop / Lead / Co); the agency is always offered. */
  readonly abouts = input<string[]>(['Lead', 'Co', 'Desktop', 'Agency']);
  /** Set by the page's "+ Observation" button of an item: opens the pop-up on it. */
  readonly target = model<QoTarget | null>(null);

  protected readonly view = signal<QoUnitView | null>(null);
  protected readonly form = signal<{ targetKey: string; about: string; category: string; text: string } | null>(null);
  protected readonly busy = signal(false);
  protected readonly formError = signal('');
  protected readonly allTargets = computed(() => [this.overall, ...this.targets()]);
  protected readonly openCount = computed(() => (this.view()?.items ?? []).filter((o) => o.status !== 'Closed').length);
  /** There is a panel: the login may raise observations or has some to see. */
  readonly shown = computed(() => {
    const v = this.view();
    return !!v && (v.canRaise || v.items.length > 0);
  });
  /** The reason chosen in the pop-up (its severity is shown, not chosen). */
  protected readonly reason = computed(() => {
    const id = this.form()?.category;
    return id ? (this.view()?.reasons ?? []).find((r) => r.id === id) ?? null : null;
  });
  /** A major or critical reason holds the agency's final submit. */
  protected readonly holds = computed(() => this.reason()?.severity === 'Major' || this.reason()?.severity === 'Critical');
  protected readonly heading = computed(() => [this.zedId(), this.unitName(), this.certification()].filter(Boolean).join(' · '));

  constructor() {
    effect(() => {
      const z = this.zedId();
      const c = this.certification();
      if (z && c) untracked(() => void this.load());
    });
    effect(() => {
      const t = this.target();
      if (t && this.view()?.canRaise) untracked(() => {
        this.start(t);
        this.target.set(null);
      });
    });
  }

  protected key(t: QoTarget): string {
    return `${t.type}|${t.id ?? ''}`;
  }

  protected aboutLabel(a: string): string {
    return this.labels[a] ?? a;
  }

  protected start(t: QoTarget | null): void {
    this.formError.set('');
    this.form.set({ targetKey: this.key(t ?? this.overall), about: this.abouts()[0] ?? 'Lead', category: '', text: '' });
    setTimeout(() => document.getElementById('qo-target')?.focus());
  }

  protected cancel(): void {
    if (!this.busy()) this.form.set(null);
  }

  protected patch(k: 'targetKey' | 'about' | 'category' | 'text', v: string): void {
    this.form.update((f) => (f ? { ...f, [k]: v } : f));
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    if (!f.category) return this.formError.set('Please choose the category.');
    if (!f.text.trim()) return this.formError.set('Please write the observation.');
    const t = this.allTargets().find((x) => this.key(x) === f.targetKey) ?? this.overall;
    this.busy.set(true);
    this.formError.set('');
    try {
      const r = await firstValueFrom(this.api.raise(this.zedId(), this.certification(), {
        refType: t.type, refId: t.id, refLabel: t.type === 'Overall' ? null : t.label, category: f.category, about: f.about, text: f.text.trim(),
      }));
      this.form.set(null);
      await this.reload(r.message);
    } catch (err) {
      this.formError.set(apiErrorMessage(err));
    } finally {
      this.busy.set(false);
    }
  }

  protected async reload(message: string): Promise<void> {
    this.toast.success(message);
    void this.attention.refresh();
    await this.load();
  }

  private async load(): Promise<void> {
    if (!QualityObservationsPanel.Roles.includes(this.auth.currentUser()?.roleId ?? 0)) return;
    try {
      this.view.set(await firstValueFrom(this.api.unit(this.zedId(), this.certification())));
    } catch (err) {
      // Not allowed (403 / 404) or not there yet: no panel.
      if (!(err instanceof HttpErrorResponse)) throw err;
      this.view.set(null);
    }
  }
}
