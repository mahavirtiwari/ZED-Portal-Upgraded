# Mobile apps: inventory of the vendor's source package

Source: `ZED Mobile App Source Code.zip` (vendor package, 3,953 files, 16 projects; every entry is dated 2026-09-24, the
day it was packed, so the dates say nothing about when each app last changed). Reviewed read-only on 2026-10-22; nothing
was built or run. Security review: [APPS-SECURITY.md](APPS-SECURITY.md).

## The apps

"Current" = targets Android 14+ (SDK 36) and calls loginzed.msme.gov.in. Versions are the ones in the source; check
them against the Play Console before trusting them.

| Project | Application id | Version (code) | SDK min / target | Code | Server it calls | Belongs to | V4 deployment | State |
|---|---|---|---|---|---|---|---|---|
| ZED_MSME_Bronze | com.qci.zed.bronzesurveillance | 1.8 (12) | 26 / 36 | Kotlin 119, Java 19 | `loginzed.msme.gov.in/` (`mobileapi/…`); Udyam service directly | **ZED MSME app** (registration, dashboard, payments, NCs, surveillance photos) | Zed.Main.MobileApi `Mobile:System=Main`, `/mobileapi` | current |
| ZED_SA_Studio | com.qci.zed.siteassessment | 1.2 (45) | 26 / 36 | Java 78, Kotlin 37 | `/mobileapi/SA/` | **ZED site assessor app** (main) | `/mobileapi` (Main) | current; see completeness |
| ZEDConsultant | com.qci.zed.consultancy | 1.2 (74) | 26 / 36 | Kotlin 83, Java 68 | `/consultancymobileapi/SA/`, `/mobileapi/`, web `/Consultancy/FinancialAssistance/…` | **ZED consultant app** (handholding, TU) | `/consultancymobileapi` (`Mobile:System=Consultancy`) **and** the V4 Consultancy portal | current |
| ImpactAssessment | com.qci.zed.impactassessment | 1.2 (33) | 26 / 36 | Kotlin 92, Java 71 | `/impactmobileapi/SA/`, `/liamobileapi/SA/`, plus ZED's `/mobileapi/` and `/Consultancy/FinancialAssistance/…` | Impact Assessment application (not ZED) | its own APIs are **not V4**; the ZED calls are served by V4 after the cut-over | current |
| LeanImpactAssessment | com.qci.zed.leanimpact | 1.2 (1) | 26 / 36 | Kotlin 92, Java 71 | `/impactmobileapi/SA/`, plus `/mobileapi/` and `/Consultancy/FinancialAssistance/…` | Lean Impact Assessment (not ZED) | as above | current; a signed `app-release.aab` is committed in `app/release/` |
| ZEDProfessionals | org.qcin.zed.professionals | 1.3 (11) | 24 / 33 | Java 81, Kotlin 22 | `training.zed.org.in/professional/…`, `pcsap.in` | ZED Professionals (training site) | not V4 | maintained, not on the latest SDK; signed `.aab` and `local.properties` committed |
| ZEDTraining | com.zed.training | 1.3.8 (15) | 24 / 31 | Java 62 | `training.zed.org.in` | training | not V4 | older |
| ZEDMonitoringStudio | com.zed.monitoring | 1.1 (7) | 26 / 36 | Java 100 | `training.zed.org.in` (professional, qualityprofessional) | monitoring of professionals (training site) | not V4 | current |
| ZED_Defence | com.zed.defence.geostat | 1.0.0 (1) | 19 / 22 | Java 61 | `http://45.114.245.113/defencemobileapi/…` (raw IP, cleartext), `assets.zedcs.com` | a defence variant by the vendor (GeoStat) | not V4 | **obsolete** |
| ZEDSurveillance | com.prd.zedsa.surveillance | 1.0 (1) | 19 / 28 | Java 64 | `sv.zedcs.com/SiteAssessment`, `assets.zedcs.com` | old surveillance assessor app | not V4 | **obsolete** (old vendor domain) |
| ZEDReassessment | com.prd.zed.reassessment | 1.0 (1) | 19 / 28 | Java 64 | `ra.zedcs.com/SiteAssessment` | old reassessment app | not V4 | **obsolete** |
| ZED_MAM | com.prd.zed.mam | 1.1 (2) | 19 / 28 | Java 65 | `mobile-api.zedcs.com/MAM/` | old app on the vendor's domain | not V4 | **obsolete** |
| ZED_DA | (manifest) com.zed.zeddaapplication | 1.0.0 (5) | 19 / 22 | Java 54 | `mobile-api.zedcs.com`, `assets.zedcs.com/Staging` | old desktop-assessment app | not V4 | **obsolete** (no Gradle build) |
| ZEDMonitoring | – | – | – | Java 162 (all empty) | – | old Eclipse/ADT monitoring project | – | **empty** |
| ZED_Training | – | – | – | Java 50 (all empty) | – | old training project | – | **empty** |

Forks: ZEDSurveillance, ZEDReassessment and ZED_MAM share the manifest package `com.zed.zedsaapplication` (the old
site-assessment app re-labelled per product; their update prompts open the Play listing `com.prd.zedsa.assessment`).
The current GeoStat-built apps (ZED_SA_Studio, ZEDConsultant, ImpactAssessment, LeanImpactAssessment) share one code
base (`com.geostat.assessment.*`, namespace `com.zed.zedsaapplication`) with near-identical login, storage and network
classes; ZEDProfessionals uses the `com.geostat.android` namespace. Libraries: Retrofit 2 + OkHttp + Gson in the
current apps; the MSME app adds RxJava 2, Ion, Room, Twilio Video (with Twilio's "quickstart" sample module built into
the app), CCAvenue India SDK and SafetyNet reCAPTCHA; the rest use Play Services location and AndroidX.

## Completeness

483 files are 0 bytes **in the vendor's zip itself** (not an extraction fault):

| Project | Empty | What |
|---|---|---|
| ZEDMonitoring | 303 | the whole project (sources, resources, `Model_Classes.zip`, `ZED_Documents.zip`, `ZED_New_Changes.zip`) |
| ZED_Training | 161 | the whole project |
| ZED_SA_Studio | 12 | `ZED_SA.zip`, and the overlay folder `SurveillanceModuleChanges/ZED/ZED_SA_Studio/` (its `app/build.gradle` and 10 sources: `LoginActivity`, `RestHelper`, `RetrofitProvider.kt`, `ServiceResponse`, `SubmitAssessmentRequest`, `AssessmentDetails`, `FinalCommentsActivity`, `SubmitParametersActivity`, `MeetingDataCollectionActivity`, `SelfieCapturingActivity`). The app's **main source is complete**; the overlay looks like the planned surveillance changes to the site assessor app, and it arrived empty. |
| ZEDConsultant | 4 | only `docs/` (two requirement documents, `BasicInfoModels.txt`, a store image); sources complete |
| ZEDTraining | 1 | `import-summary.txt` |
| top level | 2 | `app_icon.png`, `ZEDMonitoring.rar` |

Also in the package: `ZED_SA_Studio/ZED_SA_Old.zip` (64 sources, 2019, the old SA app, with a signing config),
`ZED_MSME_Bronze/app/src/main/java/com/twilio_backup.zip` (4 Twilio sample sources, 2021), two signed release bundles
(LeanImpactAssessment, ZEDProfessionals), and `ZEDProfessionals/local.properties` (a developer's SDK path). No keystore
files are included.

**The V4 Surveillance deployment serves the Bronze surveillance app.** `ZED_MSME_Bronze` (`com.qci.zed.bronzesurveillance`)
builds its base address in code, so a plain URL search missed it: it calls `/surveillancemobileapi/surveillance/*` and
`/surveillancemobileapi/msme/` (docs/mobile/MSME-APP.md). Missing from the package: the **surveillance site assessor
app** (ZEDSurveillance is the obsolete one on `sv.zedcs.com`; the SA app's surveillance overlay is empty) and the
**store MSME app** itself (ZED_MSME_Bronze is a copy of its code base).

## Consequences for V4 and the cut-over

- **The IIS site must keep the other applications' mobile APIs.** `/impactmobileapi` and `/liamobileapi` are on the same
  host as ZED; `Install-ZedIis.ps1` must not remove or shadow those applications.
- **Impact and Lean Impact also call ZED's endpoints** (`/mobileapi/…` and the Consultancy web
  `/Consultancy/FinancialAssistance/FinalSubmit|GetDetails|ValidateEvidence|updatetechnology`), so after the cut-over they
  depend on V4. They belong in the mobile contract check and in the cut-over tests (CUTOVER 2.1, "Mobile").
- The consultant app calls the Consultancy **web** paths `/Consultancy/FinancialAssistance/…` as well as its mobile API.
- The obsolete apps point at domains V4 does not serve (`*.zedcs.com`, a raw IP). If any is still installed, its users
  are unaffected by the cut-over and keep sending data to those servers: confirm with the vendor that those servers and
  apps are retired, and who owns the `zedcs.com` domains.

## What to ask the vendor for

1. The missing files: the `SurveillanceModuleChanges` overlay of ZED_SA_Studio (or confirmation it is abandoned),
   `ZED_SA.zip`, ZEDMonitoring and ZED_Training (or confirmation they are retired), and ZEDConsultant's `docs/`.
2. **The surveillance site assessor app and the store MSME app** (the Bronze surveillance app is here; these two are not).
3. For each live app: the Play Console package name, the version currently in the store and its minimum supported
   version (for `Mobile:` version gates), and whether the source given is exactly that version (tag or commit).
4. **Signing keys custody**: who holds the upload keys and keystores of every live app, whether Play App Signing is on,
   and that the obsolete projects' keystores (whose passwords are in their `build.gradle`) sign nothing live.
5. Ownership and status of `mobile-api.zedcs.com`, `sv.zedcs.com`, `ra.zedcs.com`, `assets.zedcs.com`, `45.114.245.113`
   and `zedtesting.qci.org.in`.
6. The fixes in [APPS-SECURITY.md](APPS-SECURITY.md) ("For the vendor").
