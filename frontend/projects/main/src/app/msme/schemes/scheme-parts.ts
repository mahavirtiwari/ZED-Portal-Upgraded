import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
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
 * Disclaimer (step 1) and instructions (step 2), the same text on the FA and TU pages of the old portal.
 * `accept` moves to the next step; "Back to dashboard" leaves.
 */
@Component({
  selector: 'zed-scheme-intro',
  imports: [RouterLink],
  template: `
    <div class="row justify-content-center">
      <div class="col-sm-9">
        <div class="card card-default panel-design">
          <div class="card-body disclaimer-sec">
            <div class="col-sm-12">
              @if (step() === 1) {
                <h3 class="registration-title">DISCLAIMER</h3>
                <p><i>Please read and review carefully before proceeding</i></p>
                <ol>
                  <li>The benefits/incentives available to a ZED Certified MSME Unit are non-transferrable.</li>
                  <li>The Financial Assistance can be applied/claimed only for the Unit which has been ZED Certified and not for any other Unit of the applicant MSME which may not be ZED Certified.</li>
                  <li>The Financial Assistance can be applied/claimed only for the activities being conducted at the MSME unit and for the existing product line only, as exhibited during the ZED Certification process.</li>
                  <li>This Financial Assistance is at the discretion of Ministry of MSME and cannot be claimed as a right by any ZED Certified MSME.</li>
                  <li>
                    The subsidy on the cost of Certification for any Testing, Management System or Product Certification will be subject to the following conditions:
                    <ol type="a">
                      <li>The product testing must be through a Laboratory that is accredited by the National Accreditation Board for Testing &amp; Calibration Laboratories (NABL)</li>
                      <li>The Management System Certification must be through a Certification Body that is accredited by the National Accreditation Board for Certification Bodies (NABCB)</li>
                      <li>The Product Certification must be through Bureau of Indian Standards (BIS)</li>
                    </ol>
                  </li>
                  <li>The subsidy will be 75% of the total cost of Testing/System/Product Certification, with the maximum ceiling of subsidy being Rs. 50,000/-. The subsidy will be on the amount which is exclusive of any applicable taxes.</li>
                  <li>The date of product/systems/testing Certification, for which the financial assistance is being claimed, must be after the date of ZED Certification. Claim for Certifications which have been procured earlier from the date of ZED Certification will not be entertained.</li>
                  <li>The Financial Assistance cannot be claimed retrospectively for ZED Certifications achieved earlier. For example, an MSME which did not claim Financial Assistance for Bronze, achieves Silver and then applies for Financial Assistance: in this case the Financial Assistance can only be claimed for Silver and not for Bronze retrospectively.</li>
                  <li>The subsidy will be applicable on only one Testing OR one Quality OR one Product Certification after achieving this Level. The applicant MSME cannot club two or more certifications in the given subsidy/cost.</li>
                  <li>The Certification pertaining to Testing, Management Systems or Product, obtained through a Government Agency/Organisation will also be eligible for the said Financial Assistance.</li>
                  <li>Any application which is incomplete in any respect will be summarily rejected.</li>
                  <li>Information and documents submitted are subject to scrutiny and relevant validation.</li>
                  <li>Mere submission of application for this activity does not warrant award of any financial support.</li>
                  <li>If at any stage it is found that the documents submitted have been obtained fraudulently, the Ministry of MSME reserves the right to withdraw or recall its decision and seek refund of financial support provided. The Ministry will also be within its rights to initiate legal proceedings for any such cases.</li>
                </ol>
              } @else {
                <h3 class="registration-title">Instructions</h3>
                <ol>
                  <li>After agreeing to the disclaimer and reading these instructions, the applicant will follow the directions given hereon and submit relevant information and documents as asked.</li>
                  <li>
                    Please keep the scanned images/PDF of the following ready:
                    <ol type="a">
                      <li>Testing, Systems or Product Certification, for which financial assistance is being applied for.</li>
                      <li>Invoice/Bill of the Assessment Agency or Authority through which the Testing, Systems or Product Certification is processed.</li>
                      <li>Certificate from the Chartered Accountant (CA) regarding payment of amount to the said Agency/Authority by the MSME. To know the details of information and documents needed to proceed, please see the “My Document” Section in your dashboard.</li>
                    </ol>
                  </li>
                  <li>Relevant document(s) must be uploaded for verification, as and when asked, failing which the application for Financial Assistance will be rejected.</li>
                  <li>Ensure to input correct dates, amount, invoice numbers and other details, as and when asked, else the application for Financial Assistance will be rejected if the information is not matched with the uploaded document(s).</li>
                  <li>In case your application is rejected, you will be given another opportunity to apply for Financial Assistance for Testing, Quality or Product Certification. The same can be applied through your dashboard.</li>
                  <li>You shall be notified in due course of time regarding the outcome of your application.</li>
                </ol>
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
