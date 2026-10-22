# Mobile apps: security review of the vendor's source

Read-only review (2026-10-22) of the source package described in [APPS-INVENTORY.md](APPS-INVENTORY.md): first the five
apps that talk to the ZED servers (ZED_MSME_Bronze, ZED_SA_Studio, ZEDConsultant, ImpactAssessment,
LeanImpactAssessment), then a lighter pass on the rest. No secret value is reproduced here: findings name the file,
line and kind only. Finding numbers refer to [SECURITY-FINDINGS.md](../SECURITY-FINDINGS.md).

## Summary

| Severity | Finding | Apps |
|---|---|---|
| High | TLS certificate and host-name checks switched off | all five current apps except LeanImpactAssessment; most others |
| High | The Udyam service access key is built into the MSME app | ZED_MSME_Bronze |
| Medium | Passwords kept on the phone in clear (or Base64) | all current apps |
| Medium | Full HTTP request/response bodies logged in release builds | ZED_MSME_Bronze, ZEDProfessionals |
| Medium | Signing-key passwords in build files (obsolete apps); apps on servers outside QCI's control | ZEDSurveillance, ZED_MAM, ZED_Defence, ZED_DA, ZEDReassessment |
| Low | No code shrinking/obfuscation, cleartext allowed, broad file-provider paths, deprecated SafetyNet reCAPTCHA, sample code and personal data in the source, legacy storage permissions | various |

Not found: no Google Maps, Twilio account/API keys, Firebase server keys, private keys or keystores in the source; the
CCAvenue merchant id and access code reach the MSME app from the server at payment time; Twilio tokens come from the
server (`GetToken`); the reCAPTCHA value in `ZED_MSME_Bronze/app/build.gradle` is the **site** key, which is public by
design. Exported components are only the launcher activities; `allowBackup` is off in the five current apps.

## High

### TLS validation disabled (MITM)
Every call to the ZED servers accepts any certificate for any host name, so anyone on the same network (public Wi-Fi,
a hostile hotspot) can read and change logins, passwords, uploaded evidence and payments.
- ZED_MSME_Bronze `app/src/main/java/com/qci/zedmsme/network/RetrofitProvider.kt` lines 23–43: a trust-all
  `X509TrustManager`, `SSLContext.getInstance("SSL")`, and `.hostnameVerifier { _, _ -> true }`. The manifest also sets
  `android:usesCleartextTraffic="true"` (line 19).
- ZED_SA_Studio `app/src/main/java/com/geostat/assessment/service/RestHelper.java` lines 188–205 (`trustAllCerts`,
  `getUnsafeSSLContext`), used by `network/RetrofitProvider.kt` lines 17–20 (with the host-name bypass).
- ZEDConsultant `RestHelper.java` 175–192 and `RetrofitProvider.kt` 17–18; ImpactAssessment the same classes.
  LeanImpactAssessment no longer has it.
- Obsolete and training apps (ZEDReassessment, ZEDSurveillance, ZED_MAM, ZED_DA, ZED_Defence, ZEDTraining,
  ZEDProfessionals) carry the same `RestHelper` pattern.

Fix (vendor): delete the trust-all manager, the custom `SSLContext` and the host-name verifier; use the platform's
default trust (the ZED servers have public certificates). Optionally add certificate pinning through a network security
config with a backup pin. → SECURITY-FINDINGS #131.

### Udyam access key in the MSME app
`ZED_MSME_Bronze/app/src/main/java/com/qci/zedmsme/fragments/registration/EnterpriseInfoFragment.kt` line ~172 calls the
government Udyam lookup service (`udyogaadhaar.gov.in/sv/UAMRestServiceAssist.svc`) directly from the phone and appends a
24-character access key to the URL. It is **the same key** as the one hard-coded in the old portals' `MsmeController`
(#3; it is `Udyam:AccessKey` in V4's configuration). Anyone can extract it from the published APK. Rotating it (as
LIVE-HARDENING §7 asks) would break registration in the installed app. Fix: the app asks the ZED server (V4 already does
the Udyam lookup server-side, with rate limits) instead of calling Udyam itself; after that version is the minimum
supported one, rotate the key. → #132.

## Medium

### Passwords stored on the device
- ZED_MSME_Bronze: `database/LoginDataAccessObject.java` (lines 17, 31, 113–117) stores the password in its SQLite
  table in a column named `EncCred`, but as plain UTF-8 bytes (no encryption).
- ZED_SA_Studio, ZEDConsultant, ImpactAssessment, LeanImpactAssessment: `activities/LoginActivity.java` (~254–265)
  keep the assessor id, password and ZED ID in SharedPreferences, Base64-encoded only, for the offline login; SA also
  keeps it in `database/OfflineDBManager.java` (60, 94).

Anyone with a rooted phone, a lost unlocked phone, or a device backup gets the account's password, which is often reused.
Fix: do not keep the password; keep a server-issued token (the planned v2 token API, MOBILE-API.md) in
`EncryptedSharedPreferences` / Android Keystore, and for offline login keep a salted hash. → #133.

### Request bodies logged in release
ZED_MSME_Bronze `network/RetrofitProvider.kt` line 20 sets `HttpLoggingInterceptor.Level.BODY` unconditionally, so every
request and response, including the login password, OTPs, payment hashes and personal data, goes to logcat in the store
build (readable over USB debugging and in bug reports). ZEDProfessionals does the same and also logs sensitive values
with `Log.*` (7 places). Fix: `Level.NONE` in release (`if (BuildConfig.DEBUG)`), and no `Log` of credentials. → #134.

### Obsolete apps: signing passwords and outside servers
- `ZEDSurveillance/app/build.gradle` (lines 15–18) and `ZED_MAM/app/build.gradle` (15–18) contain the keystore and key
  passwords in clear; both use the **same 7-character password** for store and key. `ZED_SA_Studio/ZED_SA_Old.zip` has a
  signing config too. The keystores are not in the package. If either keystore still signs a live app, the password is
  exposed with it.
- ZED_Defence talks to `http://45.114.245.113/defencemobileapi/…` (a raw IP, cleartext); ZEDSurveillance,
  ZEDReassessment, ZED_MAM and ZED_DA talk to `*.zedcs.com` (the vendor's old domains; ZED_DA to a staging asset host).
  If installed copies are still in use, assessment data goes to servers outside QCI's control, partly unencrypted.
→ #135.

## Low

- **No shrinking/obfuscation** in any release build (`minifyEnabled false`): the APKs decompile to readable source,
  which makes the Udyam key and the trust-all code trivial to find.
- **Cleartext allowed** (`usesCleartextTraffic="true"`): ZED_MSME_Bronze, ZEDProfessionals. Turn it off.
- **File provider shares all external storage** (`<external-path path=".">`): ImpactAssessment, LeanImpactAssessment,
  ZEDProfessionals. Limit it to the app's own folder.
- **SafetyNet reCAPTCHA** (`EnterpriseInfoFragment.kt` 111) is Google's deprecated API; move to reCAPTCHA Enterprise or
  Play Integrity as the vendor plans the next release.
- **Sample code and test hosts in the store build**: the MSME app builds Twilio's `quickstart` sample module into the app
  (`settings.gradle`), which loads an image from `https://zedtesting.qci.org.in/mobileapi/RA` (`VideoActivity.java`
  1266). Remove the sample module.
- **Personal data in source**: a code comment in `EnterpriseInfoFragment.kt` holds what looks like a real Udyam
  registration number and mobile number. Remove it.
- **Legacy storage access** (`WRITE_EXTERNAL_STORAGE`, `requestLegacyExternalStorage="true"`,
  `Environment.getExternalStorageDirectory()`): the GeoStat apps; no effect on Android 11+ but widens access on older
  phones. SQLite queries concatenate local values (`EvidenceDataAccessObject` and others); local-only data, low risk.
- Committed build artefacts: signed `.aab` files and a developer's `local.properties`; keep them out of source control.

## For the vendor (one release of each current app)

1. Platform TLS validation only (no trust-all, no host-name bypass); cleartext off.
2. MSME app: Udyam lookup through the ZED server; remove the key; remove the Twilio sample module and the test URL.
3. No stored passwords: token in encrypted storage; salted hash for offline login.
4. Logging off in release; `minifyEnabled true` with R8 rules.
5. File provider limited to the app's folder; drop legacy storage flags where the target SDK allows.
6. Move from SafetyNet reCAPTCHA to the supported API.
7. Send the release to QCI as source (tagged) plus the signed bundle, and keep upload keys under QCI's custody / Play App Signing.

Server side (V4), already in place: rate limits on login and reset, master passwords refused, device binding
(Monitor → Enforce), server-side Udyam lookup, CCAvenue keys only on the server. Once the fixed versions are out, raise
the minimum version in the `Mobile:` version gate so old builds with the Udyam key and the trust-all code stop working.
