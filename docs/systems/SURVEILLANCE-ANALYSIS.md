# ZEDCS_SURVEILLANCE: analysis for the V4 port (phase 8)

Read-only analysis of `ZEDCS_SURVEILLANCE` (web `SurveillanceWeb`, mobile `SurveillanceServices`, DB ZED_SURVEILLANCE)
against the V4 port of main. Supporting data (procedure lists, signatures, body hashes, normalised diffs, view→action
maps, `v4_feature_missing.txt`) was produced in the session scratchpad `surv\` folder.

## 0. Key facts and decisions

1. **The surveillance code is an older fork of main.** Most large line diffs are main's later changes (pagination, QC
   role, ERP posting, partner APIs, sign-in filters, parameterised SQL) or Swachh Survekshan / Saathi code still live
   here but commented out in main. Real differences are in the stored procedures: status buckets, the `_S_` archive
   suffix for the 2nd surveillance, `SurveillanceNo`, `MeetingLink`, and writes back into ZEDCS_V2_LIVE (main
   certificate number and QR re-used, main certificate set ACTIVE or WITHDRAWN, re-certification enabled) and into
   ZED_CONSULTANT.
2. **Procedures.** The code calls 324; 215 exist in ZED_SURVEILLANCE. Of 206 in both DBs: 119 identical, 80 body-only
   differences, 7 different parameters. Of 254 procedures V4 calls: 79 identical, 91 body-only, 6 parameter
   differences, ~70 missing here.
3. **The MSME side of this portal is effectively unused.** MSMEs pay surveillance on main (main's `SP_SURVEILLANCE_MSME_*`
   wrappers call ZED_SURVEILLANCE), download surveillance certificates through main (`Surveillance/Certificates/...`),
   and open surveillance reports from main's Certification details link to the public `/surveillance/SA/ReportSummary/{ZedId}`.
   No live procedure creates RoleId 5 rows in `ZED_SURVEILLANCE.Users`.
4. **`SurveillancePay` and `ConsultancyPay` here are duplicates — do not port.** SurveillancePay calls 5
   `SP_SURVEILLANCE_MSME_*` procedures that exist only in main (broken here); main V4 phase 3b serves it. ConsultancyPay
   and Pay/Payment only have result pages. CCAvenue here is in TEST mode with vendor test-host return URLs.

## 1. Who uses this portal

### 1.1 Roles and live menus (`UserRoleEnum` = main's)

| Role | Live menu | What they do |
|---|---|---|
| MasterAdmin (7) | Allot Surveillance; Bronze Surveillance Agencies; Surveillance Payment Received; Surveillance Monitoring; Completed / Rejected | Allots units, watches the pipeline, edits agencies' preferred state/districts, blocks/unblocks agencies |
| Agency (2) | Monitoring, Completed, Assessors, Allot Surveillance (DaAllotment for desktop/Bronze, SaAllotment for site/Silver-Gold), Rejected, Reports | Bronze: assign a desktop assessor allowed for Bronze surveillance. Silver/Gold: lead + co-assessor, date, mode and **MeetingLink**. Then QC, certify, send back, reject |
| DesktopAssessor (3) | Surveillance Assessments (DaVerification; RemoteAssessments), Completed, Non-Conformances, Rejected | Bronze: reviews what was captured in the Surveillance app, raises NCs. Silver/Gold: works `Remote/Index` during an external video meeting |
| Admin (1) | Payments (surveillance fee master; login lands there); since 2026-10-24 in V4 also Sectors and Questionnaire (parameters and requirements) | Maintains the fee rows main's surveillance payment charges |
| SuperAdmin (10) | Failed Transactions, Registered MSME, Financial Support, API Incentives, Reports | Reports, manual payment fixes |
| CitizenFeedback (11) | Registered MSME, Financial Support, Reports | Reports |
| Ministry (8) | Registered MSME, Reports | Reports |
| StateCoordinator (6) | NEFT New / Approved | Probably unused |
| MSME (5) | My Documents, Contact | Probably unused |

### 1.2 Login and accounts
- Staff sign in at `/surveillance/User/Login` (reCAPTCHA, `SP_GET_USER_DETAILS` against **ZED_SURVEILLANCE.Users** —
  separate table with AllowBronzeSurveillance, ReasonForRejectionForBS, TuPreferredState; lacks AssessorType, OrgPartnerId).
- After login: Admin → fee page, StateCoordinator → NEFT, MSME → MSME dashboard, others → staff dashboard.
- **Agency and assessor accounts come from main**: main's `SP_INSERT_USER` / `SP_UPDATE_USER` / `SP_BLOCK_UNBLOCK_USER`
  also write the surveillance Users tables (RoleId 2 and 3), password copied in clear at creation, not synced later;
  blocking here changes only this DB. Admin/MasterAdmin/SuperAdmin/Ministry/CitizenFeedback accounts were added by hand.
- **No SSO.** Main's `User/GoToSurveillance` redirects to a non-existent `surveillance/User/GoToRoute`.

### 1.3 Data flow and statuses
- Units arrive through Agent jobs: `SP_JOB_FOR_INSERT_SURVEILLANCE_DATA` (Silver/Gold certified ≥ 11 months ago),
  `SP_JOB_FOR_INSERT_BRONZE_SURVEILLANCE_DATA`, `SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND*` (Bronze). Add to JOBS.md.
- **Silver/Gold:** MSME pays on main → record created at **8**, auto-allotted to the original agency, sections copied,
  agency mailed → agency site allotment (assessors, date, MeetingLink) → **9** → open meeting **13** → assessor final
  submit **14/15/17** → agency final submit **16** (main certificate number and QR re-used, main certificate set ACTIVE,
  benefits enabled) or reject **99** (main certificate WITHDRAWN, main re-certification enabled).
- **Bronze:** backend job applies at **1**, allotted to an agency allowed for Bronze surveillance whose preferred state
  matches → agency assigns a desktop assessor (unit mailed) → assessor uses the Surveillance app, final submit **2** →
  desktop verification **4/5/7** (NC rounds) → agency final submit **6** (main certificate number re-used; unit copied to
  ZED_CONSULTANT).
- 2nd surveillance archives old rows as `{ZedId}_S_{Id}`.

### 1.4 Hosting (names only)
- Web: IIS virtual directory `/surveillance` under `https://loginzed.msme.gov.in`; views hard-code `/surveillance/`.
- Mobile services: `/surveillancemobileapi`.
- Web.config keys: `connString`, `fromAddressContact`, `fromAddress`, `ccAddress`, `password`, `Host`, `SmsProvider`,
  `checkFeedbackVersion`, `feedbackVersionNo`, `checkSAVersion`, `SAVersionNo`, PayU*, `Amount`, `SAAmount`, `apiToken`,
  `BaseUrl`, `PaymentGateway`, CcAvenue* (incl. Mobile variants, TestMode, Success/Fail URLs).
- Services Web.config: `connString`, `fromAddress`, `password`, `checkMsmeVersion`, `msmeVersionNo`.

### 1.5 Mobile apps calling SurveillanceServices
- **`Surveillance` controller (new): the Bronze surveillance app.** A copy of main's MSME-app controller. Login takes an
  **assessor id, a ZED ID and a password**; succeeds only if that assessor is the unit's allotted desktop assessor at
  status 1. The assessor then enters on the unit's behalf: basic info, parameters, evidence/photos, ESG checklist,
  "financial assistance availed" answers, NC answers, final submit (with two extra answers: suitable for Silver upgrade,
  handholding support). Site photos probably via `Msme/SubmitSurveillancePhoto` (also new).
- **`SA` controller: site-assessor app for Silver/Gold surveillance.** Login returns `IsSurveillance=1` and
  `MinimumParameters` (already read by V4's mobile SA code). New `SA/SaveCapturedPhoto` is called by the **web** page
  `Remote/Index`.
- **`Msme` and `RA` (Twilio): probably unused** (no MSME accounts; remote surveillance uses meeting links now).
- Main's SA login has its forwarding to surveillance switched off, so the app calls `/surveillancemobileapi` directly.
  **Ask the vendor** whether the Bronze surveillance app is a separate build and which actions it calls.

### 1.6 Production checks to settle "probably unused"
- `SELECT RoleId, COUNT(DISTINCT UserId), MAX(CreatedDate) FROM ZED_SURVEILLANCE.dbo.UserLoginsWeb GROUP BY RoleId`
- `SELECT RoleId, COUNT(*) FROM ZED_SURVEILLANCE.dbo.Users GROUP BY RoleId`
- `MsmeCertifications` counts grouped by Certification and CertificationStatus
- IIS logs for the mobile controllers and for the NEFT, FA, Incentive and payment paths.

## 2. Controllers

### 2.1 Web

| Controller (diff vs main) | Live? | Versus main | Notes |
|---|---|---|---|
| Assessment (1227) | live | variant | ~583 lines uncommented Swachh code (procs missing), ~38 newer main code. Real: `AcceptUnitForSa` takes MeetingLink; mails say "Surveillance" and cc; Completed/Rejected/RemoteAssessments for MasterAdmin, Agency, DesktopAssessor; no QC role; new `GetDaDetailsFromZedLive` / `GetSaDetailsFromZedLive` (SaDetails shows the original certification assessment from main); fee read/update actions have no sign-in filter (main: Admin) |
| CitizenFeedback, Email, Helpdesk, Otp, Login, SC, SelfAssessment, SelfCertification, WB, QueryForm | dead | – | Swachh / Saathi |
| ConsultancyPay, Payment, SurveillancePay | dead / broken | duplicate | Main V4 serves them |
| Dashboard (4092) | live | variant | ~1668 lines Swachh. Live: staff dashboard, Registered MSME (also MasterAdmin; adds SurveillanceNo), Financial Support, Payment Received (no paging), Failed Transactions (also MasterAdmin) with manual update but **no ERP posting**. No role filter on data lists. Resend password dead |
| DynamicReports (14) | live | variant | Own list of 13 active reports, all procs present. **No filter at all** |
| FinancialAssistance, TechnologyUpgradation, Neft | dead / probably dead | same | No class filter here |
| Home | redirect only | same | |
| Incentive | partly (SuperAdmin API incentives) | duplicate | Data lives in main: link to main |
| Monitoring (176) | live | variant | **No class filter.** No re-allot or regeneration (procs absent). Certificate prints DateOfSurveillance and SurveillanceNo on different artwork (Bronze and site Gold backgrounds differ). Report not attached to mail; surveillance subjects. Details page broken (`SP_MONITORING_GET_DETAILS` missing) |
| Msme (1308) | mostly dead | older copy | Live for staff only: Profile / GetProfileDetails ("View Profile") and Download (evidence links) |
| MyDocuments, Questionaire, Sector | dead (menu commented out) | Sector and Questionnaire served again for Admin (2026-10-24, asked for by the owner; same procedures as consultancy's); MyDocuments and page settings stay off (no MSME pages or public home page here) | |
| Pdf, Token, Unit, Verify, Webinar | dead | same | Verify: certificate QR uses main's sequence, so main's verify page answers it |
| Remote (4) | live | variant (page/flow) | Opened for "Onsite Assessment" units (shown as Remote), status 9/13. Meeting-link Join button instead of Twilio, up to 6 recording links, photo capture via mobile `SA/SaveCapturedPhoto` |
| SA (4) | partly | variant | ReportSummary / Summary1/2 / PDF header/footer live (public report linked from main). Hotel actions dead |
| User (160) | live | variant | Login, logout, change password, assessors (agency creates assessors in this DB only), agencies (MasterAdmin), agency edit (preferred state/districts), block/unblock (this DB only). Swachh leftovers `GetAllAmc`, `UpdateUlbs` reachable (S4, S5) |

### 2.2 Mobile

| Controller | Live? | Versus main | Notes |
|---|---|---|---|
| Home | – | same | |
| Msme (215) | mostly dead; `SubmitSurveillancePhoto` probably live | older | Lacks main's ESG, facilitator, final-submit checks. New `SubmitSurveillancePhoto` |
| RA | probably dead | same | |
| SA (75) | live | variant | Meeting photos named `{name}.jpg` (main `{name}_{photoId}.jpg`). New `SaveCapturedPhoto`. Several procedure bodies differ (login, basic info, photos, open meeting) |
| Surveillance (1270) | live | **new** | See 1.5 |

## 3. Variants mapped to V4

General switch: add Surveillance to the controller's `[PortalSystems]`, inject `PortalHost` where behaviour differs,
branch on `PORTAL_SYSTEM === 'surveillance'` in Angular. Column lists passed to `Pick(...)` must tolerate surveillance columns.

| Legacy | V4 (backend `Zed.Portal\Features\…`; frontend `projects\main\src\app\…`) | Change needed |
|---|---|---|
| Staff login, change password, logout | `Staff\StaffAuthController.cs`, `Account\AccountController.cs`; `staff\staff-login.ts` | Mark for Surveillance; Users columns differ (1.2) |
| Menu | `staff\staff-menu.ts` | Surveillance item list (1.1) |
| Dashboard pages | `Staff\Dashboard\*`; `staff\dashboard` | Roles (MasterAdmin added), columns (SurveillanceNo in; FirstSurveDueDate, CertificationPhase, IsManuallyUpdated out), no resend, no paging params. Decide ERP posting for manual updates |
| Reports | `Staff\Reports\ReportCatalog.cs`, `ReportsController.cs` | Per-system catalogue (13 entries) |
| Fee master | `Staff\Fees\AssessmentFeesController.cs`; `staff\fees` | Mark only (same procs and shape) |
| Bronze allotment, DA verification, NCs, Completed/Rejected | `Staff\Assessment\*`; `staff\assessment` | New columns (AutoAllocationDate, SurveillanceNo, lead/co of original certification). Bronze lists start at status 1. Agencies list adds AllowBronzeSurveillance. Surveillance mail templates. Results use `SP_MONITORING_GET_LIST` (paginated version missing here) |
| DaDetails (Bronze review) | `Staff\Assessment\DesktopAssessmentController.cs`, `DaFiles.cs`, `EvidenceUploads.cs` | State checks match. `_S_` archived IDs. Do **not** pass `@FromSurveillance`. Photo root `surveillancemobileapi` already known |
| Site allotment, remote lists | `Staff\SiteAssessment\*`; `staff\site-assessment` | MeetingLink input (http/https only), passed only on Surveillance; list includes status 9 not yet joined; mails with the link |
| SaDetails | `Staff\SiteReview\*`; `staff\site-review` | "Original certification" panel (the two from-main procedures, with role and allotment checks), recording links, meeting link |
| Remote page | `Remote\*`; `staff\remote` | Mode check relaxed ("Onsite Assessment"). No Twilio. Meeting link and recording links. Photo capture stored with legacy names via the SA photo procedure |
| Monitoring | `Staff\Monitoring\*`; monitoring mail templates; `staff\monitoring` | Review status numbers match. Hide re-allot. List columns. Certificate artwork + 2 extra fields, stored under main's `Surveillance/Certificates/{DA|SA}/{ZedId}/{Level}.pdf` (storage root shared with main). No report attachment |
| Public report | `Documents\*`; main `msme\certification\certification-details.ts` | Surveillance variant of the report procedure; serve from the main host to the owning MSME (second read-only Surveillance connection); replace the legacy link |
| Agencies and assessors | `Staff\Users\*` | Params differ and block procs missing: small surveillance-specific controller (list, edit Bronze-surveillance preference, block via a new procedure). Account creation stays in main |
| Staff "View Profile" | none | New endpoint with an allotment check |
| Mobile SA | `Zed.Main.MobileApi\Controllers\SAController.cs` | Photo-name switch; add `SaveCapturedPhoto`; host against ZED_SURVEILLANCE at `/surveillancemobileapi` |
| Mobile Surveillance, `Msme/SubmitSurveillancePhoto` | pattern: `Zed.Main.MobileApi\Controllers\MsmeController.*.cs` | New controller: assessor+ZED ID login, device binding on the assessor, **allotment check on every call**, surveillance procs (incl. `SP_APP_SURVEILLANCE_INSERT_ESG_CHECKLIST`) |

## 4. Procedures

**Missing here but called on live paths:** the five `SP_SURVEILLANCE_MSME_*` (main only: SurveillancePay broken);
`SP_SA_PAYMENT_UPDATE_RESPONSE`, `SP_DYNAMIC_REPORT` (missing in both); `SP_MONITORING_GET_DETAILS`;
`SP_MONITORING_UPDATE_MEETING_COMMENTS`, `SP_ASSESSMENT_RA_GET_NEW_PRODUCT` (missing in both); ~70 Swachh procs.

**Called by V4 but missing here:** paginated monitoring list, re-allot; block/unblock user, block Bronze agency,
professional-details lookup; certificate regeneration list/status; Udyam update, main's ESG and facilitator procedures,
`SP_SA_GET_REG_DETAILS`; category and technology masters; ZED ID history; all external-API procedures; ~37 report procs.

**Same name, different parameters:**

| Procedure | Only in surveillance | Only in main |
|---|---|---|
| SP_APP_MSME_FINAL_SUBMIT | @SuitableForSilverUpgrade, @HandholdingSupport | – |
| SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA | @MeetingLink | – |
| SP_ASSESSMENT_DA_DETAILS | – | @FromSurveillance |
| SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS | – | @ApiType |
| SP_INSERT_USER, SP_UPDATE_USER | TuPreferredState/Districts | AssessorType, OrgPartnerId |
| SP_MSME_UPDATE_PROFILE | – | three activity-code parameters |

**Result-set differences (first set):** DA/RA certificate details add DateOfSurveillance and SurveillanceNo (RA drops
SurveillanceDate); allotment mail data MeetingLink instead of Recertification; Registered MSME +SurveillanceNo,
−FirstSurveDueDate, −CertificationPhase; failed transactions −IsManuallyUpdated; MSME app status lacks six surveillance
columns; agencies to allot +AllowBronzeSurveillance; Users columns as 1.2. Body-only differences that matter most:
monitoring final submit and reject, monitoring list, allotment list, agencies-to-allot, DA accept and final submit,
report details, payment procedures.

## 5. Security findings (S1–S15) — see SECURITY-FINDINGS.md

## 6. Work packages (original proposal)
Do not port: SurveillancePay, ConsultancyPay, Pay/Payment, the MSME web area, FinancialAssistance, TechnologyUpgradation,
NEFT, Incentive (link to main), Questionnaire, Sector, MyDocuments, page settings, Verify, Token, Unit, Pdf, all
Swachh/Saathi controllers, mobile RA and mobile MSME (except the photo action, pending the vendor). Accounts stay
mastered in main; Surveillance keeps its own login (no SSO at go-live). The surveillance report is served by the main host.
Surveillance mobile is a second instance of the mobile host at `/surveillancemobileapi`. Main and Surveillance share the
storage root.
