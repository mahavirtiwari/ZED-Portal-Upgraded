import { DatePipe } from '@angular/common';
import { Component, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { apiErrorMessage } from '@zed/shared';
import { Observable, firstValueFrom } from 'rxjs';
import { ContentService, ContentTextComponent, textParts } from '../../content/content-text';
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
  handholdingLevelName,
} from './handholding.api';
import { HandholdingLevelCard, LevelCardVm } from './handholding-level-card';
import { Crumb, PageHead } from '../shared/page-head';

type InfoTopic = 'My' | HandholdingLevel;

/** One milestone row of the level view. */
interface MilestoneRow {
  number: number;
  /** The milestone's name without its "Milestone n:" prefix. */
  title: string;
  /** Greyed out until the previous milestone is accepted (status 100). */
  disabled: boolean;
  /** Payment made (StatusOfNc{n} = 1): VIEW opens the certification page of the milestone. */
  applied: boolean;
  /** APPLY leads to the payment; only for the milestone the server says can be paid now. */
  canApply: boolean;
  /** "ACCEPT MILESTONE n": the consultant has submitted it (status 16). */
  canAccept: boolean;
  /** 2026-11-16: accepted by the MSME (status 100): "Completed", not "Applied". */
  accepted: boolean;
  /** The milestone being worked on now (highlighted). */
  now: boolean;
  /** Its state, top right ("Completed", "Starts after Milestone 1", ...). */
  state: string;
}

/** "MILESTONE 1: BASIC DIAGNOSTIC STUDY" → "Basic diagnostic study" (the old titles, without the prefix). */
function milestoneName(title: string): string {
  const name = title.replace(/^Milestone\s*\d+\s*:\s*/i, '').trim();
  return name === name.toUpperCase() ? name.charAt(0) + name.slice(1).toLowerCase() : name;
}

/**
 * Handholding Support of the signed-in MSME. Port of Frontend/Msme/HandholdingSupport.cshtml (step 1:
 * level cards, milestones, accept milestone, information pop-ups). The disclaimer, instructions and
 * payment steps of that page are {@link ConsultancyPaymentPage} (/msme/handholding/:level/payment);
 * the milestone details are the certification page (/msme/certification/SilverMilestone1, ...).
 * 2026-11-17 (the user's design): one card per level open to the unit with a four-point tracker; the selected level
 * (outlined) shows its milestones below on the same page; the cost and subsidy in the right column.
 */
@Component({
  selector: 'zed-msme-handholding',
  imports: [RouterLink, FormsModule, DatePipe, ContentTextComponent, PageHead, HandholdingLevelCard],
  templateUrl: './handholding.html',
  styleUrls: ['../shared/msme-page.scss', './handholding.scss'],
})
export class HandholdingPage {
  private readonly api = inject(HandholdingApi);
  private readonly router = inject(Router);
  private readonly content = inject(ContentService);

  /** `?level=Silver`: open that level's milestones (the BACK of the payment page, as the old DisplayStep = 1). */
  readonly levelParam = input('', { alias: 'level' });

  protected readonly levels = HANDHOLDING_LEVELS;

  /**
   * 2026-11-17 (the user): only the levels open to the unit (Bronze: Silver or Gold; Silver: Gold; Gold: ZED-X; the
   * server's Enable{Level}), and a level it has already paid for or started, so that work in progress stays shown.
   */
  protected readonly shownLevels = computed(() => {
    if (!this.data()) return [];
    return this.levels.filter((l) => !this.cardDisabled(l) || this.started(l) || this.num(`${l}Status`) > 0);
  });
  protected readonly levelName = handholdingLevelName;

  /** The level's picture (ZED-X has an SVG). */
  protected logo(level: HandholdingLevel): string {
    return level === 'ZEDX' ? '/Images/Dashboard/zedx.svg' : `/Images/Dashboard/${level.toLowerCase()}.png`;
  }
  protected readonly data = signal<HandholdingSummary | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly loadedAt = signal(new Date());

  /** Level whose milestones are shown below the cards (outlined). */
  protected readonly selected = signal<HandholdingLevel | null>(null);
  protected readonly crumbs: Crumb[] = [{ label: 'Home', link: '/msme/dashboard' }, { label: 'Incentives', link: '/msme/dashboard', fragment: 'incentives' }, { label: 'Handholding support' }];
  protected readonly info = signal<InfoTopic | null>(null);
  protected readonly detailsOf = signal<HandholdingLevel | null>(null);
  protected readonly accepting = signal<{ level: HandholdingLevel; milestone: number } | null>(null);
  protected accepted = false;
  private preselected = false;

  protected readonly msme = computed<Row>(() => this.data()?.msme ?? {});
  protected readonly status = computed<Row>(() => this.data()?.status ?? {});

  /**
   * The handholding cost from the Admin's text "Handholding: information (a level)" ("The Handholding Support cost is
   * Rs. 2,00,000/- inclusive of taxes; ..."): nothing when the text is hidden, not loaded, or names no amount.
   */
  protected readonly cost = computed(() => {
    const text = this.content.text('msme.handholding.info.level');
    if (!text?.enabled) return null;
    const line = textParts(text.html, 'li')
      .map((l) => l.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim())
      .find((l) => /cost/i.test(l));
    const amount = line?.match(/(?:Rs\.?|₹|INR)\s*([\d,]+(?:\.\d+)?)/i)?.[1];
    return amount ? { amount, taxes: /inclusive of tax/i.test(line!) } : null;
  });

  /** The unit's size (Micro / Small / Medium): the subsidy depends on it. */
  protected readonly size = computed(() => {
    const t = String(this.msme()['EnterpriseType'] ?? '').trim();
    return /^(micro|small|medium)$/i.test(t) ? t.charAt(0).toUpperCase() + t.slice(1).toLowerCase() : '';
  });

  protected readonly subtitle = computed(() => {
    const cost = this.cost();
    return 'Consultancy to help you reach your target level.' + (cost ? ` Cost ₹ ${cost.amount}, subsidy as per MSME size.` : '');
  });

  protected readonly cards = computed<LevelCardVm[]>(() =>
    this.shownLevels().map((level) => {
      const started = this.started(level);
      const completed = this.completed(level);
      const current = this.currentMilestone(level);
      const points = ['Baseline', 'Review 1', 'Review 2'].map((label, i) => ({
        label,
        done: completed || this.isAccepted(level, i + 1),
        now: started && !completed && current === i + 1,
      }));
      return {
        code: level,
        name: handholdingLevelName(level),
        logo: this.logo(level),
        chip: completed
          ? { label: 'Completed', tone: 'done' as const }
          : started
            ? { label: `In progress · Milestone ${current}`, tone: 'prog' as const }
            : { label: 'Not started', tone: 'new' as const },
        points: [...points, { label: 'Complete', done: completed, now: false }],
        canApply: !started && !!this.state(level)?.canPay,
        selected: this.selected() === level,
      };
    }),
  );

  protected readonly milestones = computed<MilestoneRow[]>(() => {
    const level = this.selected();
    if (!level) return [];
    const state = this.state(level);
    let nowTaken = false;
    return MILESTONE_TITLES[level].map((title, i) => {
      const n = i + 1;
      const row = {
        number: n,
        title: milestoneName(title),
        disabled: n > 1 && this.num(completionColumn(level, n - 1)) < 100,
        applied: this.num(`${level}StatusOfNc${n}`) === 1,
        canApply: !!state?.canPay && state.nextMilestone === n,
        canAccept: this.num(completionColumn(level, n)) === 16,
        accepted: this.num(completionColumn(level, n)) >= 100,
        now: false,
        state: '',
      };
      row.state = row.canAccept
        ? 'Submitted by the consultant: please accept'
        : row.accepted
          ? 'Completed'
          : row.applied
            ? 'Applied · in progress'
            : row.canApply
              ? 'Apply and pay to start'
              : row.disabled
                ? `Starts after Milestone ${n - 1}`
                : 'Not started';
      if (!nowTaken && !row.accepted && (row.canAccept || row.applied || row.canApply)) row.now = nowTaken = true;
      return row;
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

  /**
   * The level whose milestones open below: once, the level of the query parameter if it is shown; otherwise (and when
   * the selected level is no longer shown) the level in progress, else the first level shown.
   */
  private preselect(): void {
    const shown = this.shownLevels();
    if (!this.preselected) {
      this.preselected = true;
      const level = handholdingLevel(this.levelParam());
      if (level && shown.includes(level) && !this.cardDisabled(level)) {
        this.selected.set(level);
        return;
      }
    }
    const current = this.selected();
    if (current && shown.includes(current)) return;
    const busy = shown.filter((l) => this.started(l));
    this.selected.set(busy.find((l) => !this.completed(l)) ?? busy[0] ?? shown[0] ?? null);
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

  /** Paid for, or a milestone started. */
  private started(level: HandholdingLevel): boolean {
    return this.paid(level) || this.num(`${level}StatusOfNc`) > 0;
  }

  private isAccepted(level: HandholdingLevel, milestone: number): boolean {
    return this.num(completionColumn(level, milestone)) >= 100;
  }

  /** All three milestones accepted (or the old page's "Completed": the third milestone started and status 4). */
  private completed(level: HandholdingLevel): boolean {
    return [1, 2, 3].every((n) => this.isAccepted(level, n)) || (this.num(`${level}StatusOfNc`) === 3 && this.num(`${level}Status`) === 4);
  }

  /** The first milestone not accepted yet (1–3). */
  private currentMilestone(level: HandholdingLevel): number {
    return [1, 2, 3].find((n) => !this.isAccepted(level, n)) ?? 3;
  }

  /** A level card: show its milestones below. */
  protected openLevel(level: HandholdingLevel): void {
    if (!this.shownLevels().includes(level)) return;
    this.selected.set(level);
    if (window.innerWidth < 992) document.getElementById('hh-milestones')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  }

  /** "View details" of the selected level: its milestones when paid, the details pop-up otherwise. */
  protected viewDetails(level: HandholdingLevel): void {
    if (this.paid(level)) this.openLevel(level);
    else this.detailsOf.set(level);
  }

  /** Apply of a level card (not started, payable): the disclaimer, instructions and payment of its first milestone. */
  protected applyLevel(card: LevelCardVm): void {
    if (!card.canApply) return;
    void this.router.navigate(['/msme/handholding', card.code, 'payment']);
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
