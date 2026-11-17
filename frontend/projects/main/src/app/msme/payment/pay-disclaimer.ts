import { Component, input, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import type { PaymentBilling } from './payment-step';

/** One line of the right rail's facts ("Milestone", "Milestone 2"). */
export interface PayFact {
  label: string;
  value: string;
}

/** What the right rail shows about what is being paid for. */
export interface PayRail {
  logo: string;
  title: string;
  /** "<unit> · <ZED ID>" under the title; hidden when empty. */
  sub: string | null;
  facts: PayFact[];
}

/**
 * 2026-11-17 (the user's apply-and-pay designs, as the certification apply flow): the disclaimer / instructions card of the
 * surveillance and handholding payment pages. The Admin's text is projected as it is; on the disclaimer an explicit consent tick
 * comes before Accept &amp; proceed, and the consent bar is pinned to the bottom on a laptop. On the right "You are paying for"
 * and "Key points at a glance".
 */
@Component({
  selector: 'zed-pay-disclaimer',
  imports: [FormsModule, RouterLink],
  host: { class: 'd-block' },
  template: `
    <div class="pd-cols">
      <section class="pd-card disclaimer-sec" aria-labelledby="pdTitle">
        <header class="pd-head">
          <span class="pd-ico" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3l7 3v5c0 4.5-3 8.3-7 10-4-1.7-7-5.5-7-10V6l7-3z" /><path d="M9 12l2 2 4-4" /></svg></span>
          <h3 id="pdTitle">{{ step() === 'disclaimer' ? 'Disclaimer / declaration' : 'Instructions' }}</h3>
        </header>
        <div class="pd-body"><ng-content /></div>
        <div class="pd-bar">
          @if (step() === 'disclaimer') {
            <label class="pd-consent">
              <input type="checkbox" name="consent" [ngModel]="consent()" (ngModelChange)="consent.set($event)" />
              <span>I have read and understood the disclaimer and accept it on behalf of {{ unitName() || 'my unit' }}.</span>
            </label>
          }
          <div class="pd-actions">
            <a class="btn pd-soft" [routerLink]="backLink()" [queryParams]="backQuery()">← {{ backLabel() }}</a>
            <button type="button" class="btn btn-primary pd-go" [disabled]="busy() || (step() === 'disclaimer' && !consent())" (click)="accept.emit()">Accept &amp; proceed →</button>
            <span class="pd-free">Nothing is charged at this step.</span>
          </div>
        </div>
      </section>

      <aside class="pd-rail">
        <section class="pd-card" aria-labelledby="pdPaying">
          <h3 class="pd-rh" id="pdPaying">You are paying for</h3>
          @let r = rail();
          <div class="pd-level">
            <img [src]="r.logo" alt="" />
            <div><b>{{ r.title }}</b>@if (r.sub) { <small>{{ r.sub }}</small> }</div>
          </div>
          <dl class="pd-facts">
            @for (f of r.facts; track f.label) { <div><dt>{{ f.label }}</dt><dd>{{ f.value }}</dd></div> }
          </dl>
        </section>
        <section class="pd-card" aria-labelledby="pdKey">
          <h3 class="pd-rh" id="pdKey">Key points at a glance</h3>
          <ul class="pd-keys">
            <li><span class="k-warn" aria-hidden="true">!</span>The fee is non-refundable, non-adjustable and non-transferable.</li>
            <li><span aria-hidden="true">★</span>The Joining Reward works once: once used, it cannot be used again.</li>
            <li><span aria-hidden="true">₹</span>Subsidy is already applied; you pay only the beneficiary contribution.</li>
            <li><span aria-hidden="true">◷</span>Late documents or responses can forfeit the amount paid.</li>
          </ul>
        </section>
      </aside>
    </div>
  `,
  styles: `
    .pd-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 420px); gap: 20px; align-items: start; }
    @media (max-width: 991.98px) { .pd-cols { grid-template-columns: minmax(0, 1fr); } }
    .pd-card { background: #fff; border: 1px solid #e3ecec; border-radius: 12px; box-shadow: 0 2px 8px rgba(16, 61, 64, .05); }
    .pd-head { display: flex; align-items: center; gap: 12px; padding: 14px 22px; border-bottom: 1px solid #e8eff0; }
    .pd-head h3 { margin: 0; font-size: 17px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .pd-ico { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #eef5f5; }
    .pd-ico svg { width: 18px; height: 18px; fill: none; stroke: var(--zt-dark, #1f5c61); stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .pd-body { padding: 18px 22px; color: #24393b; font-size: 14.5px; line-height: 1.6; overflow-wrap: anywhere; }
    .pd-bar { padding: 16px 22px; border-top: 1px solid #e8eff0; background: #fff; border-radius: 0 0 12px 12px; }
    @media (min-width: 992px) { .pd-bar { position: sticky; bottom: 0; z-index: 2; box-shadow: 0 -6px 14px rgba(16, 61, 64, .06); } }
    .pd-consent { display: flex; gap: 10px; align-items: flex-start; margin: 0 0 14px; font-weight: 500; color: #24393b; cursor: pointer; }
    .pd-consent input { width: 18px; height: 18px; margin-top: 2px; flex: none; accent-color: var(--zt-dark, #1f5c61); }
    .pd-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
    .pd-soft { background: #e8eff0; color: var(--zt-ink, #173f44); font-weight: 700; border-radius: 8px; padding: 10px 22px; }
    .pd-go { background: var(--zt-dark, #1f5c61); border-color: var(--zt-dark, #1f5c61); font-weight: 700; border-radius: 8px; padding: 10px 26px; }
    .pd-free { margin-left: auto; font-size: 13px; color: #5f6f70; }
    .pd-rail { display: grid; gap: 20px; }
    .pd-rh { margin: 0; padding: 14px 22px; border-bottom: 1px solid #e8eff0; font-size: 16px; font-weight: 700; color: var(--zt-ink, #173f44); }
    .pd-level { display: flex; align-items: center; gap: 14px; padding: 16px 22px 4px; }
    .pd-level img { width: 56px; height: 56px; object-fit: contain; }
    .pd-level b { display: block; font-size: 17px; color: var(--zt-ink, #173f44); }
    .pd-level small { color: #5f6f70; font-size: 13px; }
    .pd-facts { margin: 8px 22px 14px; }
    .pd-facts div { display: flex; justify-content: space-between; gap: 12px; padding: 8px 0; border-top: 1px solid #eef3f3; font-size: 13.5px; }
    .pd-facts dt { font-weight: 400; color: #5f6f70; }
    .pd-facts dd { margin: 0; text-align: right; font-weight: 600; color: #24393b; }
    .pd-keys { list-style: none; margin: 0; padding: 14px 22px; display: grid; gap: 12px; font-size: 13.5px; color: #24393b; }
    .pd-keys li { display: flex; gap: 12px; align-items: flex-start; }
    .pd-keys span { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #eef5f5; color: var(--zt-dark, #1f5c61); font-weight: 700; }
    .pd-keys .k-warn { background: #fdf3dc; color: #9a6700; }
  `,
})
export class PayDisclaimer {
  readonly step = input.required<'disclaimer' | 'instructions'>();
  readonly rail = input.required<PayRail>();
  readonly unitName = input<string | null>(null);
  /** A call is running (the instructions' Accept loads the fee summary). */
  readonly busy = input(false);
  readonly backLink = input<string | unknown[]>('/msme/dashboard');
  readonly backQuery = input<Record<string, unknown> | null>(null);
  readonly backLabel = input('Back to dashboard');
  readonly accept = output<void>();

  /** The explicit consent to the disclaimer. */
  protected readonly consent = signal(false);
}

/** The billing details card of the fee step and the "<unit> · <ZED ID>" line, from the unit's registration (api/msme/profile). */
export function billingOf(row: Record<string, string | number | null> | null | undefined): PaymentBilling | null {
  if (!row) return null;
  const t = (k: string) => String(row[k] ?? '').trim();
  const address = [t('PUnitName'), t('PAddress'), t('PDistrictName'), [t('PStateName'), t('PPin')].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  const b: PaymentBilling = { name: t('EnterpriseName') || null, address: address || null, zedId: t('ZedId') || null,
    unit: [t('EnterpriseName'), t('ZedId')].filter(Boolean).join(' · ') || null };
  return b.name || b.address || b.zedId ? b : null;
}
