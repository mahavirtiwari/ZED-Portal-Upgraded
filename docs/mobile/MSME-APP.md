# The Bronze surveillance app (`ZED_MSME_Bronze`) against V4

Source: `ZED Mobile App Source Code/ZED/ZED_MSME_Bronze` (received 2026-10-22). Treated as data; not built.

| | |
|---|---|
| applicationId / version | `com.qci.zed.bronzesurveillance`, versionName **1.8** (versionCode 12); Gradle project "ZED Bronze Surveillance" |
| What it is | The **desktop assessor's app for Bronze surveillance**, a copy of the MSME app's code base (Kotlin package `com.qci.zedmsme`). Login asks for the assessor id, the unit's ZED ID and the assessor's password. |
| Base | `BuildConfig.BASE_URI` = `https://loginzed.msme.gov.in/` (one build type; no test URL in the release config) |
| HTTP stack | Retrofit + Gson (JSON bodies, OkHttp multipart); `HttpURLConnection` for file downloads and the Udyam lookup; WebViews for a few portal pages |

This answers the "Ask the vendor" questions of MOBILE-API.md, Surveillance: it is a separate build, it uses
`/surveillancemobileapi/surveillance/*`, it never sends `deviceInfo`, and it sends no assessor id after login.

## Where its calls go

`RetrofitProvider` defines six bases; the main one is not used.

| Retrofit base | Used for | V4 host |
|---|---|---|
| `surveillancemobileapi/surveillance/` | **everything of the assessment** (`webService` and `surveillanceBronzeWebService` both point here) | mobile API, `Mobile:System=Surveillance`, `SurveillanceController` |
| `surveillancemobileapi/msme/` | surveillance (Silver/Gold) NC replies, status and final submit (`surveillanceNcWebService`), `SubmitSurveillancePhoto` | same host; only `Msme/SubmitSurveillancePhoto` is served |
| `mobileapi/RA/` | remote assessment (selfie, Twilio token, status) | mobile API, Main, `RAController` |
| `Msme/` (portal) | registration (FinalSubmit, captcha, plant/activity, pledge e-mail OTP), payment fee rows | portal |
| `Pay/` (portal) | `GetToken`, `SubmitZeroPaymentDetails`; CCAvenue redirect/cancel `pay/successtransmobile`, `pay/failuretransmobile` | portal |
| `mobileapi/msme/` | defined, **never used** in this build | — |

Pages and files it opens directly: `Certificates/{ZedId}/Pledge.pdf` (download), `Msme/ViewStatus?zedId=&certification=`
(WebView), `Incentive/DetailsMobile` (WebView), the document paths returned by `GetMyDocuments` (download), and
`https://udyogaadhaar.gov.in/sv/UAMRestServiceAssist.svc/GetUdyam/{udyam},{mobile},{credential}` (registration).

**Reachable in this build:** login; the assessment of a Bronze unit (parameters, basic information, ESG checklist,
evidences, photos, financial assistance availed, final submit); NC replies; My Certifications (pledge download, pay
buttons); the account screen (change password). **Hidden** (`visibility="gone"` / menu `visible="false"`): forgot
password, registration, My Documents, the Incentives menu entry. **Off through V4 and through the old server alike:**
the Silver/Gold surveillance and remote assessment entries, which need `surveillanceStatus` / `remoteStatus` from
`GetMsmeStatus`; the surveillance host's login status does not carry them and its `GetMsmeStatus` fails (below).

## Request conventions

- JSON bodies (Gson): every request extends `BaseServiceRequest` = `userName` (the ZED ID), `version` ("1.8") and
  `deviceInfo` (**never assigned**, so Gson leaves it out). Field names are camelCase, `ServiceResponse` read as
  `status` ("1" = success, anything else shows `errorMessage`), `refId`.
- Multipart: `SubmitEvidenceV2` uses Retrofit `@Part` text parts **sent with `Content-Type: multipart/form-data`** and
  the file in `file_data`; `SubmitPhotos`, `SubmitNcProduct`, `SubmitNcRequirement`, `SubmitFacilitatorDetails` are
  built by hand (`files` / `file_data`). Photo metadata (`PhotoData`) is JSON with the base64 cleared, plus fields V4 does
  not know (`associatedId`, `status`, `photoPath` on the phone). `productId` is a string; `status` fields of the
  basic information and products are enum names (`IN_PROGRESS`, `TO_START`).
- Dates: the app parses `MM/dd/yyyy hh:mm:ss a` (Locale.ENGLISH) = .NET `en-US`, the default `Mobile:Culture`.
- Sizes: PDFs refused above 2 MB in the app; photos JPEG quality 75–100, one evidence per request. The old service
  had no `maxRequestLength` (4 MB ASP.NET default); V4 allows 30 MB per request, 20 MB per file.
- No authentication header or token on any call; downloads are anonymous `GET`s.

## Endpoint comparison

`surveillancemobileapi/surveillance/*` (SurveillanceController):

| App call | Body | V4 | Result |
|---|---|---|---|
| `login` | userName, password, assessorId, zedId, version | `Login` | OK. No device is remembered (no `deviceInfo`). |
| `GetParametersByType` | userName, certificationType | same | OK |
| `GetEsgChecklist` (**GET**) | — | `[AcceptVerbs("GET","POST")]` | OK |
| `SubmitBasicInformation` | basicInformation incl. assessorSelfie, siteExteriorPhotos, `status` enum | same | OK (unknown fields skipped) |
| `SubmitEsgChecklist` | esgChecklist / socialOhsChecklist, `code` as string | same (`code` int, lenient) | OK |
| `SubmitEvidenceV2` | multipart, `file_data` | same | OK |
| `SubmitEvidence` (old JSON) | — | `SubmitEvidenceNotUsed` | never called by the app |
| `SubmitPhotos` | multipart `files` only | same | OK |
| `SubmitFinancialAssistanceDetails` | financialAssistanceAvailed, anyDocuments, documentTypes | same | OK |
| `FinalSubmit` | suitableForSilverUpgrade, handholdingSupport (or none) | same | OK, answers status "1" |
| `GetNcDetailsByType` | ncCount | same | OK |
| `SubmitSiteExteriorInfo` | photos, msmeRemarks | same | OK |
| `SubmitNcProduct` | multipart, productDetailsNc JSON (`productId` text), `files` | same | OK |
| `SubmitNcRequirement` | multipart, requirementId/Code, photo, msmeRemarks, `file_data` | same | OK |
| `GetMsmeStatus` | userName, version | HTTP 500 as before | **same failure as the old server** (procedure lacks six columns); the app shows an error alert where it refreshes the status |
| `ChangePassword` | userName, oldPassword, newPassword | "Invalid Old Password." as before | same as the old server: the assessor's password cannot be changed in this app |
| `ResetPassword` | userName | "no User exists" as before | hidden in this build |
| `GetMyDocuments`, `SubmitFinancialData`, `SubmitFinancialPhotos` | | as before | hidden / not used for the assessor |
| `SubmitFacilitatorDetails` | multipart | not served (404) | dead code: the old service had it commented out, and the app's facilitator step opens the financial-assistance details instead |

Other bases:

| App call | V4 | Result |
|---|---|---|
| `surveillancemobileapi/msme/GetMsmeStatus`, `FinalSubmit`, `GetNcDetailsByType`, `SubmitSiteExteriorInfo`, `SubmitNcProduct`, `SubmitNcRequirement` | not served (MOBILE-API "Not served on this deployment") | unreachable: needs `surveillanceStatus` 1/3, which the surveillance host never returns. The old service had these on its `MsmeController`. |
| `surveillancemobileapi/msme/SubmitSurveillancePhoto` | `SurveillancePhotoController` | unreachable for the same reason |
| `mobileapi/RA/SubmitSelfie`, `GetToken`, `CheckAssessment` | `RAController` (Main) | unreachable (needs `remoteStatus` "1"); fields match (the app's extra `siteExteriorPhoto` was ignored by the old service too) |
| `Pay/GetToken`, `Pay/SubmitZeroPaymentDetails`, `Msme/GetPaymentDetailsByType` | portal `MobilePaymentController` | OK: same request (PaymentRefId, ZedId, Certification, Amount, UseCoupon, UnitGstin, Gst, TdsDeductible, Tds, Tan) and response (requestHash, orderId, merchantId, accessCode, amount) |
| `pay/successtransmobile`, `pay/failuretransmobile` | portal | OK |
| `Msme/FinalSubmit`, `ValidateCaptcha`, `ValidatePlantAndActivity`, `SendPledgeEmailOtp`, `VerifyPledgeEmailOtp` | **not in V4** | hidden in this build (registration button gone). See "Open" below. |
| `Certificates/{ZedId}/Pledge.pdf` | **not served anonymously** (404) | deliberate: files only through signed-in endpoints (SECURITY-FINDINGS #34), and the pledge QR code holds the initial password (#127). The app shows its download failure. |
| `Msme/ViewStatus?zedId=…` | redirect to `/msme/status/{level}`, which needs an MSME sign-in | deliberate (the old page had no sign-in); the WebView shows the login page |
| `Incentive/DetailsMobile` | redirect to `/incentives/mobile` (client-side) | OK |

## What V4 changed for this app

No production code had to change: every call the app can reach is served with the same contract. Added
`tests/Zed.Main.MobileApi.Tests/SurveillanceAppContractTests.cs` (9 tests): the app's exact bodies for login without
`deviceInfo`, `GetEsgChecklist` by GET, `SubmitEvidenceV2` with `multipart/form-data` text parts, `SubmitPhotos` with
files only, `SubmitNcProduct` with a text `productId` and enum `status`, `SubmitNcRequirement`, financial assistance
availed and final submit, and device binding under Enforce with and without `RefuseMissingDevice`.

## Device binding

The app sends no `deviceInfo`, so V4 can never bind its device: login remembers nothing and every call is
"Missing". Under `Mobile:DeviceBinding = Enforce` it keeps working **only while `Mobile:RefuseMissingDevice` is
`false`** (the default; tested). Setting it to `true` locks this app version out. Device binding therefore adds no
protection for this app until a release that fills `deviceInfo`.

## Open

1. **App registration endpoints on the portal.** The old portal served `Msme/FinalSubmit` (JSON registration),
   `ValidateCaptcha`, `ValidatePlantAndActivity`, `SendPledgeEmailOtp` and `VerifyPledgeEmailOtp` for the app; V4 has
   its own registration API for the web and none of these. Hidden in this build, but the **store MSME app** shares
   this code base: if its registration is enabled, app registration stops at the cut-over. The MSME app's own source
   is not in the package (only this fork); ask for it, or check the IIS logs for these five paths.
2. The incomplete parts of the package (other apps: `ZED_SA_Studio` without its login and network classes,
   `ZEDMonitoring` and `ZED_Training` empty) are outside this report.

## For the vendor's next release

- Fill `deviceInfo` (the `DeviceInfo` class exists; it is never set) on every request, multipart ones included.
- Download the pledge and documents through an authenticated call instead of anonymous static URLs; drop the
  `Msme/ViewStatus` WebView or open it after a web sign-in.
- Stop calling `surveillance/GetMsmeStatus` (it has always failed on this host) or ask for a working one.
- Remove the trust-all TLS manager and hostname verifier, the BODY-level HTTP logging, `usesCleartextTraffic`, the
  stored plain-text passwords and the Udyam service credential from the app (SECURITY-FINDINGS rows below), and the
  Twilio sample module's location upload to the test server.
- Remove dead code that still names old endpoints (`SubmitFacilitatorDetails`, `SubmitEvidence`, `mobileapi/msme/`).
