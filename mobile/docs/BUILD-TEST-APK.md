# Building the test APKs (Windows)

How to build the three React Native apps as **release APKs that talk to the test server** (`https://zedv3.qci.org.in`),
signed with the local Android debug key, for testing on phones. They are not for the Play Store (that needs the
upload keystore, see `mobile/README.md`, "Release APK / AAB and signing"). The steps are the same on a developer PC
and on a Windows build server; adjust the drive letters and folders to that machine.

| App | Workspace | applicationId | Version | Test server addresses it uses |
|---|---|---|---|---|
| ZED Surveillance (Bronze, the "MSME" build) | `apps/msme` | `com.qci.zed.bronzesurveillance` | 1.9 (13) | `/surveillancemobileapi/surveillance/`, `/surveillancemobileapi/msme/`, `/mobileapi/RA/` |
| ZED SA (site assessment) | `apps/assessor` | `com.qci.zed.siteassessment` | 1.3 (46) | `/mobileapi/SA/` |
| ZED Consultancy (handholding) | `apps/consultant` | `com.qci.zed.consultancy` | 1.3 (75) | `/consultancymobileapi/SA/`, `/Consultancy/FinancialAssistance/`, `/mobileapi/photos/` |

**Never run a build against production.** The server is fixed at build time: `-PzedEnvironment=staging` is the
internal name of the test server setting (testers never see it); a release build without it points at production
(`https://loginzed.msme.gov.in`). Check every APK with `aapt2` (below) before
it is opened on a phone or emulator with a network.

## With the scripts (server or PC)

Two scripts in `mobile/tools` do everything below. Run them in PowerShell; tools and caches go to `E:` (`-ToolsRoot`), never the system drive.

1. Once per machine, install JDK 17, Node.js and the Android SDK into `E:\ZedApkTools` (needs Git and about 8 GB):
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\mobile\tools\Install-ZedApkTools.ps1
   ```
2. Build (clones or updates its own checkout in `E:\ZedApkBuild\src`, builds for the test server, checks the server
   setting with aapt2, copies the APK with a `.sha256` to `E:\Releases\apk`, log in `E:\Releases\apk\logs`):
   ```powershell
   powershell -ExecutionPolicy Bypass -File .\mobile\tools\Build-ZedApk.ps1 -App msme
   ```
   `-App assessor`, `-App consultant` or `-App all` for the others; `-Ref <commit or tag>` for a given version;
   `-Production` (with the four `ZED_UPLOAD_*` environment variables of the upload keystore) for a Play Store APK,
   refused if it would be signed with the debug key.

The manual steps follow.

## Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| Git | any recent | |
| Node.js | 24.19.0 (npm 11.17.0); at least 22.11 | `engines` in `mobile/package.json` |
| JDK | 17 (Temurin 17.0.13) | set `JAVA_HOME` to it |
| Android SDK | platform `android-37.0`, build-tools `37.0.0`, NDK `27.1.12297006`, CMake `3.22.1`, platform-tools | install with Android Studio's SDK Manager or `sdkmanager`; set `ANDROID_HOME` |
| Gradle | 9.4.1 | downloaded by the wrapper (`gradlew.bat`), nothing to install |

Disk: the Gradle cache grows to several GB and each app's build folder to about 2-4 GB while it builds. Keep both off
the system drive: put the SDK, the Gradle cache, the npm cache and the temporary folder on another drive (the
commands below use `E:`; any drive works), and delete the build folders after copying the APK. Metro and Jest
already keep their caches inside `mobile/` (`.metro-cache`, `.jest-cache`, ignored by Git).

The release builds are signed with Android's debug key (`%USERPROFILE%\.android\debug.keystore`, created by the
build when it is missing). A phone that has a test APK signed on another PC must uninstall it before installing
one built here (Android refuses an update signed with a different key).

## Commands (PowerShell, one per line)

Open a new PowerShell window. Set the tools and caches for this window (adjust the paths to your machine):

```powershell
$env:JAVA_HOME = 'E:\dev\jdk-17'
```
```powershell
$env:ANDROID_HOME = 'E:\Android\Sdk'
```
```powershell
$env:GRADLE_USER_HOME = 'E:\DevCache\gradle'
```
```powershell
$env:npm_config_cache = 'E:\DevCache\npm-cache'
```
```powershell
New-Item -ItemType Directory -Force 'E:\DevCache\tmp' | Out-Null
```
```powershell
$env:TEMP = 'E:\DevCache\tmp'; $env:TMP = 'E:\DevCache\tmp'
```
```powershell
$env:GRADLE_OPTS = '-Djava.io.tmpdir=E:\DevCache\tmp'
```

Get the code and the JavaScript packages (once per checkout):

```powershell
git clone https://github.com/mahavirtiwari/ZED-Portal-Upgraded.git 'D:\ZED Portal Code\ZEDCS_V4'
```
```powershell
Set-Location 'D:\ZED Portal Code\ZEDCS_V4\mobile'
```
```powershell
npm ci
```

Build the three test APKs (each takes 6-12 minutes the first time):

```powershell
Set-Location 'D:\ZED Portal Code\ZEDCS_V4\mobile\apps\msme\android'
```
```powershell
.\gradlew.bat assembleRelease -PzedEnvironment=staging --no-daemon
```
```powershell
Set-Location 'D:\ZED Portal Code\ZEDCS_V4\mobile\apps\assessor\android'
```
```powershell
.\gradlew.bat assembleRelease -PzedEnvironment=staging --no-daemon
```
```powershell
Set-Location 'D:\ZED Portal Code\ZEDCS_V4\mobile\apps\consultant\android'
```
```powershell
.\gradlew.bat assembleRelease -PzedEnvironment=staging --no-daemon
```

The APKs are written to (the date is the build date):

- `apps\msme\android\app\build\outputs\apk\release\Android_ZED_BronzeSurveillance_<MMM-dd-yyyy>-1.9-13.apk`
- `apps\assessor\android\app\build\outputs\apk\release\ZEDSA_Android_<MMM-dd-yyyy>-1.3-46.apk`
- `apps\consultant\android\app\build\outputs\apk\release\ZEDConsultancy_Android_<MMM-dd-yyyy>-1.3-75.apk`

## Check the server setting with aapt2 (before any network use)

```powershell
& "$env:ANDROID_HOME\build-tools\37.0.0\aapt2.exe" dump resources 'D:\path\to\the.apk' | Select-String -Context 0,1 'string/zed_environment'
```

The line after `string/zed_environment` must read `() "staging"` (the internal name of the test server setting).
If it reads `"production"`, or if nothing is printed, the APK points at production: do not install it on a phone
with a network; rebuild it with `-PzedEnvironment=staging`.

To check an APK that is already installed on a connected phone or emulator, copy it back first, then run the
command above on the copy:

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" shell pm path com.qci.zed.consultancy
```
```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" pull '<the path printed above, without "package:">' 'E:\DevCache\tmp\installed.apk'
```

## Copy, install, clean up

Copy each APK under a name that says app, version, "test" and date (`ZED-MSME-1.9-test-<date>.apk`,
`ZED-SA-1.3-test-<date>.apk`, `ZED-Consultant-1.3-test-<date>.apk`), for example:

```powershell
Copy-Item 'D:\ZED Portal Code\ZEDCS_V4\mobile\apps\consultant\android\app\build\outputs\apk\release\*.apk' 'D:\ZED Portal Code\ZED-RN-APKs\ZED-Consultant-1.3-test-2026-10-25.apk'
```

Install on a phone or emulator connected with USB debugging:

```powershell
& "$env:ANDROID_HOME\platform-tools\adb.exe" install -r 'D:\ZED Portal Code\ZED-RN-APKs\ZED-Consultant-1.3-test-2026-10-25.apk'
```

Delete the build folders afterwards (they are recreated by the next build):

```powershell
Remove-Item -Recurse -Force 'D:\ZED Portal Code\ZEDCS_V4\mobile\apps\msme\android\app\build', 'D:\ZED Portal Code\ZEDCS_V4\mobile\apps\assessor\android\app\build', 'D:\ZED Portal Code\ZEDCS_V4\mobile\apps\consultant\android\app\build' -ErrorAction SilentlyContinue
```
```powershell
Remove-Item -Recurse -Force 'D:\ZED Portal Code\ZEDCS_V4\mobile\packages\shared\android\build' -ErrorAction SilentlyContinue
```

## Checking the encryption of an existing install (test builds only)

The first start of a build with encrypted storage encrypts the databases of the installed app in place
(`mobile/README.md`, "Sign-in token and encryption on the phone"). The first build also downloads OpenSSL for SQLCipher
from Maven Central (`io.github.ronickg:openssl`). Test it as an update, never as a fresh install only:

1. Install the previous test APK (or the legacy store build), sign in, and leave work unsent: complete an evidence or an
   opening meeting in airplane mode, take photos.
2. Install the new APK over it with `adb install -r` (same signing key), start it, still in airplane mode.
3. Sign in offline: the unsent work must be there and listed under "Pending Uploads" (MSME) or in the assessment.
4. With a debug build (`run-as`) or an emulator image that allows `adb root`, the files must no longer be plain
   SQLite: `adb exec-out run-as <applicationId> head -c 16 databases/QCI_MSME_DB` (or `com.zed.assessmentdb`,
   `ZED_MSME_Media_DB`) must not print `SQLite format 3`; no `*.zedenc-tmp` file may be left in `databases/`.
5. Turn the network on: the pending work goes out; restart the app: it opens without migrating again.
