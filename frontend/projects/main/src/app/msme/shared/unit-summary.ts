import { Component, input } from '@angular/core';

type Row = Record<string, unknown>;

/**
 * The unit summary on the left of the MSME pages (dashboard, certification details, basic information / non-conformances,
 * site assessment, handholding), in the live portal's markup (Views/Msme/Dashboard.cshtml): the grey unit box, then the
 * black "Selected Unit", "Selected Activity" and "ZED Pledge Certificate" bars with their grey rows. Place it in a
 * col-lg-3 column next to the page's col-lg-9 (stacked above it below 992px, where a quarter of the width is too narrow).
 */
@Component({
  selector: 'zed-msme-unit-summary',
  host: { class: 'd-block' },
  template: `
    @let m = msme();
    <div class="panel panel-default panel-grey">
      <div class="panel-body">
        <div class="entp-type-sec">
          @switch (m['EnterpriseType']) {
            @case ('Micro') { <div class="entp-label micro">M</div> }
            @case ('Small') { <div class="entp-label small">S</div> }
            @case ('Medium') { <div class="entp-label medium">M</div> }
          }
          @if (showType()) {
            <p class="entp-type-title">{{ m['RegistrationType'] === 'UAM' ? m['EnterpriseTypee'] : m['EnterpriseType'] }}</p>
          }
          @if (m['OldEnterpriseType']) { <span class="old-type">(Old Type: {{ m['OldEnterpriseType'] }})</span> }
        </div>
        <div class="entrp-title"><h4>{{ m['EnterpriseName'] }}</h4></div>
        <div class="entp-details"><small>UDYAM Number</small><p>{{ udyam() }}</p></div>
        <div class="entp-details"><small>ZED ID</small><p>{{ m['ZedId'] }}</p></div>
      </div>
    </div>

    <div class="panel panel-default panel-black"><div class="panel-body">Selected Unit</div></div>
    <div class="unit-selection"><img src="/Images/svgicons/Icon-MSME.svg" alt="" /><p>{{ m['PUnitName'] }}</p></div>
    <div class="unit-selection">
      <img src="/Images/svgicons/mapicon.svg" alt="" />
      @if (showAddress()) { <p>{{ m['PAddress'] }}, {{ m['PDistrictName'] }}, {{ m['PStateName'] }}, {{ m['PPin'] }}</p> }
    </div>

    <div class="panel panel-default panel-black"><div class="panel-body">Selected Activity</div></div>
    <div class="unit-selection"><img src="/Images/svgicons/Icon-2-Digit-Code.svg" alt="" /><p>{{ m['Activity'] }}</p></div>
    <div class="unit-selection"><img src="/Images/svgicons/Icon-4-Digit-Code.svg" alt="" /><p>{{ m['TwoDigitActivity'] }}</p></div>
    <div class="unit-selection"><img src="/Images/svgicons/Icon-5-Digit-Code.svg" alt="" /><p>{{ m['FourDigitActivity'] }}</p></div>
    <div class="unit-selection"><img src="/Images/svgicons/manufacturing.svg" alt="" /><p>{{ m['FiveDigitActivity'] }}</p></div>

    <div class="panel panel-default panel-black"><div class="panel-body">{{ basicInfo() ? 'ZED Pledge' : 'ZED Pledge Certificate' }}</div></div>
    <div class="unit-selection">
      <div class="col-sm-12 p-0">
        <p>{{ basicInfo() ? 'Pledged on' : 'Pledge taken on' }} {{ m['PledgeOn'] }}</p>
        <div class="btn-download">
          <!-- V4: the certificate page (DOWNLOAD PDF there); the PDF is drawn when downloaded, never stored. -->
          <a href="/msme/pledge-certificate">{{ basicInfo() ? 'DOWNLOAD PLEDGE' : 'DOWNLOAD' }}</a>
        </div>
      </div>
    </div>
  `,
  styles: `
    .old-type { margin-left: 12px; color: #5f6f70; font-size: 0.8em; }
    .unit-selection p, .entp-details p, .entrp-title h4 { overflow-wrap: anywhere; }
  `,
})
export class MsmeUnitSummary {
  readonly msme = input.required<Row>();
  readonly udyam = input<unknown>('');
  /** The enterprise type next to its letter (the basic information page shows it only once the unit is loaded). */
  readonly showType = input(true);
  readonly showAddress = input(true);
  /** The basic information page's wording ("ZED Pledge", "Pledged on", "DOWNLOAD PLEDGE"). */
  readonly basicInfo = input(false);
}
