# Mobile API (phase 6)

The ZED MSME app, the site assessor app (`/SA/...`) and the remote-assessment app (`/RA/...`; despite the
name its user is the MSME, signing in with the ZED ID) call the old
`SwachhSurvekshanServices` site. The apps are installed on users' phones and cannot be changed
quickly, so V4 serves them in two layers:

1. **v1, compatible** (`backend/src/Zed.Main.MobileApi`): the same addresses, field names, request
   formats and response formats as the old site. No app update needed.
2. **v2, token-based** (design below): for the next app release. Identity comes from a sign-in
   token, never from the request body.

The mobile payment actions that the apps open on the web portal (`Pay/GetToken`,
`Pay/GetTokenRSA`, `Pay/successtransmobile`, ...) stay on the portal (`Zed.Main.Api`) at their old
addresses, built on the same compatibility layer.

## v1: what "compatible" means

Everything below lives in `backend/src/Zed.Core/Mobile` and is covered by
`tests/Zed.Main.MobileApi.Tests/LegacyCompatibilityTests.cs`.

| Old behaviour (ASP.NET MVC 5) | V4 |
|---|---|
| Route `{controller}/{action}/{id}`, any letter case | `LegacyMobileController` carries `[Route("[controller]/[action]/{id?}")]`. A portal controller sets its own `[Route]`. |
| Default model binder: query string, route, JSON body and form fields merged, case-insensitive; `deviceInfo.deviceId` and `photos[0].photoId` form keys; numbers sent as strings and the reverse; a complex parameter is never null | `LegacyModelBinder` + `LegacyJson.Read`. A complex parameter reads the whole request; a simple one (`string userName`) reads the field with its name. |
| `HttpPostedFileBase` parameters and properties | `IFormFile` / `List<IFormFile>` parameters and properties, matched by form field name (including `photos[0].file_data`). |
| `Json(x)` (JavaScriptSerializer): declared property names, nulls included, dates as `"\/Date(ms)\/"`, `application/json` | `LegacyJson(x)` |
| `Content(JsonConvert.SerializeObject(dataSet))`: tables by name, ISO dates, `text/html` | `LegacyContent(LegacyResults.DataSetJson(sets, names))`. Password, OTP and token columns are left out. |
| `row["X"].ToString()` for dates and numbers: server regional format | Set `Mobile:Culture` to the old server's culture. **Check one live response before cut-over.** |
| Unhandled exception: HTML error page, often `ex.Message` in the body | 500 with `{"status":"0","errorMessage":"An error has occurred, please try again later."}`. Details go to the log only. |
| `checkMsmeVersion` / `msmeVersionNo` | `Mobile:CheckMsmeVersion` / `Mobile:MsmeVersion` |

### Rules for porting an action

- Copy the request and response classes field for field into `Models/` (names, casing, order).
  Fields the old code never set still appear, as null.
- Same procedure, same parameters, same result-set mapping. Read rows with `Text()`, `Int()` and
  `Bool()` (`MobileRows`), which never throw where the old `Convert.ToInt32(...)` did.
- Keep the old `status` / `errorMessage` texts. Where the old code returned `ex.Message`, return a
  fixed message and log the exception.
- **Files**: build every path with `MobileStorage` (`Folder(...)`, `FileName(...)`,
  `UploadedName(...)`, `SaveBase64Async`, `SaveAsync`). Each request value must be a plain name;
  extensions come from an allow-list. `MobileStorage.Root` is `Mobile:StorageRoot`, which in
  production points at the old site's folder so the portal keeps finding the files
  (`mobileapi/Photos/...`, `mobileapi/SaPhotos/...`).
- **Never** write request bodies to disk. The old code saved every request, passwords included, to
  `App_Data/Json`. Log only the action, the user and the outcome.
- Mark every action that acts for a user with `[DeviceBound(MobileApps.X, "fieldName", ...)]`.
- Logins call `IDeviceBindings.RememberAsync` on success, use `LoginThrottle`, and check
  `LegacyPasswords.MatchesStored` (the procedures contain hard-coded master passwords).
- **Stage checks** (MSME app): before a write, `SP_APP_MSME_STATUS` (the procedure behind the app's own
  buttons) must show the matching stage: basic information only before final submit; evidences and photos
  before final submit or while the current NC is open; NC replies only while the current NC is open;
  facilitator details only for a paid level; financial assistance only with a completed certification.
  Otherwise the old `{"status":"0","errorMessage":"Invalid Details."}` is returned and the refusal logged.
- **Assessor allotment** (site assessor app): the assessor in the request must be the unit's lead or
  co-assessor for that certification (`MsmeCertifications.SiteAssessorId/CoAssessorId`); section allotment
  and the closing meeting are lead-only, final submit co-assessor-only.
- Where an ownership check is possible without breaking the app (for example, the assessor named
  in the request must be allotted to the unit named in the request), add it and return the old
  failure shape.

## Device binding (protection without an app update)

The old services had no sign-in after login: every call names the user in the body (`zedId`,
`userName`, `saId`), so anyone who knows a ZED ID could act for that MSME. V4 cannot add a token
without an app update, but the apps send `deviceInfo.deviceId` with most calls.

- On every successful login the device is recorded (`dbo.MobileDeviceBindings`,
  `database/migrations/0001_mobile_devices.sql`).
- An action marked `[DeviceBound]` checks that the calling device has logged in as the user named
  in the request.
- `Mobile:DeviceBinding`:
  - `Monitor` (default): nothing is refused; calls from unknown devices and calls without a
    device id are recorded in `dbo.MobileDeviceEvents` (at most one row per user, device, action
    and outcome every 10 minutes).
  - `Enforce`: calls from an unknown device are refused with
    `{"status":"0","errorMessage":"This device is not registered for your account. Please login again."}`.
    Users with no recorded device yet (not logged in since go-live) are not blocked.
  - `Mobile:RefuseMissingDevice: true` also refuses calls that send no device id.
- **Roll-out**: run Monitor for two to four weeks. Then look at the events:
  ```sql
  SELECT Path, Outcome, COUNT(*) n, COUNT(DISTINCT UserKey) users
  FROM dbo.MobileDeviceEvents WHERE At > DATEADD(day, -14, SYSDATETIME())
  GROUP BY Path, Outcome ORDER BY n DESC;
  ```
  Actions that show `Missing` for most users are ones where the app never sends `deviceInfo`;
  device binding cannot protect those, and they wait for v2. Switch to `Enforce` once `Unknown`
  is rare among genuine users (phone changes and reinstalls log in again, which registers the
  new device).
- Limits: a device id is not a secret. Binding stops callers who only know a ZED ID; it does not
  stop someone who has the victim's device id. v2 closes that gap.

## Check on the live services before cut-over

- One response each of `Msme/ChangePassword`, `Msme/ResetPassword` and `Msme/FinalSubmit`. As built from
  source, their mail templates were missing, so they answered `status "0"` after doing the work; V4 answers
  `status "1"`. If the live site had the templates, nothing changes; if not, check the app treats `1` as success.
- One login response, for `Mobile:Culture` (date text format).
- The virtual folder (`Mobile:PathBase`) and the folder holding `Photos/`, `SaPhotos/` (`Mobile:StorageRoot`).
- Whether the remote-assessment app builds video tokens itself from the Twilio secret it used to receive (#48).

## Mobile payments (on the portal)

`Zed.Main.Api/Features/Payments/Mobile`: `Pay/GetToken`, `Pay/GetTokenRSA`, `Pay/successtransmobile`,
`Pay/failuretransmobile`, `Pay/SubmitZeroPaymentDetails`, `Msme/GetPaymentDetailsByType`, and the same under
`SurveillancePay/` (`GetSurveillancePaymentDetailsByType`) and `ConsultancyPay/` (`GetToken`, `GetTokenRSA`, `successtransmobile`, `failuretransmobile`, `SubmitZeroPaymentDetails`, plus `Msme/GetConsultancyPaymentDetailsByType`). The app uses CCAvenue's mobile SDK with its own access
code and working key (`CcAvenue:MobileAccessCode`, `CcAvenue:MobileWorkingKey`, `CcAvenue:MobileServiceUrl`).
Callbacks go through the same checks as the web flow (`CcAvenueResponseProcessor`).

Open before go-live:
- Confirm on one live app request that `Amount` in `GetToken` is the net payable; V4 refuses a different amount.
- Consultancy (handholding) mobile payment never worked either (no order id → forced error); V4 makes it work. Confirm.
- CCAvenue redirect URLs for `/ConsultancyPay/successtransmobile` and `failuretransmobile` too.
- Surveillance mobile payment never worked on the old site (the procedure forces an error); V4 makes it work.
  Confirm this is wanted.
- CCAvenue merchant settings for the mobile access code: redirect/cancel URLs (must be
  `/Pay/successtransmobile` and `failuretransmobile`, and the `SurveillancePay` ones), which working key encrypts
  mobile responses, the reconciliation URL/key for mobile orders, and whether the SDK accepts 36-character order
  ids (surveillance orders use GUIDs; CCAvenue documents 30).
- Rotate the mobile access code/working key (they were in Web.config) and set them as secrets.
- Set `Mobile:DeviceBinding` on the portal too (it defaults to Monitor).

## Configuration

| Key | Meaning |
|---|---|
| `ConnectionStrings:Main` | ZEDCS_V2_LIVE |
| `Mobile:PathBase` | Virtual folder the old services ran under (the portal links to `/mobileapi/...`, so likely `/mobileapi`) |
| `Mobile:StorageRoot` | The old services site's folder (holds `Photos/`, `SaPhotos/`, `Videos/`) |
| `Mobile:Culture` | Regional format for dates sent as text (default `en-US`) |
| `Mobile:DeviceBinding`, `Mobile:RefuseMissingDevice` | See above |
| `Mobile:CheckMsmeVersion`, `Mobile:MsmeVersion` | Version gate for the MSME app (old `checkMsmeVersion`/`msmeVersionNo`) |
| `Mobile:CheckSaVersion`, `Mobile:SaVersion` | Site assessor app (old `checkSAVersion`/`SAVersionNo`) |
| `Mobile:CheckRaVersion`, `Mobile:RaVersion` | Remote assessment app |
| `Mobile:MaxRequestBytes`, `Mobile:MaxFileBytes` | 30 MB request / 20 MB file by default |
| `Mobile:Twilio:AccountSid`, `ApiKey`, `ApiSecret` | Video tokens for remote assessment. The old keys were in source code and must be rotated; put the new ones in user secrets or the environment. |
| `Email:*`, `Portal:PublicBaseUrl` | As for the portal |

Local run: launch configuration `mobile-api` (port 5104). The dev seed user `ZEDMSMEDEV001`
(`database/seed/dev-test-user.sql`) can log in from the app's login call.

## Consultancy (consultant app and TU verifier / DFO app)

The Consultancy deployment of the mobile host (`Mobile:System=Consultancy`, launch profile `consultancy`, port 5105,
database ZED_CONSULTANT, old site `/Consultancymobileapi`, so `Mobile:PathBase=/Consultancymobileapi`) serves the
consultancy `SwachhSurvekshanServices` SAController at `/SA/{action}`:
`Controllers/Consultancy/ConsultancySAController*.cs`, models `Models/ConsultancyModels.cs`
(namespace `Models.Consultancy`), tests `ConsultancyApp*Tests.cs`. The controller carries
`[PortalSystems(PortalSystem.Consultancy)]` and `[Route("SA/[action]/{id?}")]`; Main's `SAController` (Main only) is
removed on this deployment by the controller filter, so `/SA/...` never clashes. Main's `Msme/*` and `RA/*` are not
served here (only `Home`).

| Action | Procedure (ZED_CONSULTANT) | Notes |
|---|---|---|
| `Login` | `SP_APP_SA_CHECK_LOGIN_V2` (→ `SP_APP_SA_CONSULTANCY_CHECK_LOGIN` or `SP_APP_TU_CHECK_LOGIN`) | Consultant branch when `SiteVerification`, DFO branch when `FinancialVerification`. Adds milestone, BDS/HAP dates, unit address/district/state/pincode, the requirement fields and the bullet lists (set 9, by `PrevReqId` and `ReqType`); several co-consultants. The procedure's own failure texts are returned. |
| `SubmitAllocation`, `SubmitSiteTour`, `SubmitOfiComments`, `SubmitStartAssessment`, `SubmitEndAssessment`, `SubmitBasicInfoPhotos` | as on Main | Messages without the "MSME SA" prefix, as in the consultancy code. |
| `SubmitSelfie` | `SP_APP_SA_SAVE_PHOTOS` | Database row only (from `selfie`), no file. |
| `SubmitParameter` | — | No-op success after the stage checks (as the old code). |
| `SubmitEvidences` | `SP_APP_SA_SAVE_PHOTOS` | Files in `SaPhotos/{zed}/{cert}/{sectionName}` (`SiteTour` when empty). |
| `SubmitBasicInformation` | `SP_APP_SA_CONSULTANCY_INSERT_BASIC_INFO` | The handholding baseline figures. |
| `CheckParameterSyncStatus` | `SP_SA_APP_CHECK_STATUS` | `AllParametersSynced` for the role sent (`userType`). |
| `SubmitPhotos` | `SP_APP_SA_SAVE_PHOTOS` (PhotoType = section) | Multipart, file part `FormFile`; `SaPhotos/{zed}/{cert}/{section}/{photoId}.jpg` (`.pdf` when `isPdf`). |
| `SubmitZedTrainingInfo`, `SubmitHouseholdingTrainingInfo` | `SP_APP_SA_CONSULTANCY_TRAINING_INFO` | `TrainingType` ZedTraining / HouseholdingTraining; photo rows only. No stage check (as before). |
| `SubmitBaselineDiagnostic`, `SubmitHandholdingActionPlan`, `SubmitTechnologyIntervention`, `SubmitProgressReview` | `SP_APP_SA_SAVE_PARAMETER` | TVPs `DynamicRequirementsList1`, `DynamicPhotoList2`, `DynamicParticipants` (`@BulletList`: requirement id, bullet). Conformance carries conformance / estimatedTimeInDays / "Conformance" / isProposedActivityCompleted; TechnologyIntervention sends the rationale as RequirementCode. |
| `SubmitAttendance` | `SP_APP_SA_INSERT_DAILY_ATTENDANCE` | Multipart, file part `files`, details in the JSON text `selfieMetadata`; saved as `Attendance/{zed}/{cert}/{photoId}.jpg` (the portal reads `.jpg`; the old code kept the client's extension, #91). |

Checks added on every call:
- **Allotment by exact id** (#93: `SP_APP_SA_CHECK_LOGIN_V2` matches co-consultants with `LIKE`): the lead
  (`MsmeCertifications.SiteAssessorId`), a co-consultant (`AllotedCoAssessors`) or a technical expert
  (`AllotedTechExperts`) of the current milestone; allotment and the closing meeting lead-only, final submit (and
  co-consultant evidences) co-consultant-only. The DFO (`FinancialAssistance.FinancialAssessorId`, VerificationStatus 2,
  TechUpgradeStatus 4/5/10) may log in, send attendance, upload files and read the sync status. Login checks the same
  allotment after the procedure. Refusals answer `Handholding Consultant not yet allocated for the ZEDID: …`.
- `[DeviceBound]` on every write (`saId`, or `userName` for `SubmitPhotos` / `SubmitBasicInfoPhotos`); device records
  under app key `SA`. **Run `database/migrations/0001_mobile_devices.sql` on ZED_CONSULTANT** (the consultancy
  deployment's database), else logins and device checks fail.
- Paths only through `MobileStorage`: certification Bronze/Silver/Gold, section names letters/digits/spaces/`_`/`-`,
  fixed extensions. No request bodies are written to disk; no exception texts are returned.
- Version check: the old mobile Web.config had no `checkSAVersion` (the old code failed with a null reference); here
  it is off unless `Mobile:CheckSaVersion` / `Mobile:SaVersion` are set for this deployment.

Not ported (no evidence the apps call them): the hotel leftovers `GetSiteAssessmentDetails`, `UpdateSaDeclaration`,
`SubmitSaReg`, `GetAmounts`, the views `Index`, `List`, `PaymentDetails`; the consultancy `Msme/*` and `RA/*`
controllers. Check IIS logs of `/Consultancymobileapi` before go-live. The DFO app's open meeting posts to the web host
(`/Consultancy/FinancialAssistance/SubmitOpenMeeting`), not here.

## Surveillance (Bronze surveillance app, site assessor app, surveillance photos)

Deployment: `Mobile:System = Surveillance` (launch profile `surveillance`, port 5106), database ZED_SURVEILLANCE
(`ConnectionStrings:Surveillance`), old site `/surveillancemobileapi` (`Mobile:PathBase`). `Mobile:StorageRoot` is the
old site's folder (it holds `Photos/` and `SaPhotos/`, which the surveillance review pages open). Run
`database/migrations/0001_mobile_devices.sql` on ZED_SURVEILLANCE too: device records live in the deployment's own
database.

| Address | Controller | Notes |
|---|---|---|
| `SA/*` | `SAController` (also Main) | Same procedures and parameters as Main. Login answers `isSurveillance: true` and the unit's `minimumParameters` (from the procedure). Open/closing meeting photos are saved as `SaPhotos/{ZedId}/{level}/{name}.jpg` (Main: `{name}_{photoId}.jpg`). |
| `Surveillance/*` | `Controllers/Surveillance/SurveillanceController.*` | Bronze surveillance app, below. |
| `Msme/SubmitSurveillancePhoto` | `SurveillancePhotoController` | Below. No other `Msme/*` action is served here. |

### Bronze surveillance app (`Surveillance/*`)

A copy of the MSME app's controller: the desktop assessor signs in with `assessorId`, `zedId` and `password`
(`SP_APP_SURVEILLANCE_CHECK_LOGIN`; succeeds only for the unit's desktop assessor at status 1) and then enters the
unit's data, the unit being the request's `userName`.

- **Allotment on every call** (finding #109): the unit's `MsmeCertifications` row for the level must have a
  `DesktopAssessorId`; an assessor named in the request (`saId` or `assessorId`) must be that one, otherwise
  `"Bronze Surveillance Assessment data not yet allocated for the ZEDID: …"`. The calling device must have signed in
  as that assessor (device records app `SURV`, user = assessor id, same `Mobile:DeviceBinding` modes).
- **Stage checks** (from the surveillance procedures; refusal `"Invalid Details."`): basic information, ESG
  checklist and "financial assistance availed" only at status 1 with no NC; evidences and photos then or while the
  current NC is open; NC replies only while the current NC is open; final submit at status 1 or while the NC is open.
- `FinalSubmit` passes `suitableForSilverUpgrade` and `handholdingSupport`. On this database
  `SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT` returns `AllowFinalSubmit = 1` to **refuse** (with the reason).
- Kept failing as before, without database calls: `ChangePassword` ("Invalid Old Password.": there are no MSME
  accounts here), `ResetPassword` ("Sorry, no User exists with these details."), `GetMsmeStatus` (HTTP 500: the
  procedure lacks six columns the old code read). Refused: `SubmitFinancialData`, `SubmitFinancialPhotos` (the MSME's
  own claim, made on main). `SubmitVideo` as on Main.

### `Msme/SubmitSurveillancePhoto`

Photo of a Silver/Gold surveillance meeting (`selfie`, `interior`, `exterior` or `sitetour` = PhotoInformation JSON,
file in `file_data`), stored as `SaPhotos/{ZedId}/{level}/SiteTour/{photoId}.jpg` and recorded with
`SP_APP_SYNC_SUVEILLANCE_PHOTOS` (finding #108). Before anything is written: level Silver or Gold, a site assessment
allotted and not certified, status 9–13 (else the procedure's "Cannot Sync Now…" text), a JPEG or PNG file within
`Mobile:MaxFileBytes`, plain names only. Device-bound to the ZED ID (app `MSME`); MSMEs never sign in on this
deployment, so in practice this records nothing until a v2 token exists.

### Not served on this deployment

Old `Msme/*` (Index, Login, ChangePassword, ResetPassword, GetMsmeStatus, GetMyDocuments, GetParametersByType,
SubmitBasicInformation, SubmitEvidenceNotUsed, SubmitEvidenceV2, SubmitPhotos, SubmitVideo, FinalSubmit,
GetNcDetailsByType, SubmitNcRequirement, SubmitNcProduct, SubmitSiteExteriorInfo, SubmitFinancialData,
SubmitFinancialPhotos) and `RA/*` (Index, Login, CheckAssessment, GetToken, SubmitSelfie, SubmitLocation): no MSME
accounts exist in ZED_SURVEILLANCE and remote surveillance uses meeting links. `SA/SaveCapturedPhoto` is called by the
web page `Remote/Index` and is served by the portal. Check the IIS logs of `/surveillancemobileapi` before go-live.

**Ask the vendor:** is the Bronze surveillance app a separate build (package name, store listing), which base URL it
uses, and which `Surveillance/*` (and `Msme/*`) actions it calls, in which order (in particular whether
`SubmitFinancialAssistanceDetails` and `SubmitEsgChecklist` come before `FinalSubmit`), and whether it sends
`deviceInfo` and the assessor id (`saId`) on calls after login. Also which app calls `Msme/SubmitSurveillancePhoto`
(the main MSME app during a surveillance meeting?).

## v2: token-based API (for the next app release)

Design, for the app vendor. Not built yet.

- **Base address** `/v2/`, JSON in camelCase, errors as RFC 7807 problem details. Uploads are
  multipart only (no base64 in JSON), with per-type size and extension limits.
- **Sign-in**: `POST /v2/auth/login {userName, password, deviceInfo}` returns
  `{accessToken, expiresIn, refreshToken, user}`.
  - Access token: random 256-bit value, 15 minutes, sent as `Authorization: Bearer`.
  - Refresh token: 30 days, bound to the device id, single use (each refresh returns a new one;
    reusing an old one revokes the whole session).
  - Both are stored hashed (SHA-256) in a `MobileSessions` table, so sessions can be listed and
    revoked; a password change or reset revokes all of the user's sessions.
  - OTP step-up for assessor apps on a new device (SMS to the registered mobile number).
- **Identity**: every v2 action takes the user from the token. `zedId`, `userName`, `saId` and
  `assessorId` in a request are ignored; an assessor's access to a unit is checked against the
  allotment on every call.
- **Same functions as v1**, under `/v2/msme/...`, `/v2/sa/...`, `/v2/ra/...`, with the same data
  so the app's screens do not change, and server-generated file names.
- **Passwords**: v2 login is where hashed passwords are introduced (SECURITY-FINDINGS #2): verify
  against the plain column once, then store a hash.
- **Retiring v1**: once most installs run the v2 app, set `Mobile:CheckMsmeVersion` so old
  versions are told to update, then switch v1 off.
