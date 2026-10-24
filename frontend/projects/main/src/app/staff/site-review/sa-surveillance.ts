import { Component, computed, input, output, signal } from '@angular/core';
import { text } from '../assessment/assessment-shared';
import { ReviewActionsBar } from '../monitoring/review-actions';
import { RemarksKind, ReviewActions } from '../monitoring/review.api';
import { Row, SaDetails, SaMeeting, SaOriginal, SaPhoto } from './site-review.api';

/** An "Edit Remarks" request for the parent's remarks pop-up. */
export interface SurveillanceRemarks {
  kind: RemarksKind;
  id: unknown;
  remarks: string | null | undefined;
}

/** One accordion panel of a tab: the surveillance block, then (MasterAdmin) the original certification's block. */
interface Block<T> {
  key: string;
  title: string;
  value: T;
  surveillance: boolean;
}

/**
 * Tabs 1-7 of the Surveillance portal's Assessment/SaDetails.cshtml, which put the surveillance next to the original
 * certification on main (old GetDaDetailsFromZedLive / GetSaDetailsFromZedLive): every tab shows the SURVEILLANCE block
 * and, to MasterAdmin only, the ONSITE block of the original assessment. Parameters follow main's sections (only
 * those with SurveMandatories for other roles, all of them for MasterAdmin) with main's site assessment (MasterAdmin)
 * and the surveillance's own result under each requirement. Without the original (QC, or main not reachable) the
 * surveillance's own sections are listed. Remarks edits and the review buttons are the parent's (agency, status 15).
 */
@Component({
  selector: 'zed-sa-surveillance-tab',
  imports: [ReviewActionsBar],
  templateUrl: './sa-surveillance.html',
  styles: `
    .surveillance-assessment { width: 200px; overflow: auto; vertical-align: middle !important; text-align: center; background-color: #f9cc53; }
    .surveillance-assessment p { font-weight: 600; font-size: 16px; }
    .section-toggle { cursor: pointer; }
    .map-box { border: 1px solid #8d8f90; border-radius: 4px; }
    .recording-link {
      display: inline-block; background-color: #007bff; color: #fff; text-decoration: none; padding: 6px 12px;
      border-radius: 4px; font-weight: bold; font-size: 13px; transition: 0.3s;
    }
  `,
})
export class SaSurveillanceTab {
  readonly tab = input.required<number>();
  readonly details = input.required<SaDetails>();
  /** Main's original certification; null for QC or when it is not available. */
  readonly original = input<SaOriginal | null>(null);
  /** MasterAdmin: also sees the original certification's blocks. */
  readonly admin = input(false);
  readonly review = input.required<ReviewActions>();

  readonly preview = output<string>();
  readonly remarks = output<SurveillanceRemarks>();
  readonly done = output<string>();

  protected readonly t = text;
  /** Accordion panels the user closed (they open expanded, as before). */
  private readonly closed = signal<ReadonlySet<string>>(new Set());
  /** Parameter sections the user opened (they open collapsed, as before). */
  private readonly opened = signal<ReadonlySet<string>>(new Set());

  /** The original certification's unit row, or the surveillance's when the original is not loaded. */
  protected readonly main = computed<Row>(() => this.original()?.msme ?? this.details().msme);
  protected readonly sur = computed<Row>(() => this.details().msme);
  protected readonly mainLocation = computed<Row>(() => this.original()?.location ?? {});

  protected readonly planBlocks = computed<Block<Row[]>[]>(() => {
    const d = this.details();
    const blocks: Block<Row[]>[] = [
      { key: 'plan-surveillance', title: 'SURVEILLANCE ASSESSMENT PLAN', value: d.surveillance?.planSections ?? d.sections, surveillance: true },
    ];
    const o = this.original();
    if (this.admin() && o) blocks.push({ key: 'plan-onsite', title: 'ONSITE ASSESSMENT PLAN', value: o.sections, surveillance: false });
    return blocks;
  });

  protected readonly openMeetings = computed(() => this.meetings('open', 'SURVEILLANCE OPEN MEETING', 'ONSITE OPEN MEETING'));
  protected readonly closeMeetings = computed(() => this.meetings('close', 'SURVEILLANCE CLOSE MEETING', 'CLOSE MEETING'));

  protected readonly tourBlocks = computed<Block<SaPhoto[]>[]>(() => {
    const blocks: Block<SaPhoto[]>[] = [{ key: 'tour-surveillance', title: 'SURVEILLANCE SITE TOUR', value: this.details().siteTour, surveillance: true }];
    const o = this.original();
    if (this.admin() && o) blocks.push({ key: 'tour-onsite', title: 'ONSITE SITE TOUR', value: o.siteTour, surveillance: false });
    return blocks;
  });

  /** Parameter sections: main's (non-admins: only SurveMandatories), or the surveillance's own without the original. */
  protected readonly sections = computed<Row[]>(() => {
    const o = this.original();
    if (!o) return this.details().sections;
    return this.admin() ? o.sections : o.sections.filter((s) => text(s, 'SurveMandatories'));
  });

  private readonly skeleton = computed(() => this.original() ?? this.details());

  // ------------------------------------------------------------------ view helpers

  protected isClosed(key: string): boolean {
    return this.closed().has(key);
  }

  protected togglePanel(key: string): void {
    this.closed.update((s) => flip(s, key));
  }

  protected isOpen(section: Row): boolean {
    return this.opened().has(text(section, 'SectionCode'));
  }

  protected toggleSection(section: Row): void {
    this.opened.update((s) => flip(s, text(section, 'SectionCode')));
  }

  protected requirementsOf(section: Row): Row[] {
    return this.skeleton().requirements.filter((r) => text(r, 'SectionCode') === text(section, 'SectionCode'));
  }

  protected optionsOf(r: Row): Row[] {
    return this.skeleton().options.filter((o) => text(o, 'SectionCode') === text(r, 'SectionCode') && text(o, 'RequirementCode') === text(r, 'RequirementCode'));
  }

  protected subOptionsOf(o: Row): Row[] {
    return this.skeleton().subOptions.filter(
      (s) => text(s, 'SectionCode') === text(o, 'SectionCode') && text(s, 'RequirementCode') === text(o, 'RequirementCode') && text(s, 'OptionCode') === text(o, 'OptionCode'),
    );
  }

  /** The surveillance's result for a requirement of main (same RequirementId); the requirement itself without the original. */
  protected surveillanceOf(r: Row): Row | undefined {
    if (!this.original()) return r;
    const id = text(r, 'RequirementId');
    return id ? this.details().requirements.find((x) => text(x, 'RequirementId') === id) : undefined;
  }

  protected photosOf(r: Row | undefined): SaPhoto[] {
    const p = r?.['Photos'];
    return Array.isArray(p) ? (p as SaPhoto[]) : [];
  }

  protected mapUrl(lat: unknown, lng: unknown): string {
    const a = Number(lat);
    const b = Number(lng);
    return lat && lng && Number.isFinite(a) && Number.isFinite(b) ? `https://www.google.com/maps?q=${a},${b}` : '';
  }

  protected view(src: string | null | undefined): void {
    if (src) this.preview.emit(src);
  }

  protected edit(kind: RemarksKind, id: unknown, remarks: string | null | undefined): void {
    this.remarks.emit({ kind, id, remarks });
  }

  private meetings(kind: 'open' | 'close', surveillanceTitle: string, onsiteTitle: string): Block<SaMeeting | null>[] {
    const d = this.details();
    const blocks: Block<SaMeeting | null>[] = [
      { key: kind + '-surveillance', title: surveillanceTitle, value: kind === 'open' ? d.openMeeting : d.closeMeeting, surveillance: true },
    ];
    const o = this.original();
    if (this.admin() && o) blocks.push({ key: kind + '-onsite', title: onsiteTitle, value: kind === 'open' ? o.openMeeting : o.closeMeeting, surveillance: false });
    return blocks;
  }
}

function flip(set: ReadonlySet<string>, key: string): ReadonlySet<string> {
  const next = new Set(set);
  if (!next.delete(key)) next.add(key);
  return next;
}
