# ZED mobile apps (React Native)

The five native Android apps of ZED are being rewritten in React Native as the **same Play Store apps** (same
applicationId and signing key, so installed apps update in place). Requirements: [docs/mobile/REACT-NATIVE-REWRITE.md](../docs/mobile/REACT-NATIVE-REWRITE.md).

| Workspace | What | Legacy source (read only) | applicationId | State |
|---|---|---|---|---|
| `packages/shared` (`@zed/shared`) | Foundation shared by all apps | — | — | done |
| `apps/msme` (`@zed/msme`) | **ZED Surveillance** (Bronze surveillance desktop assessor) | `ZED_MSME_Bronze` | `com.qci.zed.bronzesurveillance` | done, see [docs/MSME-PARITY.md](docs/MSME-PARITY.md) |
| `apps/assessor` (`@zed/assessor`) | **ZED SA** (site assessment, lead and co-assessor) | `ZED_SA_Studio` | `com.qci.zed.siteassessment` | done, see [docs/SA-PARITY.md](docs/SA-PARITY.md); no source for a surveillance build |
| `apps/consultant` (`@zed/consultant`) | **ZED Consultancy** (handholding: lead and co-consultant, DFO technology upgradation) | `ZEDConsultant` | `com.qci.zed.consultancy` | done, see [docs/CONSULTANT-PARITY.md](docs/CONSULTANT-PARITY.md) |
| `apps/desktop-assessment` | Desktop assessment | `ZED_DA/ZED_DA_App` | `com.zed.zeddaapplication` | later |
| `apps/surveillance` | Surveillance | `ZEDSurveillance` | `com.prd.zedsa.surveillance` | later |

**About `apps/msme`:** `ZED_MSME_Bronze` is not the store MSME app. It is the Bronze surveillance build for the
desktop assessor ("ZED Surveillance"; sign-in with assessor ID, the unit's ZED ID and the assessor's password), built
from a copy of the MSME app's code base. The workspace keeps the name `msme` because the brief named it so; it ports
that build exactly, with its applicationId. The store MSME app's own source was never delivered
(docs/mobile/APPS-INVENTORY.md).

**About `apps/assessor`:** the site assessment app as `ZED_SA_Studio` builds it (Main system, `mobileapi/SA/`). Its own
look (orange toolbar, legacy colours) comes from `src/palette.ts`, loaded first by `index.js`, which overrides the shared
theme tokens, and from `src/ui/kit.tsx`. Locally it runs against the Main MobileApi (launch profile `http`, port 5104,
`-PzedEnvironment=local`) with `tools/dev-seed/seed-local-sa.ps1` (fake Silver unit at status 8, lead and co-assessor;
credentials in `apps/assessor/.env.local`, ignored). Migrations 0016/0017 on the local `ZEDCS_V2_LIVE` and
`tools/dev-seed/admin-changes-demo-sa.sql -v Mode=apply` play fake Admin changes to `assessor.basicInfo` and an
`app.assessor.*` text (`Mode=remove` takes them out).

**About `apps/consultant`:** the handholding app as `ZEDConsultant` builds it (Consultancy system,
`consultancymobileapi/SA/`; the technology upgradation calls the consultancy web site `Consultancy/FinancialAssistance/…`
and `mobileapi/photos/…`). It started as a copy of `apps/assessor` (the legacy app is a fork of the site assessment app)
and was changed to match its source: teal look (`src/palette.ts`, `src/ui/kit.tsx`), milestone dashboard, training,
baseline study / action plan / technology suggestion / progress review pages, nine-group basic information
(`consultant.basicInfo`), attendance per day. Locally it runs against the V4 MobileApi started as the consultancy host
(`Mobile__System=Consultancy`, `Mobile__PathBase=/consultancymobileapi`, port 5105, database `ZED_CONSULTANT`,
`-PzedEnvironment=local`) with `tools/dev-seed/seed-local-consultant.ps1 [-Milestone 1|2|3]` (fake Silver unit at
status 8, lead and co-consultant; credentials in `apps/consultant/.env.local`, ignored). Migrations 0001, 0010, 0016 and
0017 on the local `ZED_CONSULTANT`; `tools/dev-seed/admin-changes-demo-consultant.sql -v Mode=apply` plays fake Admin
changes (`Mode=remove` takes them out). The technology upgradation also needs the consultancy web site on port 5102.

## Choices

- **React Native 0.88.0** (latest stable on 2026-10-24), **bare React Native CLI**, New Architecture (Fabric,
  TurboModules), Hermes. Not Expo: the apps need custom native code that must behave exactly like the legacy Java
  (photo stamping pixel for pixel, the fused-location rules, opening the legacy SQLite/Room files in place), the
  Android project must keep full control of signing, applicationId and manifest, and nothing is gained from Expo's
  managed services. A custom TurboModule in the shared package covers what React Native lacks.
- **npm workspaces** (no Yarn on the build PCs): `packages/*` and `apps/*`; React Native is hoisted to
  `mobile/node_modules`, the apps' Gradle and Metro configs point there.
- **TypeScript strict** (`tsconfig.base.json`: `strict`, `noUncheckedIndexedAccess`, ...).
- Few native dependencies, all New Architecture: `@op-engineering/op-sqlite` (SQLite), `@react-native-community/netinfo`,
  `react-native-svg` (the legacy vector icons), `react-native-safe-area-context`. Navigation is a small stack in the
  shared package (no native navigation library to keep in step with React Native releases).

## Shared package (`packages/shared`)

| Area | Files | What |
|---|---|---|
| API client | `src/api/http.ts`, `src/api/legacy.ts`, `src/config/environments.ts` | fetch client with the legacy conventions (JSON as Gson writes it: nulls left out; multipart; 60 s timeouts; "HTTP 500 ..." texts; `NetworkError` vs. refusals); `baseRequest` adds `userName`, `version` and **`deviceInfo`** to every body and `deviceInfo.*` fields to multipart forms; environments (production `https://loginzed.msme.gov.in`, staging `https://zedv3.qci.org.in`, local `http://10.0.2.2:5106`) |
| Device registration | `src/device/deviceInfo.ts` | `deviceInfo` as the GeoStat apps built it: ANDROID_ID, `os.version (incremental)`, SDK level, `Build.DEVICE`, `MODEL (PRODUCT)`, `MANUFACTURER`; V4 binds it at sign-in (`MobileDeviceBindings`) and records it with every change |
| Auth / session | `src/auth/passwords.ts` | offline sign-in credential: a salted PBKDF2 hash in the legacy credential column (the legacy apps kept the password itself); legacy plain-text rows are accepted once and upgraded |
| Local store | `src/db/*` | async SQLite interface (op-sqlite on the phone, sql.js in tests); `LegacyLoginStore` (the legacy `LoginData` table: user, credential, whole sign-in response as JSON); `PhotoStore` (the legacy Room `photos_table`, same DDL) |
| Offline sync | `src/sync/syncQueue.ts`, `src/sync/connectivity.ts` | persistent queue (`ZedSyncQueue` table): ordered, retried with back-off, de-duplicated by key, groups (a failure blocks later jobs of its group), pending/failed list, retry/remove; connectivity watcher (`isConnectedOrConnecting` meaning) |
| Camera pipeline | `android/.../PhotoPipeline.kt`, `src/photo/*` | legacy `PhotoCaptureHelper` call for call: camera intent into `cache/SharedDocs/Geostat_yyyyMMdd_HHmmss_*.jpg`, scale to 1080 px, EXIF rotation, time/Lat/Long stamp (Paint 20 px, BLUE, x 20, lines at h+15, 2h+15, 3h+15 with h = measureText("yY")), base64 JPEG 75 into `photos_table`, file `filesDir/<UUID>.jpg` JPEG 100, temp file deleted; PDFs ≤ 2 MB as `filesDir/<UUID>.pdf`; photo ids `<loginId><millis>` |
| Location | `android/.../LocationFetcher.kt`, `src/location/location.ts` | legacy `LocationFetcher`: fused provider, high accuracy, accuracy ≤ 100 m, fix < 15 min old, 10 s timeout, last location as fallback, mocked locations refused with the legacy message; GPS-off and failure dialogs with "Try Again" |
| Forms | `src/forms/validation.ts`, `src/ui/components/Form.tsx` | the legacy view helpers: text (multi-line with 500 counter, numeric max 20, percentage validator), yes/no, check boxes, selection and multi-selection pickers, static text with VIEW, multi-row lists, buttons, dialogs |
| Theme / UI | `src/ui/theme.ts`, `src/ui/UiHost.tsx`, `src/ui/components/*` | colours, sizes and text styles of the legacy `res/values`; loading overlay ("Please Wait"), toasts, snackbars, native alert dialogs, item/multi-choice dialogs; header/back bar/offline note/drawer of `activity_base.xml`; `<Icon>` renders the legacy vector drawables (converted by `tools/convert-vector-drawables.mjs`) |
| Navigation | `src/navigation/stack.tsx` | stack with per-screen back handling and focus effects |
| Native module | `android/` (Kotlin TurboModule `ZedDevice`, spec `src/native/NativeZedDevice.ts`) | device/app info, memory check, auto-time check, GPS state, location, camera/gallery/PDF pickers, photo processing, file viewer through the legacy FileProvider (`${applicationId}.fileprovider`, `cache/SharedDocs`), clipboard, PBKDF2, SharedPreferences |

## Building and running

Requirements: Node 22.11+ (24 used), JDK 17, Android SDK (platform 37, build-tools 37, NDK 27.1), `ANDROID_HOME`.

```bash
cd mobile
npm install
```

Run on an emulator or a phone (debug build, Metro):

```bash
cd mobile/apps/msme
npx react-native start
```

```bash
cd mobile/apps/msme/android
./gradlew installDebug -PreactNativeArchitectures=x86_64
```

Disk use: Metro keeps its caches in `mobile/.metro-cache` (ignored), not in `%TEMP%`; keep Gradle's cache off the
system drive with `GRADLE_USER_HOME` (this PC: `E:\DevCache\gradle`, SDK `E:\Android\Sdk`, AVDs `D:\.android\avd`).
Build outputs (`android/app/build`, `android/.gradle`, `.cxx`, `node_modules/**/android/build`) can be deleted at any
time; the next build recreates them (about 12 minutes for a release build here).

The server is chosen at build time with `-PzedEnvironment=production|staging|local` (debug default `staging`,
release default `production`; Android string resource `zed_environment`). `local` is the V4 MobileApi on this PC
(below); debug builds allow plain http only to `10.0.2.2`/`localhost` (`src/debug/res/xml/network_security_config.xml`),
release builds are HTTPS only.

**Never call production from a build or a test**, not even with a fake login. The app reads `zed_environment` by
name and falls back to production when it is missing; release builds keep it through
`packages/shared/android/src/main/res/raw/zed_shared_keep.xml` (before that, the resource shrinker removed it and
staging release APKs went to production). Before running any APK with a network, check what it points at:

```bash
aapt2 dump resources <app>.apk | grep -A1 "string/zed_environment"
```

It must print `"staging"` or `"local"`; if it prints nothing or `"production"`, do not run the APK with a network.

Tests and checks:

```bash
cd mobile
npm test
npm run typecheck
```

### Release APK / AAB and signing

The release build keeps `applicationId "com.qci.zed.bronzesurveillance"` and must be signed with the **existing
upload keystore of the Play Store app**, which is never stored in this repository (`*.jks`, `*.keystore`,
`keystore.properties` are ignored). Give it to Gradle in one of two ways:

- Gradle properties, e.g. in `%USERPROFILE%\.gradle\gradle.properties` (outside the repo):
  ```properties
  ZED_UPLOAD_STORE_FILE=C:/secure/zed-bronze-upload.jks
  ZED_UPLOAD_STORE_PASSWORD=...
  ZED_UPLOAD_KEY_ALIAS=...
  ZED_UPLOAD_KEY_PASSWORD=...
  ```
- or environment variables with the same names (CI secrets).

Then:

```bash
cd mobile/apps/msme/android
./gradlew assembleRelease
```

```bash
cd mobile/apps/msme/android
./gradlew bundleRelease
```

Outputs: `app/build/outputs/apk/release/Android_ZED_BronzeSurveillance_<MMM-dd-yyyy>-<versionName>-<versionCode>.apk`
(the legacy file name) and `app/build/outputs/bundle/release/app-release.aab`. Without the keystore the release build
is signed with the local Android debug key and Gradle warns: fine for testing, refused by Play. Before uploading,
check `versionCode` (legacy store build 12 / 1.8; this build 13 / 1.9) against the Play Console. If Play App Signing is
on, the keystore above is the **upload** key; Google re-signs with the app signing key, so installed apps update.
Release builds are shrunk with R8 (`minifyEnabled`, `shrinkResources`) and do not log request bodies.

### Running against the V4 MobileApi on this PC (fake data)

Staging has no test account for this app and holds copies of production data, so the full flows are tested against
the V4 MobileApi run locally (profile `surveillance`) on the local `ZED_SURVEILLANCE` database with fake data:

```powershell
# fake desktop assessor ZEDRNSA01 + Bronze unit ZEDRNTEST0001 (password generated into apps\msme\.env.local, ignored)
mobile\tools\dev-seed\seed-local.ps1
cd backend\src\Zed.Main.MobileApi
$env:ASPNETCORE_ENVIRONMENT='Development'; $env:Mobile__System='Surveillance'; $env:Mobile__PathBase='/surveillancemobileapi'; $env:ASPNETCORE_URLS='http://localhost:5106'
dotnet run --no-launch-profile
```

and build the app with `-PzedEnvironment=local`. With an emulator, `adb reverse tcp:8081 tcp:8081` (Metro) is enough;
the app reaches the API at `10.0.2.2:5106`. (If another checkout or session is using the MobileApi's `bin`/`obj`,
build it apart with `dotnet build -p:BaseIntermediateOutputPath=obj-rn/ -p:BaseOutputPath=bin-rn/` and start
`dotnet bin-rn\Debug\net10.0\Zed.Main.MobileApi.dll` with the same environment variables.)

`seed-local.ps1` also runs `tools/dev-seed/local-db-gaps.sql`, which creates in the local database objects that the
surveillance procedures use but that the local `ZED_SURVEILLANCE` lacks (`dbo.CheckListReport`, used by
`SP_APP_SURVEILLANCE_INSERT_ESG_CHECKLIST`; see `database/README.md`). Without it the ESG checklist is saved but the
procedure then fails and the app shows the legacy error.

To test a cold start in airplane mode, the debug APK must carry its JS bundle (Metro is unreachable):

```bash
cd mobile/apps/msme/android
./gradlew installDebug -PzedEnvironment=local -PzedBundleDebug=true
```

## Admin texts and configurable forms (new in V4)

- **Texts** (docs/mobile/APP-TEXTS.md): `Content/Texts` on the app's mobile host. `AppTexts` (shared) loads the
  answer at start and after login, keeps the last one in the `ZedCache` table for offline use and falls back to the
  app's built-in wording (`apps/msme/src/content/builtInTexts.ts`, generated from the server's standard catalogue with
  `python mobile/tools/gen-app-texts.py app.msme`, which is the legacy wording). Screens read a text with
  `useAppText(key, fields)`; `HtmlText` shows its simple HTML; a text the Admin switched off is not shown.
- **Forms** (docs/mobile/APP-FORMS.md): `Forms/Definition?form=msme.basicInfo`. `AppForms` (shared) keeps the last
  definition for offline use, with the app's built-in form (`apps/msme/src/forms.ts`, the legacy labels) until one
  arrives. The Basic Information screen is built from it: standard fields keep their legacy controls (photo stamping,
  product and raw-material dialogs, the 0–100 % check, the countries list), labels/help/order/required come from the
  definition, disabled fields are not shown and not sent, and the Admin's own fields (`CustomFormField`: text, whole
  and decimal numbers, date, yes/no, drop-down, multi-select, check boxes) are sent in `customFields` with
  `formVersion`. A refusal saying the form changed on the server reloads the definition.
- Locally: migrations `0016` and `0017` on the local `ZED_SURVEILLANCE`, then
  `tools/dev-seed/admin-changes-demo.sql -v Mode=apply` plays fake Admin changes (`Mode=remove` takes them out).

## Offline mode

As the legacy app, all work is kept on the phone in the legacy databases (`QCI_MSME_DB`: sign-in response with the
offline work; `ZED_MSME_Media_DB`: photos) and the photo files; screens check the network before each call as the
legacy screens did. Added: the sync queue sends pending work automatically when the connection returns, when the app
comes to the foreground, every 30 s while open (back-off permitting) and on demand ("Sync All" in the header,
"Pending Uploads" in the menu), and after sign-in it queues whatever the local data (also data left by the legacy
app) shows as done but not sent. Details per screen: [docs/MSME-PARITY.md](docs/MSME-PARITY.md).

**Update from the legacy app:** the new app opens the legacy database files by name in the same folder, with the same
tables, and the legacy photo files stay where they are, so pending offline work of the legacy app is read after the
update (verified with a database written in the legacy format, see the parity document). No blocking of the update is
needed.
