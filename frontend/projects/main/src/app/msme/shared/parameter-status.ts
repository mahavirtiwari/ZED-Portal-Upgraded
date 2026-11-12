import { computed, signal } from '@angular/core';

/**
 * Status chips of the parameters layout (global "zp-" styles, styles/_zed-parameters.scss), computed the same way on every
 * assessment page: desktop and site assessment, surveillance, handholding milestones and the MSME's own reports.
 */
export type ParameterStatus = 'Yes' | 'No' | 'Partial' | 'Pending';
/** Chip of a parameter in the list: an exempted parameter shows "Exempt". */
export type ParameterChip = ParameterStatus | 'Exempt';

export interface ParameterProgress {
  /** Requirements with a conformance (Yes or No). */
  done: number;
  total: number;
  /** done / total, 0-100. */
  percent: number;
}

function conformanceOf(value: unknown): string {
  const v = value === null || value === undefined ? '' : String(value).trim().toLowerCase();
  return v === 'yes' ? 'Yes' : v === 'no' ? 'No' : v === 'partial' || v === 'partially' ? 'Partial' : '';
}

/**
 * Status of a requirement: its conformance when given (Yes / No, or Partial where a page has it); "Partial" while only
 * some of its checkpoints are answered (`answered`); "Pending" when nothing is answered yet.
 */
export function requirementStatus(conformance: unknown, answered = false): ParameterStatus {
  const c = conformanceOf(conformance);
  if (c) return c as ParameterStatus;
  return answered ? 'Partial' : 'Pending';
}

/** Status of a parameter from its requirements: nothing answered (Pending), any No, all Yes, else Partial. */
export function parameterStatus(statuses: readonly ParameterStatus[]): ParameterStatus {
  if (!statuses.length || statuses.every((s) => s === 'Pending')) return 'Pending';
  if (statuses.includes('No')) return 'No';
  return statuses.every((s) => s === 'Yes') ? 'Yes' : 'Partial';
}

/** Requirements with a Yes / No conformance out of all of them. */
export function parameterProgress(conformances: readonly unknown[]): ParameterProgress {
  const done = conformances.filter((c) => ['Yes', 'No'].includes(conformanceOf(c))).length;
  const total = conformances.length;
  return { done, total, percent: total ? Math.round((done / total) * 100) : 0 };
}

export function parameterChip(status: ParameterStatus, exempted: boolean): ParameterChip {
  return exempted ? 'Exempt' : status;
}

/** Complete: every requirement decided (a Yes / No conformance); an exempted parameter counts as complete. */
export function parameterComplete(progress: ParameterProgress, exempted: boolean): boolean {
  return exempted || (progress.total > 0 && progress.done === progress.total);
}

/** Where a page's parameters (sections) and requirements come from, for {@link ParameterNav}. */
export interface ParameterSource<S, R> {
  sections: () => readonly S[];
  id: (section: S) => string;
  requirements: (section: S) => readonly R[];
  /** The conformance that decides the requirement on this page (desktop, site, milestone…). */
  conformance: (requirement: R) => unknown;
  exempted?: (section: S) => boolean;
  /** Some checkpoints of the requirement are answered (status Partial while no conformance is given). */
  answered?: (requirement: R) => boolean;
}

/**
 * The parameter list of a page: the selected parameter (the first until one is picked), the status, chip and progress of
 * each parameter and the number of complete ones, from the page's own rows.
 */
export class ParameterNav<S, R> {
  readonly selected = signal<string | null>(null);
  readonly active = computed<S | null>(() => {
    const list = this.src.sections();
    const id = this.selected();
    return list.find((s) => this.src.id(s) === id) ?? list[0] ?? null;
  });
  readonly complete = computed(() => this.src.sections().filter((s) => parameterComplete(this.progress(s), this.exempted(s))).length);

  constructor(private readonly src: ParameterSource<S, R>) {}

  select(section: S): void {
    this.selected.set(this.src.id(section));
  }

  exempted(section: S): boolean {
    return this.src.exempted?.(section) ?? false;
  }

  requirementStatus(requirement: R): ParameterStatus {
    return requirementStatus(this.src.conformance(requirement), this.src.answered?.(requirement) ?? false);
  }

  status(section: S): ParameterStatus {
    return parameterStatus(this.src.requirements(section).map((r) => this.requirementStatus(r)));
  }

  chip(section: S): ParameterChip {
    return parameterChip(this.status(section), this.exempted(section));
  }

  progress(section: S): ParameterProgress {
    return parameterProgress(this.src.requirements(section).map((r) => this.src.conformance(r)));
  }
}

/** The parameter shown on the right of the layout: the one picked in the list, else the first. */
export class ParameterPicker {
  readonly selected = signal<string | null>(null);

  pick<T>(list: readonly T[], idOf: (item: T) => string): T | null {
    const id = this.selected();
    return list.find((s) => idOf(s) === id) ?? list[0] ?? null;
  }

  select(id: string): void {
    this.selected.set(id);
  }
}
