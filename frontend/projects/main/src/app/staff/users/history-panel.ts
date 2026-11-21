import { DatePipe } from '@angular/common';
import { Component, ElementRef, HostListener, afterNextRender, computed, effect, inject, input, output, signal } from '@angular/core';
import { TextPipe, t } from '../../content/page-text';
import { TableExport } from '../table-export';
import { BlockHistoryEntry } from './users.api';

/** What a history line is about (2026-11-21: the account's whole history, not only blocks). */
export type HistoryKind = 'created' | 'edited' | 'passwordLink' | 'mobileReset' | 'blocked' | 'unblocked' | 'allotment' | 'sessionsEnded' | 'other';

/** One line of the history panel: what happened, who did it and why, when; an edit also lists what changed. */
export interface HistoryItem {
  kind: HistoryKind;
  title: string;
  /** "By Master Admin · Reason: …" */
  detail: string;
  at: string | null;
  tone: 'good' | 'bad' | 'info';
  /** Created / Edited: one readable line per field ("Mobile: 98… → 91…"), shown on demand. */
  changes?: string[];
}

/** The kinds in the order of the filter chips. */
export const HISTORY_KINDS: readonly HistoryKind[] = ['created', 'edited', 'passwordLink', 'mobileReset', 'blocked', 'unblocked', 'allotment', 'sessionsEnded', 'other'];

/** The chip / CSV word of each kind. */
export function historyKindLabel(kind: HistoryKind): string {
  switch (kind) {
    case 'created': return t('staff.userLists.history.kind.created', 'Created');
    case 'edited': return t('staff.userLists.history.kind.edited', 'Edited');
    case 'passwordLink': return t('staff.userLists.history.kind.passwordLink', 'Password link');
    case 'mobileReset': return t('staff.userLists.history.kind.mobileReset', 'Mobile reset');
    case 'blocked': return t('staff.userLists.history.kind.blocked', 'Blocked');
    case 'unblocked': return t('staff.userLists.history.kind.unblocked', 'Unblocked');
    case 'allotment': return t('staff.userLists.history.kind.allotment', 'Allotment');
    case 'sessionsEnded': return t('staff.userLists.history.kind.sessionsEnded', 'Signed out everywhere');
    default: return t('staff.userLists.history.kind.other', 'Other');
  }
}

/** The label of a changed field (the keys the server records, UserBlockHistory / AccountChanges). */
function fieldLabel(field: string): string {
  switch (field) {
    case 'name': return t('staff.userLists.history.field.name', 'Name');
    case 'spoc': return t('staff.userLists.history.field.spoc', 'SPOC name');
    case 'email': return t('staff.userLists.history.field.email', 'E-mail');
    case 'mobile': return t('staff.userLists.history.field.mobile', 'Mobile');
    case 'address': return t('staff.userLists.history.field.address', 'Address');
    case 'pin': return t('staff.userLists.history.field.pin', 'PIN code');
    case 'gstin': return t('staff.userLists.history.field.gstin', 'GSTIN');
    case 'pan': return t('staff.userLists.history.field.pan', 'PAN');
    case 'idProofType': return t('staff.userLists.history.field.idProofType', 'ID proof type');
    case 'idProofNumber': return t('staff.userLists.history.field.idProofNumber', 'ID proof number');
    case 'certificateNo': return t('staff.userLists.history.field.certificateNo', 'Certificate number');
    case 'professionalEmail': return t('staff.userLists.history.field.professionalEmail', 'Professional e-mail');
    case 'assessorType': return t('staff.userLists.history.field.assessorType', 'Type');
    case 'states': return t('staff.userLists.history.field.states', 'States');
    case 'districts': return t('staff.userLists.history.field.districts', 'Districts');
    case 'nicSectors': return t('staff.userLists.history.field.nicSectors', 'NIC sectors');
    case 'areasOfKnowledge': return t('staff.userLists.history.field.areasOfKnowledge', 'Areas of knowledge');
    case 'assessments': return t('staff.userLists.history.field.assessments', 'Levels and modes');
    case 'verifications': return t('staff.userLists.history.field.verifications', 'Verifications');
    case 'organisingPartner': return t('staff.userLists.history.field.organisingPartner', 'Organising partner');
    case 'activity': return t('staff.userLists.history.field.activity', 'Activity type');
    case 'tuState': return t('staff.userLists.history.field.tuState', 'Technology Upgradation state');
    case 'tuDistricts': return t('staff.userLists.history.field.tuDistricts', 'Technology Upgradation districts');
    case 'agencyType': return t('staff.userLists.history.field.agencyType', 'Agency type');
    case 'schemes': return t('staff.userLists.history.field.schemes', 'Schemes');
    case 'schemeTicks': return t('staff.userLists.history.field.schemeTicks', 'Scheme ticks');
    case 'state': return t('staff.userLists.history.field.state', 'State');
    case 'scopeStates': return t('staff.userLists.history.field.scopeStates', 'Applicable states');
    case 'levels': return t('staff.userLists.history.field.levels', 'Certification levels');
    case 'bronzeSurveillance': return t('staff.userLists.history.field.bronzeSurveillance', 'Bronze surveillance');
    case 'preferredState': return t('staff.userLists.history.field.preferredState', 'Preferred state');
    case 'sentTo': return t('staff.userLists.history.field.sentTo', 'Sent to');
    default: return field;
  }
}

/** One stored change (AccountChange on the server, camelCase JSON). */
interface StoredChange {
  field: string;
  old?: string | null;
  new?: string | null;
  added?: string[] | null;
  removed?: string[] | null;
  addedCount?: number | null;
  removedCount?: number | null;
}

function parseChanges(details: string | null | undefined): StoredChange[] {
  if (!details) return [];
  try {
    const value: unknown = JSON.parse(details);
    return Array.isArray(value) ? value.filter((c): c is StoredChange => !!c && typeof (c as StoredChange).field === 'string') : [];
  } catch {
    return [];
  }
}

function shown(value: string | null | undefined): string {
  if (value === 'true') return t('staff.userLists.history.value.yes', 'Yes');
  if (value === 'false') return t('staff.userLists.history.value.no', 'No');
  return value?.trim() ? value : t('staff.userLists.history.value.none', '(none)');
}

function listText(items: string[] | null | undefined, total: number | null | undefined): string {
  const names = (items ?? []).join(', ');
  const more = (total ?? 0) - (items?.length ?? 0);
  return more > 0 ? t('staff.userLists.history.change.more', '{names} and {n} more', { names, n: more }) : names;
}

/** A stored change as one readable line: "Mobile: 98… → 91…", "States: added Goa; removed Delhi", "Name: Acme" (a new account). */
export function changeLine(c: StoredChange, created = false): string {
  const label = fieldLabel(c.field);
  if (c.added?.length || c.removed?.length) {
    const parts = [
      c.added?.length ? t('staff.userLists.history.change.added', 'added {items}', { items: listText(c.added, c.addedCount) }) : '',
      c.removed?.length ? t('staff.userLists.history.change.removed', 'removed {items}', { items: listText(c.removed, c.removedCount) }) : '',
    ].filter(Boolean);
    if (created) return t('staff.userLists.history.change.set', '{label}: {value}', { label, value: listText(c.added, c.addedCount) });
    return t('staff.userLists.history.change.list', '{label}: {parts}', { label, parts: parts.join('; ') });
  }
  if (created) return t('staff.userLists.history.change.set', '{label}: {value}', { label, value: shown(c.new) });
  return t('staff.userLists.history.change.value', '{label}: {old} → {new}', { label, old: shown(c.old), new: shown(c.new) });
}

/** How an allotment came (the agency's allotment type) or the assessor's part in it. */
function allotmentText(kind: string | null | undefined): string {
  switch (kind) {
    case 'Manual': return t('staff.userLists.history.allot.manual', 'allotted by the Master Admin');
    case 'Auto': return t('staff.userLists.history.allot.auto', 'automatic allotment (round robin)');
    case 'Direct': return t('staff.userLists.history.allot.direct', 'direct allotment');
    case 'Reallot': return t('staff.userLists.history.allot.reallot', "re-allotted after another agency's rejection");
    case 'SchemeOnsite': return t('staff.userLists.history.allot.schemeOnsite', 'incentive scheme onsite verification');
    case 'CoAlloted': return t('staff.userLists.history.allot.consultancy', 'allotted for handholding');
    case 'OldSchemeRejected': return t('staff.userLists.history.allot.oldScheme', 'old scheme self-assessment, rejected');
    case 'Desktop': return t('staff.userLists.history.allot.desktop', 'desktop assessment');
    case 'Site': return t('staff.userLists.history.allot.site', 'lead (site / remote)');
    case 'SiteCo': return t('staff.userLists.history.allot.siteCo', 'co-assessor (site / remote)');
    case 'Expert': return t('staff.userLists.history.allot.expert', 'technical expert');
    case 'OnsiteSurveillance': return t('staff.userLists.history.allot.onsiteSurveillance', 'onsite surveillance');
    case 'OnsiteSurveillanceCo': return t('staff.userLists.history.allot.onsiteSurveillanceCo', 'onsite surveillance, co-assessor');
    default: return kind ?? '';
  }
}

/**
 * The history entries as panel lines (latest first, as the server sends them). 2026-11-21: every kind the server records (created,
 * edited with its change list, password links, mobile changes, blocks) and the allotments it reads; the name is kept for the pages
 * that call it.
 */
export function blockHistoryItems(entries: readonly BlockHistoryEntry[], agencyWord?: string): HistoryItem[] {
  const by = (name: string, r: number | null) =>
    r === 7 ? t('staff.userLists.history.byMasterAdmin', 'By {name} (Master Admin)', { name })
    : r === 2 ? t('staff.userLists.history.byAgency', 'By {name} ({word})', { name, word: agencyWord ?? t('staff.userLists.history.agencyWord', 'agency') })
    : r === 1 ? t('staff.userLists.history.byAdmin', 'By {name} (Admin)', { name })
    : t('staff.userLists.history.by', 'By {name}', { name });
  return entries.map((e): HistoryItem => {
    const who = e.actionByName?.trim() || e.actionBy;
    const byWho = who ? by(who, e.actionByRole) : '';
    const reason = e.reason ? t('staff.userLists.history.reason', 'Reason: {reason}', { reason: e.reason }) : '';
    const changes = parseChanges(e.details);
    const join = (...parts: string[]) => parts.filter(Boolean).join(' · ');
    switch (e.action) {
      case 'Blocked':
        return { kind: 'blocked', title: historyKindLabel('blocked'), detail: join(byWho, reason), at: e.actionDate, tone: 'bad' };
      case 'Unblocked':
        return { kind: 'unblocked', title: historyKindLabel('unblocked'), detail: join(byWho, reason), at: e.actionDate, tone: 'good' };
      case 'Created':
        return { kind: 'created', title: t('staff.userLists.history.title.created', 'Account created'), detail: byWho, at: e.actionDate, tone: 'good',
          changes: changes.map((c) => changeLine(c, true)) };
      case 'Edited':
        return { kind: 'edited', title: t('staff.userLists.history.title.edited', 'Profile edited'),
          detail: join(byWho, t('staff.userLists.history.changedCount', '{n} changed', { n: changes.length }), reason), at: e.actionDate, tone: 'info',
          changes: changes.map((c) => changeLine(c)) };
      case 'MobileReset':
        return { kind: 'mobileReset', title: t('staff.userLists.history.title.mobileReset', 'Mobile number changed'),
          detail: join(byWho, ...changes.map((c) => changeLine(c))), at: e.actionDate, tone: 'info' };
      case 'PasswordLink': {
        const to = changes.find((c) => c.field === 'sentTo')?.new;
        const sentTo = to ? t('staff.userLists.history.sentTo', 'Sent to {to}', { to }) : '';
        const self = e.reason === 'self';
        return { kind: 'passwordLink',
          title: e.reason === 'newPassword' ? t('staff.userLists.history.title.newPassword', 'New password e-mailed') : t('staff.userLists.history.title.passwordLink', 'Password link sent'),
          detail: join(self ? t('staff.userLists.history.selfService', 'Asked by the user (Forgot password)') : byWho, sentTo), at: e.actionDate, tone: 'info' };
      }
      case 'SessionsEnded':
        return { kind: 'sessionsEnded', title: historyKindLabel('sessionsEnded'), detail: join(byWho, reason), at: e.actionDate, tone: 'info' };
      case 'Allotment':
        return { kind: 'allotment',
          title: e.zedId ? t('staff.userLists.history.title.allotment', 'Allotment: {zedId}', { zedId: e.zedId }) : historyKindLabel('allotment'),
          detail: join(e.level ?? '', allotmentText(e.allotment),
            e.replaced ? t('staff.userLists.history.allot.replaced', 'later allotted to someone else') : '',
            e.reason ? t('staff.userLists.history.allot.note', 'Note: {note}', { note: e.reason }) : ''),
          at: e.actionDate, tone: 'info' };
      default:
        return { kind: 'other', title: e.action, detail: join(byWho, reason), at: e.actionDate, tone: 'info' };
    }
  });
}

/** Icon paths (24px, stroked) of each kind. */
const ICONS: Record<HistoryKind, string> = {
  created: 'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2 M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8 M19 8v6 M22 11h-6',
  edited: 'M12 20h9 M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z',
  passwordLink: 'M21 2l-2 2 M15.5 7.5l3 3L22 7l-3-3 M11.4 11.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8Z M11.4 11.6L19 4',
  mobileReset: 'M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z M12 18h.01',
  blocked: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M4.9 4.9l14.2 14.2',
  unblocked: 'M5 11h14v10H5Z M8 11V7a4 4 0 0 1 7.9-1',
  allotment: 'M9 2h6v4H9Z M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2 M9 14l2 2 4-4',
  sessionsEnded: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4 M16 17l5-5-5-5 M21 12H9',
  other: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20Z M12 8v4 M12 16h.01',
};

/**
 * 2026-11-17 (approved staff redesign, popup-08): the history of a login as a side panel on the right, so the list stays
 * visible behind it: each entry says what happened, who did it and why, with a CSV download.
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): popup-08 values: 520px, 19px title, a grey square close
 * button, 6px coloured dots on a 2px line, 14 / 12.5 / 11.5px entry lines, and a white footer with a top line (a div, not a
 * <code>footer</code>: the site's global footer rule painted it dark): Download (CSV) outlined with its icon, Close grey.
 * 2026-11-21 (the product owner: "profile Edit histories etc. are missing"): the account's whole history: created, profile edits
 * (each with its changed fields, old → new, opened on demand), password links, mobile number changes, blocks and unblocks, and the
 * allotments, each kind with its own icon and colour, filter chips by kind, and the CSV with every kind and its changes. Full
 * width on phones.
 */
@Component({
  selector: 'zed-user-history',
  imports: [DatePipe, TextPipe],
  template: `
    <div class="hp-back" (click)="closed.emit()"></div>
    <aside class="hp" role="dialog" aria-modal="true" aria-labelledby="hp-title">
      <header class="hp-head">
        <div>
          <h3 id="hp-title">{{ 'History' | t: 'staff.userLists.history.title' }}</h3>
          <small>{{ subtitle() }}</small>
        </div>
        <button type="button" class="hp-x" [attr.aria-label]="'Close history' | t: 'staff.userLists.history.closeAria'" (click)="closed.emit()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18 6L6 18 M6 6l12 12" /></svg></button>
      </header>
      <div class="hp-body">
        @if (error()) {
          <div class="alert alert-danger" role="alert">{{ error() }}</div>
        } @else if (items() === null) {
          <p class="hp-none" role="status">{{ 'Loading…' | t: 'staff.userLists.history.loading' }}</p>
        } @else {
          @if (chips().length > 1) {
            <div class="hp-chips" role="group" [attr.aria-label]="'Filter by kind' | t: 'staff.userLists.history.filterAria'">
              <button type="button" class="hp-chip" [class.on]="filter() === 'all'" [attr.aria-pressed]="filter() === 'all'" (click)="filter.set('all')">{{ 'All' | t: 'staff.userLists.history.filterAll' }} <span>{{ items()!.length }}</span></button>
              @for (c of chips(); track c.kind) {
                <button type="button" class="hp-chip" [attr.data-kind]="c.kind" [class.on]="filter() === c.kind" [attr.aria-pressed]="filter() === c.kind" (click)="filter.set(c.kind)">{{ c.label }} <span>{{ c.count }}</span></button>
              }
            </div>
          }
          <ol class="hp-list">
            @for (e of shownItems(); track $index) {
              <li [class]="'is-' + e.tone" [attr.data-kind]="e.kind">
                <strong><svg class="hp-ic" viewBox="0 0 24 24" aria-hidden="true"><path [attr.d]="icons[e.kind]" /></svg>{{ e.title }}</strong>
                @if (e.detail) { <span>{{ e.detail }}</span> }
                @if (e.changes?.length) {
                  <details class="hp-changes">
                    @if (e.kind === 'created') {
                      <summary>{{ 'Created with ({n})' | t: 'staff.userLists.history.createdWith' : { n: e.changes!.length } }}</summary>
                    } @else {
                      <summary>{{ 'What changed ({n})' | t: 'staff.userLists.history.whatChanged' : { n: e.changes!.length } }}</summary>
                    }
                    @for (line of e.changes; track $index) { <div class="hp-change">{{ line }}</div> }
                  </details>
                }
                @if (e.at) { <small>{{ e.at | date: 'dd MMM yyyy, HH:mm' }}</small> }
              </li>
            } @empty {
              <li class="hp-none">{{ 'Nothing recorded yet.' | t: 'staff.userLists.history.emptyAll' }}</li>
            }
          </ol>
          <p class="hp-note">{{ 'Shown: the account’s creation, profile edits (each changed field, old → new), password links, mobile number changes, blocks and unblocks, and its allotments. Profile edits and links are recorded from 21 Nov 2026.' | t: 'staff.userLists.history.noteAll' }}</p>
        }
      </div>
      <div class="hp-foot">
        <button type="button" class="btn btn-outline-primary hp-csv" [disabled]="!shownItems().length" (click)="download()"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4 M7 10l5 5 5-5 M12 15V3" /></svg>{{ 'Download (CSV)' | t: 'staff.userLists.history.downloadButton' }}</button>
        <button type="button" class="btn btn-default hp-close" (click)="closed.emit()">{{ 'Close' | t: 'staff.userLists.history.closeButton' }}</button>
      </div>
    </aside>
  `,
  styles: `
    .hp-back { position: fixed; inset: 0; z-index: 1065; background: rgba(15, 35, 38, 0.56); }
    .hp { position: fixed; top: 0; right: 0; bottom: 0; z-index: 1066; width: min(520px, 100vw); display: flex; flex-direction: column; background: #fff;
      box-shadow: -12px 0 32px rgba(16, 61, 64, 0.2); }
    .hp-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 12px; padding: 24px 28px 20px; border-bottom: 1px solid #dde7e8; }
    .hp-head h3 { margin: 0; font-size: 19px; font-weight: 700; color: #17373b; }
    .hp-head small { display: block; margin-top: 4px; font-size: 12.5px; font-weight: 500; color: #6f8487; overflow-wrap: anywhere; }
    .hp-x { flex: none; width: 32px; height: 32px; padding: 0; border: 0; border-radius: 8px; display: grid; place-items: center; background: #eef3f3; color: #17373b; }
    .hp-x svg, .hp-csv svg, .hp-ic { fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .hp-x svg { width: 16px; height: 16px; }
    .hp-body { flex: 1; overflow: auto; padding: 24px 28px; }
    .hp-chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 18px; }
    .hp-chip { border: 1px solid #cfdcdd; border-radius: 999px; padding: 4px 10px; background: #fff; color: #3d5559; font-size: 12px; font-weight: 600; line-height: 1.4; }
    .hp-chip span { margin-left: 2px; color: #6f8487; font-weight: 500; }
    .hp-chip.on { border-color: #17373b; background: #17373b; color: #fff; }
    .hp-chip.on span { color: #dbe7e8; }
    .hp-list { list-style: none; margin: 0 0 0 15px; padding: 0 0 0 21px; border-left: 2px solid #dde7e8; }
    .hp-list li { position: relative; display: flex; flex-direction: column; gap: 3px; padding: 0 0 22px; font-size: 12.5px; font-weight: 500; color: #3d5559; overflow-wrap: anywhere; }
    .hp-list li::before { content: ''; position: absolute; left: -29px; top: 3px; width: 12px; height: 12px; border-radius: 50%; background: #3ba3ad; box-shadow: 0 0 0 2px #fff; }
    .hp-list li.is-good::before { background: #2f9e58; }
    .hp-list li.is-bad::before { background: #c8473c; }
    .hp-list li[data-kind='edited']::before { background: #3b6fd8; }
    .hp-list li[data-kind='passwordLink']::before { background: #7a5ad6; }
    .hp-list li[data-kind='mobileReset']::before { background: #3ba3ad; }
    .hp-list li[data-kind='allotment']::before { background: #c98a1b; }
    .hp-list strong { display: flex; align-items: center; gap: 6px; font-size: 14px; font-weight: 700; color: #17373b; }
    .hp-ic { flex: none; width: 15px; height: 15px; color: #3ba3ad; }
    li.is-good .hp-ic { color: #2f9e58; }
    li.is-bad .hp-ic { color: #c8473c; }
    li[data-kind='edited'] .hp-ic { color: #3b6fd8; }
    li[data-kind='passwordLink'] .hp-ic { color: #7a5ad6; }
    li[data-kind='allotment'] .hp-ic { color: #c98a1b; }
    .hp-list small { font-size: 11.5px; color: #6f8487; }
    .hp-list li.hp-none::before { display: none; }
    .hp-changes { margin: 2px 0; }
    .hp-changes summary { cursor: pointer; color: #1f6f78; font-weight: 600; }
    .hp-change { margin: 4px 0 0 2px; padding-left: 10px; border-left: 2px solid #e6eeef; white-space: pre-line; }
    .hp-none { color: #6f8487; }
    .hp-note { margin: 4px 0 0; font-size: 12px; font-weight: 500; color: #6f8487; }
    .hp-foot { flex: none; display: flex; justify-content: space-between; gap: 12px; padding: 14px 28px; border-top: 1px solid #dde7e8; background: #fff; color: inherit; }
    .hp-foot .btn { min-height: 40px; }
    .hp-csv { min-width: 180px; }
    .hp-csv svg { width: 16px; height: 16px; }
    .hp-close { min-width: 100px; }
    @media (max-width: 575.98px) {
      .hp-head { padding: 18px 16px 14px; }
      .hp-body { padding: 16px; }
      .hp-foot { padding: 12px 16px; }
      .hp-csv { min-width: 0; flex: 1; }
    }
  `,
})
export class UserHistoryPanel {
  /** "Assessor One · ZEDBA3653" */
  readonly subtitle = input('');
  /** null while loading. */
  readonly items = input<HistoryItem[] | null>(null);
  readonly error = input('');
  /** The CSV's name, e.g. "history-ZEDBA3653". */
  readonly fileName = input('history');
  readonly closed = output<void>();

  protected readonly icons = ICONS;
  /** The kind shown ('all' = every line). */
  protected readonly filter = signal<HistoryKind | 'all'>('all');
  /** A chip per kind present, with its count (shown when there is more than one kind). */
  protected readonly chips = computed(() => {
    const list = this.items() ?? [];
    return HISTORY_KINDS.map((kind) => ({ kind, label: historyKindLabel(kind), count: list.filter((i) => i.kind === kind).length })).filter((c) => c.count > 0);
  });
  protected readonly shownItems = computed(() => {
    const f = this.filter();
    const list = this.items() ?? [];
    return f === 'all' ? list : list.filter((i) => i.kind === f);
  });

  private readonly exporter = inject(TableExport);
  private readonly host = inject(ElementRef<HTMLElement>);

  constructor() {
    afterNextRender(() => (this.host.nativeElement as HTMLElement).querySelector<HTMLButtonElement>('.hp-x')?.focus());
    // A new list (another user, or loaded again) starts unfiltered.
    effect(() => {
      this.items();
      this.filter.set('all');
    });
  }

  @HostListener('document:keydown.escape')
  protected escape(): void {
    this.closed.emit();
  }

  /** The lines shown (the filter applies), with each kind's word and every change of an edit. */
  protected download(): void {
    const rows = this.shownItems().map((e) => [e.at ?? '', historyKindLabel(e.kind), e.title, e.detail, (e.changes ?? []).join('; ')]);
    this.exporter.csv(this.fileName(), {
      name: t('staff.userLists.history.csv.sheet', 'History'),
      columns: [t('staff.userLists.history.csv.column.date', 'Date'), t('staff.userLists.history.csv.column.kind', 'Kind'),
        t('staff.userLists.history.csv.column.event', 'Event'), t('staff.userLists.history.csv.column.details', 'Details'),
        t('staff.userLists.history.csv.column.changes', 'Changes')],
      rows,
    });
  }
}
