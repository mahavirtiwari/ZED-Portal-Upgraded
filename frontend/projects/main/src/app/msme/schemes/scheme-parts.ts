import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { ContentTextComponent } from '../../content/content-text';
import { SchemeDocument, UnitPanel } from './schemes.api';

/** Unit summary on the left of the FA/TU pages (enterprise, Udyam number, ZED ID, unit, activity). */
@Component({
  selector: 'zed-scheme-unit-panel',
  template: `
    @let u = unit();
    <div class="card card-default panel-grey">
      <div class="card-body">
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
    </div>
    @if (full()) {
      <div class="card card-default panel-black"><div class="card-body">Selected Unit</div></div>
      <div class="unit-selection"><img src="/Images/svgicons/Icon-MSME.svg" alt="" /><p>{{ u['PUnitName'] }}</p></div>
      <div class="unit-selection">
        <img src="/Images/svgicons/mapicon.svg" alt="" />
        <p>{{ address() }}</p>
      </div>
      <div class="card card-default panel-black"><div class="card-body">Selected Activity</div></div>
      <div class="unit-selection"><img src="/Images/svgicons/Icon-2-Digit-Code.svg" alt="" /><p>{{ u['Activity'] }}</p></div>
      <div class="unit-selection"><img src="/Images/svgicons/Icon-4-Digit-Code.svg" alt="" /><p>{{ u['TwoDigitActivity'] }}</p></div>
      <div class="unit-selection"><img src="/Images/svgicons/Icon-5-Digit-Code.svg" alt="" /><p>{{ u['FourDigitActivity'] }}</p></div>
      <div class="unit-selection"><img src="/Images/svgicons/manufacturing.svg" alt="" /><p>{{ u['FiveDigitActivity'] }}</p></div>
    }
    @if (pledge() && u['PledgeOn']) {
      <!-- As FinancialAssistance/Details.cshtml: the pledge certificate under the unit. -->
      <div class="card card-default panel-black panel-msme-black"><div class="card-body">ZED Pledge Certificate</div></div>
      <div class="unit-selection">
        <div class="col-sm-12" style="padding: 0">
          <p>Pledge taken on {{ u['PledgeOn'] }}</p>
          <div class="btn-download"><a href="/api/msme/files/pledge-certificate" target="_blank" rel="noopener">DOWNLOAD</a></div>
        </div>
      </div>
    }
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
  template: `
    <div class="row justify-content-center">
      <div class="col-sm-9">
        <div class="card card-default panel-design">
          <div class="card-body disclaimer-sec">
            <div class="col-sm-12">
              @if (step() === 1) {
                <h3 class="registration-title">DISCLAIMER</h3>
                <zed-text key="msme.schemes.disclaimer" />
              } @else {
                <h3 class="registration-title">Instructions</h3>
                <zed-text key="msme.schemes.instructions" />
              }
              <div class="stepper-footer-sec initial-step1">
                <a routerLink="/msme/dashboard" class="btn btn-default">BACK TO DASHBOARD</a>
                <button type="button" class="btn btn-primary" (click)="accept.emit()">ACCEPT &amp; PROCEED</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  `,
})
export class SchemeIntro {
  readonly step = input.required<1 | 2>();
  readonly accept = output<void>();
}

/** One document field: the files attached so far (view / remove) and an upload button. */
@Component({
  selector: 'zed-scheme-document',
  template: `
    <div class="card card-default m-b-0">
      <div class="card-body">
        <label class="col-sm-12 p-l-0" [attr.for]="inputId()">{{ label() }} @if (required()) { <span style="color: red;">*</span> }</label>
        @for (d of documents(); track d.fileName) {
          <div class="d-flex justify-content-between align-items-center p-2 mb-1 scheme-doc" style="background: #F3F3F3;">
            <a [href]="d.url" target="_blank" rel="noopener" class="d-flex align-items-center gap-2">
              @if (d.isPdf) { <img src="/Images/svgicons/pdf-icon.svg" alt="PDF" /> } @else { <img [src]="d.url" alt="" class="img-tile" style="max-height: 60px;" /> }
              <span>{{ d.type }}</span>
            </a>
            @if (!readonly()) {
              <button type="button" class="btn btn-white" [attr.aria-label]="'Remove ' + label()" (click)="remove.emit(d.fileName)">
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
    </div>
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
