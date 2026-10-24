import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ContentTextComponent } from '../../content/content-text';
import {
  HANDHOLDING_LEVELS,
  HandholdingApi,
  HandholdingLevel,
  HandholdingSummary,
  LevelState,
  MILESTONE_TITLES,
  Row,
  completionColumn,
  handholdingLevel,
} from './handholding.api';

type InfoTopic = 'My' | HandholdingLevel;

/** One step of a level card's stepper. */
interface Step {
  completed: boolean;
  current: boolean;
}

/** One milestone row of the level view. */
interface MilestoneRow {
  number: number;
  title: string;
  /** Greyed out until the previous milestone is accepted (status 100). */
  disabled: boolean;
  /** Payment made (StatusOfNc{n} = 1): VIEW opens the certification page of the milestone. */
  applied: boolean;
  /** APPLY leads to the payment; only for the milestone the server says can be paid now. */
  canApply: boolean;
  /** "ACCEPT MILESTONE n": the consultant has submitted it (status 16). */
  canAccept: boolean;
}

/**
 * Handholding Support of the signed-in MSME. Port of Frontend/Msme/HandholdingSupport.cshtml (step 1:
 * level cards, milestones, accept milestone, information pop-ups). The disclaimer, instructions and
 * payment steps of that page are {@link ConsultancyPaymentPage} (/msme/handholding/:level/payment);
 * the milestone details are the certification page (/msme/certification/SilverMilestone1, ...).
 */
@Component({
  selector: 'zed-msme-handholding',
  imports: [RouterLink, FormsModule, DatePipe, ContentTextComponent],
  templateUrl: './handholding.html',
  styles: `
    .loadingdiv { position: fixed; inset: 0; background: rgba(0,0,0,.35); display: flex; align-items: center; justify-content: center; z-index: 2000; }
    .refresh-link { text-decoration: none; }
    .panel-cert-block, .panel-cert-block:hover { background: #fff; box-shadow: 0px 8px 16px 0px rgba(0, 0, 0, 0.15); }
    .milestone-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
    .clickable { cursor: pointer; }
    .checkbox-inline { margin-left: 30px; padding-left: 10px; }
  `,
})
export class HandholdingPage {
  private readonly api = inject(HandholdingApi);
  private readonly router = inject(Router);

  /** `?level=Silver`: open that level's milestones (the BACK of the payment page, as the old DisplayStep = 1). */
  readonly levelParam = input('', { alias: 'level' });

  protected readonly levels = HANDHOLDING_LEVELS;
  protected readonly data = signal<HandholdingSummary | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly loadedAt = signal(new Date());

  /** Level whose milestones are shown (the old page's showLevels / certification). */
  protected readonly selected = signal<HandholdingLevel | null>(null);
  protected readonly info = signal<InfoTopic | null>(null);
  protected readonly detailsOf = signal<HandholdingLevel | null>(null);
  protected readonly accepting = signal<{ level: HandholdingLevel; milestone: number } | null>(null);
  protected accepted = false;
  private preselected = false;

  protected readonly pledgeCertificateUrl = '/api/msme/files/pledge-certificate';

  protected readonly msme = computed<Row>(() => this.data()?.msme ?? {});
  protected readonly basic = computed<Row>(() => this.data()?.basicInfo ?? {});
  protected readonly status = computed<Row>(() => this.data()?.status ?? {});

  protected readonly milestones = computed<MilestoneRow[]>(() => {
    const level = this.selected();
    if (!level) return [];
    const state = this.state(level);
    return MILESTONE_TITLES[level].map((title, i) => {
      const n = i + 1;
      return {
        number: n,
        title,
        disabled: n > 1 && this.num(completionColumn(level, n - 1)) < 100,
        applied: this.num(`${level}StatusOfNc${n}`) === 1,
        canApply: !!state?.canPay && state.nextMilestone === n,
        canAccept: this.num(completionColumn(level, n)) === 16,
      };
    });
  });

  constructor() {
    void this.load();
  }

  protected async load(): Promise<void> {
    const d = await this.call(this.api.get());
    if (d) {
      this.data.set(d);
      this.loadedAt.set(new Date());
      this.preselect();
    }
  }

  /** Once, after the first load: the level of the query parameter, if its card is enabled. */
  private preselect(): void {
    if (this.preselected) return;
    this.preselected = true;
    const level = handholdingLevel(this.levelParam());
    if (level && !this.cardDisabled(level)) this.selected.set(level);
  }

  protected state(level: HandholdingLevel): LevelState | undefined {
    return this.data()?.levels.find((l) => l.certification === level);
  }

  protected num(field: string): number {
    return Number(this.status()[field] ?? 0) || 0;
  }

  protected paid(level: HandholdingLevel): boolean {
    return Number(this.msme()[`Is${level}PaymentDone`] ?? 0) === 1;
  }

  protected cardDisabled(level: HandholdingLevel): boolean {
    return this.num(`Enable${level}`) === 0;
  }

  /** Text next to the arrow of a level card. */
  protected progress(level: HandholdingLevel): string[] {
    const status = this.num(`${level}Status`);
    const started = this.num(`${level}StatusOfNc`);
    const labels: string[] = [];
    if (status === 0) labels.push('Get started');
    if (started >= 1 && started <= 3) labels.push(`Milestone ${started}`);
    if (started === 3 && status === 4) labels.push('Completed');
    return labels;
  }

  /** The four stepper dots of a level card (old ng-class expressions; Gold milestones complete above 5). */
  protected steps(level: HandholdingLevel): Step[] {
    const done = level === 'Gold' ? 5 : 3;
    const s1 = this.num(`${level}Status`);
    const later = [s1, this.num(`${level}Status2`), this.num(`${level}Status3`)];
    return [
      { completed: s1 > 1, current: s1 === 1 },
      ...later.map((s) => ({ completed: s > done, current: s > 1 && s <= done })),
    ];
  }

  /** VIEW DETAILS / APPLY of a level card. */
  protected openLevel(level: HandholdingLevel): void {
    if (this.cardDisabled(level)) return;
    this.selected.set(level);
    window.scrollTo(0, 0);
  }

  protected viewDetails(level: HandholdingLevel): void {
    if (this.cardDisabled(level)) return;
    if (this.paid(level)) this.openLevel(level);
    else this.detailsOf.set(level);
  }

  protected apply(m: MilestoneRow): void {
    const level = this.selected();
    if (!level || !m.canApply) return;
    void this.router.navigate(['/msme/handholding', level, 'payment']);
  }

  protected milestoneRoute(m: MilestoneRow): string {
    return `/msme/certification/${this.selected()}Milestone${m.number}`;
  }

  protected openAccept(m: MilestoneRow): void {
    this.accepted = false;
    this.accepting.set({ level: this.selected()!, milestone: m.number });
  }

  protected async submitAccept(): Promise<void> {
    const a = this.accepting();
    if (!a || !this.accepted) return;
    const ok = await this.call(this.api.acceptMilestone(a.level, a.milestone));
    this.accepting.set(null);
    if (ok) await this.load();
  }

  private async call<T>(req: Observable<T>): Promise<T | null> {
    this.busy.set(true);
    this.error.set('');
    try {
      return await firstValueFrom(req);
    } catch (err) {
      this.error.set(apiErrorMessage(err));
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return null;
    } finally {
      this.busy.set(false);
    }
  }
}
