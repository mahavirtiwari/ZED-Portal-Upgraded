# Security findings in the legacy code



> **Act now on the live site:** findings 19–22, 36 and 67 let someone obtain a certification or milestone without paying (or for ₹1),

> 26 and 32 let anyone change assessment results or issue certificates, 27 is a set of master passwords, 39 and 40 allow account takeover, 44, 45, 50, 74 and 75 allow file uploads into the web root, 63 and 79 delete, overwrite or write any server file and changing payout accounts,

> 30 and 31 let anyone mark payments paid or run any stored procedure, 70 posts to the production ERP, and 29/48 need key rotation (the Twilio secret was sent to every MSME). **Consultancy and Surveillance** (85–114): 85–88, 91, 100–103 are critical and anonymous on those sites — block them too. They do not depend on the migration; fix or

> block them on the current portal.



> **Remediation material for the live sites:** fix scripts for findings 1, 22, 27, 36, 48, 68, 86 (12), 93, 94 and 96 are in

> `database/fixes/` (review before running; preview by default). IIS block rules, upload-folder lockdown and the rotation list

> are in `docs/LIVE-HARDENING.md`. Finding 111 cannot be fixed without breaking surveillance login (documented there).



Found while migrating. "Fixed in V4" means the new code no longer has the problem; items marked

**open** need a decision or a database change, and still affect the live legacy site.



| # | Severity | Finding | Where | Status |

|---|---|---|---|---|

| 1 | Critical | `SP_GET_USER_DETAILS` accepts two hard-coded literal passwords for **any** user id (a back door). | ZEDCS_V2_LIVE (check the other two DBs) | V4 accepts a login only when the typed password equals the account's stored password (#27), so none of these values work. **Open** on the live site: remove the clauses from the procedure. One of the values is used by the Udyami Bharat SSO (`ZedDashboard`); give that flow its own procedure. |

| 2 | Critical | Passwords are stored and compared in plain text (`Users.Password varchar(50)`); failed attempts are stored with the typed password in `FailedLogins`. | All 3 DBs | V4 keeps salted PBKDF2 hashes next to the plain column (migration 0005, `docs/PASSWORDS.md`). `Security:Passwords` = `Dual` (default) → `Migrate` at decommission → `HashOnly`. From `Migrate` the plain column holds a random value, refused passwords no longer reach FailedLogins, and `SP_V4_PURGE_PLAIN_PASSWORDS` clears the rest. **Open until the old sites are off:** they need the plain column. |

| 3 | High | Secrets in source: reCAPTCHA secret keys and the Udyam access key in `MsmeController`; payment gateway keys in `Web.config` (11 in main, 7 in Consultancy, 3 in Surveillance). | Repo | V4 reads them from configuration only. **Open:** rotate every key that was ever committed. |

| 4 | High | TLS certificate validation turned off for outbound calls (`ServerCertificateValidationCallback` returning true). | `MsmeController.ValidateUam/GetUdyam` | Fixed in V4 (opt-in `Udyam:AllowInvalidCertificate`, default off). |

| 5 | High | Registration trusted the browser: `FinalSubmit` used Udyam details posted by the client and did not check that the pledge e-mail OTP had been verified. | `MsmeController.FinalSubmit` | Fixed in V4: Udyam data, selection and OTP state are kept on the server. |

| 6 | High | Generated passwords were 4 characters from `System.Random`; OTPs 4 characters from `System.Random`. | `MsmeController.RandomString` | Fixed in V4: 10-character passwords and 6-digit OTPs from a cryptographic RNG; OTP expires after 10 min / 5 wrong tries. |

| 7 | Medium | Password reset codes never expired and could be reused; the "password changed" e-mail repeated the new password in clear text. | `UserHelper.UpdateResetPassword`, `_ChangePwdTemplate` | Fixed in V4 (code cleared on use; password not e-mailed). Consider adding an expiry column. |

| 8 | Medium | Forgot-password told whether a ZED ID exists. | `MsmeController.ResetPassword` | Fixed in V4 (same answer either way). |

| 9 | Medium | Pledge certificates are public static files at a guessable path (`/Certificates/ZEDMSME000123/Pledge.pdf`, sequential ids). | Old site | V4: `GET api/msme/files/...` serves only files that `SP_MSME_GET_MY_DOCUMENTS` lists for the signed-in ZED ID (path-traversal and ownership checks). **Open** on the old site until its static `/Certificates/...` folders stop being published. |

| 10 | Medium | No CSRF protection on state-changing POSTs. | All MVC controllers | V4: anti-forgery token required on every POST/PUT/DELETE. |

| 11 | Medium | No rate limiting on login, OTP or Udyam lookup. | — | V4: 10 requests/min per IP on these endpoints. Lockout after 10 failures still comes from the procedure. |

| 12 | Medium | `xp_cmdshell` in `SP_JOB_TO_CREATE_RENAMING_BATCH_FILES`; dynamic SQL in `SP_CONSULTANCY_UPDATE_COLUMN_VALUE` (review for injection). | ZEDCS_V2_LIVE / ZED_CONSULTANT | xp_cmdshell: its only user, the folder-rename job, is replaced by Zed.Jobs `Jobs:FolderRename` (migration 0007, no shell, ids validated, paths confined). After switching, run `main/13_xp_cmdshell_report` with `@DisableXpCmdShell = 1`. Dynamic SQL: `consultancy/06a` or `06b`. **Open until applied.** |

| 13 | Low | XML from the Udyam service parsed with DTD processing allowed. | `ValidateUam` | Fixed in V4 (DTDs prohibited). |

| 15 | Critical | MSME data actions take the ZED ID from the request and do not check it against the signed-in user (`Msme/GetDetails`, `GetMyDocuments`, `GetProfileDetails`, `GetConsultancyDetails`, …; several have no login check at all). Anyone can read any MSME's details, documents and status by posting a ZED ID (IDs are sequential). | MsmeController and others | V4: MSME endpoints take the ZED ID only from the sign-in cookie and require the MSME role. **Open** on the live site. |

| 16 | Medium | "Contact ZED" inserted the visitor's name and query into the staff e-mail as raw HTML. | `HomeController.Contact` | Fixed in V4 (values HTML-encoded). |

| 17 | Low | Procedures return whole rows (`SELECT *`) and the MVC actions forwarded them to the browser, including columns such as `Users.Password`. | Many actions | V4: dashboard returns only the fields it shows; the generic result-set helper strips password/token columns. |

| 18 | High | Assessment report pages (`SA/ReportSummary/{zedId}` in all three systems) and certificate PDFs need no sign-in; `Msme/ViewStatus?zedId=` had no sign-in either. Anyone with a ZED ID can read them. | Old site | V4: certificates and reports of Bronze/Silver/Gold are drawn by V4 and served only to the owning MSME and authorised staff; public verification shows no contact details. Surveillance and milestone reports still link to the old sites until phases 7/8. **Open on the live site.** |

| 19 | Critical | **Payment can be marked successful without paying.** `Pay/success` (PayU) and `SurveillancePay/success` record whatever is POSTed (`udf1` = ZED ID, `txnid`, `status=success`) with no signature check. Transaction ids come from a sequence and the mobile action `Pay/GetToken` (no sign-in, ZED ID from the body) returns them, so an attacker can create an order and then "confirm" it. | PayController, SurveillancePayController | V4 does not port PayU; the CCAvenue callback only accepts encrypted responses and checks order, unit, level and amount. **Open on the live site: remove or block the PayU `success`/`failure` actions.** |

| 20 | Critical | **Free certification via the zero-payment action.** `Pay/SubmitZeroPaymentDetails` marks a level as paid for whatever `PaymentRefId` the browser sends; `SP_MSME_ZERO_PAYMENT_DETAILS` never checks that the fee is 0. Without a session it even takes the ZED ID from the body (only a spoofable Referer check). | PayController, SP_MSME_ZERO_PAYMENT_DETAILS | V4 uses the zero path only when the fee row chosen on the server is 0. **Open on the live site.** |

| 21 | High | **Choosing your own price.** The amount is looked up from the browser-supplied `PaymentRefId` (any AssessmentFee row), and `Msme/UpdateUdyamDetails` lets the browser set the enterprise type that decides the fee. | PayController.Complete, MsmeController.UpdateUdyamDetails | V4 derives the fee row from SP_MSME_GET_PAYMENT_DETAILS and the enterprise type from the Udyam service. **Open on the live site.** |

| 22 | High | `SP_MSME_PAYMENT_BASIC_DETAILS` sets the amount to **₹1.00** for 59 hard-coded production ZED IDs ("to test the payment gateway"). | ZEDCS_V2_LIVE | V4 refuses a checkout whose procedure amount differs from the fee row. **Open:** remove the list from the procedure. |

| 23 | Critical | Credentials in source: the Azure AD client secret of QCI's **production** Dynamics 365 Business Central (ERP) in `Helpers/ErpIntegrationService.cs`; a CCAvenue reconciliation working key in a comment in `PayController`. | Repo | V4 reads both from configuration. **Open: rotate both now.** |

| 24 | Medium | Payment receipts were rendered by fetching the public page `SA/PaymentReceipt/{zedId}`, which anyone can open for any ZED ID. | SAController | V4 draws the receipt PDF directly; it is served only through the authorised files endpoint. **Open** on the old site. |

| 25 | Low | CCAvenue request values were concatenated without escaping, so `&`/`=` inside a name or address broke the request (or added parameters). | PayController | Fixed in V4 (separators stripped). |

| 26 | Critical | **Assessment decisions need no sign-in.** `AssessmentController` has its `[AuthenticationFilter]` commented out, so anyone can call `Assessment/UpdateConfirmance` (SP_ASSESSMENT_DA_UPDATE_REQUIREMENT), `ValidateEvidence` (with file upload), `ValidateProduct`, `ExemptedFromAssessment`, `FinalSubmit` (SP_ASSESSMENT_DA_FINAL_SUBMIT) and `ConfirmFinalSubmit` for any requirement or ZED ID, i.e. mark an MSME's requirements as conforming and submit the desktop assessment. The MSME pages BasicInfo / NonConformances only hide these buttons by role in the template. | AssessmentController | V4 MSME pages are read-only; assessor actions return in phase 4 behind staff roles. **Open on the live site: restore the filter with role checks.** |

| 14 | Low | Exception messages returned to users (`"Unexpected error… " + ex.Message`). | Many actions | V4 returns generic messages and logs details. |

| 27 | Critical | **More master passwords.** Besides #1, hard-coded passwords that work for any account are in `SP_GET_LOGIN_DETAILS` (all three DBs), `SP_APP_MSME_CHECK_LOGIN` (main, consultancy and surveillance, with different values), `SP_APP_SURVEILLANCE_CHECK_LOGIN`, and `SP_GET_USER_DETAILS` in ZED_CONSULTANT and ZED_SURVEILLANCE (again different values). The mobile app login uses one of these. | Login procedures, all 3 DBs | V4 accepts a login only when the typed password equals the stored `Users.Password` of the row the procedure returned (`LegacyPasswords.MatchesStored`), whatever literal the procedure contains. **Open** on the live site: remove every literal from the procedures. |

| 28 | Critical | **Mobile services have no sign-in after login.** Every `SwachhSurvekshanServices` action (MSME, site assessor, remote assessor) takes the user from the request body (`zedId`, `userName`, `saId`), so anyone who knows a ZED ID or assessor id can read and submit assessment data for them. Request bodies, passwords included, are written to `App_Data/Json`; file paths are built from request values (path traversal / arbitrary file write); `ex.Message` is returned. | SwachhSurvekshanServices | V4 v1 keeps the contract but binds each user to the devices that logged in as them (`Mobile:DeviceBinding`, monitor then enforce), checks assessor allotments where the request names a unit, never stores request bodies, and confines files to the storage root. Full fix: v2 token API (docs/MOBILE-API.md). |

| 29 | Critical | Twilio account SID, API key and secret are hard-coded in `MsmeHelper`/`RAServiceHelper` (mobile services) and `RemoteController`; a SelectPdf API key is hard-coded in `MonitoringController`. | Source code | V4 reads Twilio keys from configuration. **Open: rotate the Twilio key and the SelectPdf key.** |

| 30 | Critical | **Anonymous staff actions in `DashboardController`/`MsmeController`:** `Dashboard/UpdatePaymentDetails` lets anyone mark a payment successful; `Dashboard/Resend` e-mails the stored plain-text password; `Msme/DisablePlant` deactivates and deletes an MSME; `Dashboard/GetCountsByFilter`, `Msme/History` and `Msme/GetHistory` are open too. | Main web | V4: SuperAdmin/MasterAdmin only, with server-side checks; Resend sends a reset link instead of the password. **Open on the live site.** |

| 31 | Critical | **Any stored procedure can be run from Reports.** `DynamicReports/GetReportData` and `ExportReportData` execute the procedure name sent in a hidden field; `SendMail` (any signed-in user, MSMEs included) runs any procedure and e-mails the Excel output to any address. | DynamicReportsController | V4: an allow-list of report ids per role; the browser sends only the id; user and role from the cookie. **Open on the live site.** |

| 32 | High | **Monitoring and allotment actions for any signed-in user.** `MonitoringController` only requires sign-in (no role): `FinalSubmit` (issues the certification), `RejectFinalSubmit`, `StepBack`, `SendBack*`, `ExtendNcClosureDate`, `UpdateRemarks`, `RegenerateCertificate`. `GetList`/`AcceptUnitForSa` take the allotment type from the browser and `SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA` has no ownership check, so any user can re-allot any unit. Also anonymous: `RemoteController` (all actions, plus path traversal in `SaveCapturedPhoto`) and `SAController`. | Main web | V4: role and sub-role checks; the agency's own units and assessors only. **Open on the live site.** |

| 33 | High | **Anyone can read any MSME's assessment.** `Assessment/GetDaDetails`, `GetSaDetails`, `GetDaDetailsByNc` and `Msme/GetDetails` take the ZED ID from the request; with no session the procedures treat the caller as the MSME itself. Assessor names and ids, remarks, meeting participants, coordinates and photo URLs are returned. | AssessmentController, MsmeController | V4 takes the ZED ID from the cookie and returns only the displayed columns. **Open on the live site.** |

| 34 | High | Photos and evidence are public static files at guessable addresses (`/mobileapi/{Photos,SaPhotos,CertifiedPhotos,SaCertifiedPhotos}/{ZedId}/...`, `/consultancymobileapi/...`, `/surveillancemobileapi/...`), partly linked over plain `http://`; the SA page put database photo URLs straight into `img src` (allow-list included `data:`). | IIS static files | V4 serves them only to the owning MSME (and authorised staff) through checked endpoints. **Open:** block direct static access on the old sites once V4 is live. |

| 35 | High | Allotment e-mails contain the lead and co-assessor's (and the MSME's) portal password: `SP_EMAIL_GET_DETAILS` selects `Users.Password`, `CoAssessorPassword`, `MsmePassword`. The MSME app's ChangePassword mailed the new password. | Mail templates | V4 mails contain no passwords. Fix scripts `main/05_mail_passwords` (also the 13 reminder/status job procedures that Zed.Jobs runs: **apply before enabling those jobs**), `consultancy/07`, `surveillance/06`. **Open until applied.** |

| 36 | High | **Surveillance payments**: `SurveillancePay/SubmitZeroPaymentDetails` needs no sign-in and takes the ZED ID and any `PaymentRefId` from the body (as #20); `Complete` takes `PaymentRefId` from the browser (as #21); `ZED_SURVEILLANCE.dbo.SP_MSME_PAYMENT_BASIC_DETAILS` charges ₹1.00 for 27 hard-coded ZED IDs (as #22); `GetSurveillancePaymentDetailsByType` (no sign-in) returns the Udyam PAN, GSTIN and TAN of any unit; `GetToken` writes the request body to `App_Data\Json\CCAVENUE_SURVEILLANCE\{ZedId}.json` (path traversal); the old success and reconciliation actions never compared the paid amount with the order. | SurveillancePayController | V4: server-side fee and eligibility, verified callback with amount check. **Open on the live site.** |

| 37 | Medium | Staff with a state (Ministry) could choose another state's data; the ZED ID history search accepted `LIKE` wildcards; staff list pages received every column (mobile, e-mail, owner, PAN). | Dashboard | Fixed in V4 (state forced from the user, ZED ID format checked, columns trimmed). |

| 38 | Low | Procedure defects: the surveillance zero-payment procedure checks `IsBronzePaymentDone` for every level and never raises an error; `SP_MSME_PAYMENT_BASIC_DETAILS` inserts the pending order before its already-paid check (orphan orders); the manual payment update procedure swallows its own errors. | ZEDCS_V2_LIVE, ZED_SURVEILLANCE | V4 re-checks state after these calls. Fix scripts `main/06_payment_procedure_defects` and `surveillance/07` (no orphan orders, real errors re-raised). SP_MSME_ZERO_PAYMENT_DETAILS deliberately unchanged (see surveillance/07). **Open until applied.** |

| 39 | Critical | **Anyone can take over any account.** `User/ResetMobileNo` needs no sign-in and runs `UPDATE Users SET Password=@mobile, MobileNo=@mobile` for any UserId, admins included. | UserController | V4: mobile changes only for users the caller manages, and never touch the password. **Open on the live site: remove or block this action now.** |

| 40 | Critical | `User/GeAssessorList` needs no sign-in and returns `Users.*` for every assessor: plain-text passwords, PwdCode and Aadhaar numbers. `User/CreateUser` needs no sign-in; the posted RoleId and UserId create agencies or overwrite any user via `SP_UPDATE_USER`. | UserController | V4: role checks, fixed roles, columns trimmed. **Open on the live site.** |

| 41 | High | Block/UnBlock/BlockOrUnblockBronzeAssessment: any signed-in user (MSMEs too), over GET, any user id; UnBlock re-mails the stored password. `Home/Upload` and `Home/SaveHomepageImage` (no sign-in) replace the login banner with any file or URL. Category and Technology Get/Save/Update/ActiveOrDeActive need no sign-in. | User, Home, Category, Technology controllers | Fixed in V4 (Admin/MasterAdmin only, POST with anti-forgery, uploads checked by type, signature and size). **Open on the live site.** |

| 42 | Medium | `User/Assessor?id=` shows any user by sequential id; `GeProfessionalDetailsByCertNo` has no role check; MyDocuments stores a browser-supplied path; `Questionaire/Upload` builds a folder from `sectionCode` (path traversal); the parameter description (`iButton`) is rendered as raw HTML (stored XSS); new agency/assessor passwords were 4 characters from `System.Random`. | Main web | Fixed in V4 (scoped lookups, server-generated names, encoded output, `SecureRandom.Password()`). |

| 43 | High | Desktop assessment (beyond #26): the update procedures change rows by the browser's Id with no ZED ID check; the browser's `isNcRaised` decided whether the NC mail went out and `FinalSubmit` had no state check (repeat calls raised extra NC rounds); allotment agency/assessor ids came from the browser; evidence uploads used the browser's file name (path traversal under `~/Uploads/DA`, any type, first file's content written under every name); rejection reasons are cut to `varchar(100)` silently. | AssessmentController | Fixed in V4 (ids checked against the record and NC round, NC decision from the procedure, eligible agencies/assessors only, generated names and content checks). Truncation: **open** (widen the column). |

| 44 | Critical | **Remote code execution risk in agency invoices.** `Invoice`/`InvoiceManagement` (`[AuthenticationFilter("")]`, so any signed-in user, MSMEs included): `UploadAgencyDoc`/`UploadMonthlyDoc` keep the uploaded extension and build the path from `docNumber`/`invoiceId`, so an `.aspx` can be written into the web root; `UpdateInvoice` (`SP_IM_INVOICE_STATUS_UPDATE`) sets any invoice to any status. `Incentive/Upload` needs **no** sign-in and writes to `~/Uploads/{sectionCode}/{fileName}` from the request (anonymous arbitrary file write). | Invoice, InvoiceManagement, Incentive controllers | Not ported to V4 (invoices look unreleased). **Open on the live site: remove or block these actions now.** |

| 45 | Critical | **Financial assistance for any signed-in user.** `FinancialAssistanceController` (and `TechnologyUpgradation`) only require sign-in: any user, an MSME included, can read any unit's bank details, change the reimbursement account, and approve applications. `ValidateEvidence` saves files under browser-chosen names (path traversal, any type). `FinalSubmit` and `Neft/UpdateStatus` let the browser choose the row, status and effect with no state check (NEFT Status=1 marks any row paid); `Neft/SendMail` is public; state coordinators see every state. | FinancialAssistance, TechnologyUpgradation, Neft controllers | Fixed in V4 (roles + FinancialVerification sub-role, assignment scoping, state transitions checked on the server, state scoping, audited actions). **Open on the live site.** |

| 46 | Medium | Incentive catalogue: `SaveIncentive`/`UpdateIncentive` need only a sign-in and the public page puts `WebLink` in `href` (stored XSS via `javascript:`); `SubmissionsPublic` lists unit names, Udyam numbers, gender and amounts publicly; the assessor "verified all documents" check tested a function reference (always true). | Incentive, FinancialAssistance | Fixed in V4 (Admin only, http(s) links only, server-side checks). Public list: **decision needed**. |

| 47 | High | **Mobile payments**: the old `Pay/successtransmobile`/`failuretransmobile` had no order, unit or amount check (a response for a ₹1 order could pay any level), appended raw `encResp` to `App_Data\Json\CCAVENUE` and showed `ex.Message` with the decrypted response; `Pay/GetToken` took the fee from the client's `PaymentRefId`; `GetTokenRSA` and the `Prepare*` actions were unauthenticated proxies to CCAvenue; `Msme/GetPaymentDetailsByType` and `SurveillancePay/GetSurveillancePaymentDetailsByType` give anyone with a ZED ID the unit's Udyam PAN (and previous GSTIN/TAN). Surveillance mobile `GetToken` only failed because the procedure forces an error when no order id is passed. | PayController, SurveillancePayController (mobile actions) | V4: fee and amount from the server, verified callbacks shared with the web flow, pending-order check on `GetTokenRSA`, nothing written to disk, device binding. Fee lists and zero payment stay reachable by ZED ID until device binding is enforced. |

| 48 | Critical | **Twilio API secret sent to every MSME.** `SP_APP_MSME_REMOTE_CHECK_LOGIN` hard-codes the Twilio account SID, API key and API **secret**, and `RA/Login` returned all three to every MSME that logged in (anyone holding them can mint video tokens for any room). | ZEDCS_V2_LIVE procedure, RA app | V4 no longer returns the secret; tokens come from `RA/GetToken`. **Open: rotate the Twilio key (#29) and remove the SELECT from the procedure.** Check the installed RA app does not build tokens itself from the secret. |

| 49 | High | Site assessor app: `SA/SubmitAllocation` let the lead assessor write any user id as a section's assessor (and `SP_APP_SA_ALLOT_SECTIONS_TO_COASSESSOR` updates the sections of every certification of the unit, not only the one assessed); `SA/SubmitEndAssessment` trusted the client's `userType`, so a co-assessor could submit the closing meeting; `RA/GetToken` issues a video token for any `{ZedId} Remote Assessment` room given only a ZED ID; `SA/UpdateSaDeclaration` and `SA/SubmitSaReg` change `SelfAssessments` rows by registration number with no identity (leftover hotel self-certification code). | SwachhSurvekshanServices SA/RA | V4: assessor must be the unit's lead/co-assessor for the certification, assignees limited to those two, closing meeting lead-only, device binding on RA. Procedure scope (all certifications): **open**. Registration-number actions: remove once logs confirm no caller. |

| 50 | Critical | **Web shell risk in the MSME app services.** `Msme/SubmitPhotos`, `SubmitFinancialPhotos` and `SubmitNcProduct` save uploads under the client's file name with any extension inside the IIS site's `~/Photos` folder, so an `.aspx` upload could run on the server; every path is built unchecked from `userName`, `certificationType`, `photoId`, `evidenceId`, `ulbCode` or `ghatId` (write anywhere). No sign-in is needed (#28). | SwachhSurvekshanServices MsmeController | V4: plain names only, image/PDF extensions only, paths confined to the storage root. **Open on the live site: block script execution in the upload folders (IIS handler mappings) now.** |

| 51 | High | The services' `WriteJson` saved every request under `App_Data\Json\Msme\...`, including both old and new passwords from ChangePassword (and the folder name came from `userName`). | SwachhSurvekshanServices | V4 stores no request bodies. **Open: purge `App_Data\Json` on the old services server.** |

| 52 | Medium | `SP_APP_MSME_INSERT_BASIC_INFO` creates certification rows for any ZED ID and level and overwrites them after submission; the reset token was a GUID with no throttle; `SP_INSERT_FACILITATOR_DETAILS` reveals whether a facilitator e-mail/mobile pair exists; the shipped `EnvironmentalChecklist.json` contains a real ZED ID. | SwachhSurvekshanServices, procedures | V4: stage checks before every write (`SP_APP_MSME_STATUS`), random tokens with a per-ZED-ID limit. Procedure scope: **open**. |

| 53 | High | **External API tokens.** Issued tokens last 24 h and are not scoped: any registered client can call every API (`RegisterPlant`, `SubmitIncentive`, `UploadReceiptInvoice` included); static partner rows (NULL ClientId) can mint issued tokens; client secrets and tokens are stored in clear (`ApiClientDynamicTokens.OriginalToken`, `ApiClientRequests.Token`, `ApiClientDynamicRequests.Token`, `ApiClientDynamicMultipleRequests.Token`, `ApiIncentives.Token`, `UdyamiAPIRequests`/`UdyamiAPIRequestFailures.ClientToken`, failed guesses too); no rate limit. | ApiSecure, Token, Msme partner APIs | V4: configurable lifetime, constant-time checks, per-IP limits, no tokens in logs. `main/12_api_token_logging`: the client name instead of the credential in the logs (optional purge of stored rows). **Open:** `ApiClientTokens.Token` and issued tokens kept in clear (needs new partner tokens), per-client scopes. |

| 54 | High | **ApiSecure encryption.** `AesEncryptionHelper` kept key and IV in static fields shared by concurrent requests (one client's answer encrypted with another's key); `GenerateToken` stored the request's IV before verifying the client; one IV for every message and no MAC; the "Internal check" actions (`GetAesKey`, `GetAesIV`, encrypt/decrypt helpers) are anonymous oracles for the stored keys; a test AES key and client credentials are in comments in the source. | ApiSecureController | V4: per-request keys, IV stored only after verification, oracles not ported. Fixed IV is part of the contract. **Open:** rotate that client, remove the actions on the live site. |

| 55 | Medium | A base64 static partner token (Saathi/Cleartrip certified-units API) is copied five times in comments in `MsmeController`; `Unit/*` compares the Web.config `apiToken` with `Equals`. | MsmeController, UnitController | **Open:** rotate the token if it is in `ApiClientTokens`; `Unit/*` not ported (dead hotel API). |

| 56 | High | `Msme/UploadReceiptInvoice`: path traversal from `tadaInvoiceNo`, `zedId`, `documentType` under `~/ReceiptInvoice` in the web root; any content saved as .pdf before the invoice is checked. | MsmeController (finance API) | Fixed in V4 (checked segments, PDF only, kept only on SUCCESS). **Open on the live site.** |

| 57 | Medium | Udyami Bharat APIs write request bodies (PAN, mobile, e-mail, sometimes the token) to `App_Data\Json\API\UdyamiApi\...` with the file name from the caller's `RequestId` (path traversal); RegisterPlant passwords are 4 characters from `System.Random`; `ex.Message` and internal file URLs are returned. | MsmeController (Udyami APIs) | Fixed in V4. **Open:** purge that folder. |

| 58 | Low | `GetStateCertificationsByPage` (AP state API) multiplies `ApplicationFee` by the page number and returns `ex.Message`. | MsmeController | Fixed in V4. |

| 59 | Medium | `SP_API_SUBMIT_INCENTIVE_DETAILS_ALL_OPTIONAL` validates no input (stored XSS risk on the staff incentive pages); never-expiring `ReverseToken` static tokens are accepted; duplicate submissions are inserted. | Incentive APIs | V4 validates input. `main/10_incentive_api_validation`: input check on V2, identical resubmissions stored once. **Open:** V1's static non-expiring tokens (partners must move to issued tokens first). |

| 60 | High | `Home/GetListOfCertifiedUnits` (anonymous POST) returns full `SelfAssessments` rows with respondent names, mobile numbers and e-mails. | HomeController (Saathi leftover) | Not ported. **Open: block on the live site.** |

| 61 | High | Master OTP (value redacted) accepted by `Otp/CheckOtp` and `SelfAssessment/DownloadCertificate`; `Login/SubmitForgotLogin` (anonymous) returns whole `SelfAssessments` rows by registration number. Dead Saathi code but reachable. | Otp, SelfAssessment, Login controllers | Not ported. **Open: remove the Saathi controllers on the live site.** |

| 62 | Medium | `Qc/Index` is an anonymous, unlinked copy of the Registered MSME admin page (adds to #30). | QcController | Not ported. **Open on the live site.** |

| 63 | Critical | **Delete or overwrite any server file.** `SA/AppendToDocument(sourcePdfPath, secondPdfPath, finalFile)` is public with no sign-in and deletes/overwrites the `finalFile` path (e.g. `web.config`); the same public method is on `MonitoringController` (any signed-in user). `Pdf/SelectPdfPostWithHttpWebRequest?path=` (no sign-in) writes converter output to any path; `Pdf/Index` creates folders from the ZED ID and spends paid SelectPdf calls; the SelectPdf key is also in `PdfController`. | SAController, MonitoringController, PdfController | Not ported (V4 draws PDFs itself). **Open on the live site: block these actions now.** |

| 64 | High | Stored XSS on the public report page: `SA/ReportSummary` puts `onerror='...OldPath/OldProductPhoto'` built by `SP_REPORT_GET_DETAILS` from file names the mobile app supplies; the browser decodes the HTML encoding before the handler runs. | SA/ReportSummary | V4 report is a PDF drawn on the server. **Open on the live site.** |

| 65 | Medium | `SA/ReportSummary` and `SA/Summary1` (no sign-in) save `~/GoogleMaps/{id}_{certification}.jpg` from request values (path traversal); `SA/GenerateReport` (no sign-in) writes files named from `RegistrationNumber` and returns `ex.Message`. | SAController | Not ported. **Open on the live site.** |

| 66 | Low | `Monitoring/SaveCertGenerationStatus` (any signed-in user) inserts rows that suppress certificate regeneration; `SP_GET_RE_GENERATE_CERTIFICATE_LIST` returns the whole status table for any role other than 7. | MonitoringController | V4: regeneration MasterAdmin only, status recorded by the server. |

| 67 | Critical | **Free handholding milestones.** `ConsultancyPay/SubmitZeroPaymentDetails` needs no sign-in, takes the ZED ID from the body and accepts any `PaymentRefId` with no zero check; `ZED_CONSULTANT.SP_MSME_ZERO_PAYMENT_DETAILS` sets `Is{Level}PaymentDone` and, for a unit that paid milestone 1, opens the next milestone. | ConsultancyPayController | V4: only for a state-subsidy row with nothing to pay, eligibility and milestone checked on the server, result re-read. **Open on the live site.** |

| 68 | High | `ConsultancyPay/Complete` takes the amount from the browser's `PaymentRefId`; `SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS` charges ₹1.00 for 29 hard-coded ZED IDs, inserts the order before its already-paid check and leaves the amount NULL when TdsDeductible is neither Yes nor No. | ConsultancyPayController, ZED_CONSULTANT | V4 refuses any difference from the server's fee row and milestone. **Open:** the procedure. |

| 69 | High | Consultancy callbacks (`successtrans`, `failuretrans`, `successtransmobile`) have no order, unit, amount or milestone check and show `ex.Message` with the decrypted response; `GetToken` writes the body to `App_Data\Json\CCAVENUE_CONSULTANCY\{ZedId}.json`; `GetTokenRSA` is an unauthenticated CCAvenue proxy; `SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS` opens milestone max+1 for any successful order, so a second paid order for one milestone opens the next. | ConsultancyPayController | V4: shared verified callback plus milestone check (order milestone = next, not yet paid). **Open on the live site.** |

| 70 | High | `SubmitFinanceInvoicerData` / `SubmitFinanceReceiptData` on `ConsultancyPay`, `Pay` and `SurveillancePay` are anonymous GETs that post any unit's invoice or receipt to the **production ERP** and return `ex.Message`. | Payment controllers | Not ported (V4 posts to the ERP only after a verified payment). **Open on the live site: block them.** |

| 71 | Medium | `Msme/GetConsultancyPaymentDetails` and `GetConsultancyPaymentDetailsByType` need no sign-in, take the ZED ID from the request and return the Udyam PAN. | MsmeController | V4: the app endpoint is device-bound; the web page uses the signed-in API. |

| 72 | Low | The handholding "APPLY REWARD" gave no discount but set `IsCouponUsed` (both result sets are the same row); `SP_MONITORING_RA_APPLICANT_ACCEPTANCE` accepts whichever certification is at status 16, not the one clicked. | Handholding page, procedure | V4 hides the reward without a coupon amount and accepts only the waiting milestone. Procedure part: `main/07_monitoring_state_checks`. **Open until applied.** |

| 73 | High | **Udyami Bharat sign-in hand-over** (`Msme/ZedDashboard`) signs the user in with a hard-coded master password (#1) after a token check that calls UBP's **UAT** gateway (`uatgatway.ubputl.com`) even in production; the UBP client secret is in source code (`Helpers/UdyamiIntegrationService.cs`); the raw one-time token is stored in `UbpUnitSignInHistory`; `ex.Message` is shown; the "Back to UBP" link is whatever URL UBP returns. | MsmeController, UdyamiIntegrationService | V4: looks the user up by id after UBP confirms (active MSME only), production URLs and secret from configuration, token stored as a hash, back link limited to UBP hosts. **Open:** rotate the UBP client secret, confirm production URLs with UBP. |

| 74 | Critical | **Technology upgradation POSTs need no sign-in.** Only Index, Details, Verification and Submissions carry a filter: anyone can call `UploadDocs` (saves with the client's extension under the public photos folder: web shell), `GetDetails?zedId` (any unit's FA application with bank account), `GetTechnologyList` (any unit's invoices), `UpdateAccountDetails` (changes the reimbursement account), `FinalSubmit`, `AllotCb`, `Accept/RejectUnitForVerification`, `ValidateEvidence` (path traversal), `SaveTimestamp`. Goes beyond #45. | TechnologyUpgradationController | V4: MSME side ported with sign-in and server checks; staff side not ported. **Open on the live site: block `/TechnologyUpgradation/*` POSTs now.** |

| 75 | High | Financial assistance `UploadDocs` keeps the client's extension and writes into the public `mobileapi/Photos` folder: any signed-in MSME can upload an `.aspx` (as #50); only `files[0]` is saved, under every name. | FinancialAssistanceController | V4: content-checked PDF/JPEG/PNG, generated names, owner-only serving. **Open on the live site.** |

| 76 | High | `WebinarController` (Saathi leftover) is anonymous apart from two views: `GetRegistrations?id` leaks registrants' names, mobiles, e-mails; `UpdateRegDetails` changes anyone's details; `SendReminder`/`SendFeedbackLink`/`SendCertificate` mail every registrant; `DownloadCertificate(certificateNo)` reads any `.pdf` on the server (path traversal); `ex.Message` returned. | WebinarController | Not ported. **Open on the live site: block `/Webinar/*`.** |

| 77 | Medium | `SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE` inserts without a certified level and trusts the client's eligible amount; `SP_APP_MSME_INSERT_TECHNOLOGY_DETAILS` trusts CertId, technology code and eligible amount and does not check the CertId belongs to the ZED ID. | Procedures | V4 computes the amounts on the server (web and, since round 2, the MSME app). `main/09_scheme_amounts_server_side`: FA needs a certified level, FA/TU eligible amounts computed in the procedure, TU only for a recommended technology. **Open until applied.** |

| 78 | Low | Incentive "Doc-2" links point to the vendor test host `zedtestng.umon.in`; `SP_APP_MSME_INSERT_TECHNOLOGY_UPGRADATION` excludes four hard-coded vendor e-mail addresses from agency auto-allotment, implying test agency accounts with FinancialVerification in ZED_CONSULTANT. | Incentive pages, procedure | V4 serves the documents itself. **Open:** review/disable those test accounts. |

| 79 | Critical | **Write any file.** `RemoteController.SaveBase64Image(contentBase64, filePath)` is a public method and therefore an anonymous action: it writes any content to any server path (web shell or overwrite). `SendMail` and `RenderPartialViewToString` are anonymous actions too (NC mails to any MSME/agency with attacker text, any partial view rendered). | RemoteController | Not ported. **Open on the live site: block these actions now.** |

| 80 | High | `Remote/FinalSubmit` (anonymous, #32) runs `SP_ASSESSMENT_RA_FINAL_SUBMIT` without the confirm checks: with no "No" answers it sets status 15 and assigns a certification id to an unassessed unit. `Remote/Index` and `Remote/Msme` give a Twilio token for any unit's room to anyone. The agency Final Submit on `Remote/Index` calls `Monitoring/RaFinalSubmit`, and `SP_MONITORING_RA_FINAL_SUBMIT` has no state check, so a Silver/Gold unit can be certified during desktop QC without a site assessment (with #32: by any signed-in user). | RemoteController, MonitoringController | V4: lead assessor of a remote-mode unit only, at status 9/13; agency final submit only at status 15. **Open on the live site.** |

| 81 | Medium | `Questionaire/Upload` keeps the uploaded extension (any type, e.g. `.aspx`) and writes into the web root (Admin only, but no CSRF protection, #10). `Assessment/UpdateAmounts` takes every fee column for any row from the browser (the charged amount can differ from the displayed fee), with no audit; `SP_MASTER_UPDATE_ASSESSMENT_FEE` stores `@SubsidyPer` in `SubsidyAmount`. | Questionaire, Assessment controllers | V4: server-computed fee rows, validation, audit log category `Zed.Audit.AssessmentFee`; upload not ported (unreachable). The `SubsidyAmount = @SubsidyPer` assignment is **kept on purpose**: receipts, payment and ERP procedures read that column as the applicant's fee. Column misnamed; behaviour correct. |

| 82 | Low | A Google Maps JavaScript API key is hard-coded in 52 views. | Views | **Open:** check it is referrer-restricted or rotate it. |

| 83 | Low | `SP_ASSESSMENT_RA_UPDATE_REQUIREMENT`/`_UPDATE_PRODUCT` update by Id alone (any unit); with NcCount ≥ 5 `SP_ASSESSMENT_RA_CONFIRM_FINAL_SUBMIT` returns an extra result set, so the old action read "0" for "NC raised". | Procedures | V4 checks ownership and reads the sets by name. |

| 84 | Medium | `SP_MONITORING_SEND_BACK_TO_ASSESSOR` and `SP_MONITORING_REJECT_FINAL_SUBMIT` check no status: repeated calls insert extra comments and history rows, and REJECT clears the payment flag of whatever level it is given. `SP_MONITORING_RA_UPDATE_AGENCY_REMARKS` has no SaProducts branch (remarks silently lost). | Procedures | V4 checks the state first. Fix scripts `main/07`, `consultancy/11`, `surveillance/05` (reject and send back only in the right states). **Open until applied.** |



### ZEDCS_CONSULTANCY (phase 7; analysis in systems/CONSULTANCY-ANALYSIS.md)



| # | Severity | Finding | Where | Status |

|---|---|---|---|---|

| 85 (C1) | Critical | **Anyone can set the handholding fee.** `Assessment/GetAmounts` and `UpdateAmounts` have no filter here (main: Admin). `UpdateAmounts` writes `ZED_CONSULTANT.AssessmentFee`, which main's milestone payment reads, bypassing V4 Main's fee check while the old site is up. | Consultancy AssessmentController | **Open: block now.** V4: Admin only, audited. |

| 86 (C2) | Critical | **Anonymous arbitrary update and SQL injection.** `Assessment/UpdateColumnData` (no filter) passes the browser's table, column, value and id to `SP_CONSULTANCY_UPDATE_COLUMN_VALUE`, which builds dynamic SQL with `@Id` unquoted (stacked statements possible) and accepts any table/column (`Users.Password`/`RoleId`, `AssessmentFee`, `MsmeCertifications.CertificationStatus`). `InsertBullet` is anonymous too. Concrete form of #12. | Consultancy AssessmentController, ZED_CONSULTANT | **Open: block now; fix the procedure (`@Id int` + allow-list).** V4: allow-listed edit endpoints. |

| 87 (C3) | Critical | **Milestone decisions need no sign-in.** Consultancy `MonitoringController` has no class filter: `RaFinalSubmit` (15→16, then the MSME can accept and pay the next milestone), `RejectFinalSubmit`, `SendBackToAssessor`, `UpdateRemarks`, `UpdateOfiComments`, `ExtendNcClosureDate`, DA `FinalSubmit`, `GenerateSaRepory`/`DownloadPdf` (write files), `AppendToDocument` (#63). | Consultancy MonitoringController | **Open: block now.** V4: the unit's CO only, state checks. |

| 88 (C4) | Critical | **TU review is anonymous, with a web-shell upload.** Consultancy `FinancialAssistanceController` has no class filter: AllotCb, Accept/Reject, FinalSubmit (approve), UpdateAccountDetails (payout account), UpdateTechnology (amount paid → subsidy), GetDetails (bank details), SubmitOpenMeeting (photo names from the request), `ValidateEvidence` saving under the client's name and extension in `~/Uploads/TechnologyUpgradation/...` (an `.aspx` lands in the web root). | Consultancy FinancialAssistanceController | **Open: block now** (keep only SubmitOpenMeeting); script execution off in `~/Uploads`. |

| 89 (C5) | High | `Technology/GetList` and `UpdateSelection` (no filter) replace any unit's recommended technologies, set `Msme.TechnologyUpgradation=1`, `TuStatus=1` and mail the unit — the gate for the TU subsidy application on main. | Consultancy TechnologyController | **Open: block.** V4: the unit's consultant or CO after milestone 3. |

| 90 (C6) | High | Consultancy `DynamicReportsController` has no class filter: `ExportReportData` and `SendMail` run the procedure named in the body and mail the Excel to any address, without a session (#31). | Consultancy DynamicReports | **Open: block.** V4: allow-listed per-system catalogue. |

| 91 (C7) | Critical | Consultant app: `SA/SubmitAttendance` saves with the client's extension under `~/Attendance/{zed}/{cert}` in the web root (web shell); `SubmitPhotos`/`SubmitEvidences` build paths from `sectionName`, `zedId`, `certificationType`, `photoId`; training actions have their status checks commented out. Not in #50's list. | Consultancy SwachhSurvekshanServices SA | **Open:** script execution off in `~/Attendance`, `~/SaPhotos`. V4: allotment check, fixed extensions, storage root. |

| 92 (C8) | High | `SA/TuReportSummary` (no sign-in) shows any unit's TU bank account number, IFSC and bank name by sequential ZED ID. | Consultancy SAController | **Open: block.** V4: authorised PDF. |

| 93 (C9) | High | `SP_APP_SA_CHECK_LOGIN_V2` matches co-consultants with `CoAssessorId LIKE '%'+@UserId+'%'` on a CSV column: ZEDCC101 matches a unit allotted to ZEDCC1019, so one consultant can open and submit another's unit. | ZED_CONSULTANT | **Open:** exact match on `AllotedCoAssessors`. V4 checks exact ids. |

| 94 (C10) | High | Main's `PayController` is deployed under `/Consultancy` against ZED_CONSULTANT: `SubmitZeroPaymentDetails` takes the ZED ID from the body without a session and any `PaymentRefId`; PayU success, `GetToken`, `GetTokenRSA`, `Complete` reachable; `ZED_CONSULTANT.SP_MSME_PAYMENT_BASIC_DETAILS` charges ₹1 to 8 hard-coded ZED IDs. | /Consultancy/Pay | **Open: block `/Consultancy/Pay/*`, remove the ID list.** |

| 95 (C11) | Medium | Rejection mails with the reject report attached are BCC'd to a vendor address (hard-coded in `Monitoring.SendRejectCertiicationMail`); the dead `EmailController` cc's the same vendor. | Consultancy MonitoringController | **Open: remove the address.** V4 sends no vendor copies. |

| 96 (C12) | High | Credentials: SMS gateway logins (ValueFirst user/password in a URL, a TextLocal API key) in **live** code in the consultancy `OtpController`; Twilio in Remote, MsmeHelper, RAServiceHelper and `SP_APP_MSME_REMOTE_CHECK_LOGIN` (#29/#48); SelectPdf (#29); Google Maps (#82); consultant user ids with what look like real passwords in comments of `SP_APP_SA_CHECK_LOGIN`, `_V2`, `SP_APP_SA_CONSULTANCY_CHECK_LOGIN`, `SP_APP_TU_CHECK_LOGIN`; master literals (#27). | Consultancy code and ZED_CONSULTANT | Schema scripts in this repository: every quoted value in comments redacted (round 2). `consultancy/04` and `05` strip the comments from the live procedures. **Open: rotate the SMS credentials and those consultants' passwords.** |

| 97 (C13) | Medium | Filters lost compared with main: `Assessment/GetList`, `Msme/GetProfileDetails` (any MSME profile by ZED ID), `Msme/ChangePassword` POST, `Home/Contact` (no captcha), `Sector/List`, `Incentive/Index`. | Consultancy web | **Open: block.** V4: roles. |

| 98 (C14) | Low | `MyDocuments/Upload` (Admin, no CSRF) lacks main's extension allow-list and writes into `~/Uploads/Documents` (as #81). | Consultancy MyDocumentsController | **Open:** script execution off in `~/Uploads`. |

| 99 (C15) | Low | Captured data in the legacy repository: `App_Data/Json/TU/...` (a real unit's TU open meeting with base64 photos), `App_Data/Json/SA/...`, 47 photos under `Photos/`. | Legacy source tree | **Open:** remove from source control, purge on the servers (#51). |



### ZEDCS_SURVEILLANCE (phase 8; analysis in systems/SURVEILLANCE-ANALYSIS.md)



| # | Severity | Finding | Where | Status |

|---|---|---|---|---|

| 100 (S1) | Critical | **Surveillance `MonitoringController` needs no sign-in.** Certify (also sets the **main** certificate ACTIVE), reject (sets the **main** certificate WITHDRAWN and enables re-certification), send back, NC-date extension, remarks and the file helpers are reachable anonymously. | Surveillance MonitoringController | **Open: block now.** V4: roles, allotment, state checks. `surveillance/05` already stops the anonymous reject from withdrawing a certified (16) or rejected (99) unit. |

| 101 (S2) | Critical | Surveillance `DynamicReportsController` has no filter: runs the procedure named in the request and can mail the output, without sign-in; procedures here also write to main and consultancy. | Surveillance DynamicReports | **Open: block now.** |

| 102 (S3) | Critical | `MyDocuments/Upload` (Admin on main) is anonymous here, keeps the uploaded extension and writes into the web root; save/delete document open too. | Surveillance MyDocuments | **Open: block now.** |

| 103 (S4) | Critical | `UserHelper` builds SQL from request values, reachable without sign-in through `User/UpdateUlbs` (main switched to parameters). | Surveillance UserHelper | **Open: block now.** |

| 104 (S5) | High | `User/GetAllAmc` (Swachh leftover, no sign-in) returns MasterAdmin user rows including the password column. | Surveillance UserController | **Open: block.** |

| 105 (S6) | High | Surveillance fee read/update needs no sign-in. These fee rows are what main's surveillance payment charges, and V4 trusts them. | Surveillance AssessmentController | **Open: block before relying on V4 phase 3b.** |

| 106 (S7) | High | NEFT and FinancialAssistance controllers (incl. document upload) have no filter at all. | Surveillance web | **Open: block.** |

| 107 (S8) | High | Dashboard data lists without role checks (contact and payment data of every unit); the manual "mark payment successful" action is open too. | Surveillance DashboardController | **Open: block.** |

| 108 (S9) | High | New mobile uploads `SA/SaveCapturedPhoto` and `Msme/SubmitSurveillancePhoto`: no sign-in, paths from request values, no content check, photo rows written for any unit. | SurveillanceServices | **Open.** V4: allotment check, confined storage. |

| 109 (S10) | High | New mobile `Surveillance` controller: after login every action takes the ZED ID from the request with no allotment check: evidence, answers and final submit can be written for any unit. | SurveillanceServices | V4 checks the assessor's allotment on every call. **Open on the live site.** |

| 110 (S11) | Medium | Secrets in source beyond #23: production SQL Managed Instance address and SQL login in both Web.config files; reCAPTCHA secret in UserController; copies of the Twilio, SelectPdf and Google Maps keys; CCAvenue in TEST mode pointing at the vendor host. | Surveillance source | **Open: rotate** together with #29/#82. New least-privilege logins for V4 (no db_owner, DDL or server roles): `database/security/01_v4_logins_and_roles.sql`; revoke the old login after the rollback window (CUTOVER section 4). |

| 111 (S12) | Medium | Account mirroring: staff passwords copied from main in clear and never synced; blocking here does not reach main and vice versa; any signed-in user can call block/unblock. | Surveillance UserController, main procedures | V4: from `Security:Passwords` = `Migrate`, accounts copied from main are checked against main's hash (read-only connection) and their clear copy is replaced; their password changes on main only. Main's SP_BLOCK_UNBLOCK_USER already copies blocks to surveillance. **Open:** the clear copy in SP_INSERT_USER while the old sites are live; a block made on the old surveillance site does not reach main. |

| 112 (S13) | Medium | Anonymous `Msme/Download` (any listed file of any unit; same on main's old site); the two from-main assessment views have no role check. | Surveillance MsmeController, AssessmentController | **Open: block.** |

| 113 (S14) | Low | Runtime data committed to the legacy repo: request logs with real ZED IDs, certificate PDFs, photos, an error log. | Legacy source tree | **Open: remove and purge.** |

| 114 (S15) | Low | The surveillance remote page posts to the mobile-services application, and one NEFT page posts to main, on the same origin; results depend on which application's session answers. | Surveillance views | V4: each page calls its own API. |



### Found while porting Consultancy and Surveillance (phases 7–8)



| # | Severity | Finding | Where | Status |

|---|---|---|---|---|

| 115 | High | The old consultancy and surveillance `SA/ReportSummary` pages were public: anyone with a ZED ID could read any unit's milestone or surveillance report (as #18). | Consultancy, Surveillance SAController | V4 serves the reports only to the owning MSME (main host) and authorised staff. **Open on the live site** (LIVE-HARDENING Tier C). |

| 116 | High | `SP_APP_SA_CHECK_LOGIN_V2` (DFO branch) tests TechUpgradeStatus on any FinancialAssistance row of the ZED ID, not whether this DFO is the allotted one; `SP_SA_APP_CHECK_STATUS` uses `@AssessorId` only for the LeadAssessor flag, so the old stage checks never tied the caller to the unit. | ZED_CONSULTANT | V4 checks the lead / co-consultant / expert / DFO by exact id before every call. `consultancy/09_dfo_login_allotment`: the DFO branch requires the allotted DFO. SP_SA_APP_CHECK_STATUS unchanged on purpose (no protection on the old services, would break V4): closes when the old services are retired. **Open until applied.** |

| 117 | Medium | `SP_EMAIL_GET_DETAILS_FA` (ZED_CONSULTANT) returns the DFO's `Users.Password` (as #35). TU procedures check almost no state: `SP_FINANCIAL_ASSISTANCE_VALIDATE_EVIDENCES` sets TechUpgradeStatus 5 unconditionally (can move an application back), `UPDATE_TECHNOLOGY_DATA`/`UPDATE_ACCOUNT_DETAILS` exclude only status 7, `ACCEPT_UNIT_FOR_VERIFICATION` allows re-allotment at any time, `FINAL_AUBMIT` treats a NULL RoleId as the DFO. | ZED_CONSULTANT | V4 does not use the password column and checks the state before each call. `consultancy/07` (password columns NULL), `consultancy/10_tu_state_checks` (state and owner checks). **Open until applied.** |

| 118 | Medium | Surveillance `MeetingLink`, `MeetingRecordingLinks.RecordingLink` and `Meetings.MeetingRecordingLink` are stored as entered and were rendered as `href` on the old pages and in mails: a `javascript:` URL would run for the MSME or the assessor. | Surveillance Remote page, allotment mails | V4 accepts and shows only http/https links. **Open on the live site.** |

| 119 | Low | Surveillance `SP_ASSESSMENT_RA_DELETE_PHOTOS` deletes by `Id` from both `SaPhotos` and `SaRequirementPhotos` (removes an unrelated evidence photo sharing the Id); surveillance `SP_MOVING_ONE_STEP_BACK_OF_NC` deletes MsmeHistory rows (main renames them `_STEPBACK`: audit-trail loss); surveillance `SP_ASSESSMENT_RA_UPDATE_PHOTOS` hard-codes the production host when parsing PhotoIds. | ZED_SURVEILLANCE | V4 refuses the colliding delete. `surveillance/04_photos_and_nc_history` fixes all three procedures. **Open until applied.** |

| 120 | Medium | Consultancy rejection: `SP_ASSESSMENT_REJECT_UNIT_FOR_SA` has no `NcCount` filter (writes the reason onto every milestone row); `SP_MONITORING_REJECT_FINAL_SUBMIT` sets 99 on every milestone row of the level and clears that level's payment flag; `SP_MONITORING_REJECT_CERTIFICATION` renames rows to `ZedId_D` with no Id suffix, so a second rejection merges with the earlier archive. | ZED_CONSULTANT | V4 rejects only in the right state. `consultancy/11_milestone_reject_send_back`. The `_D` archive naming is unchanged on purpose (consultancy dashboards depend on it). **Open until applied.** |

| 121 | Medium | #93's `LIKE '%'+@UserId+'%'` co-consultant match is also in ZED_CONSULTANT `SP_ASSESSMENT_ALLOT_LIST`, `SP_ASSESSMENT_DA_DETAILS` and `SP_ASSESSMENT_SA_DETAILS` (web lists and pages showed other consultants' units with SPOC contact data). Main's `SP_ASSESSMENT_DA_DETAILS` with `@FromSurveillance` skips its access check entirely (reachable through the surveillance wrapper, #112). | ZED_CONSULTANT, ZEDCS_V2_LIVE | V4 gates access by exact id and calls the main procedure only after its own allotment check. `consultancy/08` (exact co-consultant match), `main/11` (@FromSurveillance needs a staff role or the unit's surveillance agency/assessor; the executing login needs SELECT on ZED_SURVEILLANCE.dbo.MsmeCertifications). **Open until applied.** |

| 122 | Low | The old consultancy web `Remote/FinalSubmit` never passed `@UserId`, so the procedure always took the co-consultant branch and the lead's web final submit never moved the unit to 15. | Consultancy RemoteController | V4 passes the user. |

| 123 | Low | `ZED_SURVEILLANCE.SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS` has its own ₹1 list (16 ZED IDs); `ZEDCS_V2_LIVE.SP_MOVING_CERTIFIED_MSME_TO_CONSULTANCY` (runs at every certification) contains a test hack `IF @ZedId='<one unit>' UPDATE Users SET IsActive='ABC123'`. | ZED_SURVEILLANCE, ZEDCS_V2_LIVE | ₹1 list: `surveillance/02`. Test hack: `main/08_certified_to_consultancy_test_hack` (afterwards re-run the move for that unit if it is missing in ZED_CONSULTANT). **Open until applied.** |

| 124 | Medium | More public helper methods are reachable as MVC actions than #47/#63/#79 list (`GenerateReceipt`, `Prepare*CcAvenue*`, `Submi*ToApi`, `SubmitFinanceCustomerData`, `RandomString`); ASP.NET cookieless path tokens (`/(S(x))/…`) bypass URL-based blocks. | All three old sites | LIVE-HARDENING rules A00 and A01. **Open on the live site.** |

| 125 | Low | The old consultancy TU preferred-state drop-down posted state names while the procedures match `Msme.StateId`, so TU auto-allotment matched only Andhra Pradesh; the old surveillance agency list filtered to `AllowBronzeSurveillance=1`, so no agency could ever be enabled from it. | Consultancy, Surveillance user pages | V4 stores LGD state codes and lists all agencies. **Check existing `TuPreferredState` data.** |

| 126 | Low | The XSRF-TOKEN cookie was set with path `/`, so systems served on one domain overwrite each other's token. | V4 platform | Fixed in V4 (cookie scoped to the app's path base). |

| 127 | High | The pledge certificate's QR code holds the initial password: `SP_MSME_INSERT_UDYAM_DETAILS` builds `QrCodeNo` from the plant id, `'1'` and `UPPER(@Password)` (passwords are compared case-insensitively). Anyone with the certificate of a unit that never changed its password can sign in as that unit. | ZEDCS_V2_LIVE, pledge certificate | From `Security:Passwords` = `Migrate`, V4 passes a random value there. **Open:** ask the affected units to reset their password (detection query in `docs/PASSWORDS.md`). |

| 128 | Medium | The MSME reset (`SP_MSME_PWD_UPDATE_TOKEN` / `SP_MSME_PWD_VALIDATE_CODE`) stores reset codes in clear in `Users.PwdCode` and keeps every one in `ForgotPwdLinks`; codes never expire, only the last one is cleared when used, and the validate procedure returns `Users.*` including the password. V4's MSME reset sends the mail before answering (existing ZED IDs answer more slowly: probing by timing) and its link check puts the code in the URL path (`GET api/msme/auth/reset-password/{code}`, server logs). | ZEDCS_V2_LIVE, V4 MsmeAuthController | V4 (migration 0009, docs/PASSWORDS.md "MSME password reset"): web, staff "Resend Details" and the app use hashed, single-use, expiring tokens in `V4PasswordResets` (fragment links, answer before the lookup, the app no longer says "no User exists"); the legacy codes are neither written nor accepted, and a used link clears `Users.PwdCode`. **Open on the live site** while the old site issues codes; after decommission `SP_V4_PURGE_LEGACY_RESET_CODES @Mode='APPLY'`. |

| 129 | High | The other applications' databases on the same instance repeat #27 and #48: ZED_IMPACT_ASSESSMENT's `SP_APP_MSME_CHECK_LOGIN`, `SP_GET_LOGIN_DETAILS` and `SP_GET_USER_DETAILS` accept hard-coded master passwords, and its `SP_APP_MSME_REMOTE_CHECK_LOGIN` returns a Twilio account SID, API key and secret; ZED_CENTER_AUDIT_PROFESSIONAL's `SP_QUESTIONNAIRE_GET_BY_CODE` is gated by a hard-coded admin user id and password; ZED_IMPACT_ASSESSMENT's `SP_MSME_INSERT_UDYAM_DETAILS` and `SP_MSME_INSERT_UAM_DETAILS` set a new MSME login's password to its ZED ID. ZED can reach these databases (three-part names). | ZED_IMPACT_ASSESSMENT, ZED_CENTER_AUDIT_PROFESSIONAL | The schema copies in this repository (`database/schema/05`, `06`) are redacted. **Open:** those applications' owners: remove the literals and rotate the Twilio key (it may be the one of #48). |

| 130 | Medium | Database Mail profile `ZED_Report_Profile` ("ZED Daily Reporting") sends through a vendor's own mailbox (account GeoStat_Outlook, a geostat.in address, on smtp.office365.com): ZED data leaves through a third party's account, and no procedure in the six schema exports uses the profile, so what sends through it is unknown. | Old instance (msdb) | V4 does not use it. Fix script `database/fixes/msdb/01_report_profile_qci_mailbox.sql` moves the profile to the QCI mailbox dev.zed@qcin.org and, with `@DeleteVendorAccount = 1`, deletes the vendor account and its stored password (tested inside a rolled-back transaction). **Open until applied** on the old instance; then change the vendor mailbox's password with its owner. |
