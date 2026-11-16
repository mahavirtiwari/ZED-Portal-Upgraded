import { HttpErrorResponse } from '@angular/common/http';
import { Component, computed, effect, inject, input, model, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { QualityObservationItem } from './quality-observation-item';
import { ASSESSMENT_SYSTEM } from '../assessment/assessment-shared';
import { QoTarget, QoUnitView, QualityApi, aboutLabels } from './quality.api';


/**
 * 2026-11-16 (approved): the "ZED quality observations" panel of a review page (desktop / site assessment details, the
 * remote assessment, the handholding milestone page). The Master Admin and its operation admins (with the "Quality
 * observations" screen) raise them on the whole assessment or on an item of the page, close and reopen them; the agency
 * replies; the assessor reads the ones about its own work. Hidden when the login may not see them (the API refuses).
 * A page asks for an observation on one of its items through {@link target} (its "+ Observation" buttons).
 */
@Component({
  selector: 'zed-qo-panel',
  imports: [FormsModule, QualityObservationItem],
  template: `
    @if (view(); as v) {
      @if (v.canRaise || v.items.length) {
        <section class="qo-panel" data-qo-panel id="quality-observations">
          <div class="qo-panel-head">
            <h4>ZED quality observations <small>{{ openCount() }} open · {{ v.items.length }} in all</small></h4>
            @if (v.canRaise && !form()) {
              <button type="button" class="btn btn-primary btn-sm" (click)="start(null)">+ OBSERVATION</button>
            }
          </div>
          @if (notice()) { <div class="alert alert-success py-1" role="status">{{ notice() }}</div> }
          @if (form(); as f) {
            <form class="qo-form" (ngSubmit)="save()" novalidate data-qo-form>
              <label for="qo-target">About</label>
              <select id="qo-target" class="form-select" name="target" [ngModel]="f.targetKey" (ngModelChange)="patch('targetKey', $event)">
                @for (t of allTargets(); track key(t)) { <option [value]="key(t)">{{ t.label }}</option> }
              </select>
              <label for="qo-about">Whose work</label>
              <select id="qo-about" class="form-select" name="about" [ngModel]="f.about" (ngModelChange)="patch('about', $event)">
                @for (a of abouts(); track a) { <option [value]="a">{{ aboutLabel(a) }}</option> }
              </select>
              <label for="qo-category">Category</label>
              <select id="qo-category" class="form-select" name="category" [ngModel]="f.category" (ngModelChange)="patch('category', $event)">
                <option value="">Select</option>
                @for (c of v.categories; track c) { <option [value]="c">{{ c }}</option> }
              </select>
              <label for="qo-severity">Severity</label>
              <select id="qo-severity" class="form-select" name="severity" [ngModel]="f.severity" (ngModelChange)="patch('severity', $event)">
                <option value="">Select</option>
                @for (s of v.severities; track s) { <option [value]="s">{{ s }}</option> }
              </select>
              <label for="qo-text">Observation</label>
              <textarea id="qo-text" class="form-control" name="text" rows="3" maxlength="2000" [ngModel]="f.text" (ngModelChange)="patch('text', $event)"></textarea>
              <p class="qo-hint">{{ blockingHint }}</p>
              @if (formError()) { <div class="alert alert-danger py-1 mb-2" role="alert">{{ formError() }}</div> }
              <div class="qo-form-actions">
                <button type="button" class="btn btn-default btn-sm" (click)="form.set(null)">CANCEL</button>
                <button type="submit" class="btn btn-primary btn-sm" [disabled]="busy()">RAISE</button>
              </div>
            </form>
          }
          @for (o of v.items; track o.id) {
            <zed-qo-item [item]="o" [canRespond]="v.canRespond" [canClose]="v.canClose" (changed)="reload($event)" />
          } @empty {
            <p class="qo-empty">No observations yet.</p>
          }
        </section>
      }
    }
  `,
  styles: `
    .qo-panel { border: 1px solid var(--zt-soft, #d6eef0); background: var(--zt-pale, #f7fbfb); border-radius: 12px; padding: 12px 14px; margin: 12px 0; }
    .qo-panel-head { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; }
    .qo-panel-head h4 { margin: 0; font-size: 16px; color: #23474a; }
    .qo-panel-head small { font-size: 12px; color: #5f6f70; font-weight: 400; margin-left: 6px; }
    .qo-form { display: grid; grid-template-columns: 130px 1fr; gap: 8px 12px; align-items: center; background: #fff; border: 1px solid #e3eaea;
      border-radius: 10px; padding: 10px 12px; margin-bottom: 10px; }
    .qo-form textarea { min-height: 0; height: auto; }
    .qo-hint, .qo-form-actions, .qo-form .alert { grid-column: 1 / -1; }
    .qo-hint { font-size: 12px; color: #8a6100; margin: 0; }
    .qo-form-actions { display: flex; justify-content: flex-end; gap: 8px; }
    .qo-empty { font-size: 13px; color: #5f6f70; margin: 0; }
    @media (max-width: 575.98px) { .qo-form { grid-template-columns: 1fr; } }
  `,
})
export class QualityObservationsPanel {
  private readonly api = inject(QualityApi);
  private readonly system = inject(ASSESSMENT_SYSTEM);
  private readonly labels = aboutLabels(this.system);
  /** The whole assessment (the whole milestone in handholding). */
  private readonly overall: QoTarget = { type: 'Overall', id: null, label: this.system === 'consultancy' ? 'Whole milestone' : 'Whole assessment' };
  protected readonly blockingHint = this.system === 'consultancy'
    ? "A major or critical observation holds the consultant organisation's final submit until it replies."
    : "A major or critical observation holds the agency's final submit until it replies.";
  private readonly auth = inject(AuthService);
  /** Master Admin (and operation admins), agency, assessor: the logins that may see observations. */
  private static readonly Roles = [7, 2, 3];

  readonly zedId = input.required<string>();
  readonly certification = input.required<string>();
  /** The page's items an observation can be about (requirements, products…); the whole assessment is always offered. */
  readonly targets = input<QoTarget[]>([]);
  /** Which assessors the page has (Desktop / Lead / Co); the agency is always offered. */
  readonly abouts = input<string[]>(['Lead', 'Co', 'Desktop', 'Agency']);
  /** Set by the page's "+ Observation" button of an item: opens the form on it. */
  readonly target = model<QoTarget | null>(null);

  protected readonly view = signal<QoUnitView | null>(null);
  protected readonly form = signal<{ targetKey: string; about: string; category: string; severity: string; text: string } | null>(null);
  protected readonly busy = signal(false);
  protected readonly notice = signal('');
  protected readonly formError = signal('');
  protected readonly allTargets = computed(() => [this.overall, ...this.targets()]);
  protected readonly openCount = computed(() => (this.view()?.items ?? []).filter((o) => o.status !== 'Closed').length);

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
        document.getElementById('quality-observations')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
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
    this.notice.set('');
    this.form.set({ targetKey: this.key(t ?? this.overall), about: this.abouts()[0] ?? 'Lead', category: '', severity: '', text: '' });
  }

  protected patch(k: 'targetKey' | 'about' | 'category' | 'severity' | 'text', v: string): void {
    this.form.update((f) => (f ? { ...f, [k]: v } : f));
  }

  protected async save(): Promise<void> {
    const f = this.form();
    if (!f) return;
    const t = this.allTargets().find((x) => this.key(x) === f.targetKey) ?? this.overall;
    this.busy.set(true);
    this.formError.set('');
    try {
      const r = await firstValueFrom(this.api.raise(this.zedId(), this.certification(), {
        refType: t.type, refId: t.id, refLabel: t.type === 'Overall' ? null : t.label, category: f.category, severity: f.severity, about: f.about, text: f.text,
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
    this.notice.set(message);
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
