# ZED Consultancy (`ZEDConsultant`) → React Native: parity checklist

Legacy: `ZED Mobile App Source Code\ZED\ZEDConsultant` (applicationId `com.qci.zed.consultancy`, versionName 1.2,
versionCode 74, label "ZED Consultancy", calls `https://loginzed.msme.gov.in/consultancymobileapi/SA/`, the
consultancy web site `…/Consultancy/FinancialAssistance/…` and `…/mobileapi/photos/…`). React Native:
`mobile/apps/consultant` (same applicationId, 1.3 / 75). The app is a fork of the site assessment app; the React
Native app started as a copy of `apps/assessor` and was then changed to match this source (both on `@zed/shared`).

The app serves three kinds of users: the lead consultant and the co-consultant of a handholding milestone (1: baseline
diagnostic study and action plan; 2 and 3: progress reviews), and the DFO who verifies a technology upgradation
(milestone 4).

Tested: **E** = on the Android emulator against the V4 consultancy mobile host run locally with fake data
(`mobile/tools/dev-seed/seed-local-consultant.ps1`), **U** = unit or screen test (`npm test`), **R** = reviewed
against the legacy code only.

## Screens and flows

| # | Legacy screen / flow | React Native | Tested |
|---|---|---|---|
| 1 | SplashScreen, drawer menu (BaseDrawerActivity), OptionsInfoScreen, SelfieCapturingActivity, ParametersPagerActivity, QuestionsPagerActivity / QuestionsFragment, NewEvidenceActivity, the site tour's pick mode, BasicDetailsDisplayActivity (its button is hidden), OfflineDBManager | not reachable in the legacy app; not ported | R |
| 2 | Login: login image, banner, "Consultant/Expert ID" (pre-filled "ZEDCC"), "Password", "Applicant MSME ID" (pre-filled "ZEDMSME"), Login; the startup checks and permissions of the SA app | `LoginScreen` | E |
| 3 | getLoginRespose: first answer stored; a stored consultancy without parameters replaced unless it is a technology upgradation; "The milestones doesn't match, please check"; credential kept only when parameters are allotted; flags merged (open meeting, selfie, site tour, basic info); offline: stored credential and stored consultancy | `flows/login.ts` | E, U |
| 4 | Login window note (Admin text `app.consultant.login.windowNote`) | `LoginScreen` | R (Admin text path: E) |
| 5 | Company profile: "Welcome"; BASIC INFORMATION (BDS (From & To), HAP (From & To) on the first milestone, ZED ID, MSME NAME, SECTOR, OSA/DA SCORE), UNIT ADDRESS (address with the maps marker, State/UT, District, PIN Code), UNIT SPOC DETAILS (EMAIL, PHONE); Start Allocation / Proceed (allotted, co-consultant or technology upgradation); time checks; no attendance step | `CompanyProfileScreen` | E, U |
| 6 | Allocation (parameter names numbered "1 …"), "Allocation from Lead Consultant pending…" | `AllocationScreen`, `AlertScreen` | E |
| 7 | Dashboard: "Dashboard", rows with the coloured bar, label (" (Mandatory)" in red / " (Optional)"), status (Not completed / In Progress / Completed in teal bold; Submitted shown as Completed), arrow; the rows and their order per milestone and role; attendance opened by itself while today's punch-in is missing (not needed for technology upgradation); "Please log the attendance today to proceed", "Opening meeting is pending", "Please capture site photos to proceed", "Please complete all the sections in order to close the meeting", "Information already submitted"; Sync Data; Clear Data ("Are you sure you want to clear the data associated with this login?", No / Yes) | `AssessmentOptionsScreen` | E, U |
| 8 | Site Photos: "Site Exterior Photo (With Unit Name Board)", "Site Interior Photo (Working Area)", kept in the opening meeting row; back to the dashboard | `SiteImagesScreen` | E, U |
| 9 | Opening / closing meeting: the row's photos and comment, participants "Lead Consultant" / "Consultant", add / delete, geotag; the opening meeting sent (technology upgradation: `Consultancy/FinancialAssistance/SubmitOpenMeeting`), offline saved; the closing meeting goes to the final comments | `MeetingScreen` | E, U |
| 10 | Site tour (first milestone): instruction once (Admin text `app.consultant.siteTour.tourInstruction`), photos with comments, edit button, "n/20 Images Added" | `SiteTourScreen`, `NewSitePhotoScreen` | E |
| 11 | Training on ZED / on the Handholding Implementation Plan: Training Topic, Training Date (today on), Training Time, Remarks, Training Photo (5), Attendance Sheet (5); "Missing/Invalid Data"; uploads (SubmitPhotos, section = title) then SubmitZedTrainingInfo / SubmitHouseholdingTrainingInfo; offline saved | `TrainingScreen` | E, U |
| 12 | Baseline diagnostic study / handholding action plan / suggestion for technology intervention / progress review: the screen's own copy of the parameters, "PARAMETERS" list ("n Question(s) \| To Start / In Progress (Review Needed) / Completed / Submitted"), BACK / PROCEED (sends the completed parameters one after the other: evidences through SubmitPhotos, then SubmitBaselineDiagnostic / SubmitHandholdingActionPlan / SubmitTechnologyIntervention / SubmitProgressReview; all sent → submitted) | `ModuleScreen` | E, U |
| 13 | Requirement pages (swipeable): REQUIREMENT box with the options and sub-options; BDS: Conformance (Yes / No / Partial), Add Evidence (5), Gaps Identified (points), Remarks; HAP: Planned Activity(ies), Estimated Time (in days), Remarks; technology: Suggested Technology Intervention, Rationale, Remarks; progress review: "Is proposed activity completed?", evidences, Remarks, and VIEW of the BDS / HAP / technology answers (read-only pages); technology upgradation milestone: only the technology suggestion view; BACK / REVIEW / PROCEED with the legacy validations | `RequirementsScreen`, `RequirementReviewScreen` | E, U |
| 14 | Progress review selfie ("Consultant Selfie on Site", "Please capture selfie to proceed"; back without one leaves); sent first (SubmitPhotos "Progress Review", SubmitSelfie) | `ProgressReviewSelfieScreen` | E, U |
| 15 | Basic information: the nine groups with their status, each group's page with its headings (A. Electrical …, Emissions …) and fields ("Required"), PROCEED once all are completed; SubmitBasicInformation; offline saved | `BasicInformationScreen`, `BasicInfoSectionScreen` | E, U |
| 16 | Final comments: "Consultancy Summary" / "Comments"; not everything submitted → saved locally ("As there is data yet to submit…"); site tour not synced → "Please sync Site Tour in order to final submit"; basic information first (lead); added evidences three per request; SubmitEndAssessment; "Consultancy completed successfully…" | `FinalCommentsScreen` | E, U |
| 17 | Sync Data: Opening Meeting (any saved row), Selfie on Site, Site Tour (> 5 photos warning, chunks of 3), the allotted parameters (none in practice), the saved Closing Meeting / Final Comments ("Please submit all the sections in order to close the meeting"), "Assessment completed successfully…" | `SubmitParametersScreen` | E, U |
| 18 | Attendance: today's punch in / out, "Today's login already captured", Day Agenda, record with "Stage" (Milestone - n / Technology Upgradation); punch-out ends a technology upgradation on the phone | `AttendanceScreen`, `PunchInScreen`, `AttendanceLogScreen` | E, U |
| 19 | Technology upgradation: technologies (Completed / Not Completed), certificate, "Financial Details", cancelled cheque, Summary (accepted technologies, total, eligible amount, the legacy 300000.00 cap), Final Submission ("Confirm Final Submit": Accept / Reject, Comments, the Admin text `app.consultant.tu.dataCorrect.checkbox`); a technology's page (details, amount with its edit dialog → updatetechnology, documents, "Please validate all the documents"); document rows (image or PDF, VIEW downloads and opens it, VALIDATE / EDIT → "Verify Evidence": Verified, Capture Evidences, Remarks → ValidateEvidence); pending opening meeting check; back confirmation | `TechnologyUpgradationScreen` | U |

## Offline mode

| Legacy | React Native | Tested |
|---|---|---|
| Consultancy in `com.zed.assessmentdb` AssessorData (Gson JSON with dates as DateFormat.FULL), meeting rows, evidences; photos in Room `ZED_MSME_Media_DB` | same files, tables and JSON names, opened in place; the full-style dates are read in their Android variants and written the same way | U, E |
| Offline sign-in from `LoginActivity` preferences (Base64 of the password) | password kept as a salted hash (a legacy value is accepted once and replaced) | U, E |
| Opening meeting saved offline, sent from "Sync Data" | same, **plus** sent by the sync queue when the connection returns | U |
| Attendance saved offline: no way to send it (no "Sync Pending Data" in this app) | sent by the sync queue | U, E |
| Training details saved offline: sent when the consultant opens the screen again online | sent by the sync queue (files first) | U, E |
| Milestone sections, basic information, closing meeting: their screens' buttons | unchanged | U, E |

## Photos

| Legacy | React Native | Tested |
|---|---|---|
| Site, meeting and site tour photos (BaseActivity.displayImageWithUri): camera → 1280 px → EXIF → stamp → base64 **JPEG 100** in the JSON | native `processImageInlineQuality(…, 100)` | E |
| Evidences, training photos and sheets, attendance and progress review selfies, technology upgradation attachments (PhotoCaptureHelper): the MSME pipeline, file in filesDir, base64 in photos_table; uploaded through SubmitPhotos and the server path kept (`filePath`) | shared pipeline; photos missing on the phone are dropped with "Missing/corrupt images were removed, please capture again" | E, U |
| LocationFetcher without a fix: the last location, else 1.0, 1.0 | the same (native last location, then 1.0 / 1.0) | R |

## Deliberate differences

1. `deviceInfo` and `version` on every request.
2. HTTPS with platform certificate checks (the legacy disabled them up to Android 13); no request bodies logged.
3. Offline password stored as a hash.
4. The sync queue for the opening meeting, attendance and training saved offline.
5. Attendance marked synced only when the server accepts it.
6. Syncing a saved opening meeting no longer marks the site tour as submitted (the legacy did, which hid the site tour).
7. A call without an answer shows "Network not available" instead of the exception text.
8. New in V4: Admin texts and the configurable Basic Information form (`consultant.basicInfo`).

## Verification log

Emulator (Android 16, debug build) against the V4 consultancy mobile host on this PC (`Mobile__System=Consultancy`,
`http://localhost:5105/consultancymobileapi`, database `ZED_CONSULTANT`) with the fake unit of
`tools/dev-seed/seed-local-consultant.ps1`; each step checked in the database.

- **First milestone, lead:** login → profile (BDS and HAP dates, address and contact boxes) → allocation (one
  parameter each, review question) → status 9 with the sections assigned. Re-login → Proceed → attendance opened by
  itself → punch-in with selfie and Day Agenda (attendance row). Site photos → opening meeting (participants, comment,
  geotag; Meetings row and three photos). Training on ZED (past dates disabled in the date picker, 12-hour time
  picker; TrainingInfo and two TrainingPhotos rows, files in "Training on ZED"). Baseline diagnostic study (Yes with an
  evidence, No with a gap from the dialog; conformance, bullet and evidence rows). Basic Information (server
  definition, all nine groups; ConsultancyBasicInformation row). Handholding action plan (planned activities and
  estimated days on both pages; HandholdingActionPlan bullets). Technology suggestion (TechnologyIntervention bullets).
  Site tour (the instruction once, two photos with comments, "2/20 Images Added") → Sync Data sends it (two SiteTour
  photos, the row leaves the dashboard).
- **Offline:** Training on Handholding saved with the network off ("Network not available, your data will be saved
  locally.", the status stays "Not completed" as in the legacy) and sent by the sync queue after reconnecting (row
  and photos on the server within about 40 s; the dashboard then shows Completed). Cold start offline: sign-in with
  the stored credential → profile → attendance; a punch-in offline was sent by the queue about 10 s after reconnecting.
- **Closing:** the lead's closing meeting and Consultancy Summary before the co-consultant finished → the server's
  "All Parameters not synced yet for the ZEDID: …" (toast, data kept). Co-consultant on the same phone (its own
  data): attendance, baseline study and technology suggestion for its parameter, Final Submission ("Final Submit"
  meeting row, "Consultancy completed successfully…", phone data removed). Lead again: closing meeting photo and
  summary → "Close Meeting" row, unit status 13, phone data removed, back to the login screen.
- **Second milestone** (seed `-Milestone 2`): no HAP dates on the profile; allocation to lead and co-consultant;
  dashboard without the first milestone's sections; site photos and opening meeting; Progress Review 1 with the
  selfie check ("Please capture selfie to proceed"), the read-only VIEW of the first milestone's action plan, Yes with
  an evidence and No → answers stored (on the first milestone's rows, as the procedure does), selfie and evidence
  photos uploaded, status Completed. Clear Data ("Are you sure…", Yes) removed the consultancy and left the app.
- **Admin changes** (`tools/dev-seed/admin-changes-demo-consultant.sql`): after a restart the Financial Performance
  group showed the relabelled turnover with its help text and the custom required "Export markets" (Required until
  filled); the server served the Admin wording of the site tour instruction.
- Not run on the emulator: the technology upgradation (needs the consultancy web site and its FinancialAssistance
  data; covered by unit tests), the login window note (shown only when the server says the date is too far).
- Release APK (R8, debug-signed, `-PzedEnvironment=staging`): the first build had lost `zed_environment` to the
  resource shrinker and fell back to production; its one fake login (ids starting ZEDRN) was answered by the
  production consultancy server with the legacy "There is an Updated version of the app…" (status 2, before any
  credential check). Fixed in `@zed/shared` (`res/raw/zed_shared_keep.xml`). The rebuilt APK carries `zed_environment = staging`,
  starts with the teal status-bar strip on the login screen and reaches staging over HTTPS: the fake login (locked
  after a few earlier fake tries) answered "Too many failed attempts. Please try again after 15 minutes." No staging
  test account (staging holds production copies), so the signed-in flows were run locally with fake data.
- **Before publishing 1.3:** the production consultancy server checks the app version and refused "1.3"; its expected
  version has to be set to 1.3 when this build goes out (V4: `Mobile:CheckSaVersion` / `Mobile:SaVersion`; off by
  default), otherwise every consultant gets the update prompt.
- Test-script note: in the **debug** build, two "r" key presses in quick succession reload the JavaScript, also while
  typing in a dialog (React Native's dev support); release builds do not have it.
