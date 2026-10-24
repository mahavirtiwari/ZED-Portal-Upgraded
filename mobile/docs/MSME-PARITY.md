# ZED Surveillance (`ZED_MSME_Bronze`) → React Native: parity checklist

Legacy: `ZED Mobile App Source Code\ZED\ZED_MSME_Bronze` (applicationId `com.qci.zed.bronzesurveillance`, versionName 1.8,
versionCode 12, label "ZED Surveillance"). React Native: `mobile/apps/msme` (same applicationId, 1.9 / 13).

**Which app this is.** Not the store MSME app: it is the **Bronze surveillance desktop-assessor build** of the MSME
code base (login with ZED ID, assessor ID and password; every call goes to `/surveillancemobileapi/surveillance/`),
as docs/mobile/MSME-APP.md found. Many MSME screens are still in its code but unreachable in this build (gone
layouts, hidden menu items, commented-out calls, server flags the surveillance host never sets). This checklist
lists every legacy screen and flow, says whether a user can reach it, and where it is in the new app.

Tested: **E** = on the Android emulator against the V4 MobileApi run locally with fake data (profile
`surveillance`, `mobile/tools/dev-seed`), **S** = on the emulator against staging `https://zedv3.qci.org.in`,
**U** = unit or screen test (`npm test`), **R** = reviewed against the legacy code only (not reachable on any
server, or needs hardware/services the emulator lacks). Every reachable row has E, S or U.

## Screens and flows

| # | Legacy screen / flow (source) | Reachable in the legacy build | React Native | Tested |
|---|---|---|---|---|
| 1 | Launcher: splash 2.5 s (`LauncherActivity`, `SplashFragment`) | yes | `LauncherScreen` (`Splash`) | E |
| 2 | Launcher: low RAM / low storage (< 128 MB) dialogs with "Exit" | yes | `startupChecks` (native `getMemoryInfo`) | R |
| 3 | Launcher: permissions dialog, location then camera, rationale, "Permission not granted", denied-for-good dialog that closes the app, "All the permissions granted…" | yes | `checkPermissions` | E (first run) |
| 4 | Login: ZED ID, Assessor ID, Password (eye toggle); blank field marker in that order; values upper-cased | yes | `LoginForm` | E, U |
| 5 | Login online → `surveillance/login`; error → snackbar with server message | yes | `LoginForm` + `MsmeApi.login` | S ("Invalid Credentials."), E |
| 6 | Login online, first time on the phone: response stored; later: local work kept, server statuses taken (`updateCertificationDetails`) | yes | `MsmeApp.onlineLoginSucceeded` | E, U |
| 7 | Login offline: stored password (ignore case) and stored data, else toast "Network Unavailable" | yes | `MsmeApp.offlineLogin` | U, E (cold start in airplane mode) |
| 8 | After login: toast "Login Success", Dashboard with My Certifications added, Enterprise Profile on top with Proceed and no menu | yes | `onLoginSuccess`, `DashboardScreen`, `MyAccountScreen` | E, U |
| 9 | Login pre-filled with test ZED ID / assessor ID (`donottranslate.xml` test values) | yes (test data in the release) | **not ported** (test data, not a feature) | — |
| 10 | Forgot password link; New User / Register Now box | no (`visibility="gone"`) | not shown (same) | R |
| 11 | Dashboard: header (menu, date "EEEE dd, MMM", title), "Welcome", enterprise card (type icon, unit name, unit address), "Bronze Surveillance" card → My Certifications, ZED gear divider | yes | `DashboardScreen` | E |
| 12 | Dashboard: "My Incentives" card, certification steps box, info icons | no (`gone`) | not shown | R |
| 13 | Dashboard back: "Are you sure you want to exit?" Yes/No | yes | `useBackHandler` in `DashboardScreen` | E |
| 14 | Drawer: header (close, banner, enterprise type, unit name, ZED ID copy → "Copied!"), Dashboard, View Profile, Contact ZED (mail zed@qcin.org), Logout, version "v1.9"; new: Pending Uploads | yes | `AppDrawer` | E (items, Pending Uploads); R (copy toast) |
| 15 | Drawer: My Documents, Incentives | no (`visible="false"`) | not shown | R |
| 16 | Enterprise Profile: Basic Information (ZED ID, Enterprise Name), Unit Address (address with map pin → `geo:` intent, State/UT, District, PIN), Unit SPOC (Email, Mobile), Proceed when opened after login | yes | `MyAccountScreen` | E |
| 17 | Change password (from the profile) | no (button `gone`, click commented out; server answers "Invalid Old Password." anyway) | not ported | R |
| 18 | My Certifications: Bronze card (title, status text, step icons, Bronze image), APPLY (no details / all levels inactive) → payment, arrow (status 1–4) → certification, overlay (status 0/5) | yes | `MyCertificationsScreen`, `CertificationCard` | E, U |
| 19 | My Certifications: Silver/Gold cards, pledge box and download | no (`gone`) | not shown | R |
| 20 | Certification click: GetParametersByType once, kept; error toast | yes | `useCertificationClick` | E |
| 21 | Certification options: card; Basic Information & Document Upload (status ≥ 2 or final submit done → "To view Basic Information & Documents uploaded, please login through the web module."; basic info SUBMITTED → Evidences; else Basic Information) | yes | `CertificationOptionsScreen` | E, U |
| 22 | Certification options: Non-conformances (only with an active NC), Certificate Download (URL), Download Report (no action, as legacy), Incentives (certified + URL), Remote Assessment (`remoteStatus` 1), Surveillance Assessment (active; not today → "This module will be activated on the scheduled assessment date only") | yes, by server status | same | U |
| 23 | Basic Information: selfie (1), site exterior photos (2), audits, products (add/edit/delete dialog), domestic customers, international customers (shown when a product is exported), raw material imported, raw materials (dialog), capacity units/value, utilisation units/value, outsourced processes, energy sources; Proceed: markers, "Missing/Invalid Data"; online → SubmitBasicInformation + SubmitPhotos per product → ESG; offline → ESG | yes | `BasicInformationScreen`, `ProductDialog`, `RawMaterialDialog` | E (online), U |
| 24 | Product / raw material dialog: name, exported, product photo (camera), label photo (camera/gallery/PDF), "Please enter all the required data"; raw material name, % with the percentage validator, countries multi-select (`countries.json`) | yes | `RowInfoDialog.tsx` | E, U |
| 25 | Row delete: "Delete!" / "Are you sure?" (No / Yes) | yes | `MultiRow` | R |
| 26 | ESG checklist: GetEsgChecklist (offline → "Please check the network connection and retry." Retry/Cancel), sections, single choice and dependent fields, "Please answer to all the questions.", offline → "Please check the network connection.", SubmitEsgChecklist → basic info SUBMITTED → Documents Upload; back → "Going back will loose the filled data." | yes | `EsgChecklistScreen`, `esg.ts` | E, U |
| 27 | Documents Upload: evidence list (grey tick / complete / done icons, open icon), long press → "Info" with iButton, yellow note "Sync your offline changes now" + UPLOAD online / reminder offline, red offline banner | yes | `EvidencesScreen` | E, U |
| 28 | Evidence dialog (not cancelable): "Attach photos (max. 5 photos)" (gallery/PDF when validation required), "Certificate Available" Yes/No, "There are photos already attached", Done → COMPLETED / SUBMITTED / IN_PROGRESS; online → sync; tapping a row with photos makes it COMPLETED again | yes | `EvidenceDialog` | E |
| 29 | Evidence sync: basic info first if not SUBMITTED, then SubmitEvidenceV2 per photo, "Please wait, this may take a while...", "Evidence submitted successfully" / alert with error | yes | `onSyncClick`, `submissions.syncEvidence` | E, U |
| 30 | Final submit block (shown when every evidence is SUBMITTED or not available): financial support Yes/No (No → "Enter Details" dialog: any documents, 3 types; SubmitFinancialAssistanceDetails), Silver upgrade, Handholding, confirmation check box (enables when valid: "Please enter all the required data" / "Invalid Data"), Final Submit → "Submitted successfully" → Dashboard | yes | `EvidencesScreen`, `PreFinalSubmitDialog` | E, U |
| 31 | Non-conformances list (NC 1–5 with status text, "Final Submit Done" snackbar, legend, "What is Non-Conformance?") | only when the server sets NC statuses; the surveillance login never does | `NonConformancesScreen` | U |
| 32 | NC details: site exterior photos, products, parameters with requirement options and "View NC", "Close Non-Conformance" → FinalSubmit → "Closed successfully" | as 31 | `NcDetailsScreen`, `OptionsList` | U |
| 33 | NC site photos / product / requirement forms (assessor remarks with VIEW, MSME remarks with 500 counter, photos), their messages (requirement shows "Product submitted successfully", a legacy bug kept) | as 31 | `NcSitePhotosScreen`, `NcProductScreen`, `NcRequirementScreen` | U |
| 34 | Surveillance NC (`isSurveillance`): msme/GetMsmeStatus first, msme/ base | no (GetMsmeStatus fails on this host; flag never set) | same, `isSurveillance` | U (requests) |
| 35 | Surveillance Assessment: selfie, exterior (2), interior (2), site tour (up to 100, name dialog "Site Tour Photo Name", re-capture of sent photos), Sync → msme/SubmitSurveillancePhoto, "Data submitted successfully" | no (`surveillanceStatus` never set by this host) | `SurveillanceScreen` | U |
| 36 | Remote assessment: CheckAssessment, assessment date, Proceed; representative, selfie, site photo, Submit Selfie, Start Assessment → Twilio token → Twilio video sample (`quickstart` VideoActivity) | no (`remoteStatus` never "1") | `RemoteAssessmentInitialScreen`, `RemoteAssessmentDetailsScreen`; the **video call is not ported** (Twilio sample module; see gaps) | R |
| 37 | Payment: disclaimer, instructions, details (GSTIN, TDS 2%/10% with TAN, joining reward apply/remove, summary rows), summary dialog, zero payment → success page; non-zero → CCAvenue India SDK; result pages (Success/Failure, Start Certification / Retry / back to dashboard) | yes (APPLY when the unit has no active level) | `PaymentScreen` (all pages, zero payment); **CCAvenue checkout not available** (see gaps) | U (summary), R |
| 38 | My Documents, Incentives, Financial Assistance, Graded Incentives, Registration (Udyam, captcha, pledge, e-mail OTP), Compliance and Certification Requirements screens, Topics/Questions pagers, Facilitator details, Certification details dialog | no (hidden or dead code in this build) | not ported | R |
| 39 | Header date, back bar "BACK … ZED ID", loading overlay "Please Wait", toasts, snackbars, dialogs, status bar colour, fonts, colours | yes | shared `ScreenFrame`, `UiHost`, `theme.ts` | E |
| 40 | **New in V4: Admin texts** (docs/mobile/APP-TEXTS.md): the texts this build shows (payment disclaimer, instructions, joining reward notes, payment success/failure, final submit confirmation, read-only message, "What is Non-Conformance?", offline banner, offline evidence note) come from `Content/Texts`, kept for offline use, legacy wording as fallback; a text switched off is not shown. Keys of hidden screens (registration, pledge, financial assistance, level info, steps, compliance, requirements check box) have their built-in wording but no screen in this build | — | `AppTexts`, `useAppText`, `HtmlText`, `content/builtInTexts.ts` | E (offline banner with an Admin text), U |
| 41 | **New in V4: configurable Basic Information** (docs/mobile/APP-FORMS.md): the screen is built from `Forms/Definition?form=msme.basicInfo` (labels, help, order, required, disabled fields, the Admin's own fields), kept for offline use, the legacy form as fallback; `customFields` + `formVersion` sent with SubmitBasicInformation; "form was changed" refusal reloads the definition | — | `BasicInformationScreen`, `forms.ts`, `AppForms`, `CustomFormField` | E (Admin label/help, two custom fields, a disabled field; "Required" marker; answers stored in `V4AppFormValues`, disabled field NULL; offline cold start keeps form and answers), U |

## Offline mode

| Legacy behaviour | React Native | Tested |
|---|---|---|
| Whole sign-in response with offline work in `QCI_MSME_DB.LoginData` (JSON), photos in Room `ZED_MSME_Media_DB.photos_table`, files in `filesDir` | the same databases opened in place, same tables and JSON field names (`LegacyLoginStore`, `PhotoStore`, `models.ts`) | U (legacy-format data), E |
| Password kept in clear (`EncCred`) for the offline login | salted PBKDF2 hash in the same column; legacy rows upgraded on first offline login | U |
| Screens check `isNetworkAvailable` before calls; offline work stays as statuses (COMPLETED, not SUBMITTED) until the user syncs | same checks; **plus** a persistent queue (`ZedSyncQueue`) of what must be sent, sent on reconnect / foreground / every 30 s / "Sync All" / "Pending Uploads", in order, retried with back-off, de-duplicated, refusals kept as failed with the server message | U, E |
| Basic information saved offline, sent later from the evidence sync | queued at once (`basicInfo`), and still sent first by the evidence sync | U, E |
| Evidences completed offline wait for UPLOAD | queued on Done; sent automatically when online | U, E |
| NC replies: no network check, the request fails with the error text | queued when offline or unanswered ("Saved on the phone. It will be sent when the connection returns.") | U |
| Surveillance photos: Sync button only | queued when offline | U |
| ESG checklist, pre-final submit, final submit, certification parameters, payment: online only | unchanged (online only) | E |
| Update from the legacy app | the new app reads the legacy files in place; after sign-in, evidences and NC items left COMPLETED are queued | U |

## Photos

| Legacy (`PhotoCaptureHelper`, `PhotosHelper`, `Utils`, `LocationFetcher`) | React Native | Tested |
|---|---|---|
| Location first (fused, high accuracy, ≤ 100 m, < 15 min, 10 s, last location fallback, mock refused), kept for the screen; GPS off → "Alert / Please Enable GPS/Location services" | `LocationFetcher.kt`, `usePhotoCapture` | E |
| Camera `ACTION_IMAGE_CAPTURE` into `cache/SharedDocs/Geostat_yyyyMMdd_HHmmss_*.jpg` via `${applicationId}.fileprovider` | `ZedDeviceModule.capturePhoto`, `zed_file_paths.xml` | E |
| `getBitmap` → scale to 1080 → EXIF rotation → stamp (time "MMM dd, yyyy h:mm a", "Lat: x,", "Long: y"; 20 px BLUE at x 20; y = h+15, 2h+15, 3h+15) | `PhotoPipeline.kt` (same calls) | E (file pulled: 810×1080, stamp as legacy) |
| base64 JPEG 75 in `photos_table.photo`; file `filesDir/<UUID>.jpg` JPEG 100; temp file deleted; id `<loginId><millis>`; owner `<MsmeId><ZedId>` | same | E (row and file checked) |
| Gallery pick (stamped like a capture), PDF pick ≤ 2 MB ("File size cannot exceed 2 MB") copied to `filesDir/<UUID>.pdf` | `pickImage`, `pickPdf`, `copyPdf` | R |
| Auto time off → "Your Date and Time settings are not set to Automatic Time zone…" and the screen closes | `TIME_NOT_AUTOMATIC` in `usePhotoCapture` | R |
| Row: thumbnail (PDF icon), "name\nCaptured at …", delete / done (sent) / replay (sent, replace allowed); tap → viewer (`SharedDocs/Image.jpg`, `PDF File.pdf`) | `PhotosField`, `openImage`, `openPdf` | E |
| Uploads: SubmitEvidenceV2 `file_data` (own file name), SubmitPhotos / SubmitNcProduct `files` (photoId + extension), SubmitNcRequirement `file_data`, JSON photos with base64 for basic info and NC site photos; metadata JSON without base64 | `MsmeApi` | U, E |

## Deliberate differences (each is an improvement or forced; nothing a user had is lost)

1. `deviceInfo` (deviceId, osVersion, apiLevel, device, modelProduct, manufacturer) and `version` on every request,
   multipart included: V4 records them at sign-in and with every change, and device binding can now protect this app.
2. Offline sign-in credential stored as a hash (legacy: the password itself).
3. HTTPS only with platform certificate checks (legacy: trust-all TLS, cleartext allowed); no request bodies logged;
   R8 shrinking in release.
4. Sync queue, "Sync All" header button (the legacy layout had it hidden) and the new "Pending Uploads" screen.
5. ESG: V4's built-in checklist has no `section_key`; the legacy app then crashed on Proceed (`getJSONArray("esgChecklist")`).
   The new app maps the sections by position (first `esgChecklist`, second `socialOhsChecklist`). A fetch error is shown
   instead of an empty form.
6. Online sign-in refreshes the stored offline credential with the password that just worked (legacy kept the first one).
7. A connected network whose server cannot be reached falls back to the offline login (legacy showed the connection error).
8. Removing the assessor selfie clears it (legacy kept the deleted photo in its data and failed at submit with
   "Assessor Selfie Missing").
9. Scoped storage: none needed; the legacy app already kept photos in its private `filesDir`.
10. Product and raw-material rows are saved as soon as they change (legacy: on Proceed only); with the configurable
    form every Basic Information answer is kept in the draft as it is entered (needed to keep answers across a
    refreshed definition).
11. Admin texts and the configurable Basic Information form (V4 features, rows 40 and 41). Until the server's
    definition arrives the legacy labels are shown; the server's standard form uses its own labels (e.g. "Assessor
    Selfie", "Monthly manufacturing capacity (value)"), which the app then shows.

## Gaps (listed, not invented)

| Gap | Why | Effect |
|---|---|---|
| **CCAvenue checkout** for a non-zero payment | the legacy app used the proprietary CCAvenue India SDK (`indiasdk_grid_v1.2.aar` in the legacy `libs/`), which must not be copied from the legacy package; it needs the vendor's SDK and terms | the app gets the payment token from `Pay/GetToken` and says "Online payment through CCAvenue is not available in this version of the app. Please make the payment on the ZED portal." Zero payments work. Reachable only for a unit without an active level, which an allotted desktop assessor's unit always has. |
| **Twilio video** of remote assessment | the legacy app embedded Twilio's quickstart sample module; unreachable on this host (`remoteStatus` never "1") | "Start Assessment" explains that the video assessment is not available |
| **Store MSME app** (Main system: registration, pledge, financial assistance, incentives, My Documents) | the only legacy source (`ZED_MSME_Bronze`) builds `com.qci.zed.bronzesurveillance`, where those screens are hidden; the store app's applicationId and source are not here | not ported; needs the user's decision and the store app's applicationId (the Admin texts for those screens already have built-in wording) |
| `Certificates/{ZedId}/Pledge.pdf`, `Msme/ViewStatus`, My Documents | hidden in this build; not served anonymously by V4 (MSME-APP.md) | none |

## Endpoints this app needs that V4 does not serve (backend not changed)

| Call | V4 | Note |
|---|---|---|
| `surveillance/GetEsgChecklist` | served, but the built-in JSON (`EsgChecklistJson`) has **no `section_key`** | the legacy app crashes on ESG Proceed against V4 unless the old site's `App_Data/EnvironmentalChecklist.json` (with keys) is in `Mobile:StorageRoot`; the new app copes either way. Add `section_key` (`esgChecklist`, `socialOhsChecklist`) to the built-in JSON. |
| `surveillance/GetMsmeStatus` | HTTP 500 by design (old failure kept) | only the surveillance NC flow calls it (unreachable) |
| `surveillancemobileapi/msme/GetMsmeStatus`, `FinalSubmit`, `GetNcDetailsByType`, `SubmitSiteExteriorInfo`, `SubmitNcProduct`, `SubmitNcRequirement` | not served on the surveillance deployment | surveillance NC flow, unreachable (MOBILE-API.md "Not served on this deployment") |
| `surveillance/SubmitFacilitatorDetails` | not served (404) | dead code in the legacy app too, not called |

## Verification log

- Staging (`zedv3.qci.org.in`): the app reaches the server; a fake login answers "Invalid Credentials." (snackbar). No staging test account exists for this app (staging holds production copies), so the
  signed-in flows were run against the local V4 MobileApi with fake data, as agreed with the parent session.
- Local V4 (fake unit `ZEDRNTEST0001`, assessor `ZEDRNSA01`; emulator android-35 x86_64), 2026-10-24:
  - login → Enterprise Profile → My Certifications → parameters → Basic Information with selfie, site photo and a
    product with two photos (one through the "Take Photo" menu) → SubmitBasicInformation and SubmitPhotos accepted
    (rows in `MsmeCertifications`, files in `Photos/ZEDRNTEST0001/Bronze/...` under the app's photo ids);
  - photo pulled from the phone: `filesDir/<UUID>.jpg`, 810×1080, stamp as legacy; `photos_table` row as legacy; the
    `SharedDocs` temp file deleted;
  - ESG checklist answered → SubmitEsgChecklist → Documents Upload (needed the local stand-in for `dbo.CheckListReport`,
    `tools/dev-seed/local-db-gaps.sql`: without it the procedure fails after saving and the app shows the legacy
    "Error occurred while submitting basic info: …" toast, which was also checked);
  - evidence 1 captured and Done online → synced at once (`MsmeEvidences.SyncedDate`, photo and server PDF stored);
    "Certificate Available" No → done without photos;
  - **offline**: airplane mode on → red banner; evidence 2 captured (location from the fused provider) and Done →
    amber "Don't forget to sync…" row, "SYNC ALL (1)"; app force-stopped and restarted cold (APK with the bundle
    embedded, `-PzedBundleDebug=true`) → offline login with the stored credential → stored work shown; Pending
    Uploads lists "Evidence: Photo of the test records / Waiting to be sent"; airplane mode off → sent automatically
    within 10 s (`SyncedDate` set, files on the server), Pending Uploads "Nothing is waiting to be sent.";
  - evidence 4 online → final-submit block appears; financial support No → "Enter Details" dialog (any documents Yes,
    one type) → Silver Yes, Handholding No, confirmation → FINAL SUBMIT → "Submitted successfully", back to My
    Certifications with step 1 done; server: `CertificationStatus` 2, `EvidenceSubmissionDate` set;
  - drawer items, Pending Uploads, dashboard back → "Are you sure you want to exit?".
- Local database gaps met (not app or API issues): `dbo.CheckListReport` (above) and `dbo.V4LoginEvents` (V4 sign-in
  audit, migration 0013 not applied locally; the API only logs a warning) are missing from the local `ZED_SURVEILLANCE`.
- Release APK: `./gradlew assembleRelease` (R8 on, debug-signed without the keystore) builds and starts on the emulator.
- Admin texts and forms (local MobileApi rebuilt from main with commit 04072da, migrations 0016/0017 on the local
  database, fake Admin changes from `tools/dev-seed/admin-changes-demo.sql`): the Basic Information screen showed the
  Admin's label and help, the custom "GST number" (required) and "Number of employees" fields, no "Processes
  Outsourced"; Proceed without GST → "Required" marker; with it → SubmitBasicInformation accepted (formVersion sent),
  `V4AppFormValues` holds both answers, `OutsourcedProcesses` NULL, ESG checklist opened; the offline banner showed the
  Admin's text; a cold start in airplane mode showed the same form with the entered answers. The fake changes were
  removed afterwards.
- Release APK also signs in offline (R8 did not break SQLite or the native module).
- Unit and screen tests: 45 (shared) + 38 (app) pass; `npm run typecheck` clean.
