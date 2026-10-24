import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../../content/content-text';
import { RecommendationPage, TuApi } from './tu.api';

/**
 * "Recommend / View Recommended Technologies" after Handholding milestone 3 (port of Frontend/Technology/Index.cshtml):
 * the unit's lead consultant selects 1 to 10 technologies, reviews the summary, confirms and submits once; the CO and
 * the master admin see the recommendation. A fixed counter shows "Selected: n/10"; while the lead consultant cannot
 * recommend (PreviousRecomInProgress and the other reasons the API gives) the list stays visible and the reason
 * replaces PROCEED. Route: /staff/consultancy/technology/:zedId/:level
 */
@Component({
  selector: 'zed-staff-technology-recommendation',
  imports: [FormsModule, ContentTextComponent],
  templateUrl: './technology-recommendation.html',
  styles: `
    table tbody tr td { font-size: 14px; }
    .counter-block { position: fixed; top: 48%; right: 0; background-color: #b3e079; padding: 4px; border-top-left-radius: 4px; border-bottom-left-radius: 4px; z-index: 10; }
    .counter-block p { text-align: center; margin: 0; }
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
  `,
})
export class TechnologyRecommendationPage {
  private readonly api = inject(TuApi);
  private readonly route = inject(ActivatedRoute);

  protected readonly zedId = this.route.snapshot.paramMap.get('zedId') ?? '';
  protected readonly level = this.route.snapshot.paramMap.get('level') ?? '';

  protected readonly page = signal<RecommendationPage | null>(null);
  protected readonly chosen = signal<ReadonlySet<string>>(new Set());
  protected readonly search = signal('');
  protected readonly summary = signal(false);
  protected readonly confirmed = signal(false);
  protected readonly loading = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal('');
  protected readonly success = signal('');

  protected readonly visible = computed(() => {
    const q = this.search().trim().toLowerCase();
    return (this.page()?.technologies ?? []).filter((t) => !q || t.name.toLowerCase().includes(q));
  });
  protected readonly selectedList = computed(() => (this.page()?.technologies ?? []).filter((t) => this.chosen().has(t.code)));
  protected readonly max = computed(() => this.page()?.maxSelection ?? 10);

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.error.set('');
    try {
      const p = await firstValueFrom(this.api.recommendation(this.zedId, this.level));
      this.page.set(p);
      this.chosen.set(new Set(p.technologies.filter((t) => t.selected).map((t) => t.code)));
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.loading.set(false);
    }
  }

  protected toggle(code: string, on: boolean): void {
    const next = new Set(this.chosen());
    if (on && next.size < this.max()) next.add(code);
    else next.delete(code);
    this.chosen.set(next);
  }

  protected async submit(): Promise<void> {
    if (!this.confirmed() || this.chosen().size === 0) return;
    this.saving.set(true);
    this.error.set('');
    try {
      const r = await firstValueFrom(this.api.recommend(this.zedId, this.level, [...this.chosen()]));
      this.success.set(r.message);
      this.summary.set(false);
      await this.load();
    } catch (err) {
      this.error.set(apiErrorMessage(err));
    } finally {
      this.saving.set(false);
    }
  }
}
