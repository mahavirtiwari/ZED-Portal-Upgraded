# Consultant, site assessor and Impact Assessment apps against V4

Checked against the apps' source received on 2026-10-22 (`ZED Mobile App Source Code\ZED\`), read as data, not built.
The MSME / Bronze surveillance app (`ZED_MSME_Bronze`) is covered separately.

| Project | Package | Version | Calls | V4 host |
|---|---|---|---|---|
| `ZEDConsultant` | com.qci.zed.consultancy | 1.2 (74) | `/consultancymobileapi/SA/…`; the consultancy web site `/Consultancy/FinancialAssistance/…`; `/mobileapi/photos/…` | mobile (`Mobile:System=Consultancy`), Consultancy portal, mobile (Main) |
| `ZED_SA_Studio` | com.qci.zed.siteassessment | 1.2 (45) | `/mobileapi/SA/…` | mobile (Main) |
| `ImpactAssessment` | com.qci.zed.impactassessment | 1.2 (33) | its own `/impactmobileapi/SA/…` and `/liamobileapi/SA/…` (not V4); `/Consultancy/FinancialAssistance/…`; `/mobileapi/photos/…` | Consultancy portal, mobile (Main) for the ZED calls only |
| `LeanImpactAssessment` | com.qci.zed.leanimpact | 1.2 (1) | its own `/impactmobileapi/SA/…` (not V4); `/Consultancy/FinancialAssistance/…`; `/mobileapi/photos/…` | as above |

The 12 empty files of the package are an overlay folder `SurveillanceModuleChanges/ZED/ZED_SA_Studio/` (planned
surveillance changes) and an empty `ZED_SA.zip`; the site assessor app's own source in `ZED_SA_Studio/app/src` is complete.

## How the apps call the server

Common to all four (one code base, `com.geostat.assessment`):

- **Transport.** `RestHelper.callRestService` (HttpURLConnection) for the assessment flow, Retrofit + Gson for the newer
  screens. JSON bodies with `Content-Type: application/json`, `Accept: application/json`; uploads as multipart.
- **No identity on the wire** except the request's own fields: no token, no cookie, no header. The site assessor and
  consultant calls name the assessor in `saId` / `assessorId`; the technology upgradation (TU) calls name nobody.
- **No `deviceInfo`.** `Utils.getDeviceInfo` exists but is never called, so V4's device binding sees these apps as
  "Missing" (see "Device binding" below).
- **Success** is `status == "1"` (`BaseServiceResponse.isSuccess`, `Constants.SUCCESS_RESPONSE`); `errorMessage` is shown
  to the user. Responses are parsed leniently (`JsonReader.setLenient`), dates as `yyyy-MM-dd` text.
- **Paths.** `BASE_URI` ends in `/SA/`; the RestHelper paths of the consultant app start with `/` (`/SubmitAllocation`,
  `/SubmitParameter`, `/SubmitEndAssessment`, `/SubmitSelfie`, `/SubmitSiteTour`, `/SubmitEvidences`,
  `/SubmitStartAssessment`), so it requests `…/SA//SubmitAllocation`. The site assessor app's paths have no leading slash.

### Consultant app (ZEDConsultant)

| Call | Method / body | V4 |
|---|---|---|
| `SA/Login` | JSON `UserLogin` (`zedId`, `assessorId`, `password`, `version`) | `ConsultancySAController.Login` |
| `SA/SubmitAllocation`, `SubmitStartAssessment`, `SubmitParameter`, `SubmitEndAssessment`, `SubmitSelfie` (`selfie`), `SubmitSiteTour`, `SubmitEvidences` (RestHelper, `//`) | JSON | `ConsultancySAController` (same actions, both `selfie` and `selfieImage` bound) |
| `SA/SubmitBasicInformation`, `SubmitBasicInfoPhotos`, `SubmitZedTrainingInfo`, `SubmitHouseholdingTrainingInfo`, `SubmitBaselineDiagnostic`, `SubmitHandholdingActionPlan`, `SubmitTechnologyIntervention`, `SubmitProgressReview` (Retrofit) | JSON | `ConsultancySAController` |
| `SA/SubmitPhotos` | multipart: `zedId`, `userName`, `certificationType`, `sectionName`, `photoId`, `latitude`, `longitude`, `timeStamp`, file part `FormFile` | `ConsultancySAController.SubmitPhotos` |
| `SA/SubmitAttendance` | multipart: `saId`, `zedId`, `certificationType`, `attendanceType`, `comments`, `selfieMetadata` (JSON text), file part `files` | `ConsultancySAController.SubmitAttendance` |
| `/Consultancy/FinancialAssistance/SubmitOpenMeeting` (absolute URL) | JSON `SubmitAssessmentRequest` | `TuOpenMeetingController` |
| `/Consultancy/FinancialAssistance/GetDetails` | JSON `{zedId}` (`saId` null) | **new** `TuAppController.GetDetails` |
| `/Consultancy/FinancialAssistance/ValidateEvidence` | multipart: `Id`, `ZedId`, `CertificationType`, `IsVerified`, `Remarks`, `SourceOfValidation`, file parts `files` | **new** `TuAppController.ValidateEvidence` |
| `/Consultancy/FinancialAssistance/updatetechnology` | JSON `{ZedID, Id, AmountPaid}` | **new** `TuAppController.UpdateTechnology` |
| `/Consultancy/FinancialAssistance/FinalSubmit` | JSON: the whole application row of GetDetails with `IsApproved` (1/2) and `Comments` | **new** `TuAppController.FinalSubmit` |
| `GET /mobileapi/photos/{zedId}/TechnologyUpgradation/{photoId}` | file download | **new** `TuPhotosController` (Main mobile deployment) |

The TU screens appear for the "fourth milestone" after the DFO signed in to the app for the unit, has taken
attendance today and submitted the opening meeting.

### Site assessor app (ZED_SA_Studio)

`SA/Login`, `SubmitAllocation`, `SubmitStartAssessment`, `SubmitParameter`, `SubmitEndAssessment`, `SubmitSelfie`
(`selfieImage`), `SubmitSiteTour`, `SubmitEvidences` (RestHelper, no leading slash) and `SubmitBasicInformation`,
`SubmitBasicInfoPhotos`, `SubmitAttendance` (Retrofit; attendance multipart as in the consultant app). All are on V4's
main `SAController` except **`SubmitAttendance`, which was missing** (added; below).

### Impact Assessment apps

Their assessment flow goes to their own services (`/impactmobileapi/SA/`, `/liamobileapi/SA/`), which are not V4 and
stay as they are on the same IIS site: out of scope. They carry the consultant app's TU screens and Retrofit clients
unchanged, i.e. they can call ZED's `/Consultancy/FinancialAssistance/*` and `/mobileapi/photos/…`. Those screens show
only when their own backend reports a TU milestone, which an impact assessment does not appear to do; if they are used,
V4 refuses them (their users never sign in to V4's consultant app), see "Unknown".

## What V4 changed (2026-10-22)

1. **`//` in paths.** `UseLegacyPathNormalization` (Zed.Core, mobile host, before an explicit `UseRouting`) collapses
   repeated slashes, so `…/SA//SubmitAllocation` reaches `SA/SubmitAllocation` as on the old IIS/MVC 5 site. Without it
   seven consultant app actions answered 404.
2. **`SA/SubmitAttendance` on the main mobile deployment** for the site assessor app: lead or co-assessor allotted to the
   unit, selfie stored as `Attendance/{zed}/{cert}/{photoId}.jpg`, `SP_APP_SA_INSERT_DAILY_ATTENDANCE` (which exists in
   ZEDCS_V2_LIVE). The services source we received has no such action although the procedure exists: production most
   likely runs newer services code than that copy (see "Unknown").
3. **The consultant app's TU calls** (`TuAppController` on the consultancy portal, `TuPhotosController` on the main
   mobile deployment). The app sends no identity, and the old actions had no filter (#88; the old FinalSubmit even ran
   as "DFO" because the missing session role defaulted to it, #117). V4 now:
   - records each consultant app sign-in that passed its exact allotment check (`dbo.V4AppSessions` in ZED_CONSULTANT,
     migration **0010**, written by `ConsultancySAController.Login`);
   - serves the TU calls only for a unit whose **allotted DFO** (`FinancialAssessorId`) signed in to the app **for that
     unit** within `Consultancy:TuApp:LoginHours` (default 12; `0` switches the check off; `Consultancy:TuApp:SameIp`
     also requires the sign-in's IP address);
   - reads (GetDetails, documents) while the application is with that DFO or just decided by them (VerificationStatus 2
     or 3), writes only while it is with them (2);
   - runs FinalSubmit as that DFO (`UserId` = the allotted DFO, `RoleId` 3), never as the body's `FinancialAssessorId`,
     and mails the MSME a DFO rejection as the web review does;
   - accepts amounts up to what the unit declared, audits the change;
   - content-checks uploads (PDF / JPEG / PNG, 5 MB each, at most 10) and stores them under generated names;
   - serves a document file only when it is listed for the unit's application (no static folder).
   The same `Consultancy:TuApp:LoginHours` setting is read by the main mobile deployment for the document downloads.
4. **Fix script `database/fixes/consultancy/10_tu_state_checks.sql`.** It limited `SP_FINANCIAL_ASSISTANCE_UPDATE_TECHNOLOGY_DATA`
   to VerificationStatus 4, which would have refused the DFO's amount correction in the app (VerificationStatus 2). It
   now allows 2 or 4 (payout pending, no NEFT in process). Tested again on the local copy inside a rolled-back
   transaction: preview, apply, second apply "nothing to change", status 2 and 4 accepted, 1 refused. A database where
   the earlier version of 10 was already applied stops with "neither the reviewed text nor the fix": restore the saved
   definition of that procedure first.

Tests: `Zed.Consultancy.Api.Tests/TuAppTests.cs` (5), `Zed.Main.MobileApi.Tests/AppSourceContractTests.cs` (double
slashes, site assessor attendance, TU documents: 4), a sign-in test in `ConsultancyAppLoginTests`.

## Device binding

None of these apps sends `deviceInfo`. In `Mobile:DeviceBinding = Enforce` their calls are "Missing", which is
refused only when `Mobile:RefuseMissingDevice` is true. Keep it **false** on the Main and Consultancy deployments until
an app release sends `deviceInfo` (`Utils.getDeviceInfo` is already written), or the site assessor and consultant apps
stop working. CUTOVER "Week 1" should say so.

## Which app the Surveillance mobile deployment serves

None of the four apps here calls `/surveillancemobileapi/`. The MSME / Bronze surveillance app (`ZED_MSME_Bronze`,
com.qci.zed.bronzesurveillance) does: `surveillancemobileapi/msme/` and `surveillancemobileapi/surveillance/`
(its RetrofitProvider), which is what V4's Surveillance deployment and MOBILE-API.md "Surveillance" assume. The
surveillance **site assessor** app's current source is not in this package: `ZEDSurveillance` (com.prd.zedsa.surveillance)
still points at an old vendor domain, and the `SurveillanceModuleChanges` overlay holds planned changes only. Ask the
vendor for the released surveillance site assessor app's source.

## Unknown

- Production services code is newer than the source we received (SubmitAttendance). Before go-live, list the IIS log
  paths of `/mobileapi`, `/consultancymobileapi` and `/Consultancy/FinancialAssistance` for a month and compare them with
  V4's actions; anything else the apps call must be ported.
- Whether the Impact Assessment apps ever reach their TU screens. If they do, their verifiers would need to be
  recognised (their backend's sign-ins are not visible to V4).
- Whether DFOs sign in to the app for a unit on the same day they verify it. The 12-hour window is a guess; the app
  answers "Please login again in the app for this unit", and the DFO can sign out and in again from the menu.
- The production values of `UrlsMasterData` and the photo folder layout for `CertifiedPhotos` (the document endpoint
  looks in `Photos` then `CertifiedPhotos`).

## What the app vendor should change (next release)

1. Send a session token from Login with every call (the v2 API of MOBILE-API.md), including the TU calls; until then
   V4 can only infer the caller.
2. Send `saId` with the four FinancialAssistance calls and move them to the mobile API.
3. Stop disabling TLS certificate and hostname checks (`RestHelper.disableSSLVerification` on Android 13 and older,
   `RetrofitProvider`'s trust-all client). If it was added for an incomplete certificate chain, make the server send the
   full chain instead.
4. Do not keep the user's password in the offline database (`OfflineDBManager`, `OfflineAuditData`).
5. Send `deviceInfo` (already written, never called).
6. Remove the leading `/` of the RestHelper paths (V4 copes either way).
