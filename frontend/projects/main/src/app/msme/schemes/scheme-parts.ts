import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContentTextComponent } from '../../content/content-text';
import { SchemeDocument, UnitPanel } from './schemes.api';

/** Unit summary on the left of the FA/TU pages (enterprise, Udyam number, ZED ID, unit, activity). */
@Component({
  selector: 'zed-scheme-unit-panel',
  styleUrl: '../shared/msme-page.scss',
  template: `
    @let u = unit();
    <aside class="dash-side">
      <div class="zed-card unit-card">
        <div class="entp-type-sec">
          @switch (u['EnterpriseType']) {
            @case ('Micro') { <div class="entp-label micro">M</div> }
            @case ('Small') { <div class="entp-label small">S</div> }
            @case ('Medium') { <div class="entp-label medium">M</div> }
          }
          <p class="entp-type-title">{{ u['RegistrationType'] === 'UAM' ? u['EnterpriseTypee'] : u['EnterpriseType'] }}</p>
        </div>
        <div class="entrp-title"><h4>{{ u['EnterpriseName'] }}</h4></div>
        <div class="entp-details"><small>UDYAM Number</small><p>{{ u['UdyogAadharNo'] }}</p></div>
        <div class="entp-details"><small>ZED ID</small><p>{{ u['ZedId'] }}</p></div>
      </div>
      @if (full()) {
        <div class="zed-card side-card">
          <h4>Selected Unit</h4>
          <div class="unit-selection"><img src="/Images/svgicons/Icon-MSME.svg" alt="" /><p>{{ u['PUnitName'] }}</p></div>
          <div class="unit-selection">
            <img src="/Images/svgicons/mapicon.svg" alt="" />
            <p>{{ address() }}</p>
          </div>
        </div>
        <div class="zed-card side-card">
          <h4>Selected Activity</h4>
          <div class="unit-selection"><img src="/Images/svgicons/Icon-2-Digit-Code.svg" alt="" /><p>{{ u['Activity'] }}</p></div>
          <div class="unit-selection"><img src="/Images/svgicons/Icon-4-Digit-Code.svg" alt="" /><p>{{ u['TwoDigitActivity'] }}</p></div>
          <div class="unit-selection"><img src="/Images/svgicons/Icon-5-Digit-Code.svg" alt="" /><p>{{ u['FourDigitActivity'] }}</p></div>
          <div class="unit-selection"><img src="/Images/svgicons/manufacturing.svg" alt="" /><p>{{ u['FiveDigitActivity'] }}</p></div>
        </div>
      }
      @if (pledge() && u['PledgeOn']) {
        <!-- As FinancialAssistance/Details.cshtml: the pledge certificate under the unit. -->
        <div class="zed-card side-card">
          <h4>ZED Pledge Certificate</h4>
          <p class="mb-0">Pledge taken on {{ u['PledgeOn'] }}</p>
          <div class="btn-download"><a href="/api/msme/files/pledge-certificate" target="_blank" rel="noopener">DOWNLOAD</a></div>
        </div>
      }
    </aside>
  `,
})
export class SchemeUnitPanel {
  readonly unit = input.required<UnitPanel>();
  readonly full = input(true);
  /** The "ZED Pledge Certificate" block (the old applications page only). */
  readonly pledge = input(false);

  protected address(): string {
    const u = this.unit();
    return ['PAddress', 'PDistrictName', 'PStateName', 'PPin'].map((k) => u[k]).filter((v) => v !== null && v !== undefined && v !== '').join(', ');
  }
}

/**
 * Disclaimer (step 1) and instructions (step 2), the same text on the FA and TU pages of the old portal (Admin → Texts).
 * `accept` moves to the next step; "Back to dashboard" leaves.
 */
@Component({
  selector: 'zed-scheme-intro',
  imports: [RouterLink, ContentTextComponent],
  styleUrl: '../shared/msme-page.scss',
  template: `
    <div class="step-page">
      <div class="page-head">
        <div>
          @if (step() === 1) {
            <h3 class="registration-title">DISCLAIMER</h3>
            <p class="page-sub">Read and accept the disclaimer to apply.</p>
          } @else {
            <h3 class="registration-title">Instructions</h3>
            <p class="page-sub">Read the instructions before you fill in the application.</p>
          }
        </div>
      </div>
      <div class="zed-card disclaimer-sec">
        @if (step() === 1) {
          <zed-text key="msme.schemes.disclaimer" />
        } @else {
          <zed-text key="msme.schemes.instructions" />
        }
        <div class="form-actions">
          <a routerLink="/msme/dashboard" class="btn btn-default">BACK TO DASHBOARD</a>
          <button type="button" class="btn btn-primary" (click)="accept.emit()">ACCEPT &amp; PROCEED</button>
        </div>
      </div>
    </div>
  `,
})
export class SchemeIntro {
  readonly step = input.required<1 | 2>();
  readonly accept = output<void>();
}

/**
 * One document field inside a form grid: the label in the left column; in the right one the files attached so far
 * (view / remove) and an upload button. The host takes no box of its own, so its label and field are grid cells.
 */
@Component({
  selector: 'zed-scheme-document',
  host: { class: 'scheme-document' },
  template: `
    <label [attr.for]="inputId()">{{ label() }} @if (required()) { <span class="req">*</span> }</label>
    <div>
      @for (d of documents(); track d.fileName) {
        <div class="scheme-doc">
          <a [href]="d.url" target="_blank" rel="noopener" class="d-flex align-items-center gap-2">
            @if (d.isPdf) { <img src="/Images/svgicons/pdf-icon.svg" alt="PDF" /> } @else { <img [src]="d.url" alt="" class="img-tile" /> }
            <span>{{ d.type }}</span>
          </a>
          @if (!readonly()) {
            <button type="button" class="btn btn-outline-danger btn-sm" [attr.aria-label]="'Remove ' + label()" (click)="remove.emit(d.fileName)">
              <img src="/Images/svgicons/close.svg" alt="" />
            </button>
          }
        </div>
      }
      @if (!readonly() && documents().length < max()) {
        <input type="file" class="form-control" [id]="inputId()" accept="image/*,application/pdf" [disabled]="busy()" (change)="onPick($event)" />
        <p class="text-grey mb-0"><small>PDF/Image, maximum size 5 MB</small></p>
      }
    </div>
  `,
  styles: `
    :host { display: contents; }
    label { font-weight: 600; color: #3b4b4c; font-size: 14px; margin: 0; align-self: start; padding-top: 9px; }
    .req { color: #d64550; margin-left: 2px; }
    .scheme-doc { display: flex; justify-content: space-between; align-items: center; gap: 8px; padding: 8px 10px; margin-bottom: 6px; background: #f7fafa; border: 1px solid #e8eff0; border-radius: 8px; }
    .scheme-doc a { color: #23474a; text-decoration: none; min-width: 0; word-break: break-word; }
    .img-tile { max-height: 60px; border-radius: 4px; }
    @media (max-width: 767.98px) { label { padding-top: 0; margin-top: 8px; } }
  `,
})
export class SchemeDocumentField {
  readonly label = input.required<string>();
  readonly inputId = input.required<string>();
  readonly documents = input<SchemeDocument[]>([]);
  readonly required = input(false);
  readonly readonly = input(false);
  readonly busy = input(false);
  readonly max = input(1);
  readonly pick = output<File>();
  readonly remove = output<string>();

  protected onPick(event: Event): void {
    const el = event.target as HTMLInputElement;
    const file = el.files?.[0];
    el.value = '';
    if (file) this.pick.emit(file);
  }
}
