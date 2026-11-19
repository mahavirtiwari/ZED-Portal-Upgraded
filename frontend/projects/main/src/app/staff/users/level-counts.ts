import { Component, input } from '@angular/core';
import { TextPipe, t } from '../../content/page-text';
import { ListCount } from '../list-counts';

/**
 * 2026-11-18 (the user: "certification level wise numbers allocated to the respective agency ... also for the assessors"):
 * one level's allotments as the server counts them (UserLevelCounts): allotted = every application allotted (the ones the
 * agency rejected and gave back left out), split into in progress, completed (certified) and rejected.
 */
export interface LevelCount {
  code: string;
  name: string;
  allotted: number;
  inProgress: number;
  completed: number;
  rejected: number;
}

/** "Bronze: 12 allocated · 4 in progress · 7 completed · 1 rejected" (rejected only when there are some). */
export function levelCountTip(c: LevelCount): string {
  const v = { level: c.name, allotted: c.allotted, inProgress: c.inProgress, completed: c.completed, rejected: c.rejected };
  return c.rejected
    ? t('staff.userLists.levelCounts.tipRejected', '{level}: {allotted} allocated · {inProgress} in progress · {completed} completed · {rejected} rejected', v)
    : t('staff.userLists.levelCounts.tip', '{level}: {allotted} allocated · {inProgress} in progress · {completed} completed', v);
}

/** The medal colour of a level (Bronze, Silver, Gold, ZED-X; any other level the teal of the added levels). */
export function levelKey(code: string): string {
  const k = (code ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return ['bronze', 'silver', 'gold', 'zedx'].includes(k) ? k : 'other';
}

/** An agency's own totals as count tiles ("Bronze Allocated", "4 in progress · 7 completed"). */
export function levelCountTiles(list: readonly LevelCount[] | null | undefined): ListCount[] {
  return (list ?? []).map((c) => ({
    key: 'lv-' + c.code,
    label: t('staff.userLists.levelCounts.tile.label', '{level} Allocated', { level: c.name }),
    value: c.allotted,
    sub: t('staff.userLists.levelCounts.tile.sub', '{inProgress} in progress · {completed} completed', { inProgress: c.inProgress, completed: c.completed }),
  }));
}

/**
 * The level chips of a row in the agency and assessor lists: a medal dot, the level and its allocated count
 * ("Bronze 12 · Silver 3 · Gold 0 · ZED-X 1"), a tooltip with allocated / in progress / completed (/ rejected); "—" when
 * the server could not count them. Shows only the numbers (no filter).
 */
@Component({
  selector: 'zed-level-counts',
  imports: [TextPipe],
  template: `
    @if (counts(); as list) {
      <span class="lcs" role="list" [attr.aria-label]="label() || ('Allocated per level' | t: 'staff.userLists.levelCounts.aria')">
        @for (c of list; track c.code) {
          <span role="listitem" [class]="'lcs-chip' + (c.allotted ? '' : ' is-zero')" [attr.data-level]="c.code" [title]="tip(c)" [attr.aria-label]="tip(c)">
            <span [class]="'lcs-dot lcs-' + key(c.code)" aria-hidden="true"></span>{{ c.name }}&ngsp;<b>{{ c.allotted }}</b>
          </span>
        }
      </span>
    } @else {
      <span class="lcs-none" [title]="'The allocations could not be counted' | t: 'staff.userLists.levelCounts.noneTooltip'">—</span>
    }
  `,
  styles: `
    :host { display: block; min-width: 0; }
    .lcs { display: flex; flex-wrap: wrap; gap: 4px 6px; }
    .lcs-chip { display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px 3px 6px; border-radius: 11px; background: #f1f5f5;
      border: 1px solid #e1eaea; color: #3d5559; font-size: 11.5px; font-weight: 600; line-height: 15px; white-space: nowrap; cursor: default; }
    .lcs-chip b { font-size: 12.5px; font-weight: 800; color: #17373b; }
    .lcs-chip.is-zero { opacity: .6; }
    .lcs-dot { flex: none; width: 10px; height: 10px; border-radius: 50%; background: #2f9aa3; box-shadow: inset 0 0 0 1px rgba(255, 255, 255, .5); }
    .lcs-bronze { background: #c9714f; }
    .lcs-silver { background: #9aa4aa; }
    .lcs-gold { background: #c9a23f; }
    .lcs-zedx { background: #3c8f99; }
    .lcs-none { color: #8a9899; }
  `,
})
export class LevelCounts {
  /** The row's counts (every enabled level, the server's order); null / undefined: not counted. */
  readonly counts = input<readonly LevelCount[] | null | undefined>(null);
  /** The list's aria-label; empty: the standard "Allocated per level" (Admin → Texts → Page wording). */
  readonly label = input('');

  protected readonly tip = levelCountTip;
  protected readonly key = levelKey;
}
