# ZED SA (`ZED_SA_Studio`) → React Native: parity checklist

Legacy: `ZED Mobile App Source Code\ZED\ZED_SA_Studio` (applicationId `com.qci.zed.siteassessment`, versionName 1.2,
versionCode 45, label "ZED SA", calls `https://loginzed.msme.gov.in/mobileapi/SA/`). React Native: `mobile/apps/assessor`
(same applicationId, 1.3 / 46).

**Surveillance site assessor build.** There is no source for it: the package's `SurveillanceModuleChanges` overlay
holds 11 files of 0 bytes (FinalComments, Login, MeetingDataCollection, SelfieCapturing, SubmitParameters activities,
AssessmentDetails, RetrofitProvider, RestHelper, ServiceResponse, SubmitAssessmentRequest) and `ZED_SA.zip` is empty;
`ZEDSurveillance` (com.prd.zedsa.surveillance) points at an old vendor domain. V4 serves the same SA contract on the
surveillance host (`/surveillancemobileapi/SA/…`, login answers `IsSurveillance` and `MinimumParameters`, and V4 has
`SA/SubmitOfiComments`, which this source never calls). The app's API client already takes the host
(`SaApi(..., 'surveillance')`), but what the released surveillance build did differently (and its applicationId) is
unknown, so no second build is delivered.

Tested: **E** = on the Android emulator against the V4 MobileApi run locally with fake data (Main, port 5104,
`mobile/tools/dev-seed/seed-local-sa.ps1`), **U** = unit or screen test (`npm test`), **R** = reviewed against the
legacy code only.

## Screens and flows

| # | Legacy screen / flow | React Native | Tested |
|---|---|---|---|
| 1 | SplashScreen (3 s): in the manifest but not the launcher, never opened | not ported (unreachable) | R |
| 2 | Login (launcher): login image, banner, "Assessor ID" (pre-filled "ZEDAS"), "Password" (eye toggle), "MSME ID" (pre-filled "ZEDMSME"), Login; RAM < 256 MB / storage < 128 MB dialogs with Exit; permissions (location, camera; storage before Android 13) with the legacy dialogs | `LoginScreen` | E |
| 3 | Login: blank field → "Please enter all the details."; IDs trimmed and upper-cased, password trimmed; online `SA/Login` ("Please Wait..."), "1" → stored / merged + "Login Successful.", "2" → update dialog (Go to Play Store / Exit), else server message or "Invalid Username or Password"; offline → stored credential, else "Network Unavailable" | `flows/login.ts` | E, U |
| 4 | getLoginRespose: first answer stored, later sign-ins keep local work and take the server flags (open meeting, selfie, site tour, basic info, allowFinalSubmit); credential kept only when parameters are allotted; SiteTourStatusHelper local status (dead: empty ids); "There is an assessment already in progress…" (unreachable: same key) | `flows/login.ts` | U |
| 5 | Login with SA_DATE_DUE: "You can only login 2 days prior to your allocated Site Assessment date" (Admin text `app.assessor.login.windowNote`) | `LoginScreen` | U (text), R |
| 6 | Company profile: COMPANY PROFILE box (SA DATE as MM/dd/yyyy, ZED ID, MSME NAME, SECTOR (NIC 2 DIGIT), UNIT ADDRESS with marker → maps, EMAIL, PHONE, OSA/DA SCORE; blank rows hidden), "Show Company Details" (API basic information), "Start Allocation"/"Proceed"; automatic time check; SA date more than 2 days ahead → back to login; back → exit question | `CompanyProfileScreen` | E, U |
| 7 | Start: lead without parameters → Allocation or "No parameters to allocate"; assessor without parameters → "Allocation from Lead Assessor pending…" (EXIT closes the app); with parameters → "You can only start the Assessment on allotted SA Date", attendance (punch in) first, then the options | `CompanyProfileScreen`, `AlertScreen` | E (lead), U |
| 8 | Allocation: ALLOCATION DETAILS (count per assessor, collapsible), PARAMETERS (name, "Exempted", assessor picker "Select"/names, exempted disabled); unassigned → marker + "Please assign all the parameters to proceed"; first submit asks "Please review the allocated data before submission." (Review/Submit); online only; "Allocation Submitted successfully" → "Allocation Submitted" (EXIT → login) | `AllocationScreen`, `AlertScreen` | E, U |
| 9 | Assessment options: Attendance, Opening Meeting, Capture/Edit Basic Info, Site Tour, Start/Continue Assessment, Sync Assessment, Closing Meeting, Final Submission with the legacy visibility rules and checks; every step but Attendance needs today's punch-in ("Please log the attendance today to proceed"; the "already punched out" branch is unreachable, as in the legacy order) | `AssessmentOptionsScreen` | E, U |
| 10 | Opening meeting step 1: "Take Site Exterior Photo" / "Take Site Interior Photo" (location dialogs, camera), Proceed checks; draft in `meeting_data_prefs` | `SiteImagesScreen` | E |
| 11 | Meeting data: "Opening/Closing Meeting Photo", participants prefilled (assessors as "Lead Assessor"/"Assessor"; closing: opening participants), add (dialog with errors, max 15), delete (confirm), Comments (opening only), "Latitude : x" / "Longitude : y"; Submit (opening: SubmitStartAssessment, offline saved locally) / Proceed (closing → final comments) | `MeetingScreen` | E |
| 12 | Selfie on site: front camera, "SUBMIT & PROCEED", SubmitSelfie, offline saved locally → parameters | `SelfieScreen` | E |
| 13 | Parameters pager: two pages (both listing the parameters, as the legacy adapter built them), "OVERALL PROGRESS (n/N)", rows with status icon and "n Question(s) \| To Start/In Progress/Completed" (+ " (Review Needed)"), submitted → "This parameter is already submitted…" (No/Yes); after an edit the list keeps the "Mandatory" parameters (legacy) | `ParametersPagerScreen` | E, U |
| 14 | Questions: back arrow, parameter name, "i of N Question(s)", option bullets, "(Review Needed)", "More info", Selected Option / MSME / DA fields (blank hidden), Conformance Yes/No (opened evidences rule), Comments (counter 500), Add Evidence (≤ 5: "Add New" / "Pick from site tour", delete with confirm), Previous / Review / "Save >" ("Save" on the last); validation snackbars; statuses (In Progress / Completed); home icon; back on first page does nothing | `QuestionsPagerScreen` | E, U |
| 15 | New evidence: "Evidence" photo (location + camera), name (required, counter toast), "Add Evidence"; pick mode via site tour ("No Site Tour images available to pick from", "Request Cancelled") | `NewEvidenceScreen` | E |
| 16 | Site tour: instructions once (Admin texts `app.assessor.siteTour.tourInstruction` / `pickInstruction`), "n/20 Images Added", tiles (Take Photo / Add More), edit, Done; pick mode | `SiteTourScreen` | E |
| 17 | Site photo: "Site Photo" (camera at once for a new one, location reused), comment required, "Submit Photo" / "Update Photo", "Photo added successfully" | `NewSitePhotoScreen` | E |
| 18 | Sync Assessment: pending Opening Meeting / Selfie on Site / Site Tour rows (gates, >5 photos warning, chunks of 3), then completed parameters (Sync All, Sync Selected, Submit; missing-data alert; added evidences two by two before the parameter), "No data to sync", saved Closing Meeting / Final Comments (basic information first, SubmitEndAssessment, success → local data removed → login) | `SubmitParametersScreen`, `flows/submissions.ts` | E, U |
| 19 | Final comments: "Comments"/"Assessment Summary"; parameters not all submitted → saved locally; lead without submitted basic information → SubmitBasicInformation first; punch out required; "This might take a while, Please Wait..."; "1" → "Assessment completed successfully…"; "4" → saved with the server message; offline → saved | `FinalCommentsScreen` | E, U |
| 20 | Basic information: numbered questions 1–10, products / raw materials (full-screen forms with "Submit", "All the fields are required"), Submit (online, photos one per request) / Save > (completed); offline → "Network not available, your data will be saved locally." | `BasicInformationScreen`, `BasicInfoRowScreen` | E, U |
| 21 | Basic details display (API basic information): fields, Products, Raw Materials | `BasicDetailsDisplayScreen` | E |
| 22 | Attendance: Punch In / Punch Out times, buttons with their rules, "View Attendance Record" (per day, Date / In Time / Out Time / Total Hours, Close), "Sync Pending Data"; punch form with Selfie and Done; SubmitAttendance multipart; offline saved; punch-out after the closing meeting ends the assessment on the phone | `AttendanceScreen`, `PunchInScreen`, `AttendanceLogScreen` | E, U |
| 23 | Drawer menu (BaseDrawerActivity), OptionsInfoScreen, OfflineDBManager/OfflineAuditData/AuditCenterConstants, e-mail export of the closing meeting | dead code in the legacy app (never used) | R |

## Offline mode

| Legacy | React Native | Tested |
|---|---|---|
| Assessment in `com.zed.assessmentdb` AssessorData (Gson JSON) with the meeting and selfie requests saved offline; evidences in EvidenceData; photos in Room `ZED_MSME_Media_DB` | same database files, tables and JSON names, opened in place (`AssessorStore`, shared `PhotoStore`); meeting/selfie SQL now uses parameters (the legacy concatenated the JSON into the SQL) | U, E |
| Offline sign-in from `LoginActivity` preferences (Base64 of the password) | password kept as a salted hash in the same key (a legacy value is accepted once and replaced) | U, E |
| Opening meeting, selfie, attendance saved offline; sent from "Sync Assessment" | same, **plus** sent automatically by the sync queue when the connection returns (opening meeting before selfie) | U, E |
| Parameters, site tour, closing meeting: from "Sync Assessment" only | unchanged (sending them on their own would end steps the assessor may still be working on) | U, E |

## Photos

| Legacy | React Native | Tested |
|---|---|---|
| Meetings, selfie, evidences, site photos (BaseActivity.displayImageWithUri): camera → scale to 1280 → EXIF → stamp (time, Lat, Long) → base64 JPEG 75 (Base64.DEFAULT) in the JSON, camera file deleted | native `processImageInline` (same steps), `useInlineCapture` with the legacy location dialogs; the camera writes to the app's cache instead of the public gallery (deleted the same way) | E |
| Basic information and attendance (PhotoCaptureHelper): MSME pipeline (1080, file `filesDir/<UUID>.jpg`, base64 in photos_table), ids `<saId><millis>`, owner `<zedId><saId>` | shared pipeline (`useSaPhotoCapture`) | E |

## Deliberate differences

1. `deviceInfo` and `version` on every request (the legacy built them but never sent them).
2. HTTPS with platform certificate checks (the legacy disabled TLS checks on Android 13 and older); no request bodies logged.
3. Offline password stored as a hash.
4. The sync queue for what the user submitted offline.
5. Attendance marked synced only when the server accepts it (the legacy marked any HTTP answer as synced).
6. The attendance selfie metadata without the base64 (the file part carries it; the legacy sent both).
7. Back on the assessment options asks "Are you sure you want to exit?" (the legacy closed the screen and then asked).
8. New in V4: Admin texts and the configurable Basic Information form (`assessor.basicInfo`, numbered by position).

## Verification log

- Staging: the release APK (R8, debug-signed, `-PzedEnvironment=staging`) reaches the server over HTTPS; a fake
  login answers "Invalid credetials." (the server's spelling). No staging test account (staging holds production
  copies), so the signed-in flows were run against the local Main MobileApi with fake data.
- Local Main MobileApi (fake Silver unit `ZEDRNSA0001`, lead `ZEDRNLA01`, co-assessor `ZEDRNCA01`; emulator
  android-35 x86_64; debug APK with the bundle embedded), 2026-10-24:
  - login → company profile → Start Allocation: "Please assign all the parameters to proceed", picker (closes on
    tap), counts, review question, submit → server status 9, "Allocation Submitted" → EXIT → login;
  - Proceed → attendance first → punch in with a selfie → "Data submitted successfully" (`ZedDailyAttendance`, photo
    in `Attendance/ZEDRNSA0001/Silver/`) → assessment options;
  - opening meeting: exterior/interior photos (stamped), participants prefilled, add-participant dialog, Latitude /
    Longitude, Submit → meeting row and three photos in `SaPhotos`; selfie (front camera) → parameters list;
  - questions: Yes + new evidence ("Add New"), No + comment, Save → "Completed"; "Please add at least one Evidence"
    snackbar; site tour (instruction once, photo with comment, "1/20 Images Added"), then "Pick from site tour" as a
    second evidence;
  - Sync Assessment: Site Tour row first (photos in `SaPhotos/…/SiteTour`), then the parameter: evidences two by two
    and SubmitParameter → "Parameter submitted successfully" (`MsmeRequirements.SaConformance`/`SaAssessorRemarks`,
    two `SaRequirementPhotos` rows), "No data to sync";
  - Admin form and texts (migrations 0016/0017 and `tools/dev-seed/admin-changes-demo-sa.sql` on the local
    database): the relabelled audits question with its help text, two custom fields numbered in place, "Processes
    Outsourced" hidden; a product with a camera photo and a label photo (Take Photo / Gallery / PDF menu) → Submit →
    `SaProducts` row, both files in `SaPhotos/…/BasicInfo`, custom answers in `V4AppFormValues`;
  - **offline**: airplane mode → cold start → offline login with the stored credential → closing meeting photo and
    participants → final comments → "Network is not available. Data saved locally…";
  - **offline queue** (co-assessor, signed in online first): airplane mode → punch in ("Network unavailable, your data
    will be saved locally.") and selfie on site (saved locally) → airplane mode off → both sent by the queue without
    any tap (`ZedDailyAttendance` row and photo; selfie file in `SaPhotos`);
  - co-assessor: parameter, Submit → final submission → "Please perform punch out…" → punch out → SubmitEndAssessment
    → "Assessment completed successfully…" → login;
  - lead: Sync Assessment → saved Closing Meeting row → SubmitEndAssessment → "Assessment completed successfully…" →
    local data removed → login. (This run found a crash once the data was removed while the options screen was still
    in the stack; fixed in `App.tsx`, covered by a screen test.)
  - release APK (R8, debug-signed): starts, login screen, staging reachable (above).
- Tests: 25 unit/screen tests for the app (108 in all with `@zed/shared` and `@zed/msme`); typecheck clean.
