# React Native rewrite of the ZED mobile apps

Decided 2026-10-24: the five native Android apps (Java/Kotlin) are rewritten in the latest stable React Native and stay
the **same Play Store apps** (same applicationId and signing keystore, so installed apps update). Work is done app by
app, each in its own session/branch, on a shared foundation under `mobile/` in this repo.

| Order | App | Legacy source (read only) | applicationId |
|---|---|---|---|
| 1 | Shared foundation + **MSME** | `ZED Mobile App Source Code\ZED\ZED_MSME_Bronze` | `com.qci.zed.bronzesurveillance` (verify it is the MSME app) |
| 2 | **Site assessment** | `ZED_SA_Studio` | `com.qci.zed.siteassessment` |
| 3 | **Desktop assessment** | `ZED_DA\ZED_DA_App` (old Eclipse project) | `com.zed.zeddaapplication` |
| 4 | **Surveillance** | `ZEDSurveillance` | `com.prd.zedsa.surveillance` |
| 5 | **Handholding (consultant)** | `ZEDConsultant` | `com.qci.zed.consultancy` |

The legacy source and the keystores are never copied or committed into this repo.

## Non-negotiable requirements (every app)

1. **No feature is lost.** Every screen, flow, validation, message, label and order of the legacy app is ported; each
   app keeps a parity checklist (`mobile/docs/<APP>-PARITY.md`, legacy screen → React Native screen → tested) and is not
   done until every row is ticked.
2. **Works without internet (offline mode), as today.** The legacy apps keep their work on the phone (SQLite /
   Room database and SharedPreferences) and check the network before each server call (`isNetworkAvailable`,
   `ConnectivityManager`). The React Native apps must:
   * store everything the legacy app stores locally, in a local database (SQLite, same tables and meaning; port the
     legacy schema from its `SQLiteOpenHelper` / Room `@Database` classes) — downloaded assignments, forms, answers,
     photos and pending uploads;
   * let the user do every offline-capable step of the legacy app without a connection (fill assessments, take photos,
     save drafts), and queue what must be sent;
   * send the queue when the connection returns (and on demand), in order, with retries, without duplicates, showing
     what is pending and what failed — at least as the legacy app does, never less;
   * keep the data across app restarts and updates (migrate the legacy app's local data on the first start after the
     update where it can be read; otherwise make sure nothing pending is lost: block the update path until the queue is
     sent, as agreed with the user).
3. **Pictures are stored on the phone exactly as today.** Same behaviour as the legacy code, verified per app:
   * captured with the camera, rotated by `ExifInterface.TAG_ORIENTATION`;
   * **stamped on the image** with the capture time, latitude and longitude (legacy `drawText(curTime…)`,
     `drawText(latStr…)`, `drawText(longStr…)` with the same position, font size and colours; location from the fused
     location provider);
   * saved as JPEG with the same compression quality per photo type (the legacy code uses 50, 70, 75 and 100 in
     different places) and the same maximum size;
   * in the same local folder and with the same file names (e.g. the `/ZED/` folder, `UUID.jpg`, `yyyyMMdd_HHmmss`
     names — take each from the legacy code), kept until uploaded and cleaned up when the legacy app cleans up;
   * uploaded with the same field names and request shapes to the V4 mobile API.
   Modern Android storage rules (scoped storage) may require the app-specific external folder instead of the shared
   root: then keep the same sub-folder and names inside it and document the difference.
4. **Same API contracts.** The V4 mobile API (`backend/src/Zed.Main.MobileApi`, docs/MOBILE-API.md, docs/mobile/*.md)
   serves the legacy endpoints; the apps call them with the same request and response shapes. Anything the backend
   lacks is listed, not invented.
5. **Same look.** Colours, logo, fonts and layouts from the legacy `res` folders.
6. **Security as in docs/mobile/APPS-SECURITY.md**: no secrets in the app bundle, HTTPS only, device binding
   (`MobileDeviceBindings`, migration 0001).
7. **Release builds** keep the applicationId and take the existing keystore from environment variables or gradle
   properties; `mobile/README.md` explains signing and building the APK/AAB.

## Session brief (paste to start the next app)

> Rewrite the ZED `<APP>` Android app (`D:\ZED Portal Code\ZED Mobile App Source Code\ZED\<FOLDER>`, read only,
> applicationId `<ID>`) in React Native in `ZEDCS_V4/mobile/` on the shared foundation, following
> `docs/mobile/REACT-NATIVE-REWRITE.md` (all of its non-negotiable requirements: no feature lost, offline mode as
> today, pictures stored and stamped on the phone exactly as today, same API contracts and look). Done when the parity
> checklist `mobile/docs/<APP>-PARITY.md` is complete, the offline flows and photo storage are verified on an emulator
> with the network off and on again, a release APK builds, tests pass, and everything is committed on the session's
> branch (no push, no merge).

The first session (foundation + MSME) additionally creates the `mobile/` monorepo (latest stable React Native,
TypeScript strict, one workspace per app plus a shared package with the API client, auth/session, device
registration, offline store and sync queue, camera/photo stamping and storage, location, forms, UI theme).
