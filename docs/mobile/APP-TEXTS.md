# App texts (Admin → Texts)

New in V4: the disclaimers, instructions, undertakings, pledges and confirmation texts of the mobile apps can be
changed by the Admin under **Admin → Texts** on the portal of the same system (tab "Mobile app"). The standard wording
is the legacy app's own (`backend/src/Zed.Core/Content/ContentCatalogue.Apps.cs`); keys never change.

## Endpoint

`Content/Texts` on the mobile host (GET or POST, no body, anonymous), for example `/mobileapi/Content/Texts` (Main),
`/surveillancemobileapi/Content/Texts` (Surveillance), the consultancy mobile API for the Consultant app.

```json
{ "status": "1", "texts": [ { "key": "app.msme.registration.pledge", "enabled": true, "html": "<p>We undertake …</p>" } ] }
```

- Only the App texts of the host's system are returned (the web texts are served by the portal's `api/content`).
- `enabled: false`: the Admin switched the text off; the app does not show it (for a checkbox: no label text, the app
  decides whether the checkbox stays).
- `html` is the Admin's text, or the standard one. It is simple HTML (`<p>`, `<br>`, `<ol>`/`<ul>`/`<li>`, `<b>`,
  `<a href>`); render it with `Html.fromHtml` (or the React Native equivalent). A short text (checkbox label, alert) is
  plain text without a paragraph.
- `{{Field}}` placeholders are filled in by the app, HTML-encoded (`&`, `<`, `>`, `"`, `'`); an unknown field becomes
  empty. The Admin can only use the fields listed below.
- The apps load the texts at start (and after login), **keep the last answer for offline use**, and fall back to their
  built-in wording when there is no answer yet, a key is missing, or the call fails.

## MSME app (`ZED_MSME_Bronze`, package `com.qci.zedmsme`)

Paths: `DNT` = `app/src/main/res/values/donottranslate.xml`, `strings.xml` = `app/src/main/res/values/strings.xml`,
Kotlin files under `app/src/main/java/com/qci/zedmsme/`. Systems: Main = the store MSME app on the main mobile host;
Surveillance = the Bronze surveillance build (`com.qci.zed.bronzesurveillance`) on the surveillance host, for the
screens that build shows (registration, My Documents and the Incentives menu are hidden there, the compliance step is
switched off; docs/mobile/MSME-APP.md).

| Key | Name | Legacy app | Fields | Systems |
|---|---|---|---|---|
| `app.msme.certification.payment.disclaimer` | Certification payment: disclaimer | DNT:265–272 `disclaimer_paragraph` + `disclaimer_points`; `PaymentDisclaimerFragment` | | Main, Surveillance |
| `app.msme.certification.payment.instructions` | Certification payment: instructions | DNT:274–280 `payment_instructions`; `PaymentInstructionsFragment` | | Main, Surveillance |
| `app.msme.payment.joiningReward.note` | Payment: joining reward note | DNT:168 `applicable_only_on_one_certification…`; `fragment_payment_details.xml` | | Main, Surveillance |
| `app.msme.payment.joiningReward.bronzeNote` | Payment: balance joining reward note (Bronze) | DNT:169–171 `reward_additional_hint`; shown for a Bronze payment only (`PaymentDetailsFragment.kt:254`) | | Main, Surveillance |
| `app.msme.payment.success` | Payment: success message | DNT:288 `payment_success_message` (the app replaced `__`); `PaymentResultFragment.kt:73` | `{{Certification}}` (Bronze, Silver, Gold) | Main, Surveillance |
| `app.msme.payment.failure` | Payment: failure message | DNT:289 `payment_failure_message`; `PaymentResultFragment.kt:87` | | Main, Surveillance |
| `app.msme.schemes.fa.disclaimer` | Financial Assistance: disclaimer | DNT:300–316 `fin_disclaimer_points`; `FinAssistanceDisclaimerFragment` | | Main |
| `app.msme.schemes.fa.instructions` | Financial Assistance: instructions | DNT:318–326 `fin_instructions`; `FinAssistanceInstructionsFragment` | | Main |
| `app.msme.schemes.fa.accountDeclaration.checkbox` | Financial Assistance: account details declaration (checkbox) | DNT:351 `account_details_confirmation`; `fragment_finassistance_details.xml` | | Main |
| `app.msme.login.newUserEligibility` | Login: new user eligibility | DNT:119 `registration_text`; `fragment_login.xml` | | Main |
| `app.msme.registration.welcome` | Registration: before you start | DNT:123–129 `to_proceed`, `point_one`…`point_four`, `registration_link`; `MsmeRegistrationFragment` | | Main |
| `app.msme.registration.validatedNote` | Registration: details validated note | DNT:132 `details_validated`; `fragment_unit_activity.xml` | | Main |
| `app.msme.registration.confirm.checkbox` | Registration: confirm the details (checkbox) | DNT:196 `registration_info_confirmation_text`; `fragment_registration_summary.xml` | | Main |
| `app.msme.registration.pledge` | Registration: ZED pledge | DNT:142 `pledge_text`; `PledgeFragment` (the legacy "our plant" is "our planet", as on the web and the certificate) | | Main |
| `app.msme.registration.emailNote` | Registration: e-mail note | DNT:149 `your_zed_id_password_and_other_details…`; `fragment_registration_email.xml` | | Main |
| `app.msme.registration.otpSent` | Registration: e-mail OTP sent | `fragments/registration/VerifyEmailOtpDialogFragment.kt:48` (built in code) | `{{Email}}` | Main |
| `app.msme.registration.success` | Registration: success | DNT:150–156 `congrats_now_you_can_avail`, `registration_success_point_one`…`five`, `what_next`; `RegistrationSuccessFragment` | | Main |
| `app.msme.dashboard.certificationSteps` | Dashboard: ZED certification steps | DNT:202–212 `step_1_label`…`step_5_value`; `DashboardActivity.kt:219` | | Main, Surveillance |
| `app.msme.dashboard.levelInfo.bronze` | My Certifications: Bronze level information | DNT:217–218; `MyCertificationsFragment.kt:196` | | Main, Surveillance |
| `app.msme.dashboard.levelInfo.silver` | My Certifications: Silver level information | DNT:219–220; `MyCertificationsFragment.kt:201` | | Main, Surveillance |
| `app.msme.dashboard.levelInfo.gold` | My Certifications: Gold level information | DNT:221–222; `MyCertificationsFragment.kt:206` | | Main, Surveillance |
| `app.msme.dashboard.info.myCertifications` | Dashboard: My Certifications information | DNT:364 `my_certifications_info`; `DashboardActivity.kt:75` | | Main |
| `app.msme.dashboard.info.myIncentives` | Dashboard: My Incentives information | DNT:365 `my_incentives_info`; `DashboardActivity.kt:84` | | Main |
| `app.msme.incentives.joiningReward.availInfo` | My Incentives: how to avail the joining reward | DNT:245 `joining_reward_avail_info`; `MyIncentivesFragment.kt:245` | | Main |
| `app.msme.assessment.complianceUndertaking` | Assessment: undertaking of compliances | strings.xml:2–3 `compliance_text` (the heading strings.xml:14 `undertaking_of_compliances` stays in the app); `fragment_compliance.xml` | | Main |
| `app.msme.assessment.requirementsAccepted.checkbox` | Assessment: certification requirements read (checkbox) | DNT:21 `certification_req_check_text`; `fragment_certification_requirements.xml` | | Main, Surveillance |
| `app.msme.evidences.finalSubmit.confirm` | Evidences: final submit confirmation | DNT:89 `final_submit_confirmation_text`; `activity_evidences.xml` | | Main, Surveillance |
| `app.msme.certification.readOnly` | Certification: read-only message | DNT:374 `certification_read_only_message`; `CertificationOptionsFragment.kt:79, :82` | | Main, Surveillance |
| `app.msme.nc.whatIsNc` | Non-conformances: what is a non-conformance | DNT:231 `nc_text`; `NonConformancesActivity.kt:138` | | Main, Surveillance |
| `app.msme.offline.note` | Offline: banner | DNT:225 `offline_note`; `activity_base.xml` | | Main, Surveillance |
| `app.msme.offline.evidenceNote` | Offline: evidence not synced | DNT:226 `offline_note_2`; `utils/EvidenceListAdapter.kt:91` | | Main, Surveillance |

## Assessor app (`ZED_SA_Studio`, package `com.geostat.assessment`)

Files under `app/src/main/java/com/geostat/assessment/activities/`.

| Key | Name | Legacy app | Fields | Systems |
|---|---|---|---|---|
| `app.assessor.siteTour.pickInstruction` | Site tour: pick a photo | `SiteTourActivity.java:71` (alert, built in code) | | Main |
| `app.assessor.siteTour.tourInstruction` | Site tour: capture photos | `SiteTourActivity.java:85` (alert) | | Main |
| `app.assessor.login.windowNote` | Login: two days before the site assessment | `LoginActivity.java:109` (alert) | | Main |

## Consultant app (`ZEDConsultant`, package `com.geostat.assessment`)

Files under `app/src/main/java/com/geostat/assessment/activities/`.

| Key | Name | Legacy app | Fields | Systems |
|---|---|---|---|---|
| `app.consultant.siteTour.pickInstruction` | Site tour: pick a photo | `SiteTourActivity.java:76` (alert) | | Consultancy |
| `app.consultant.siteTour.tourInstruction` | Site tour: capture photos | `SiteTourActivity.java:90` (alert) | | Consultancy |
| `app.consultant.login.windowNote` | Login: two days before the site assessment | `LoginActivity.java:111` (alert) | | Consultancy |
| `app.consultant.tu.dataCorrect.checkbox` | Technology Upgradation: data is correct (checkbox) | `technologyupgradation/RejectCommentFragment.kt:65` ("Confirm Final Submit" dialog) | | Consultancy |
