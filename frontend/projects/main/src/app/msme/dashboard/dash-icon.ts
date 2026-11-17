import { Component, computed, input } from '@angular/core';

const CIRCLE = 'M2 12a10 10 0 1 0 20 0a10 10 0 1 0-20 0';

/** Line icons of the dashboard (24 × 24, drawn with the text colour), as paths. */
const ICONS: Record<string, string[]> = {
  gift: ['M20 12v10H4V12', 'M2 7h20v5H2z', 'M12 22V7', 'M12 7H7.5a2.5 2.5 0 0 1 0-5C11 2 12 7 12 7z', 'M12 7h4.5a2.5 2.5 0 0 0 0-5C13 2 12 7 12 7z'],
  users: ['M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2', 'M5 7a4 4 0 1 0 8 0a4 4 0 1 0-8 0', 'M23 21v-2a4 4 0 0 0-3-3.87', 'M16 3.13a4 4 0 0 1 0 7.75'],
  award: ['M5 8a7 7 0 1 0 14 0a7 7 0 1 0-14 0', 'M8.21 13.89L7 23l5-3 5 3-1.21-9.12'],
  rupee: ['M6 3h12', 'M6 8h12', 'M6 13l8.5 8', 'M6 13h3a5 5 0 0 0 0-10'],
  zap: ['M13 2L3 14h9l-1 8 10-12h-9l1-8z'],
  building: ['M5 2h14v20H5z', 'M9 22v-4h6v4', 'M9 6h.01M12 6h.01M15 6h.01M9 10h.01M12 10h.01M15 10h.01M9 14h.01M12 14h.01M15 14h.01'],
  pin: ['M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z', 'M9 10a3 3 0 1 0 6 0a3 3 0 1 0-6 0'],
  bank: ['M3 21h18M3 10h18M5 6l7-3 7 3M4 10v11M20 10v11M8 14v3M12 14v3M16 14v3'],
  trend: ['M23 6l-9.5 9.5-5-5L1 18', 'M17 6h6v6'],
  star: ['M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'],
  info: [CIRCLE, 'M12 16v-4', 'M12 8h.01'],
  alert: [CIRCLE, 'M12 8v4', 'M12 16h.01'],
  help: [CIRCLE, 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3', 'M12 17h.01'],
  clock: [CIRCLE, 'M12 6v6l4 2'],
  arrow: ['M5 12h14', 'M12 5l7 7-7 7'],
  chevron: ['M9 18l6-6-6-6'],
  download: ['M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4', 'M7 10l5 5 5-5', 'M12 15V3'],
  refresh: ['M23 4v6h-6', 'M20.49 15a9 9 0 1 1-2.12-9.36L23 10'],
  checkCircle: ['M22 11.08V12a10 10 0 1 1-5.93-9.14', 'M22 4L12 14.01l-3-3'],
  check: ['M20 6L9 17l-5-5'],
  lock: ['M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2z', 'M7 11V7a5 5 0 0 1 10 0v4'],
  phone: ['M7 2h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z', 'M12 18h.01'],
  file: ['M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z', 'M14 2v6h6'],
  shield: ['M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'],
};

/** 2026-11-17 (the user's Home design): a line icon of the dashboard, e.g. <zed-dash-icon name="gift" />. Decorative only. */
@Component({
  selector: 'zed-dash-icon',
  host: { 'aria-hidden': 'true', style: 'display: inline-flex; line-height: 0; flex: none' },
  template: `
    <svg viewBox="0 0 24 24" [attr.width]="size()" [attr.height]="size()" fill="none" stroke="currentColor" [attr.stroke-width]="stroke()"
         stroke-linecap="round" stroke-linejoin="round" focusable="false">
      @for (d of paths(); track $index) { <path [attr.d]="d" /> }
    </svg>
  `,
})
export class DashIcon {
  readonly name = input.required<string>();
  readonly size = input(20);
  readonly stroke = input(2);
  protected readonly paths = computed(() => ICONS[this.name()] ?? []);
}
