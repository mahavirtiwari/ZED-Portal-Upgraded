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
  // 2026-11-18 (the user's applicant designs, zed-msme-06): 56px card heads, the clauses numbered in 24px grey-teal circles
  // (13px text on 20px lines), the 42px buttons, the rail's 34px rows and the key points' 34px icon tiles.
  styles: `
    .pd-cols { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 420px); gap: 20px; align-items: start; }
    @media (max-width: 991.98px) { .pd-cols { grid-template-columns: minmax(0, 1fr); } }
    .pd-card { background: #fff; border: 1px solid #dde7e8; border-radius: 14px; box-shadow: 0 3px 10px rgba(23, 55, 59, .08); }
    .pd-head { display: flex; align-items: center; gap: 12px; min-height: 56px; padding: 12px 20px; border-bottom: 1px solid #dde7e8; }
    .pd-head h3 { margin: 0; font-size: 16px; font-weight: 700; color: #17373b; }
    .pd-ico { flex: none; width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; background: #e6f2f3; }
    .pd-ico svg { width: 16px; height: 16px; fill: none; stroke: #24666b; stroke-width: 2; stroke-linejoin: round; stroke-linecap: round; }
    .pd-body { padding: 22px 24px 24px; color: #3d5559; font-size: 13px; font-weight: 500; line-height: 20px; overflow-wrap: anywhere; }
    .pd-body ::ng-deep {
      p { margin: 0 0 14px; font-size: 13.5px; line-height: 21px; color: #17373b; }
      ol { list-style: none; counter-reset: pd-c; margin: 0; padding: 0 0 0; }
      ol + ol, ol + zed-text, zed-text + zed-text { margin-top: 10px; }
      ol[start='2'] { counter-reset: pd-c 1; } ol[start='3'] { counter-reset: pd-c 2; } ol[start='4'] { counter-reset: pd-c 3; }
      ol[start='5'] { counter-reset: pd-c 4; } ol[start='6'] { counter-reset: pd-c 5; } ol[start='7'] { counter-reset: pd-c 6; }
      ol[start='8'] { counter-reset: pd-c 7; } ol[start='9'] { counter-reset: pd-c 8; }
      ol > li { counter-increment: pd-c; position: relative; margin: 0 0 10px; padding-left: 40px; }
      ol > li::before { content: counter(pd-c); position: absolute; left: 2px; top: -2px; width: 24px; height: 24px; border-radius: 50%;
        display: grid; place-items: center; font-size: 11.5px; font-weight: 800; color: #24666b; background: #e6f2f3; }
    }
    .pd-bar { padding: 22px 24px 24px; border-top: 1px solid #dde7e8; background: #fff; border-radius: 0 0 14px 14px; }
    @media (min-width: 992px) { .pd-bar { position: sticky; bottom: 0; z-index: 2; box-shadow: 0 -6px 14px rgba(23, 55, 59, .08); } }
    .pd-consent { display: flex; gap: 12px; align-items: flex-start; margin: 0 0 22px; font-size: 13.5px; font-weight: 600; line-height: 20px; color: #17373b; cursor: pointer; }
    .pd-consent input { width: 20px; height: 20px; margin: 0; flex: none; accent-color: #24666b; }
    .pd-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; }
    .pd-soft, .pd-go { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 24px; font-size: 13.5px; font-weight: 700;
      border-radius: 9px; text-transform: none; }
    .pd-soft { min-width: 190px; background: #e7eeee; border: 0; color: #17373b; }
    .pd-soft:hover { background: #dbe5e5; color: #17373b; }
    .pd-go { min-width: 210px; background: #24666b; border-color: #24666b; color: #fff; }
    .pd-free { margin-left: auto; font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .pd-rail { display: grid; gap: 20px; }
    .pd-rh { margin: 0; min-height: 56px; padding: 17px 24px 12px; border-bottom: 1px solid #dde7e8; font-size: 16px; font-weight: 700; line-height: 1.6; color: #17373b; }
    .pd-level { display: flex; align-items: center; gap: 16px; padding: 18px 24px 16px; }
    .pd-level img { width: 60px; height: 60px; object-fit: contain; }
    .pd-level b { display: block; font-size: 17px; font-weight: 700; color: #17373b; }
    .pd-level small { display: block; margin-top: 2px; color: #6f8487; font-size: 12.5px; font-weight: 500; }
    .pd-facts { margin: 0 24px 16px; }
    .pd-facts div { display: flex; justify-content: space-between; align-items: center; gap: 12px; min-height: 34px; padding: 6px 0; border-top: 1px solid #dde7e8; }
    .pd-facts dt { font-size: 12.5px; font-weight: 500; color: #6f8487; }
    .pd-facts dd { margin: 0; text-align: right; font-size: 13px; font-weight: 600; color: #17373b; }
    .pd-facts div:first-child dd { font-weight: 700; }
    .pd-keys { list-style: none; margin: 0; padding: 16px 24px 20px; display: grid; gap: 18px; font-size: 12.5px; font-weight: 500; line-height: 18px; color: #17373b; }
    .pd-keys li { display: flex; gap: 14px; align-items: flex-start; }
    .pd-keys span { flex: none; width: 34px; height: 34px; border-radius: 9px; display: grid; place-items: center; background: #e6f2f3; color: #24666b; font-weight: 700; }
    .pd-keys .k-warn { background: #fdf2dc; color: #9a5f06; }
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
