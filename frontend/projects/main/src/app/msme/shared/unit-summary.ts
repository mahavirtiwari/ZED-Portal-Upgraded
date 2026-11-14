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
    @if (compact()) {
      <!-- 2026-11-14 (approved design): the unit as one compact card, for the right column of a page. -->
      <section class="us-card" aria-label="Your unit">
        <div class="us-head">
          @switch (m['EnterpriseType']) {
            @case ('Micro') { <span class="entp-label micro">M</span> }
            @case ('Small') { <span class="entp-label small">S</span> }
            @case ('Medium') { <span class="entp-label medium">M</span> }
          }
          <b>{{ m['EnterpriseName'] }}</b>
        </div>
        <dl>
          <div><dt>UDYAM</dt><dd>{{ udyam() }}</dd></div>
          <div><dt>ZED ID</dt><dd>{{ m['ZedId'] }}</dd></div>
          <!-- 2026-11-14: short (the user): the plant's name and its district and state only; no activity, no pledge. -->
          <div><dt>Plant</dt><dd>{{ m['PUnitName'] }}@if (showAddress() && (m['PDistrictName'] || m['PStateName'])) {<small>{{ shortPlace() }}</small>}</dd></div>
        </dl>
      </section>
    } @else {
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
    }
  `,
  styles: `
    .old-type { margin-left: 12px; color: #5f6f70; font-size: 0.8em; }
    .unit-selection p, .entp-details p, .entrp-title h4 { overflow-wrap: anywhere; }
    .us-card { background: #fff; border: 1px solid #dfe9ea; border-radius: 12px; padding: 14px 16px; margin-bottom: 16px; }
    .us-head { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
    .us-head .entp-label { flex: none; width: 36px; height: 36px; padding: 0; display: grid; place-items: center; line-height: 1; font-size: 17px; margin: 0; border-radius: 10px; }
    .us-head b { font-size: 15px; color: #23474a; overflow-wrap: anywhere; }
    .us-card dl { margin: 0; font-size: 13px; }
    .us-card dl > div { display: grid; grid-template-columns: 70px minmax(0, 1fr); gap: 8px; padding: 6px 0; border-top: 1px solid #eef3f3; }
    .us-card dt { color: #7a8a8b; font-weight: 600; font-size: 11.5px; letter-spacing: .03em; padding-top: 1px; }
    .us-card dd { margin: 0; color: #232527; font-weight: 600; overflow-wrap: anywhere; }
    .us-card dd small { display: block; font-weight: 400; color: #5f6f70; }
    .us-card dd a { margin-left: 6px; color: #2f7c83; font-weight: 700; }
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
  /** 2026-11-14: the compact card (the redesigned pages) in place of the live portal's side bar. */
  readonly compact = input(false);

  /** "EAST, DELHI": the plant's district and state (the compact card's short address). */
  protected shortPlace(): string {
    const m = this.msme();
    return [m['PDistrictName'], m['PStateName']].map((x) => String(x ?? '').trim()).filter((x) => x).join(', ');
  }
}
