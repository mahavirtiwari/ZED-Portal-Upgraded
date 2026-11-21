import { Component, computed, effect, inject, input, signal, untracked } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService, apiErrorMessage } from '@zed/shared';
import { firstValueFrom } from 'rxjs';
import { TextPipe, t } from '../../content/page-text';
import { StaffRole } from '../staff-menu';
import { ASSESSMENT_SYSTEM, STATES, milestoneReportUrl, num, reportPageHref, text, useLegacyPortal } from './assessment-shared';
import { PagerComponent, ServerPager } from '../pager';
import { AssessmentApi, ResultCounts, ResultsFilter, Row } from './assessment.api';
import { withApiBase } from '../../api-base';
import { HANDHOLDING_LEVEL_CODES, levelCodes, levelName } from '../../msme/shared/levels';
import { PageHead } from '../../msme/shared/page-head';
import { ListCount, ListCounts } from '../list-counts';
import { staffCrumbs } from '../staff-crumbs';
import { RowMenu, RowMenuItem } from '../row-menu';
import { ToastService } from '../toast';
import { AttentionService } from '../attention';
import { TableExport } from '../table-export';
import { AllotDialog, daysUntil, place, shortDate } from './allot';
import { LevelMedal } from './level-medal';
import { DashIcon } from '../../msme/dashboard/dash-icon';

/** Certificates and reports for staff (authorised downloads, same visibility as the DA review page). */
const DOCUMENTS_API = withApiBase('/api/staff/certification-documents');

/**
 * 2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-12's one search box ("Search ZED ID, Udyam number or unit
 * name"): what was typed decides the API's searchBy (a Udyam number starts UDYAM-, a ZED ID is letters then digits).
 */
export function searchKind(q: string): 'Zed Id' | 'Udyam Number' | 'Unit Name' {
  const v = q.trim();
  if (/^UDYAM[-\s]/i.test(v)) return 'Udyam Number';
  if (/^ZED/i.test(v) || /^[A-Za-z]{0,8}\d{4,}$/.test(v)) return 'Zed Id';
  return 'Unit Name';
}

/** Most rows one export reads (pages of 200 from the list's API). */
const EXPORT_LIMIT = 10_000;

/**
 * Completed and rejected certifications of the master admin, the agency or the assessor. Port of
 * Views/Assessment/Completed.cshtml and Rejected.cshtml (Assessment/GetCompletedList, paged on the
 * server). Certificates and reports download from this portal; profiles and site-assessment pages
 * open on the current portal.
 * <p>Consultancy ("Consultancy Completed"; no rejected list): one row per completed milestone, with the milestone
 * reports and "Recommended Technologies" after milestone 3. Surveillance ("Completed / Rejected Surveillance"):
 * Surveillance No; no phase, due-date, duplicates or pledge columns; Completed has a Gender filter and one search box that
 * searches any column as you type (on the server), Rejected only the Certification Level filter; the agency's "Assessment
 * Details" opens SaDetails from status 9.</p>
 * <p>2026-11-17 (approved staff-11 / staff-12): district and state instead of the address, the row's buttons in one row menu,
 * the surveillance due date flagged "in N days" within 90 days, Export (the rows the list's API returns for the filter), and
 * on the Rejected list the reason for rejection and, for the master admin, Re-allot on the row when the unit is back on the
 * Allot list (the allot pop-up and endpoint).</p>
 * <p>2026-11-18 (the user: staff pages 'not aligned with SVG files'): staff-11's four count cards (completed, certified this month,
 * surveillance due in 90 days, duplicates flagged) and staff-12's three (rejected, waiting to be re-allotted, re-allotted) from the
 * API's counts of the same filter; Rejected's own filter row (one search box and three drop-downs, no labels, no Search button);
 * no subtitle; the level as a medal, the mode a grey pill, short dates, "Dup." grey at 0 and red above; Refresh and Export with
 * their icons; 10 rows per page.</p>
 */
@Component({
  selector: 'zed-staff-assessment-results',
  imports: [FormsModule, RouterLink, PagerComponent, PageHead, ListCounts, RowMenu, AllotDialog, LevelMedal, DashIcon, TextPipe],
  host: { class: 'list-v2 d-block' },
  template: `
    <zed-page-head [crumbs]="crumbs()" [title]="heading()" [subtitle]="subtitle()">
      <button type="button" class="btn btn-ph rs-hb" (click)="search()"><zed-dash-icon name="refresh" [size]="16" />{{ 'Refresh' | t: 'staff.assessmentResults.refreshButton' }}</button>
      @if (completed()) {
        <button type="button" class="btn btn-outline-primary rs-hb" [disabled]="exporting() || !pager.total()" (click)="exportRows()">
          <zed-dash-icon name="download" [size]="16" />{{ exporting() ? ('Exporting…' | t: 'staff.assessmentResults.exportingButton') : ('Export' | t: 'staff.assessmentResults.exportButton') }}</button>
      }
    </zed-page-head>
    <zed-list-counts [counts]="counts()" />

    @if (error()) {
      <div class="alert alert-danger" role="alert">{{ error() }}</div>
    }

    <div class="zed-card rs-filters">
      @if (surveillance && !completed()) {
        <!-- Rejected Surveillance (that portal's Rejected.cshtml): only the level, Bronze/Silver/Gold. -->
        <div class="filter">
          <label class="form-label" for="resLevel">{{ 'Certification level' | t: 'staff.assessmentResults.filter.levelLabel' }}</label>
          <select class="form-select" id="resLevel" [(ngModel)]="level" (ngModelChange)="search()">
            @for (l of levels(); track l) { <option [value]="l">{{ levelName(l) }}</option> }
          </select>
        </div>
      } @else if (!completed()) {
        <!-- 2026-11-18: staff-12's row: one search box (left icon), All states / All levels / All sizes, no labels. -->
        <div class="filter rs-find">
          <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input type="search" id="resSearch" class="form-control" maxlength="50" [placeholder]="'Search ZED ID, Udyam no. or unit name' | t: 'staff.assessmentResults.search.placeholder'"
                 [attr.aria-label]="'Search ZED ID, Udyam no. or unit name' | t: 'staff.assessmentResults.search.placeholder'" [(ngModel)]="searchText" (ngModelChange)="typed()" (keyup.enter)="search()" />
        </div>
        <div class="filter">
          <select class="form-select" id="resState" [attr.aria-label]="'State' | t: 'staff.assessmentResults.filter.stateLabel'" [(ngModel)]="state" (ngModelChange)="search()">
            <option value="">{{ 'All states' | t: 'staff.assessmentResults.filter.allStates' }}</option>
            @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
          </select>
        </div>
        <div class="filter">
          <select class="form-select" id="resLevel" [attr.aria-label]="'Certification level' | t: 'staff.assessmentResults.filter.levelLabel'" [(ngModel)]="level" (ngModelChange)="search()">
            <option value="">{{ 'All levels' | t: 'staff.assessmentResults.filter.allLevels' }}</option>
            @for (l of levels(); track l) { <option [value]="l">{{ levelName(l) }}</option> }
          </select>
        </div>
        <div class="filter">
          <select class="form-select" id="resSize" [attr.aria-label]="'MSME size' | t: 'staff.assessmentResults.filter.sizeLabel'" [(ngModel)]="size" (ngModelChange)="search()">
            <option value="">{{ 'All sizes' | t: 'staff.assessmentResults.filter.allSizes' }}</option>
            <option value="Micro">{{ 'Micro' | t: 'staff.assessmentResults.filter.sizeMicro' }}</option>
            <option value="Small">{{ 'Small' | t: 'staff.assessmentResults.filter.sizeSmall' }}</option>
            <option value="Medium">{{ 'Medium' | t: 'staff.assessmentResults.filter.sizeMedium' }}</option>
          </select>
        </div>
      } @else {
        <div class="filter">
          <label class="form-label" for="resState">{{ 'State' | t: 'staff.assessmentResults.filter.stateLabel' }}</label>
          <select class="form-select" id="resState" [(ngModel)]="state" (ngModelChange)="search()">
            <option value="">{{ 'Show all' | t: 'staff.assessmentResults.filter.showAll' }}</option>
            @for (s of states; track s[0]) { <option [value]="s[0]">{{ s[1] }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="resLevel">{{ consultancy ? ('Desired certification' | t: 'staff.assessmentResults.filter.desiredLabel') : ('Certification level' | t: 'staff.assessmentResults.filter.levelLabel') }}</label>
          <select class="form-select" id="resLevel" [(ngModel)]="level" (ngModelChange)="search()">
            <option value="">{{ 'Show all' | t: 'staff.assessmentResults.filter.showAll' }}</option>
            @for (l of levels(); track l) { <option [value]="l">{{ levelName(l) }}</option> }
          </select>
        </div>
        <div class="filter">
          <label class="form-label" for="resSize">{{ 'MSME size' | t: 'staff.assessmentResults.filter.sizeLabel' }}</label>
          <select class="form-select" id="resSize" [(ngModel)]="size" (ngModelChange)="search()">
            <option value="">{{ 'Show all' | t: 'staff.assessmentResults.filter.showAll' }}</option>
            <option value="Micro">{{ 'Micro' | t: 'staff.assessmentResults.filter.sizeMicro' }}</option>
            <option value="Small">{{ 'Small' | t: 'staff.assessmentResults.filter.sizeSmall' }}</option>
            <option value="Medium">{{ 'Medium' | t: 'staff.assessmentResults.filter.sizeMedium' }}</option>
          </select>
        </div>
        @if (surveillance) {
          <!-- Completed Surveillance's Gender filter (the procedure's @Gender), with the old option values. -->
          <div class="filter">
            <label class="form-label" for="resGender">{{ 'Gender' | t: 'staff.assessmentResults.filter.genderLabel' }}</label>
            <select class="form-select" id="resGender" [(ngModel)]="gender" (ngModelChange)="search()">
              <option value="">{{ 'Show all' | t: 'staff.assessmentResults.filter.showAll' }}</option>
              @for (g of genders(); track g[0]) { <option [value]="g[0]">{{ g[1] }}</option> }
            </select>
          </div>
          <!-- Completed Surveillance: one search box that filters as you type (the old SearchText). -->
          <div class="filter wide">
            <label class="form-label" for="resSearch">{{ 'Search' | t: 'staff.assessmentResults.filter.searchLabel' }}</label>
            <input type="text" id="resSearch" class="form-control" [placeholder]="'Search' | t: 'staff.assessmentResults.filter.searchPlaceholder'" maxlength="50" [(ngModel)]="searchText" (ngModelChange)="search()" />
          </div>
        } @else {
          <div class="filter">
            <label class="form-label" for="resSearchBy">{{ 'Search by' | t: 'staff.assessmentResults.filter.searchByLabel' }}</label>
            <select class="form-select" id="resSearchBy" [(ngModel)]="searchBy">
              <option value="Zed Id">{{ 'ZED ID' | t: 'staff.assessmentResults.filter.byZedId' }}</option>
              <option value="Udyam Number">{{ 'Udyam number' | t: 'staff.assessmentResults.filter.byUdyam' }}</option>
              <option value="Unit Name">{{ 'Unit name' | t: 'staff.assessmentResults.filter.byUnitName' }}</option>
            </select>
          </div>
          <div class="filter wide">
            <label class="form-label" for="resSearch">{{ searchLabel() }}</label>
            <div class="rs-q">
              <input type="text" id="resSearch" class="form-control" maxlength="50" [placeholder]="searchHint()" [(ngModel)]="searchText" (keyup.enter)="search()" />
              <button type="button" class="btn btn-primary rs-hb" (click)="search()">
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>{{ 'Search' | t: 'staff.assessmentResults.searchButton' }}</button>
            </div>
          </div>
        }
      }
    </div>

    <div class="list-card">
    <div class="table-responsive">
      <table class="table table-zed">
        <thead>
          @if (consultancy) {
            <tr>
              <th>{{ 'Unit' | t: 'staff.assessmentResults.column.unit' }}</th>
              <th>{{ 'Level / Milestone' | t: 'staff.assessmentResults.column.levelMilestone' }}</th>
              @if (!isAgency()) { <th>{{ 'CO' | t: 'staff.assessmentResults.column.co' }}</th> }
              @if (!isAssessor()) { <th>{{ 'Consultants' | t: 'staff.assessmentResults.column.consultants' }}</th> }
              <th>{{ 'Allotted / Completed' | t: 'staff.assessmentResults.column.allottedCompleted' }}</th>
              <th class="text-end">{{ 'Actions' | t: 'staff.assessmentResults.column.actions' }}</th>
            </tr>
          } @else if (completed()) {
            <tr>
              <th>{{ 'Unit' | t: 'staff.assessmentResults.column.unit' }}</th>
              <th>{{ surveillance ? ('Level / Surveillance No' | t: 'staff.assessmentResults.column.levelSurveillance') : ('Level' | t: 'staff.assessmentResults.column.level') }}</th>
              @if (!surveillance) { <th>{{ 'Phase' | t: 'staff.assessmentResults.column.phase' }}</th> }
              <th>{{ 'Mode' | t: 'staff.assessmentResults.column.mode' }}</th>
              @if (!isAgency()) { <th>{{ 'Agency' | t: 'staff.assessmentResults.column.agency' }}</th> }
              @if (!isAssessor()) { <th>{{ 'Assessor' | t: 'staff.assessmentResults.column.assessor' }}</th> }
              @if (isAssessor()) {
                <th>{{ 'Assessment allocated on' | t: 'staff.assessmentResults.column.allocatedOn' }}</th>
                <th>{{ 'Assessment completed on' | t: 'staff.assessmentResults.column.assessmentCompletedOn' }}</th>
              } @else {
                <th>{{ 'Completed on' | t: 'staff.assessmentResults.column.completedOn' }}</th>
                @if (!surveillance) { <th>{{ 'Surveillance due' | t: 'staff.assessmentResults.column.surveillanceDue' }}</th> }
              }
              @if (!surveillance) { <th class="text-center" [title]="'Duplicates' | t: 'staff.assessmentResults.column.dupTooltip'">{{ 'Dup.' | t: 'staff.assessmentResults.column.dup' }}</th> }
              @if (!isAssessor()) { <th class="text-end">{{ 'Actions' | t: 'staff.assessmentResults.column.actions' }}</th> }
            </tr>
          } @else {
            <tr>
              <th>{{ 'Unit' | t: 'staff.assessmentResults.column.unit' }}</th>
              <th>{{ 'Level' | t: 'staff.assessmentResults.column.level' }}</th>
              @if (isMasterAdmin()) { <th>{{ 'Agency' | t: 'staff.assessmentResults.column.agency' }}</th> }
              <th>{{ 'Assessed on' | t: 'staff.assessmentResults.column.assessedOn' }}</th>
              <th>{{ 'Rejected on' | t: 'staff.assessmentResults.column.rejectedOn' }}</th>
              <th>{{ 'Reason for rejection' | t: 'staff.assessmentResults.column.reason' }}</th>
              <th class="text-end">{{ 'Action' | t: 'staff.assessmentResults.column.action' }}</th>
            </tr>
          }
        </thead>
        <tbody>
          @for (s of rows(); track $index) {
            @if (consultancy) {
              <tr [class.rs-rej]="!!col(s, 'ReasonForRejection')">
                <td class="unit-cell">
                  <b>{{ col(s, 'PUnitName') }}</b><span class="dash-text-clr rs-id">{{ col(s, 'ZedId') }}</span><small>{{ place(s) }}</small>
                  @if (col(s, 'ReasonForRejection')) { <span class="chip is-bad" [title]="col(s, 'ReasonForRejection')">{{ 'Rejected' | t: 'staff.assessmentResults.row.rejectedChip' }}</span> }
                </td>
                <td><zed-level-medal [level]="col(s, 'Certification')" /><small class="sub">{{ 'Milestone {milestone}' | t: 'staff.assessmentResults.row.milestoneText' : { milestone: col(s, 'NcCount') } }}</small></td>
                @if (!isAgency()) {
                  <td><b>{{ col(s, 'AgencyName') }}</b><small class="sub">{{ col(s, 'CertificationBodyUserId') }}</small></td>
                }
                @if (!isAssessor()) {
                  <td class="stack">
                    <div><small class="sub">{{ 'Lead consultant' | t: 'staff.assessmentResults.row.leadLabel' }}</small><b>{{ col(s, 'SiteAssessorName') }}</b><small class="sub">{{ col(s, 'SiteAssessorId') }}</small></div>
                    @if (col(s, 'CoAssessorName') || col(s, 'CoAssessorId')) {
                      <div><small class="sub">{{ 'CO consultant' | t: 'staff.assessmentResults.row.coLabel' }}</small><b>{{ col(s, 'CoAssessorName') }}</b><small class="sub">{{ col(s, 'CoAssessorId') }}</small></div>
                    }
                  </td>
                }
                <td class="stack text-nowrap"><div>{{ col(s, 'DocVerifiAllot') }}</div><div>{{ col(s, 'CertificationStatusDate') }}</div></td>
                <td class="text-end text-nowrap">
                  @if (recTech(s); as k) {
                    <a [routerLink]="['/staff/consultancy/technology', col(s, 'ZedId'), col(s, 'Certification')]" class="btn btn-sm rs-act"
                       [class.btn-primary]="k === 'recommend'" [class.btn-outline-primary]="k !== 'recommend'">{{ k === 'recommend' ? ('Recommend Technologies' | t: 'staff.assessmentResults.row.recommendLink') : ('View Recommended Technologies' | t: 'staff.assessmentResults.row.viewTechLink') }}</a>
                  }
                  @if (menu(s); as items) { @if (items.length) { <zed-row-menu [items]="items" [label]="'More actions for {id}' | t: 'staff.assessmentResults.row.menuAria' : { id: col(s, 'ZedId') }" (picked)="act(s, $event)" /> } }
                </td>
              </tr>
            } @else if (completed()) {
              <!-- As the old Completed list: a rejected unit's row marked (the reason on hover). -->
              <tr [class.rs-rej]="!!col(s, 'ReasonForRejection')">
                <td class="unit-cell">
                  <b>{{ col(s, 'PUnitName') }}</b><span class="dash-text-clr rs-id">{{ col(s, 'ZedId') }}</span><small>{{ place(s) }}</small>
                  @if (col(s, 'ReasonForRejection')) { <span class="chip is-bad" [title]="col(s, 'ReasonForRejection')">{{ 'Rejected' | t: 'staff.assessmentResults.row.rejectedChip' }}</span> }
                </td>
                <td>
                  <zed-level-medal [level]="col(s, 'Certification')" />
                  @if (surveillance) { <small class="sub">{{ col(s, 'SurveillanceNo') }}</small> }
                </td>
                @if (!surveillance) {
                  <td>@if (col(s, 'CertificationPhase'); as ph) { <span class="chip" [class.is-good]="ph === 'ACTIVE'" [class.is-bad]="badPhase(ph)">{{ ph }}</span> }</td>
                }
                <td><span class="chip">{{ mode(s) }}</span></td>
                @if (!isAgency()) {
                  <td class="rs-name"><b>{{ col(s, 'AgencyName') }}</b><small class="sub">{{ col(s, 'CertificationBodyUserId') }}</small></td>
                }
                @if (!isAssessor()) {
                  <td class="stack rs-name">
                    @for (p of assessors(s); track $index) { <div><b>{{ p.name }}</b><small class="sub">{{ p.id }}</small></div> }
                  </td>
                }
                @if (isAssessor()) {
                  <td class="stack">
                    <div>@if (col(s, 'DeskAssessment') === 'D') { {{ col(s, 'DocVerifiAllot') }} }</div>
                    <div>@if (col(s, 'SiteAssessment') === 'S') { {{ col(s, 'ScheduledOn') }} }</div>
                  </td>
                  <td class="stack">
                    <div>@if (col(s, 'DeskAssessment') === 'D') { {{ col(s, 'DesktopVerificationCompleted') }} }</div>
                    <div>@if (col(s, 'SiteAssessment') === 'S') { {{ col(s, 'CompletedOn') }} }</div>
                  </td>
                } @else {
                  <td class="text-nowrap">{{ shortDate(col(s, 'CertificationStatusDate')) || col(s, 'CertificationStatusDate') }}</td>
                  @if (!surveillance) {
                    <td class="text-nowrap">
                      @if (col(s, 'FirstSurveDueDate')) {
                        @if (col(s, 'Certification') !== 'Bronze') { <small class="sub">{{ 'Surveillance 1' | t: 'staff.assessmentResults.row.surveillance1Label' }}</small> }
                        {{ shortDate(col(s, 'FirstSurveDueDate')) || col(s, 'FirstSurveDueDate') }}
                        @if (dueFlag(s); as f) { <span class="chip" [class]="'chip ' + f.cls">{{ f.label }}</span> }
                      }
                    </td>
                  }
                }
                @if (!surveillance) {
                  <td class="text-center"><b class="rs-dupn" [class.rs-dup]="n(s, 'SameUdyamAddress') > 0">{{ col(s, 'SameUdyamAddress') || '0' }}</b></td>
                }
                @if (!isAssessor()) {
                  <td class="text-end"><zed-row-menu [items]="menu(s)" [label]="'More actions for {id}' | t: 'staff.assessmentResults.row.menuAria' : { id: col(s, 'ZedId') }" (picked)="act(s, $event)" /></td>
                }
              </tr>
            } @else {
              <!-- As the old Rejected list: an open NC (NcStatus 2, status 4 or 14) marked. -->
              <tr [class.rs-nc]="n(s, 'NcStatus') === 2 && (n(s, 'CertificationStatus') === 4 || n(s, 'CertificationStatus') === 14)">
                <td class="unit-cell"><b>{{ col(s, 'PUnitName') }}</b><span class="dash-text-clr rs-id">{{ col(s, 'ZedId') }}</span><small>{{ place(s) }}</small></td>
                <td><zed-level-medal [level]="col(s, 'Certification')" /></td>
                @if (isMasterAdmin()) { <td class="rs-name"><b>{{ col(s, 'AgencyName') }}</b><small class="sub">{{ col(s, 'CertificationBodyUserId') }}</small></td> }
                <td class="text-nowrap">{{ shortDate(col(s, 'SaAssessmentDate')) || col(s, 'SaAssessmentDate') }}</td>
                <td class="text-nowrap">{{ shortDate(col(s, 'CertificationStatusDate')) || col(s, 'CertificationStatusDate') }}</td>
                <td class="rs-reason">{{ col(s, 'ReasonForRejection') }}</td>
                <td class="text-end text-nowrap">
                  @if (reallotRow(s); as r) {
                    <button type="button" class="btn btn-primary btn-sm rs-act" (click)="reallot.set([r])">{{ 'Re-allot' | t: 'staff.assessmentResults.row.reallotButton' }}</button>
                  }
                  <zed-row-menu [items]="menu(s)" [label]="'More actions for {id}' | t: 'staff.assessmentResults.row.menuAria' : { id: col(s, 'ZedId') }" (picked)="act(s, $event)" />
                </td>
              </tr>
            }
          } @empty {
            <tr><td colspan="12" style="padding: 0"><div class="no-data">{{ loading() ? ('Loading…' | t: 'staff.assessmentResults.loading') : completed() ? ('No completed assessment matches these filters.' | t: 'staff.assessmentResults.completed.empty') : (anyFilter() ? ('No rejected certification matches these filters.' | t: 'staff.assessmentResults.rejected.empty') : ('No rejected certification yet.' | t: 'staff.assessmentResults.rejected.none')) }}</div></td></tr>
          }
        </tbody>
      </table>
    </div>

    <zed-pager [pager]="pager" [sizes]="sizes" />
    </div>

    @if (reallot(); as units) {
      <zed-allot-dialog [units]="units" (changed)="reallotted()" (closed)="reallot.set(null)" />
    }
  `,
  styles: `
    .rs-filters { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 12px; padding: 12px 14px; margin-bottom: 14px; }
    .rs-filters .filter { flex: 0 1 200px; min-width: 0; }
    .rs-filters .filter.wide { flex: 1 1 420px; max-width: 430px; }
    .rs-filters .form-label { font-size: 11.5px; font-weight: 600; color: #6f8487; margin-bottom: 4px; }
    /* 2026-11-21 (Assessment Agency UI audit, item 8): wide enough for the whole placeholder ("…or unit n" was cut). */
    .rs-filters .filter.rs-find { flex: 1 1 380px; min-width: 260px; max-width: 460px; position: relative; }
    .rs-find svg { position: absolute; left: 12px; top: 50%; transform: translateY(-50%); color: #6f8487; }
    .rs-find input { padding-left: 36px; background-image: none !important; }
    .rs-q { display: flex; gap: 12px; }
    .rs-q .btn { flex: none; min-width: 110px; }
    .rs-hb { display: inline-flex; align-items: center; justify-content: center; gap: 8px; }
    .rs-id { display: block; font-size: 11.5px; font-weight: 700; color: #24666b; }
    .rs-name b { font-size: 13.5px; font-weight: 700; color: #17373b; }
    .unit-cell { min-width: 200px; }
    .stack > div + div { margin-top: 6px; }
    .stack b { display: block; }
    td .chip { margin-top: 4px; }
    tr.rs-rej > td:first-child, tr.rs-nc > td:first-child { box-shadow: inset 3px 0 0 #d64532; }
    tr.rs-nc > td:first-child { box-shadow: inset 3px 0 0 #e0a100; }
    .rs-dupn { color: #6f8487; }
    .rs-dupn.rs-dup { color: #c8473c; }
    .rs-reason { min-width: 200px; max-width: 360px; white-space: pre-wrap; }
    .rs-act { margin-right: 6px; font-weight: 600; }
  `,
})
export class AssessmentResultsPage {
  /** Route data: which list. */
  readonly kind = input<'completed' | 'rejected'>('completed');

  private readonly api = inject(AssessmentApi);
  private readonly router = inject(Router);
  private readonly toast = inject(ToastService);
  private readonly attention = inject(AttentionService);
  private readonly exporter = inject(TableExport);
  private readonly user = inject(AuthService).currentUser;
  protected readonly legacy = useLegacyPortal();
  protected readonly states = STATES;
  protected readonly col = text;
  protected readonly n = num;
  protected readonly place = place;
  protected readonly shortDate = shortDate;
  private readonly system = inject(ASSESSMENT_SYSTEM);
  protected readonly consultancy = this.system === 'consultancy';
  protected readonly surveillance = this.system === 'surveillance';
  /** Consultancy: the handholding levels; else every level (Administration → Certification Levels, the Admin's too; 2026-11-08). */
  protected readonly levels = computed(() => (this.consultancy ? [...HANDHOLDING_LEVEL_CODES] : levelCodes()));
  protected readonly levelName = levelName;
  /** Consultancy rows open the milestone review page; the others the site assessment details page. */
  protected readonly milestoneDetailsRoute = this.system === 'consultancy' ? '/staff/consultancy/milestones' : '/staff/assessment/sa-details';

  protected state = '';
  protected level = '';
  protected size = '';
  /** Surveillance Completed only: value and label of the old Gender options, in their order. */
  protected readonly genders = computed(() => [['male', t('staff.assessmentResults.filter.genderMale', 'Male')], ['female', t('staff.assessmentResults.filter.genderFemale', 'Female')],
    ['Others', t('staff.assessmentResults.filter.genderOthers', 'Others')]] as const);
  protected gender = '';
  protected searchBy = 'Zed Id';
  protected searchText = '';

  protected readonly rows = signal<Row[]>([]);
  /**
   * Paged by the procedure, as the old pages: main 20 per page (up to 200), consultancy and surveillance 10 (up to 100).
   */
  // 2026-11-21 (UI audit C4): 10 / 20 / 50 / 100 on every portal, as the other staff lists (200 is no longer offered).
  protected readonly sizes = [10, 20, 50, 100];
  /** 2026-11-18: 10 per page everywhere, as the designs and the other lists. */
  protected readonly pager = new ServerPager(10, () => void this.load());
  /** The count cards' figures for the current filter (null until loaded or when the counts could not be read). */
  protected readonly countsRes = signal<ResultCounts | null>(null);
  private typing?: ReturnType<typeof setTimeout>;
  protected readonly loading = signal(false);
  protected readonly exporting = signal(false);
  protected readonly error = signal('');
  /** Master admin, Rejected: the units now on the Allot list (ZED ID|level → its allot row), offered Re-allot. */
  private readonly allotRows = signal<ReadonlyMap<string, Row>>(new Map());
  protected readonly reallot = signal<Row[] | null>(null);
  private request = 0;

  protected readonly completed = computed(() => this.kind() !== 'rejected');
  protected readonly heading = computed(() =>
    this.consultancy ? t('staff.assessmentResults.consultancy.title', 'Consultancy Completed')
    : this.surveillance ? (this.completed() ? t('staff.assessmentResults.surveillanceCompleted.title', 'Completed Surveillance')
      : t('staff.assessmentResults.surveillanceRejected.title', 'Rejected Surveillance'))
    : this.completed() ? t('staff.assessmentResults.completed.title', 'Assessment Completed') : t('staff.assessmentResults.rejected.title', 'Rejected Certification'));
  /** The export's file name (the standard heading, whatever wording the Admin gave the page). */
  private readonly fileName = computed(() =>
    this.consultancy ? 'consultancy-completed' : this.surveillance ? (this.completed() ? 'completed-surveillance' : 'rejected-surveillance')
    : this.completed() ? 'completed-assessment' : 'rejected-certification');
  protected readonly crumbs = computed(() => staffCrumbs({ label: this.heading() }));
  /** 2026-11-18: staff-11 / staff-12 have no subtitle (Consultancy keeps its line). */
  protected readonly subtitle = computed(() =>
    this.consultancy ? t('staff.assessmentResults.consultancy.sub', 'Milestones the consultants completed, with their reports and recommended technologies.') : null);
  /** The ZED ID box's example, as staff-11 ("e.g. ZEDM000005"). */
  protected searchHint(): string {
    return this.searchBy === 'Udyam Number' ? t('staff.assessmentResults.search.udyamPlaceholder', 'e.g. UDYAM-MH-01-0000001')
      : this.searchBy === 'Unit Name' ? t('staff.assessmentResults.search.unitNamePlaceholder', 'Unit name') : t('staff.assessmentResults.search.zedIdPlaceholder', 'e.g. ZEDM000005');
  }
  protected searchLabel(): string {
    return this.searchBy === 'Udyam Number' ? t('staff.assessmentResults.search.udyamLabel', 'Udyam number')
      : this.searchBy === 'Unit Name' ? t('staff.assessmentResults.search.unitNameLabel', 'Unit name') : t('staff.assessmentResults.search.zedIdLabel', 'ZED ID');
  }
  /** staff-11: completed, certified this month, surveillance due in 90 days, duplicates; staff-12: rejected, waiting, re-allotted. */
  protected readonly counts = computed<ListCount[]>(() => {
    const c = this.countsRes();
    const total = this.pager.total();
    if (this.completed()) {
      const list: ListCount[] = [{ label: t('staff.assessmentResults.count.completed', 'Completed'), value: total, tone: 'good' }];
      if (!this.consultancy && !this.surveillance) {
        list.push({ label: t('staff.assessmentResults.count.certifiedThisMonth', 'Certified this month'), value: c?.certifiedThisMonth ?? 0 },
          { label: t('staff.assessmentResults.count.surveillanceDue', 'Surveillance due in 90 days'), value: c?.surveillanceDue90 ?? 0, tone: 'warn' },
          { label: t('staff.assessmentResults.count.duplicates', 'Duplicates flagged'), value: c?.duplicates ?? 0, tone: 'bad' });
      }
      return list;
    }
    const list: ListCount[] = [{ label: t('staff.assessmentResults.count.rejected', 'Rejected'), value: total, tone: 'bad' }];
    if (c?.waitingReallot !== null && c?.waitingReallot !== undefined) {
      list.push({ label: t('staff.assessmentResults.count.waitingReallot', 'Waiting to be re-allotted'), value: c.waitingReallot, tone: 'warn' },
        { label: t('staff.assessmentResults.count.reallotted', 'Re-allotted'), value: c.reallotted ?? 0, tone: 'good' });
    }
    return list;
  });
  protected readonly isMasterAdmin = computed(() => this.user()?.roleId === StaffRole.MasterAdmin);
  protected readonly isAgency = computed(() => this.user()?.roleId === StaffRole.Agency);
  protected readonly isAssessor = computed(() => this.user()?.roleId === StaffRole.DesktopAssessor);

  constructor() {
    effect(() => {
      this.kind();
      untracked(() => {
        this.search();
        if (!this.completed() && !this.consultancy && this.isMasterAdmin()) void this.loadAllotRows();
      });
    });
  }

  protected search(): void {
    clearTimeout(this.typing);
    this.pager.reset();
    void this.load();
    void this.loadCounts();
  }

  /** Rejected's search box searches as you type (after a short pause), as the design has no Search button. */
  protected typed(): void {
    clearTimeout(this.typing);
    this.typing = setTimeout(() => this.search(), 400);
  }

  /** The count cards (main's lists; Consultancy and Surveillance show the total only). */
  private async loadCounts(): Promise<void> {
    if (this.consultancy || this.surveillance) return;
    const request = this.request;
    try {
      const c = await firstValueFrom(this.api.resultCounts(this.completed() ? 'completed' : 'rejected', this.filter(1, 10)));
      if (request === this.request) this.countsRes.set(c);
    } catch {
      // Without the counts the cards show the total and zeros; the list is unaffected.
      if (request === this.request) this.countsRes.set(null);
    }
  }

  /** Consultancy: the report of each milestone up to the row's (Milestone 1 Report, Progress Review 1, Progress Review 2). */
  protected milestones(s: Row): { n: number; label: string; href: string }[] {
    const labels = [t('staff.assessmentResults.menu.milestone1', 'MileStone 1 Report'), t('staff.assessmentResults.menu.review1', 'Progress Review 1'),
      t('staff.assessmentResults.menu.review2', 'Progress Review 2')];
    const upTo = Math.min(Math.max(num(s, 'NcCount'), 1), 3);
    return labels.slice(0, upTo).map((label, i) => ({ n: i + 1, label, href: milestoneReportUrl(text(s, 'ZedId'), text(s, 'Certification'), i + 1) }));
  }

  /**
   * Consultancy, after milestone 3 (as the old Completed page): master admin and CO view the recommended technologies
   * once recommended (TuStatus 1); the lead consultant recommends them (TuStatus 0) or views them, once the MSME accepted
   * the milestone (status 100) and before the TU application closed them (TuStatus 98+).
   */
  protected recTech(s: Row): 'recommend' | 'view' | '' {
    if (num(s, 'DisplayRecTech') !== 1 || num(s, 'NcCount') !== 3) return '';
    const tu = num(s, 'TuStatus');
    if (this.isAssessor()) return num(s, 'CertificationStatus') === 100 && tu < 98 ? (tu === 0 ? 'recommend' : 'view') : '';
    return tu === 1 ? 'view' : '';
  }

  /** V4: every MSME has its pledge certificate (drawn when opened): the page of the unit's ZED ID (not a rejected copy's). */
  protected pledgeUrl(s: Row): string {
    const zedId = text(s, 'ZedId').split('_')[0];
    return zedId ? `/staff/pledge-certificate/${encodeURIComponent(zedId)}` : '';
  }

  /** The server serves the stored certificate, or draws it when a certified record has none. */
  protected certificateUrl(s: Row): string {
    return `${DOCUMENTS_API}/${encodeURIComponent(text(s, 'ZedId'))}/${encodeURIComponent(text(s, 'Certification'))}/certificate`;
  }

  /** The report page (2026-11-15; the surveillance portal's is the surveillance report). */
  protected reportUrl(s: Row): string {
    return reportPageHref(this.surveillance ? 'surveillance' : 'assessment', text(s, 'ZedId'), text(s, 'Certification'));
  }

  protected mode(s: Row): string {
    const m = text(s, 'ModeOfAssessment');
    if (this.surveillance) return m;
    return m === 'Remote Assessment' ? t('staff.assessmentResults.mode.remoteLabel', 'Remote')
      : m === 'Onsite Assessment' ? t('staff.assessmentResults.mode.onsiteLabel', 'Onsite') : t('staff.assessmentResults.mode.desktopLabel', 'Desktop');
  }

  protected badPhase(phase: string): boolean {
    return ['REJECTED', 'SUSPENDED', 'WITHDRAWN', 'EXPIRED'].includes(phase.toUpperCase());
  }

  protected assessors(s: Row): { name: string; id: string }[] {
    return (['DesktopAssessor', 'SiteAssessor', 'CoAssessor'] as const)
      .map((p) => ({ name: text(s, p + 'Name'), id: text(s, p + 'Id') }))
      .filter((p) => p.name || p.id);
  }

  /** The surveillance due date within 90 days: "In N days" (or overdue). */
  protected dueFlag(s: Row): { label: string; cls: string } | null {
    const d = daysUntil(s['FirstSurveDueDate']);
    if (d === null || d > 90) return null;
    if (d < 0) return { label: d === -1 ? t('staff.assessmentResults.due.overdueDayLabel', 'Overdue {count} day', { count: -d })
      : t('staff.assessmentResults.due.overdueDaysLabel', 'Overdue {count} days', { count: -d }), cls: 'is-bad' };
    return { label: d === 0 ? t('staff.assessmentResults.due.todayLabel', 'Due today') : d === 1 ? t('staff.assessmentResults.due.inDayLabel', 'In {count} day', { count: d })
      : t('staff.assessmentResults.due.inDaysLabel', 'In {count} days', { count: d }), cls: 'is-warn' };
  }

  /** The row's actions, as its old buttons per page and role. */
  menu(s: Row): RowMenuItem[] {
    const items: RowMenuItem[] = [];
    const profile: RowMenuItem = { key: 'profile', label: t('staff.assessmentResults.menu.profile', 'View MSME profile'), icon: 'people' };
    const details: RowMenuItem = { key: 'details', label: t('staff.assessmentResults.menu.details', 'Assessment details'), icon: 'eye' };
    if (this.consultancy) {
      if (this.isAssessor()) return [];
      if (this.legacy.profile(text(s, 'ZedId'))) items.push(profile);
      items.push({ key: 'milestone', label: t('staff.assessmentResults.menu.milestoneDetails', 'View details'), icon: 'eye' });
      for (const m of this.milestones(s)) items.push({ key: 'report' + m.n, label: m.label, icon: 'download' });
      return items;
    }
    if (!this.completed()) {
      items.push(profile);
      if (this.isMasterAdmin()) items.push(details);
      return items;
    }
    if (this.isMasterAdmin()) {
      items.push(details, profile);
      if (!this.surveillance) items.push({ key: 'pledge', label: t('staff.assessmentResults.menu.pledge', 'Pledge certificate'), icon: 'award' });
      items.push({ key: 'certificate', label: t('staff.assessmentResults.menu.certificate', 'Download certificate'), icon: 'download' },
        { key: 'report', label: t('staff.assessmentResults.menu.report', 'View report'), icon: 'file' });
    } else if (this.isAgency()) {
      const cs = num(s, 'CertificationStatus');
      // Surveillance (that portal's Completed.cshtml): SaDetails from status 9; main from 15.
      if (cs < 9 || cs >= (this.surveillance ? 9 : 15)) items.push(details);
      items.push(profile);
    }
    return items;
  }

  /** Where a menu item goes (the old buttons' links). */
  href(s: Row, key: string): string {
    const zedId = text(s, 'ZedId');
    const cert = text(s, 'Certification');
    const cs = num(s, 'CertificationStatus');
    switch (key) {
      case 'profile': return '/' + this.legacy.profile(zedId);
      case 'milestone': return `${this.milestoneDetailsRoute}/${encodeURIComponent(zedId)}/${encodeURIComponent(cert)}`;
      case 'pledge': return this.pledgeUrl(s);
      case 'certificate': return this.certificateUrl(s);
      case 'report': return this.reportUrl(s);
      case 'details': {
        let page: string;
        if (!this.completed()) {
          // The rejected copy of the record (RejectedZedId), Bronze at the desktop, the others on site.
          return `/staff/assessment/${cert === 'Bronze' ? 'da-details' : 'sa-details'}/${encodeURIComponent(text(s, 'RejectedZedId') || zedId)}/${encodeURIComponent(cert)}`;
        }
        if (this.isMasterAdmin()) page = cs >= 9 ? 'sa-details' : 'da-details';
        else page = cs < 9 ? 'da-details' : 'sa-details';
        return `/staff/assessment/${page}/${encodeURIComponent(zedId)}/${encodeURIComponent(cert)}`;
      }
      default: {
        const m = /^report(\d)$/.exec(key);
        return m ? this.milestones(s)[Number(m[1]) - 1]?.href ?? '' : '';
      }
    }
  }

  protected act(s: Row, key: string): void {
    const href = this.href(s, key);
    if (!href) return;
    // Certificates and reports open in a new tab, as the old buttons did; the pages of this portal in place.
    if (['pledge', 'certificate', 'report'].includes(key) || key.startsWith('report')) window.open(href, '_blank', 'noopener');
    else void this.router.navigateByUrl(href);
  }

  /** Master admin, Rejected: the unit's row on the Allot list (re-allotted there with the same checks), if it is on it. */
  protected reallotRow(s: Row): Row | null {
    if (!this.isMasterAdmin() || this.consultancy) return null;
    return this.allotRows().get(`${text(s, 'ZedId').split('_')[0]}|${text(s, 'Certification')}`.toUpperCase()) ?? null;
  }

  private async loadAllotRows(): Promise<void> {
    try {
      const res = await firstValueFrom(this.api.allotList({}));
      this.allotRows.set(new Map((res.rows ?? []).map((r) => [`${text(r, 'ZedId')}|${text(r, 'Certification')}`.toUpperCase(), r])));
    } catch {
      // Without the Allot list no Re-allot is offered here; the Allot page still has it.
      this.allotRows.set(new Map());
    }
  }

  protected reallotted(): void {
    void this.attention.refresh().catch(() => undefined);
    void this.loadAllotRows();
  }

  /** 2026-11-21 (UI audit C4): some filter is set (else the empty list says there is none yet). */
  protected anyFilter(): boolean {
    return !!(this.state || this.level || this.size || this.gender || this.searchText.trim());
  }

  private filter(pageNo: number, pageSize: number): ResultsFilter & { gender?: string } {
    const by = !this.completed() && !this.surveillance ? searchKind(this.searchText) : this.searchBy;
    const filter: ResultsFilter & { gender?: string } = {
      state: this.state,
      certification: this.level,
      size: this.size,
      searchBy: this.searchText.trim() ? by : '',
      search: this.searchText.trim(),
      pageNo,
      pageSize,
    };
    // Sent as a query parameter like the others (empty values are left out).
    if (this.surveillance && this.completed()) filter.gender = this.gender;
    return filter;
  }

  private async load(): Promise<void> {
    const request = ++this.request;
    this.loading.set(true);
    this.error.set('');
    try {
      const res = await firstValueFrom(this.api.results(this.completed() ? 'completed' : 'rejected', this.filter(this.pager.pageNo(), this.pager.pageSize())));
      if (request !== this.request) return;
      this.rows.set(res.rows);
      this.pager.total.set(res.totalCount);
    } catch (err) {
      if (request === this.request) this.error.set(apiErrorMessage(err));
    } finally {
      if (request === this.request) this.loading.set(false);
    }
  }

  /** Export (approved): every row the list's API returns for the current filter, read 200 at a time (at most 10,000). */
  protected async exportRows(): Promise<void> {
    this.exporting.set(true);
    try {
      const all: Row[] = [];
      let total = Infinity;
      for (let page = 1; all.length < total && all.length < EXPORT_LIMIT; page++) {
        const res = await firstValueFrom(this.api.results('completed', this.filter(page, 200)));
        total = res.totalCount;
        if (!res.rows.length) break;
        all.push(...res.rows);
      }
      const rows = all.slice(0, EXPORT_LIMIT);
      await this.exporter.xlsx(this.fileName(), [this.sheet(rows)]);
      this.toast.success(t('staff.assessmentResults.toast.exportReady', 'Export ready'), total > rows.length
        ? t('staff.assessmentResults.toast.exportFirst', 'The first {count} of {total} rows.', { count: rows.length, total })
        : t('staff.assessmentResults.toast.exportRows', '{count} rows.', { count: rows.length }));
    } catch (err) {
      this.toast.error(t('staff.assessmentResults.toast.exportFailed', 'The export failed'), apiErrorMessage(err));
    } finally {
      this.exporting.set(false);
    }
  }

  private sheet(rows: Row[]) {
    const col = text;
    if (this.consultancy) {
      return {
        name: 'Completed',
        columns: [t('staff.assessmentResults.export.column.zedId', 'ZED ID'), t('staff.assessmentResults.export.column.unit', 'Unit'), t('staff.assessmentResults.export.column.place', 'District / State'), t('staff.assessmentResults.export.column.level', 'Level'),
          t('staff.assessmentResults.export.column.milestone', 'Milestone'), t('staff.assessmentResults.export.column.co', 'CO'), t('staff.assessmentResults.export.column.coId', 'CO ID'), t('staff.assessmentResults.export.column.leadConsultant', 'Lead consultant'),
          t('staff.assessmentResults.export.column.coConsultant', 'CO consultant'), t('staff.assessmentResults.export.column.allottedOn', 'Allotted on'), t('staff.assessmentResults.export.column.completedOn', 'Completed on')],
        rows: rows.map((s) => [col(s, 'ZedId'), col(s, 'PUnitName'), place(s), col(s, 'Certification'), col(s, 'NcCount'), col(s, 'AgencyName'), col(s, 'CertificationBodyUserId'),
          col(s, 'SiteAssessorName'), col(s, 'CoAssessorName'), col(s, 'DocVerifiAllot'), col(s, 'CertificationStatusDate')]),
      };
    }
    const main = !this.surveillance;
    return {
      name: 'Completed',
      columns: [t('staff.assessmentResults.export.column.zedId', 'ZED ID'), t('staff.assessmentResults.export.column.unit', 'Unit'), t('staff.assessmentResults.export.column.place', 'District / State'), t('staff.assessmentResults.export.column.level', 'Level'),
        main ? t('staff.assessmentResults.export.column.phase', 'Phase') : t('staff.assessmentResults.export.column.surveillanceNo', 'Surveillance No'), t('staff.assessmentResults.export.column.mode', 'Mode'), t('staff.assessmentResults.export.column.agency', 'Agency'),
        t('staff.assessmentResults.export.column.agencyId', 'Agency ID'), t('staff.assessmentResults.export.column.desktopAssessor', 'Desktop assessor'), t('staff.assessmentResults.export.column.siteAssessor', 'Site assessor'), t('staff.assessmentResults.export.column.coAssessor', 'Co-assessor'),
        t('staff.assessmentResults.export.column.allottedOn', 'Allotted on'), t('staff.assessmentResults.export.column.assessmentDate', 'Assessment date'), t('staff.assessmentResults.export.column.completedOn', 'Completed on'),
        ...(main ? [t('staff.assessmentResults.export.column.surveillanceDue', 'Surveillance due'), t('staff.assessmentResults.export.column.duplicates', 'Duplicates')] : []), t('staff.assessmentResults.export.column.reason', 'Reason for rejection')],
      rows: rows.map((s) => [col(s, 'ZedId'), col(s, 'PUnitName'), place(s), col(s, 'Certification'), main ? col(s, 'CertificationPhase') : col(s, 'SurveillanceNo'), this.mode(s),
        col(s, 'AgencyName'), col(s, 'CertificationBodyUserId'), col(s, 'DesktopAssessorName'), col(s, 'SiteAssessorName'), col(s, 'CoAssessorName'), col(s, 'DocVerifiAllot'),
        col(s, 'SaAssessmentDate'), col(s, 'CertificationStatusDate'), ...(main ? [col(s, 'FirstSurveDueDate'), col(s, 'SameUdyamAddress')] : []), col(s, 'ReasonForRejection')]),
    };
  }
}
