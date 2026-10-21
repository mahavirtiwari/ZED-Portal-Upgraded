# ZEDCS_CONSULTANCY (handholding): analysis for the V4 port (phase 7)

Read-only analysis of `ZEDCS_CONSULTANCY` (web `SwatchSarvekshan`, mobile `SwachhSurvekshanServices`, DB ZED_CONSULTANT)
against the V4 port of main. Working files (per-method diffs `mdiff_web.txt`/`mdiff_mob.txt`, `cons_web_actions.txt`,
`proc_report.txt`, `v4_proc_report.txt`, `shape_report.txt`, `diffs\n_*.diff`, scripts incl. `showproc.sh`) were
produced in the session scratchpad.

## 0. Key decisions

1. **Staff-only portal.** `Home/Index` redirects to `User/Login`; `ZED_CONSULTANT.Users` holds only staff (separate
   accounts, no SSO). The MSME side of handholding is already on main and in V4 Main (apply, pay a milestone, accept a
   milestone, apply for Technology Upgradation), writing into ZED_CONSULTANT through cross-database procedures. **Do not
   port** the MSME web self-service (`Msme/*`), `Pay/*`, the MSME app (`Msme/*` mobile) or the remote app (`RA/*`) —
   check IIS logs for the mobile ones first.
2. **Retire 17 leftover controllers**: CitizenFeedback, Email, Helpdesk, Login, Otp, Pdf, QueryForm, SC, SelfAssessment,
   SelfCertification, Unit, WB, Webinar, Token, Verify, Incentive, Payment (`PayController`), plus ~80 Swachh actions
   inside Assessment, Dashboard, Home and User (procedures missing). Block them on the live site.
3. **Reuse with the host flag plus small switches**: staff sign-in and change password, sectors, questionnaire, my
   documents, page settings, milestone fee master, dashboard tiles, payments dashboards, registered MSME, reports, NEFT,
   agencies and assessors (renamed Consultant Organisations and Consultants/Experts), allot-to-agency.
4. **New consultancy code only where behaviour differs**: the handholding milestone workflow (CO allotment with BDS/HAP
   dates, several co-consultants and technical experts; milestone 1–3 lists; milestone review and edit page; consultant
   and CO final submit; milestone reports), the Technology Upgradation (TU) staff review plus technology recommendation,
   and the consultant app (`SA/*`: 9 new, 9 changed actions).
5. **Mobile**: a consultancy instance of the mobile host (path base `/Consultancymobileapi`), SA controller derived from
   `Zed.Main.MobileApi/Controllers/SAController.cs`.
6. **Fix the live site first**: C1–C7 undermine V4 Main too (e.g. anyone can set the handholding fee that V4 Main's
   payment reads from `ZED_CONSULTANT.AssessmentFee`).

## 1. Who uses this portal

### 1.1 Roles

| RoleId | Name | Consultancy meaning | What they do |
|---|---|---|---|
| 7 | MasterAdmin | QCI programme team | **Allot Consultancy** (`Assessment/Allot`: give a paid unit and milestone to a Consultant Organisation). Monitoring menu: Consultant Organisations (`User/AssessmentAgencies`), Consultants (`User/AssessorList`), Payment Received, Monitoring, Completed. **Technology Upgradation** (`FinancialAssistance/Submissions`). Also Failed Transactions, Registered MSME |
| 2 | Agency | Consultant Organisation (CO) | With SiteVerification: Completed, Allot Consultancy (`Assessment/SaAllotment`: accept, lead consultant, co-consultants, technical experts, BDS/HAP dates), Monitoring (review the consultant's milestone, final submit, send back, reject). Always: Consultants/Experts (`User/Assessors`), Reports. With FinancialVerification: Technology Upgradation |
| 3 | DesktopAssessor | Consultant or expert (`ZEDCC…` ids) | With SiteVerification: Milestone 1/2/3 lists (`Assessment/RemoteAssessments/{n}`), milestone page (`Assessment/SaDetails`), Completed; works mostly in the app. With FinancialVerification: **TU verifier ("DFO")**, web and app. Desktop-assessment menus commented out |
| 6 | StateCoordinator | State coordinator | NEFT New/Approved (TU reimbursement payouts), Reports |
| 10, 8 | SuperAdmin, Ministry | Oversight | Registered MSME, Reports; SuperAdmin also Failed Transactions |
| 1 | Admin | Masters | Upload Image, My Documents, Sectors, Payments (`Assessment/PaymentDetails`, milestone fee master), Questionnaire, Incentives (vestigial) |
| 5 | MSME | — | Menu exists but no MSME accounts are created for handholding units. Dead |

### 1.2 Workflow (status in `MsmeCertifications`; `NcCount` = milestone 1–3; `Certification` = Silver or Gold)
1. **On main** the MSME pays milestone n; `SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS` (main DB) opens it in
   ZED_CONSULTANT; for n > 1 it auto-allots to the previous CO.
2. **MasterAdmin** allots to a CO (`AllotCb`); mail "Allocation of MSME for Handholding Support (Milestone n)".
3. **The CO accepts** (`AcceptUnitForSa`, status 8): lead consultant, co-consultants (CSV), technical experts (CSV), BDS
   dates, HAP dates (milestone 1 only) → `AllotedCoAssessors`, `AllotedTechExperts`; mails to the MSME, the lead and each
   co-consultant. Rejection mails zed@qcin.org.
4. **The consultant works in the app**: login `SP_APP_SA_CHECK_LOGIN_V2` (consultant id, password, ZED ID; status 8/9);
   open meeting; ZED and "householding" training; selfie and site tour; Baseline Diagnostic, Handholding Action Plan,
   Technology Intervention and Progress Review with bullet lists per requirement; daily attendance with selfie; closing meeting.
5. **Web final submit**: `Remote/ConfirmFinalSubmit` checks TI/HAP/BDS bullets, estimated days and rationale;
   `Remote/FinalSubmit` moves the lead to 15; a co-consultant sets `AllotedCoAssessors.WebFinalSubmitStatus`.
6. **The CO reviews** on the same page, can edit entries (`UpdateColumnData`, `InsertBullet`, delete bullet): send back
   15 → 13; reject 99; final submit (`Monitoring/RaFinalSubmit`) 15 → 16, `SaCertificateNo='Milestone Completed'`; the
   milestone report is mailed (`_Report_PR1.pdf` for milestone 2, `_PR2` for milestone 3).
7. **On main** the MSME accepts (`SP_MONITORING_RA_APPLICANT_ACCEPTANCE`, 16 → 100) and can pay the next milestone.
8. **After milestone 3**: consultant or CO recommends technologies (`Technology/*`: writes `RecommandedTechnologies`,
   `TuStatus=1`, mails the unit); the MSME applies for TU on main (`SP_APP_MSME_INSERT_TECHNOLOGY_UPGRADATION` auto-allots
   a TU agency by `Users.TuPreferredState`); TU verification here (web and app); payouts via NEFT.

### 1.3 Links from main
- No SSO. Staff sign in at `/Consultancy/User/Login`. Certified MSMEs copied by `SP_MOVING_CERTIFIED_MSME_TO_CONSULTANCY`
  into `Msme`/`MsmeBasicInformation` without a Users row.
- MSME Certification Details links `https://loginzed.msme.gov.in/consultancy/SA/ReportSummary/{zedId}?certification=…&milestone=n`
  and `/consultancy/PDFs/SA/...`; V4 still links there (`msme/certification/certification-details.ts`).
- Milestone photos at `…/consultancymobileapi/SaPhotos/...` (already mapped by V4 `MsmeSitePhotosController.cs`).
- Mails link to `/Consultancy/User/Login`.

### 1.4 Hosting (names only)
- Web: IIS application `/Consultancy`; mobile `/Consultancymobileapi`; static `/consultancy/PDFs/SA/...`,
  `/Consultancy/Uploads/TechnologyUpgradation/...`, `/consultancy/Images/Certificates/...`.
- Web.config: connString, fromAddressContact, fromAddress, ccAddress, password, Host, BaseUrl, PaymentGateway, PayU*,
  CcAvenue* (Success/Fail URLs point to vendor test host zedcs.umon.in), Amount, SAAmount, apiToken, SmsProvider,
  checkFeedbackVersion, feedbackVersionNo, checkSAVersion, SAVersionNo. No reCAPTCHA on staff login.
- Mobile Web.config: connString, fromAddress, password, checkMsmeVersion, msmeVersionNo — **no checkSAVersion/SAVersionNo**,
  which `SA/Login` reads outside its try (null reference). Confirm production.

### 1.5 Apps calling the services
- **`SA/*` = consultant app** (probably the site-assessor app pointed at `/Consultancymobileapi`; ask the vendor).
  `SA/Login` takes userName, password, zedId. `SP_APP_SA_CHECK_LOGIN_V2` branches: consultant (SiteVerification →
  `SP_APP_SA_CONSULTANCY_CHECK_LOGIN`) and TU verifier/DFO (FinancialVerification, `TechUpgradeStatus` 4/5/10 →
  `SP_APP_TU_CHECK_LOGIN`).
- **The TU branch also posts to the web host**: `/Consultancy/FinancialAssistance/SubmitOpenMeeting` is a mobile contract
  (app request shape: `saId`, base64 `assessmentPhotos`, `startParticipants`).
- `Msme/*` and `RA/*` probably dead (need RoleId 5 rows; allotment forces Onsite).

## 2. Per controller (most big diffs are uncommented Swachh code or main's later additions)

### 2.1 Web
- **Assessment** (variant + new). Live: Allot, GetList, GetCb, AllotCb; SaAllotment, AcceptUnitForSa, RejectUnitForSa;
  RemoteAssessments/{1..3} + GetList; milestone page (SaDetails, GetSaDetails, GetDaDetails, GetDaDetailsByNc,
  ValidateEvidence, SaveTimestamp, ExemptedFromAssessment); Completed; PaymentDetails, GetAmounts, UpdateAmounts;
  GetAssessors. Dead: DaAllotment, DaVerification, NonConfirmances, SiteVerification, DA review, Rejected, Swachh actions.
  Differences: `GetList` adds `@MileStone`; `AcceptUnitForSa` takes `CoAssessors[]` (CSV, max 500), `TechnicalExperts[]`
  and four BDS/HAP dates instead of `AssessmentDate`, mode always Onsite; mails "Handholding Support (Milestone n)", cc
  every mail, one mail per co-consultant (with `CoAssessorPassword`, #35), plus a rejection mail; Completed uses
  `Monitoring/GetList` (`SP_MONITORING_GET_LIST_PAGINATION` absent); new `UpdateColumnData`, `InsertBullet`; filters lost
  on GetAmounts/UpdateAmounts/GetList (C1, C13); Rejected MasterAdmin only; no QC role.
- **Dashboard** (variant). Live: Index, GetCountsByFilter, PaymentReceived + GetPaymentTransactions, RegisteredMsme +
  GetRegisteredMsme, FailedTransactions, GetFailedTransactions, UpdatePaymentDetailsWithInfo, Resend. Home tiles read
  different columns of `SP_DASHBOARD_GET_DETAILS` (`Silver/GoldM1..M3PaymentDone`, `AssessmentAgencies`, `SiteAssessors`,
  TI = `Fa*`); payment and registered lists without paging (`@NoOfRecords` replaces `@PageSize`), milestone columns; no
  ERP push after manual payment update; FailedTransactions SuperAdmin+MasterAdmin; RegisteredMsme
  SuperAdmin+Ministry+MasterAdmin; no FinancialSupport page.
- **DynamicReports** (variant data): own catalogue of 33 procedures (milestone 1–3 completed/in progress, TU statuses,
  basic info parameters 01–09, CO and consultant lists); no date filter; no class filter (C6).
- **FinancialAssistance** = the TU staff review (variant + new). Live: Submissions, GetList, AllotCb,
  Accept/RejectUnitForVerification, Verification, GetDetails, ValidateEvidence, UpdateTechnology, SaveTimestamp,
  FinalSubmit, UpdateAccountDetails; `SubmitOpenMeeting` called by the DFO app. MSME side dead (its procedures missing
  here). Same procedure names but TU semantics (`TechUpgradeStatus`, eligible subsidy, technologies, `TotalPaidAfterQc`);
  `SP_FINANCIAL_ASSISTANCE_GET_DETAILS` returns different columns; evidence under
  `Uploads/TechnologyUpgradation/{zed}/{cert}/Screenshots`; mails "Onsite Verification: Financial Support for Zero
  Effect Solution" plus a mail to the MSME; new `UpdateTechnology`, `SubmitOpenMeeting`; StateCoordinator may open
  Verification; no class filter (C4).
- **Home** same minus captcha (Index → `User/Login`, PageSettings, Upload, SaveHomepageImage).
- **Monitoring** (variant). Live: Index, GetList, RaFinalSubmit, RejectFinalSubmit, SendBackToAssessor, UpdateRemarks,
  UpdateOfiComments, DownloadPdf, GenerateSaRepory. `GetList` has no `@NcClosingDate`; `RaFinalSubmit` completes the
  milestone without a certificate; reports PR1/PR2 via `GenerateSaRepory(…, ncCount)`, subject "Handholding Support
  (Milestone n) Report"; reject mail creates `_Reject_Report.pdf` and BCCs a vendor (C11); no regenerate/step-back; no
  class filter (C3). Dead: Details/GetDetails/UpdateMeetingComments (procs missing; button still on the page).
- **Msme (web)**: dead except staff `Profile/{zedId}`, `GetProfileDetails`, `GetDetails` ("View Profile") and `DisablePlant`.
- **MyDocuments** (Admin) same (lacks main's extension allow-list, C14). **Neft** same code, TU reimbursement rows.
  **Questionaire**, **Sector** same.
- **Remote** (variant): the milestone page calls UpdateConfirmance, ValidateEvidence, ValidateProduct,
  ValidateSiteExterior, SaveCapturedPhoto, UpdateComments, UpdateRemarks, ConfirmFinalSubmit, FinalSubmit.
  `ConfirmFinalSubmit` and `FinalSubmit` pass `@UserId`; the procedures branch lead vs co-consultant on it and run the
  milestone completeness checks. Index/Msme (video) dead.
- **SA (web)**: live `ReportSummary` (takes `int milestone`, passes `SP_REPORT_GET_DETAILS @NcCount`; linked from main),
  Summary1/2/3, PdfHeader/Footer; new `TuReportSummary` (C8). Hotel actions dead.
- **Technology**: a different controller from main's: consultant or CO "View Recommended Technologies" after milestone 3
  (`SP_TECHNOLOGIES_GET_LIST`, `SP_TECHNOLOGIES_INSERT_TECHNOLOGIES_FOR_UNIT`); no filters (C5).
- **User** (variant): Login, Logout, ChangePassword; COs (AssessmentAgencies, CertificationBodies); consultants/experts
  (AssessorList, GeAssessorList, Assessor, CreateUser); Assessors; Block/UnBlock; ResetMobileNo (#39).
  `SP_INSERT_USER`/`SP_UPDATE_USER` take `@TuPreferredState`, `@TuPreferredDistricts`, no `AssessorType`/`OrgPartnerId`;
  Block is an inline UPDATE plus a "blocked" mail; wording "Consultant Organisation…", "Consultant/Expert…"; no Bronze
  blocking, no org partners; no captcha.
- Dead: CitizenFeedback, Email, Helpdesk, Incentive (vestigial), Login, Otp (live SMS credentials, C12), Payment (block,
  C10), Pdf, QueryForm, SC, SelfAssessment, SelfCertification, Token, Unit, Verify (probably), WB, Webinar.

### 2.2 Mobile
- **SA** (variant + new) — consultant app. Login `SP_APP_SA_CHECK_LOGIN_V2` (StatusCode/ErrorMessage in row 0); adds
  milestone, BDS and HAP dates, unit address/district/state/pincode, requirement fields (`estimatedTimeInDays`,
  `technologyInterventionRationale`, `conformance`, `isProposedActivityCompleted`, `baselineRemarks`,
  `handholdingActionPlanRemarks`, `technologyInterventionRemarks`, `progressReview1Remarks`), bullet lists from table 9
  (`gapsIdentified`, `plannedActivities`, `suggestedTechnologyIntervention`); drops `allowFinalSubmit`, `isSurveillance`,
  `minimumParameters`; several co-consultants. Changed: messages drop the "MSME SA" prefix; `SubmitSelfie` saves only the
  DB row; **`SubmitParameter` is a no-op returning success**; `SubmitEvidences` uses `sectionName` in the path;
  `SubmitBasicInformation` calls `SP_APP_SA_CONSULTANCY_INSERT_BASIC_INFO`. New: `CheckParameterSyncStatus`, `SubmitPhotos`
  (multipart), `SubmitZedTrainingInfo`, `SubmitHouseholdingTrainingInfo` (`SP_APP_SA_CONSULTANCY_TRAINING_INFO`),
  `SubmitBaselineDiagnostic`, `SubmitHandholdingActionPlan`, `SubmitTechnologyIntervention`, `SubmitProgressReview`
  (`SP_APP_SA_SAVE_PARAMETER` with new TVP `@BulletList`, field mapping per type), `SubmitAttendance` (multipart selfie,
  `SP_APP_SA_INSERT_DAILY_ATTENDANCE`).
- **Msme** probably dead (older than main). **RA** probably dead (its login proc also returns the Twilio secret, #48). Home same.

## 3. Mapping to V4

**Reuse with switches** (add `[PortalSystems(Main, Consultancy)]`, branch on `PortalHost` / `PORTAL_SYSTEM`):
- Staff sign-in, change password (`Staff/StaffAuthController.cs`, `Account/*`; `staff/staff-login.ts`): flag only.
- Menu and home: the consultancy menu (1.1) and labels.
- Users (`Staff/Users/*`): **per-system parameter builder** (ZED_CONSULTANT's `SP_INSERT_USER`/`SP_UPDATE_USER` have no
  `AssessorType`/`OrgPartnerId` — V4 passes them and the call errors; consultancy adds `TuPreferredState`,
  `TuPreferredDistricts`); block/unblock procs missing → inline update or a new procedure; hide Bronze blocking and org
  partners; wording; "blocked" mail.
- Sector, Questionnaire, MyDocuments, PageSettings (`Staff/Masters/*`, `Staff/Questionnaire/*`): flag; hide categories
  and technologies (procs missing).
- Fee master (`Staff/Fees/*`): show and edit the MileStone column; Admin only, audited.
- Dashboard home (`Staff/Dashboard/StaffDashboardController.cs` `SummaryColumns`): consultancy columns and labels.
- Payment Received, Failed Transactions: milestone column; MasterAdmin may open failed transactions; **no ERP posting**
  (decide), consider leaving manual handholding payment updates on main.
- Registered MSME: pass `NoOfRecords` instead of `PageSize` (else SQL error); roles SuperAdmin+Ministry+MasterAdmin;
  hide Resend.
- Reports: per-system catalogue (33 procedures); 38 of main's 53 report procs are missing here.
- NEFT: TU columns; rows link to the TU verification page.
- Allot to CO (`Staff/Assessment/AssessmentAllotmentController.cs`, `allot.ts`): mail template and subject.
- Completed list (`AssessmentResultsController.cs`): use `SP_MONITORING_GET_LIST`; row actions milestone report and
  Recommended Technologies when `DisplayRecTech=1 && NcCount=3 && TuStatus=1`; hide Rejected.
- Monitoring list (`Staff/Monitoring/MonitoringController.cs`): do not pass `NcClosingDate` (else SQL error); hide
  step-back and send-back-to-agency (procs missing).
- Staff MSME profile: no V4 equivalent (V4 Main links the legacy page too): build a shared `Staff/MsmeProfile`, flagged
  for all systems.

**Consultancy-specific code reusing V4 helpers:**
- **CO allotment** (SaAllotment, AcceptUnitForSa, RejectUnitForSa): reuse `Staff/SiteAssessment/*` and `sa-allotment.ts`;
  add lead + several co-consultants + technical experts (all the CO's own users, lead not in the co list), four dates
  (HAP required for milestone 1), mode fixed Onsite, procedure parameters as 4.2, mails without passwords.
- **Milestone lists**: reuse `SiteAssessmentController.RemoteAssessments` / `remote-assessments.ts`; pass MileStone; a
  route per milestone.
- **Milestone review page** (Assessment/SaDetails + Remote/* + Monitoring Ra/Reject/SendBack/UpdateRemarks +
  UpdateColumnData + InsertBullet): reuse for reading `SiteReview/*` and `Msme/MsmeSiteAssessmentController.cs` (it already
  understands milestone types), for actions `Remote/RemoteAssessmentController.cs`, `Staff/Monitoring/MonitoringReviewController.cs`,
  `ReviewRules.cs`. New `Consultancy/Milestones/*` + `staff/consultancy/milestones/*`: sections trainings, BDS, HAP, TI,
  PR1/PR2, attendance, co-consultant submissions; **allow-listed edit endpoints** instead of `UpdateColumnData`
  (`MsmeRequirements`: BaselineRemarks, EstimatedTimeInDays, HActionPlanRemarks, Intervention, InterventionRemarks,
  ProgressReviewRemarks, ProgressReviewRemarks2; `MsmeRequirementBullets.BulletPoints` + soft delete; `TrainingInfo.Remarks`),
  each row checked against unit, milestone and user; consultant and co-consultant final submit with the procedure's
  checks; CO final submit only at 15 (→ 16 + report mail), send back 15 → 13, reject 99, state checked first (#84).
- **Milestone reports** (Monitoring/GenerateSaRepory, SA/ReportSummary, Summary1/2/3): reuse `Documents/*`; add
  `SP_REPORT_GET_DETAILS @NcCount`; file names `_Report`, `_Report_PR1`, `_Report_PR2`, `_Reject_Report`; no certificate;
  switch V4 Main's link in `msme/certification/certification-details.ts`, keep the legacy URL as a redirect.
- **Technology recommendation** (Technology/*): new `Consultancy/TechnologyRecommendation`, only the unit's consultant or
  CO after milestone 3.
- **TU staff review** (FinancialAssistance): sibling `Consultancy/TechnologyUpgradation` reusing
  `Staff/Schemes/FinancialAssistanceController.cs`, `FaVerificationController.cs`, `FaApplications.cs`, `SchemeCommon.cs`
  helpers and the `fa-submissions`/`fa-verification` pages; add `UpdateTechnology` (server-checked), the app-facing
  `POST /Consultancy/FinancialAssistance/SubmitOpenMeeting` (legacy JSON shape, allotted-DFO check, files confined), the
  TU report as an authorised PDF.
- **Consultant app** (`SA/*`): reuse `Zed.Main.MobileApi/Controllers/SAController.cs`, `Models/AssessorModels.cs`,
  `Zed.Core/Mobile/*`, `LoginThrottle`; V2 login mapping, 9 new actions, `SubmitParameter` no-op, `@BulletList` TVP,
  storage `SaPhotos/{zed}/{cert}/{section}` and `Attendance/...`; allotment check matching lead, co-consultant or expert
  by **exact id** (not LIKE, C9); TU branch requires the allotted DFO.

## 4. Procedures

- 304 referenced: 107 missing in ZED_CONSULTANT (102 leftovers missing in main too), 10 only in ZED_CONSULTANT, 187 in
  both (166 same parameters, 21 different; 97 identical bodies, 90 differ).
- Missing but called (non-leftover): `SP_MONITORING_UPDATE_MEETING_COMMENTS`, `SP_MONITORING_GET_DETAILS` (both DBs);
  `SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE`, `SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE`, `SP_MASTER_UPDATE_INCENTIVE`,
  `SP_SA_PAYMENT_UPDATE_RESPONSE`, `SP_API_INSERT_DYNAMIC_TOKEN` (main only); `SP_MSME_PAYMENT_VALIDATE`,
  `SP_MSME_NEFT_PAYMENT_DETAILS`, `SP_SA_GET_REG_DETAILS`, `SP_SA_GET_LIST`, `SP_SA_ALLOT_CB`, `SP_SA_ACCEPT_UNIT`,
  `SP_SA_AGENCIES_TO_ALLOT`, `SP_SA_CHECK_LOGIN`, `SP_SA_APP_INSERT_CLOSE_MEETING`, `SP_ASSESSMENT_RA_GET_NEW_PRODUCT`,
  `SP_INSERT_GANGA_TOWN_VIDEO_DETAILS`, `SP_DYNAMIC_REPORT` (both DBs).
- Only in ZED_CONSULTANT: `SP_APP_SA_CHECK_LOGIN_V2`, `SP_APP_SA_CONSULTANCY_INSERT_BASIC_INFO`,
  `SP_APP_SA_CONSULTANCY_TRAINING_INFO`, `SP_CONSULTANCY_INSERT_BULLETS`, `SP_CONSULTANCY_UPDATE_COLUMN_VALUE`,
  `SP_FINANCIAL_ASSISTANCE_SUBMIT_OPEN_MEETING`, `SP_FINANCIAL_ASSISTANCE_UPDATE_TECHNOLOGY_DATA`,
  `SP_REPORT_GET_TECHNOLOGY_UPGRADATION_DETAILS`, `SP_TECHNOLOGIES_GET_LIST`, `SP_TECHNOLOGIES_INSERT_TECHNOLOGIES_FOR_UNIT`
  (+ `SP_APP_SA_CONSULTANCY_CHECK_LOGIN`, `SP_APP_TU_CHECK_LOGIN` called from V2).

**Same name, different parameters:**

| Procedure | Consultancy only | Main only |
|---|---|---|
| `SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA` | BdsFromDate, BdsToDate, HapFromDate, HapToDate, TechnicalExperts | — |
| `SP_ASSESSMENT_ALLOT_LIST` | MileStone | — |
| `SP_ASSESSMENT_DA_DETAILS` | MileStone | FromSurveillance |
| `SP_ASSESSMENT_SA_DETAILS`, `SP_MSME_GET_DETAILS` | MileStone | — |
| `SP_REPORT_GET_DETAILS` | NcCount | — |
| `SP_ASSESSMENT_RA_FINAL_SUBMIT`, `SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT` | UserId | — |
| `SP_APP_SA_SAVE_PARAMETER` | BulletList (TVP) | — |
| `SP_DASHBOARD_REGISTERED_MSME` | NoOfRecords | PageSize |
| `SP_MONITORING_GET_LIST` | — | NcClosingDate |
| `SP_INSERT_USER`, `SP_UPDATE_USER` | TuPreferredState, TuPreferredDistricts | AssessorType, OrgPartnerId |
| `SP_APP_MSME_INSERT_BASIC_INFO`, `SP_APP_SA_INSERT_BASIC_INFO` | — | ManufacturingCapacity*, MonthlyUtilization* |
| `SP_MASTER_INSERT_INCENTIVE` | — | ActiveStatus, Email, MobileNo, VideoLink |
| `SP_API_GET_TOKEN` | — | ClientId |
| `SP_API_SUBMIT_INCENTIVE_DETAILS` | — | DisbursedAmount, DisbursedDate, IncentiveName |
| `SP_MSME_PAYMENT_GATEWAY_DETAILS` | — | ApiType |
| `SP_MSME_UPDATE_PROFILE` | — | Two/Four/FiveDigitActivity |
| `SP_MSME_VALIDATE_UDYAM_DETAILS` | — | EmailId |

**V4 calls against ZED_CONSULTANT:** 103 of 262 procedures V4 references are missing. By design on the main DB (keep on
Main host): ExternalApi, Msme/Handholding, Payments/Consultancy, Msme/Schemes. Others: Staff/Reports 38/53, Staff/Masters
7/18, Staff/Users 2/11 (block/unblock), Staff/Monitoring 2/14, Staff/Dashboard 2/11, Staff/Assessment 1/19
(`SP_MONITORING_GET_LIST_PAGINATION`), Documents 2/6 (regeneration). 0 missing: Remote, SiteAssessment, SiteReview, Fees,
Neft, Questionnaire, StaffAuth, Account. **Would fail with "is not a parameter"**: `SP_INSERT_USER`/`SP_UPDATE_USER`
(StaffAgencies, StaffAssessors), `SP_MONITORING_GET_LIST` (NcClosingDate), `SP_DASHBOARD_REGISTERED_MSME` (PageSize).
Result-set differences mostly extra main-only columns (tolerated by `Row.Text()`), plus consultancy columns V4's field
lists drop: MileStone* (fees, payments, registered MSME), BDS/HAP dates (`SP_EMAIL_GET_DETAILS`), NcCount
(`SP_RA_GET_CERTIFICATE_DETAILS`), TU columns (`SP_FINANCIAL_ASSISTANCE_GET_DETAILS`, `SP_NEFT_TRANSACTIONS_BY_STATUS`),
CO and consultant report columns. **Every reused endpoint needs a test against ZED_CONSULTANT, not just fakes.**

## 5. Security findings (C1–C15) — see SECURITY-FINDINGS.md

## Open questions for the client or vendor
Consultant app source and package id; IIS logs for `/Consultancymobileapi/Msme|RA/*`, `/Consultancy/Msme/*`, `/Verify/*`
and partner APIs; whether manual handholding payment updates and CONSULTANCY ERP postings belong here or on main;
production `checkSAVersion`.
