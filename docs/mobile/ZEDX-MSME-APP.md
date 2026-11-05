# ZED-X in the store MSME app: what the app vendor must add

ZED-X (level code `ZEDX`, shown as "ZED-X") is the fourth certification level, next to Bronze, Silver and Gold. The
V4 mobile server (`/mobileapi`) accepts it.

**ZED MSME app 2.0** (`mobile/apps/zedmsme`, built with `mobile/tools/Build-ZedApk.ps1 -App zedmsme`) shows it:

- **ZED Certifications:** a fourth card under Gold, shown once the Admin enables ZED-X (`/api/public/levels`) and
  always once the unit has paid for it. It has the Admin's name, description, comment and logo (a built-in badge when
  no logo is uploaded), with Gold's four steps.
- **APPLY / greyed out:** as the web dashboard (`levelDisabled`). ZED-X can't be applied for while Bronze, Silver or
  Gold is in progress; once ZED-X is paid, the three that have not started are greyed out.
- **The rest:** payment, basic information, documents, final submit, NC, VIEW DETAILS (`Msme/AppCertificationStatus`
  takes `ZEDX`), the certificate (`ZEDXCertificatePath` in the status, `ZEDX` in `GetMyDocuments`) and the dashboard
  text "Bronze, Silver, Gold or ZED-X".
- **Sign-in answer:** `Msme/Login` adds ZED-X to `msmeStatus`, as `GetMsmeStatus` does. The older store app ignores the
  extra fields.

The rest of this page is the contract for any other build of the store MSME app ("ZED MSME", Play Store / App Store)
whose source is not in this repository (`docs/mobile/APPS-INVENTORY.md`).

Units can also enter ZED-X on the web: **My Certifications → ZED-X → ENTER DETAILS** (`/msme/entry/ZEDX`). It covers
basic information, documents, final submit and the answers to non-conformances (**ANSWER NC**), with the same procedures
and folders as the app. The app must show what
was entered on the web and must not ask for it again: the server holds a single copy of the data.

> The `mobile/apps/msme` workspace in this repository is the **Bronze surveillance** app for desktop assessors
> (`com.qci.zed.bronzesurveillance`), not the MSME app. An APK built from it does not show ZED-X to units.
> The site assessment app (`mobile/apps/assessor`) takes the level from the server, so it needs no change for ZED-X.

## The level

| | |
|---|---|
| `certificationType` | `ZEDX` (exactly; case does not matter to the server) |
| Name on screen | `ZED-X` (Administration → Certification Levels: name, description, logo, comment) |
| Logo | `GET {portal}/api/public/levels` (code, name, description, logo URL) |
| Shown when | the Admin has enabled it (`/api/public/levels` lists enabled levels only) |
| Rules | as Gold: desktop assessment, then site assessment; status codes as Gold's |
| Who may apply | any registered MSME, whatever its other levels (a separate track) |
| Fee | from the server (`Fees`), Rs. 75,000 before subsidy; payment as for the other levels |

## Server calls that take ZEDX

Every MSME call that takes `certificationType` accepts `ZEDX`:

- `Msme/GetParametersByType`: the unit's own questionnaire. It is copied to the unit at payment, keeping only the
  parameters of the unit's NIC sector.
- `Msme/SubmitBasicInformation`, `Msme/SubmitPhotos`, `Msme/SubmitEvidenceV2`, `Msme/FinalSubmit`.
  - After the final submit, the server allots an agency of the unit's kind (Manufacturing / Services).
- `Msme/GetNcDetailsByType`, `Msme/SubmitNcRequirement`, `Msme/SubmitNcProduct`, `Msme/SubmitSiteExteriorInfo`.
- `Forms/Definition?form=msme.basicInfo&zedId={ZedId}&certificationType=ZEDX`: the Basic Information form for this
  unit and level. The Admin can limit fields to levels and NIC sectors (Admin → App Forms), so the app must ask for the
  form per unit and level. Without `zedId`/`certificationType`, every field comes back with its `levels` /
  `nicSectors`.
- Paths: files go under `Photos/{ZedId}/ZEDX/...`, as for the other levels.

## Status: `Msme/GetMsmeStatus` and the login answer

The status answer has ZED-X's fields next to Bronze's, Silver's and Gold's. They are left out when the server cannot
read them (older database), so the app must treat a missing field as "ZED-X not available".

| Field | Meaning (as Gold's) |
|---|---|
| `ZEDXStatus` | 0 not paid, 1 paid, 2 submitted, 3 site assessment, 4 certified |
| `ZEDXStatusOfNc` | number of NCs raised (0–5) |
| `ZEDXStatusOfNc1` … `ZEDXStatusOfNc5` | per NC: 1 raised, 2 response submitted |
| `Nc1StatusTextZEDX` … `Nc5StatusTextZEDX` | the text shown for each NC |
| `ZEDXSelfieStatus` | the site assessor's selfie submitted |
| `zedx` | the level's details object, as `bronze` / `silver` / `gold` |

## What the app must change

1. **My Certifications:** add a ZED-X card (name and logo from `/api/public/levels`), shown when the level is listed
   there. It is never greyed out by the unit's other levels.
2. **Apply / pay:** the existing flow with `certificationType=ZEDX`.
3. **Basic information:** ask for `Forms/Definition` with `zedId` and `certificationType=ZEDX`, and show only what it
   returns. Fields the Admin limited to other levels or sectors are left out by the server.
4. **Documents, photos, final submit, NC:** the existing screens with `ZEDX`. The ZED-X steps are Gold's: four
   steps, site assessment included.
5. **Data entered on the web:** if `ZEDXStatus` is 2 or more, show the level as submitted. Do not offer basic
   information again.
6. **Texts:** "Bronze, Silver or Gold" in the app's texts becomes "Bronze, Silver, Gold or ZED-X". The texts can be
   changed from Admin → App Texts without a release.

## Testing

Use the test server (`https://zedv3.qci.org.in`) with a unit that has paid for ZED-X, after the Admin has enabled ZED-X
(Administration → Certification Levels). Never test against the live portal.
