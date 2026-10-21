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
