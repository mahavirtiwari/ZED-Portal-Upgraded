# Hardening the live legacy sites

Runbook for the server team. It covers the three old sites, which stay live until V4 takes over:

| Application (IIS) | Code | Database |
|---|---|---|
| `/` (main, loginzed.msme.gov.in) | `ZEDCS main/SwatchSarvekshan` | ZEDCS_V2_LIVE |
| `/Consultancy` | `ZEDCS_CONSULTANCY/SwatchSarvekshan` | ZED_CONSULTANT |
| `/surveillance` | `ZEDCS_SURVEILLANCE/SurveillanceWeb` | ZED_SURVEILLANCE |
| `/mobileapi`, `/Consultancymobileapi`, `/surveillancemobileapi` | the `...Services` projects | as above |

`docs/SECURITY-FINDINGS.md` lists 114 findings. The ones below can be closed or contained **now, without the
migration**. Each finding number refers to that file. Nothing here needs a code change to the old sites.

**Order of work**
1. Back up the IIS configuration and the procedures (section 1).
2. Apply the tier A request rules (section 2) and turn off script execution in the upload folders (section 5).
   Then run the tests (section 6).
3. Run the database fix scripts (section 4): PREVIEW, diff, APPLY.
4. Rotate the keys and passwords (section 7).
5. Decide on each tier B rule with the business owner (section 3), then apply it.
6. Apply tier C at cut-over (section 3.2).

## 1. Before you start

- **URL Rewrite 2.1** must be installed (IIS Manager shows a "URL Rewrite" icon; the file is
  `%windir%\system32\inetsrv\rewrite.dll`). Request Filtering is built into IIS.
- **Back up** the server configuration with `%windir%\system32\inetsrv\appcmd add backup "before-zed-hardening"`
  (undo: `appcmd restore backup "before-zed-hardening"`). Also copy each application's `web.config`.
- **Where the rules go.** Every rule matches the full path in `{URL}` (for example `/Consultancy/Pay/GetToken`), so
  one set of rules works for all six applications, at whatever level it is placed. Put the set at **site level** so
  that a redeploy of an application cannot remove it. Either:
  - add it to `applicationHost.config` inside `<location path="SITE NAME"><system.webServer><rewrite><rules>`, or
  - add it to the main site's root `web.config` under `<system.webServer><rewrite><rules>`. The child applications
    inherit it. Keep a copy, because deploying the main site overwrites that file.

  Then check that no child `web.config` contains `<rewrite><rules><clear />`, which would drop the inherited rules:
  `findstr /s /i /m "<clear" web.config`. The repository copies have no rewrite section.
- **How the rules work.** `ignoreCase="true"` on every condition, because MVC routes are case-insensitive:
  `/user/RESETMOBILENO` reaches the same action as `/User/ResetMobileNo`. `/+` between segments also catches `//`.
  `(?:/.*)?$` also catches `/Action/123` (the `{id}` route value). A query string is never part of `{URL}`.
  Rule A00 refuses ASP.NET cookieless tokens such as `/(S(x))/Pay/success`. ASP.NET removes those from the path
  before routing, so without A00 they would get past every other rule.
- A blocked request gets **403 with the reason phrase "Blocked"** (`HTTP/1.1 403 Blocked`) and is logged with
  `sc-status` 403. Watch the IIS logs for a few days after each step (section 6.4).
- **Finding a live caller.** Before tier B or C, check whether anything still calls the path (section 6.4). The
  "what breaks" column says what the analyses (`docs/systems/*-ANALYSIS.md`) and MIGRATION-PLAN say is live. That
  comes from the code, not from the logs.

## 2. Tier A: block now

These rules close critical or anonymous paths. Most break nothing that is live. Where something small breaks, the
table says what, and the finding asks for the block anyway.

| Rule | Blocks | Findings | What breaks if applied |
|---|---|---|---|
| ZED-A00 | ASP.NET cookieless tokens in the path | bypass guard for every rule | Nothing: the sites do not use cookieless sessions (no `cookieless` in the Web.config files). |
| ZED-A01 | Helper methods that MVC exposes as actions (all three web sites) | #47, #63, #70, #79 | Nothing on the pages: these are public helper methods (PDF merge, base64 file write, partial-view render, PayU/CCAvenue request builders, ERP postings) that the code calls internally. Anyone who re-posts ERP invoices by opening `SubmitFinance*Data` in a browser must use the signed-in `Pay/RetriggerFinanceApi` instead. |
| ZED-A02 | PayU callbacks and helpers | #19, #47 | PayU checkout, which is unused: check that `PaymentGateway` in each Web.config is the CCAvenue value. The CCAvenue actions (`successtrans`, `failuretrans`, `successtransmobile`, `failuretransmobile`, `UpdatePaymentReconciliationStatus`, `GetToken`, `GetTokenRSA`, `Complete`) do not match. |
| ZED-A03 | Main: retired Saathi / Swachh / unreleased controllers | #44, #55, #61, #62, #63, #76 | Nothing live: Saathi hotel self-certification and its login and OTP, webinars (now on msmekawach.org.in), the dead hotel `Unit` API, the unlinked `Qc` copy, the SelectPdf test controller, and agency invoices (never released). `Error`, `Token` (partner API) and `Verify` (certificate QR) stay open. |
| ZED-A04 | Main: single dangerous actions | #39, #44, #54, #60, #65 | The Upload button on the old incentive admin page (`Incentive/Upload`: anonymous write to any path). Nothing else: the Home list pages are Saathi/Swachh leftovers, `ResetMobileNo` and `SA/GenerateReport` are called by no page, and the ApiSecure "internal check" actions are test oracles. The partner calls `ApiSecure/GenerateToken`, `GetDetailsByCertification`, `GetMsmeList` and `GetMsmeHandholdingList` stay open. |
| ZED-A05 | Consultancy: retired controllers, including main's PayController copy | #61, #94, #96, #97 (Incentive) | Nothing live. The handholding milestone payment runs on the main site (`/ConsultancyPay/...`), not here. Certificate QR codes are answered by main's `/Verify`. The OTP controller holds live SMS gateway credentials (rotate them, see section 7). |
| ZED-A06 | Consultancy: fee master, anonymous edits, leftovers | #39, #85, #86, #92, #97 | (1) Admin's milestone fee master page (`Assessment/PaymentDetails` loads and saves through GetAmounts/UpdateAmounts): change fees by SQL or in V4 until V4 Consultancy is live. (2) The inline EDIT and delete-bullet buttons on the milestone review page (UpdateColumnData, InsertBullet; also apply `database/fixes/consultancy/06a`). (3) The TU report link (`SA/TuReportSummary`). The MSME self-service pages here are dead (no MSME accounts); staff "View Profile" (`Msme/Profile`, `GetProfileDetails`, `GetDetails`), `DisablePlant` and evidence `Download` stay open (GetProfileDetails is in rule B08). |
| ZED-A07 | Surveillance: retired and duplicate controllers | #36, #102, #106 | Nothing live. Surveillance payment runs on the main site (`/SurveillancePay/...`; the copies here call procedures that do not exist in ZED_SURVEILLANCE). The MyDocuments, Questionnaire, Sector, FA, TU and NEFT menus are commented out on this site. |
| ZED-A08 | Surveillance: fee master, Swachh leftovers, anonymous user actions | #39, #103, #104, #105 | Admin's surveillance fee page (`Assessment/PaymentDetails`): change fees by SQL or in V4 (main's surveillance payment charges these rows). Nothing else live: "Resend password" is dead here, and the MSME self-service pages are unused (no MSME accounts). Staff "View Profile" and evidence `Download` stay open (Download is in rule B12). |

```xml
<!-- ZED hardening, tier A (docs/LIVE-HARDENING.md). Inside <system.webServer><rewrite><rules>. -->
        <rule name="ZED-A00 ASP.NET cookieless tokens in the path" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="/\([A-Z]\(" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-A01 Helper methods that MVC exposes as actions (all three web sites)" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/(?:consultancy/|surveillance/)?[^/]+/+(?:RenderPartialViewToString|AppendToDocument|SaveBase64Image|RandomString|GenerateReceipt|Generatehash512|PostPaymentRequest|PreparePayuRequest|PostPaymentRequestCcAvenue|PreparePayuRequestCcAvenue|PrepareCcAvenueSecureToken|PrepareCcAvenueSecureTokenIos|SubmiCustomerDataToApi|SubmiInvoiceDataToApi|SubmiReceiptDataToApi|SubmitFinanceCustomerData|SubmitFinanceInvoicerData|SubmitFinanceReceiptData)(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-A02 PayU callbacks and helpers" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/(?:consultancy/|surveillance/)?(?:Pay|ConsultancyPay|SurveillancePay)/+(?:success|failure|Add|Post)(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-A03 Main: retired Saathi / Swachh / unreleased controllers" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/(?:CitizenFeedback,?|Email|Helpdesk|Login|Otp|QueryForm|SC|SelfAssessment|SelfCertification|Unit|WB|Webinar|Qc|Pdf|Invoice|InvoiceManagement)(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-A04 Main: single dangerous actions" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/(?:Home/+(?:ListOfCertifiedUnitsSummary|ListOfCertifiedUnits|GetListOfCertifiedUnitsSummary|GetListOfCertifiedUnits|DummyAction|Ulbs|GetUlbsByYear|Top100Ulbs|Top200Ulbs|LandfillSites|GetUlbsByRange|GetLandfillSites)|User/+ResetMobileNo|Incentive/+Upload|SA/+GenerateReport|ApiSecure/+(?:GenerateEncryptedTokenRequest|GetAesIV|GetAesKey|GetEncryptedDetailsByCertificationRequest|GetDetailsByCertificationDecrypt|GetmsmeListEncryptedRequest))(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-A05 Consultancy: retired controllers, including main's PayController copy" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/consultancy/(?:CitizenFeedback,?|Email|Helpdesk|Login|Otp|Pdf|QueryForm|SC|SelfAssessment|SelfCertification|Unit|WB|Webinar|Token|Verify|Incentive|Pay)(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-A06 Consultancy: fee master, anonymous edits, leftovers" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/consultancy/(?:(?:Assessment/+(?:GetAmounts|UpdateAmounts|UpdateColumnData|InsertBullet|GetJaLocationCounts|AllowSaFinalSubmit|SaMonitoring|GetSaMonitoringDetails|DisableQuestionSampling|JaMonitoring|QualityCheck|GetJaMonitoringDetails|AddComments|AddGeneralComments|AcceptSaAnswer|ShortlistUlb|AssessComplete|ChangeSaAnswer|AcceptJaAnswer|ChangeJaAnswer|IndependentValidationByAmc|GetIndependentValidationDetailsByAmc|UpdateSampleByAmc|ScorerFinalSubmit|AmcFinalSubmit|Validation|UpdateValidationData|UpdateValidationNotAnswered|UpdateValidationFinalSubmit|JaSpecialPhotos|GetJaSpecialPhotos|GetUlbsByDistricts)|Dashboard/+(?:SelfAssessments|ResendPassword|AdminView|QuestionsDashboard|QuestionPaper|getSections|getQuestionPaper|insertSurveyAnswers|getQuestionsSummary|getOverallProgress|getWidgetsFilled|resetAllData|SectionWiseSummary|getSectionWiseSummary|finalsubmit|finalsubmitSampling|ResetEditStatus|getfinalSubmitValue|getfinalSubmitValueSampling|UlbDetailsDisplayReports|SelfAssessmentDisplayReports|CityProfileDisplayReports|GetCityProfileDisplayReports|CityProfileNotStarted|CityProfileinprogressCityProfile|DashboardUlbs|UnlockWards|InprogresSelfAssessmentDetails|InnovationSubmitted|SocialMedia|Innovation_Best_Practices|AssessmentSchedules|resetFinalSubmit|getBasicInformation|getCommonProfile|getODFCalculation|ExportExcel|ExportExcelGFC|ExportExcelODF|UploadDeclaration|EditDeclarations|DownloadCityProfile|ApplyProtocal)|User/+(?:ResetMobileNo|AssignUlb|Amc|GetAllAmc|UpdateUlbs)|Home/+(?:Contact|ListOfCertifiedUnitsSummary|ListOfCertifiedUnits|GetListOfCertifiedUnitsSummary|GetListOfCertifiedUnits|DummyAction|Ulbs|GetUlbsByYear|Top100Ulbs|Top200Ulbs|LandfillSites|GetUlbsByRange|GetLandfillSites)|SA/+TuReportSummary)(?:/.*)?|Msme(?:/+(?!(?:Profile|GetProfileDetails|GetDetails|DisablePlant|Download)(?:/|$)).*)?)$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-A07 Surveillance: retired and duplicate controllers" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/surveillance/(?:CitizenFeedback,?|Email|Helpdesk|Otp|Login|SC|SelfAssessment|SelfCertification|WB|QueryForm|Pdf|Token|Unit|Verify|Webinar|ConsultancyPay|Pay|SurveillancePay|MyDocuments|Questionaire|Sector|FinancialAssistance|TechnologyUpgradation|Neft)(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-A08 Surveillance: fee master, Swachh leftovers, anonymous user actions" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/surveillance/(?:(?:Assessment/+(?:GetAmounts|UpdateAmounts|GetJaLocationCounts|AllowSaFinalSubmit|SaMonitoring|GetSaMonitoringDetails|DisableQuestionSampling|JaMonitoring|QualityCheck|GetJaMonitoringDetails|AddComments|AddGeneralComments|AcceptSaAnswer|ShortlistUlb|AssessComplete|ChangeSaAnswer|AcceptJaAnswer|ChangeJaAnswer|IndependentValidationByAmc|GetIndependentValidationDetailsByAmc|UpdateSampleByAmc|ScorerFinalSubmit|AmcFinalSubmit|Validation|UpdateValidationData|UpdateValidationNotAnswered|UpdateValidationFinalSubmit|JaSpecialPhotos|GetJaSpecialPhotos|GetUlbsByDistricts)|Dashboard/+(?:Resend|SelfAssessments|ResendPassword|AdminView|QuestionsDashboard|QuestionPaper|getSections|getQuestionPaper|insertSurveyAnswers|getQuestionsSummary|getOverallProgress|getWidgetsFilled|resetAllData|SectionWiseSummary|getSectionWiseSummary|finalsubmit|finalsubmitSampling|ResetEditStatus|getfinalSubmitValue|getfinalSubmitValueSampling|UlbDetailsDisplayReports|SelfAssessmentDisplayReports|CityProfileDisplayReports|GetCityProfileDisplayReports|CityProfileNotStarted|CityProfileinprogressCityProfile|DashboardUlbs|UnlockWards|InprogresSelfAssessmentDetails|InnovationSubmitted|SocialMedia|Innovation_Best_Practices|AssessmentSchedules|resetFinalSubmit|getBasicInformation|getCommonProfile|getODFCalculation|ExportExcel|ExportExcelGFC|ExportExcelODF|UploadDeclaration|EditDeclarations|DownloadCityProfile|ApplyProtocal)|User/+(?:ResetMobileNo|AssignUlb|Amc|GetAllAmc|UpdateUlbs)|Home/+(?:ListOfCertifiedUnitsSummary|ListOfCertifiedUnits|GetListOfCertifiedUnitsSummary|GetListOfCertifiedUnits|DummyAction|Ulbs|GetUlbsByYear|Top100Ulbs|Top200Ulbs|LandfillSites|GetUlbsByRange|GetLandfillSites)|Incentive/+Upload)(?:/.*)?|Msme(?:/+(?!(?:Profile|GetProfileDetails|Download)(?:/|$)).*)?)$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
```

## 3. Tier B and tier C

### 3.1 Tier B: decide, then block

The findings say "block now". But each of these rules stops a **live staff workflow on the old site** until V4
takes it over. Decide rule by rule with the business owner. The alternative is a code fix on the old site: restore
`[AuthenticationFilter]` with role checks on the controller, then redeploy.

| Rule | Blocks | Findings | What breaks if applied |
|---|---|---|---|
| ZED-B01 | Main: Technology Upgradation POSTs (POST only) | #74 | The whole TU flow on the old main site: MSME TU applications (UploadDocs, SubmitFinancialData, SubmitTechnologyData) and the staff TU review. GET pages still open but cannot save. V4 Main has the MSME side; the staff side is not ported. |
| ZED-B02 | Main: anonymous staff payment and profile actions | #30 | SuperAdmin's manual "mark payment successful" on Failed Transactions, the Resend (password) button on Registered MSME, the disable-plant action, ZED ID history and the dashboard count filter on the old site. |
| ZED-B03 | Main: Reports run any procedure | #31 | Every report on the old main site (view, export, mail). Use V4 Reports (allow-listed) instead. |
| ZED-B04 | Main: anonymous user and master-data actions | #40, #41 | Agency and assessor lists, creation and blocking, login-banner upload, category and technology masters on the old main site. These are daily admin functions: block only when V4's staff side takes over. |
| ZED-B05 | Consultancy: milestone decisions (Monitoring writes) | #87 | The CO's milestone review on the old consultancy site: final submit (15→16), reject, send back, remarks, OFI comments, NC date, milestone reports. The lists (Index, GetList) still open. Alternative: put `[AuthenticationFilter]` with role checks on the class and redeploy. |
| ZED-B06 | Consultancy: TU staff review (keep the DFO app's SubmitOpenMeeting) | #88 | The TU review on the old consultancy site (Submissions, Verification, allot, accept/reject, final submit, account and technology updates, evidence upload). The DFO app's `SubmitOpenMeeting` stays open. |
| ZED-B07 | Consultancy: technology recommendation and reports | #89, #90 | "View Recommended Technologies" after milestone 3, and every consultancy report. |
| ZED-B08 | Consultancy: lists and profile that lost their filter | #97 | MasterAdmin's Allot list, the consultants' milestone lists and Completed (all use Assessment/GetList), staff "View Profile", Admin's Sectors page. That is most of the portal: prefer the code fix (restore the filters) unless the site is being retired. |
| ZED-B09 | Surveillance: certification decisions (Monitoring writes) | #100 | Agencies' surveillance final submit (certify, which also sets the main certificate ACTIVE), reject (main certificate WITHDRAWN), send back, remarks and NC dates on the old surveillance site. |
| ZED-B10 | Surveillance: reports | #101 | Every surveillance report. |
| ZED-B11 | Surveillance: dashboard lists and manual payment update | #107 | The staff dashboards (counts, Payment Received, Registered/Certified MSME, Financial Support, Failed Transactions) and the manual payment update. |
| ZED-B12 | Surveillance: anonymous file download and original-certification views | #112 | Evidence download links on the staff review pages, and the "original certification" panel on SaDetails. |

```xml
<!-- ZED hardening, tier B: add each rule only after the business has accepted what it breaks. -->
        <rule name="ZED-B01 Main: Technology Upgradation POSTs" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/TechnologyUpgradation/" ignoreCase="true" />
            <add input="{REQUEST_METHOD}" pattern="^POST$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-B02 Main: anonymous staff payment and profile actions" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/(?:Dashboard/+(?:UpdatePaymentDetails|UpdatePaymentDetailsWithInfo|Resend|ResendPassword|GetCountsByFilter)|Msme/+(?:DisablePlant|History|GetHistory))(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-B03 Main: Reports run any procedure" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/DynamicReports/+(?:GetReportData|ExportReportData|ExportAssessmentData|SendMail)(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-B04 Main: anonymous user and master-data actions" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/(?:User/+(?:GeAssessorList|CreateUser|Block|UnBlock|BlockOrUnblockBronzeAssessment)|Home/+(?:Upload|SaveHomepageImage)|Category/+(?:Save|Update|GetCategories)|Technology/+(?:Save|Update|ActiveOrDeActive|GetTechnologies))(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-B05 Consultancy: milestone decisions (Monitoring writes)" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/consultancy/Monitoring/+(?:UpdateRemarks|UpdateOfiComments|UpdateMeetingComments|SendBackToAssessor|StepBackToAssessor|FinalSubmit|ExtendNcClosureDate|RaFinalSubmit|RejectFinalSubmit|DownloadPdf|GenerateSaRepory|GenerateRejectRepory|DownloadReceipt|GenerateCertificate)(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-B06 Consultancy: TU staff review (keep the DFO app's SubmitOpenMeeting)" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/consultancy/FinancialAssistance(?:/+(?!SubmitOpenMeeting(?:/|$)).*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-B07 Consultancy: technology recommendation and reports" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/consultancy/(?:Technology|DynamicReports)(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-B08 Consultancy: lists and profile that lost their filter" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/consultancy/(?:Assessment/+GetList|Msme/+GetProfileDetails|Sector/+List)(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-B09 Surveillance: certification decisions (Monitoring writes)" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/surveillance/Monitoring/+(?:UpdateRemarks|UpdateOfiComments|UpdateMeetingComments|SendBackToAssessor|StepBackToAssessor|FinalSubmit|ExtendNcClosureDate|RaFinalSubmit|RejectFinalSubmit|DownloadPdf|GenerateSaRepory|GenerateRejectRepory|DownloadReceipt|GenerateCertificate)(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-B10 Surveillance: reports" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/surveillance/DynamicReports(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-B11 Surveillance: dashboard lists and manual payment update" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/surveillance/Dashboard/+(?:GetCountsByFilter|GetPaymentTransactions|GetFinancialSupport|GetRegisteredMsme|GetCertifiedMsme|GetCounts|GetFailedTransactions|UpdatePaymentDetails|UpdatePaymentDetailsWithInfo)(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-B12 Surveillance: anonymous file download and original-certification views" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/surveillance/(?:Msme/+Download|Assessment/+(?:GetDaDetailsFromZedLive|GetSaDetailsFromZedLive))(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
```

### 3.2 Tier C: at cut-over, or after checking the logs

| Rule | Blocks | Findings | What breaks if applied |
|---|---|---|---|
| ZED-C01 | Zero-payment actions | #20, #36, #67 | Fully subsidised (₹0) applications, milestones and surveillance on the old site and in the app. Apply when V4's payment flow (phase 3a/3b and the handholding payment) takes the traffic. |
| ZED-C02 | Public assessment reports and receipts | #18, #24, #64, #65 | The report links on main's Certification details page (V4 still links to the consultancy and surveillance ones until phases 7/8 switch them), and the old receipt rendering. Apply when V4 serves the reports. |
| ZED-C03 | Direct static access to certificates and photos | #9, #34 | Every page and mail that links to these files directly (old certificate links, report photos). V4 reads the same folders from disk (`Portal:StorageRoot`, `Mobile:StorageRoot`), not over HTTP, so V4 keeps working. Apply after the V4 cut-over. |
| ZED-C04 | Mobile services that are probably unused | #28, #48, #49, #108 | Any app still calling them. Check the IIS logs first (section 6.4). `/surveillancemobileapi/Msme/SubmitSurveillancePhoto` stays open. |

```xml
<!-- ZED hardening, tier C: at V4 cut-over / after the IIS log check. -->
        <rule name="ZED-C01 Zero-payment actions" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/(?:consultancy/|surveillance/)?(?:Pay|ConsultancyPay|SurveillancePay)/+SubmitZeroPaymentDetails(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-C02 Public assessment reports and receipts" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/(?:consultancy/|surveillance/)?SA/+(?:ReportSummary|Summary1|Summary2|Summary3|PaymentReceipt)(?:/.*)?$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-C03 Direct static access to certificates and photos" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/(?:(?:consultancy/|surveillance/)?(?:Certificates|PDFs)|(?:mobileapi|consultancymobileapi|surveillancemobileapi)/(?:Photos|SaPhotos|CertifiedPhotos|SaCertifiedPhotos|Attendance|FacilitatorSelfies))/" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
        <rule name="ZED-C04 Mobile services that are probably unused" stopProcessing="true">
          <match url=".*" />
          <conditions logicalGrouping="MatchAll" trackAllCaptures="false">
            <add input="{URL}" pattern="^/(?:(?:consultancymobileapi|surveillancemobileapi)/(?:RA(?:/.*)?|Msme(?:/+(?!SubmitSurveillancePhoto(?:/|$)).*)?)|mobileapi/SA/+(?:UpdateSaDeclaration|SubmitSaReg)(?:/.*)?)$" ignoreCase="true" />
          </conditions>
          <action type="CustomResponse" statusCode="403" statusReason="Blocked" statusDescription="Blocked by ZED hardening rule" />
        </rule>
```

### 3.3 Not fixable with a request rule

Request rules can only cut whole paths. These findings sit on paths that live users need, so they need a code or
database change on the old site (or V4):

- #15, #33, #71: the MSME pages read and send the ZED ID from the request (`Msme/GetDetails`, `GetMyDocuments`, ...).
- #21 (`Msme/UpdateUdyamDetails`), and #26 / #43 (Assessment actions without a filter, used by assessors).
- #28, #49, #109: the mobile services, which have no session. Script-off (section 5) limits #50 and #91.
- #32, #80: Monitoring and Remote for any signed-in user.
- #35: passwords in allotment mails (procedure `SP_EMAIL_GET_DETAILS`).
- #45, #56: FA and the `Msme/UploadReceiptInvoice` partner API (live).
- #53, #59: the partner tokens.

The old sites keep these weaknesses until V4 is live.

## 4. Database fix scripts

`database/fixes/{main,consultancy,surveillance}/*.sql`, one folder per database. **Review before running on
production. The live definitions may differ from the local copy the scripts were tested against: diff first.**

How they work:
- They read the current definition from the database at run time.
- They edit it by pattern (no password, key or ZED ID is written in any script).
- **PREVIEW** (the default) prints the new definition and changes nothing.
- **APPLY** (set `@Mode = 'APPLY'`) runs it as `CREATE OR ALTER`. Permissions are kept. All procedures of one script
  change, or none do.
- If the live text gives different match counts than the reviewed local copy, the script stops and changes nothing.
- A second run reports "nothing to change".

The undo is the definition you saved before (SSMS: Script As > CREATE To > File).

Scripts 01–04 (and consultancy 01–06) use the helper `#V4_FIX_PROCEDURE`; main 05–12 use `#V4_REWRITE_PROCEDURE` and surveillance 04–07 `#V4_EDIT_PROCEDURE` (token-by-token matching that ignores whitespace, case and comments). All scripts of one database can run in any order; each was tested on the local copy inside a rolled-back transaction.

| Script | Fixes | What breaks |
|---|---|---|
| main/01_login_master_passwords | #27: SP_GET_LOGIN_DETAILS, SP_APP_MSME_CHECK_LOGIN (MSME app); credential comments in SP_APP_SA_CHECK_LOGIN | Only use of the master values. V4 already refuses them. |
| main/02_sp_get_user_details_master_passwords | #1: the two master values in SP_GET_USER_DETAILS (web login) | **The old site's Udyami Bharat hand-over** (`Msme/ZedDashboard`) signs in with one of them. Apply after UBP points at V4, or after the old ZedDashboard calls `SP_GET_USER_DETAILS_BY_USER_ID` (details in the script header). |
| main/03_test_amount_lists | #22 (59 ids), #68 (29 ids: SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS lives in the main DB) | Those units pay the real fee. |
| main/04_remote_login_twilio | #48: Twilio SID, key and secret become NULL (same columns) | An RA app that builds tokens itself (ask the vendor). Rotate the key anyway. |
| consultancy/01_login_master_passwords | #27: SP_GET_USER_DETAILS, SP_GET_LOGIN_DETAILS, SP_APP_MSME_CHECK_LOGIN | Only use of the master values. |
| consultancy/02_test_amount_list | #94 (8 ids) | Those units pay the real fee. |
| consultancy/03_remote_login_twilio | #48/#96 | As main/04. |
| consultancy/04_consultant_login_comments | #96: consultant ids and passwords in comments of SP_APP_SA_CHECK_LOGIN, SP_APP_SA_CONSULTANCY_CHECK_LOGIN, SP_APP_TU_CHECK_LOGIN | Nothing. Change those consultants' passwords. |
| consultancy/05_sa_login_v2_exact_match | #93 (exact co-consultant match), #96 (comments) in SP_APP_SA_CHECK_LOGIN_V2 | Logins that only worked through the substring match. |
| consultancy/06a_update_column_value_fix **or** 06b_..._drop_ALTERNATIVE | #86: `@Id bigint`, table/column allow-list, parameterised value, signed-in CO / consultant / MasterAdmin only; or drop it (V4 does not use it) | 06a: edits outside the allow-list. 06b: the old milestone page's EDIT buttons (block rule A06 covers the path anyway). |
| surveillance/01_login_master_passwords | #27: SP_GET_USER_DETAILS (also the lockout bypass), SP_GET_LOGIN_DETAILS, SP_APP_MSME_CHECK_LOGIN, SP_APP_SURVEILLANCE_CHECK_LOGIN; comments in SP_APP_SA_CHECK_LOGIN | Only use of the master values. |
| surveillance/02_test_amount_lists | #36 (27 ids) and a 16-id list in this DB's copy of SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS | Those units pay the real fee. |
| surveillance/03_remote_login_twilio | #48/#110 | As main/04. |
| main/05_mail_passwords | #35: passwords NULL in SP_EMAIL_GET_DETAILS / _FA; the unit password in 13 reminder/status job mails replaced by a fixed sentence. **Apply before enabling those jobs in Zed.Jobs.** | Old allotment mails show an empty password line. |
| main/06_payment_procedure_defects | #38: no pending order for an already-paid level (SP_MSME_PAYMENT_BASIC_DETAILS); manual payment updates re-raise the real error | Nothing. |
| main/07_monitoring_state_checks | #84: reject only at 7/17, send back only from 5/15 or 7/17 (NcCount 6), SaProducts remarks saved; #72: acceptance of the named, waiting milestone only | Calls in other states get an error (V4 checks first). |
| main/08_certified_to_consultancy_test_hack | #123: one-unit test block removed from SP_MOVING_CERTIFIED_MSME_TO_CONSULTANCY | Nothing; re-run the move for that unit if it is missing in ZED_CONSULTANT. |
| main/09_scheme_amounts_server_side | #77: FA needs a certified level; FA and TU eligible amounts computed in the procedure; TU only for a recommended technology of that certificate | Client-sent eligible amounts are ignored. |
| main/10_incentive_api_validation | #59: fn_IsSafeInput on API V2; identical resubmissions not stored twice (V1 and V2) | Unsafe input on V2 gets 400 (as V1). |
| main/11_da_details_from_surveillance_access | #121: SP_ASSESSMENT_DA_DETAILS with @FromSurveillance only for staff roles or the unit's surveillance agency/assessors | The executing login needs SELECT on ZED_SURVEILLANCE.dbo.MsmeCertifications. |
| main/12_api_token_logging | #53: client name instead of the credential in the API logs and ApiIncentives.Token; optional @PurgeHistory for stored rows and expired tokens | Nothing the applications read; the purge is irreversible (back up). |
| main/13_xp_cmdshell_report | #12: report on xp_cmdshell use; optional switch-off (@DisableXpCmdShell) | Switch-off stops SP_JOB_TO_CREATE_RENAMING_BATCH_FILES: move the renaming to Zed.Jobs (`Jobs:FolderRename`, migration 0007) first. |
| consultancy/07_mail_detail_passwords | #35/#117: password columns of SP_EMAIL_GET_DETAILS, SP_EMAIL_GET_DETAILS_FA, SP_SA_GET_REG_DETAILS become NULL (same column names) | Old-site mails show an empty password ("Forgot password" instead). |
| consultancy/08_coconsultant_exact_match_web | #121: exact co-consultant match in SP_ASSESSMENT_ALLOT_LIST, SP_ASSESSMENT_DA_DETAILS, SP_ASSESSMENT_SA_DETAILS | Access that only worked through the substring match. |
| consultancy/09_dfo_login_allotment | #116: SP_APP_SA_CHECK_LOGIN_V2 DFO branch requires the DFO allotted to the unit (VerificationStatus 2) | A DFO signing in to another DFO's unit is refused. |
| consultancy/10_tu_state_checks | #117/#88: state and owner checks in SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT (no role default; allotted DFO at 2, allotted CO in QC, admin reject before decision), _VALIDATE_EVIDENCES (status 2), SP_FINANCIAL_ASSESSMENT_ACCEPT_UNIT_FOR_VERIFICATION (1, or 2 with TU 4/5), _UPDATE_TECHNOLOGY_DATA and _UPDATE_ACCOUNT_DETAILS (status 4, no NEFT in process) | Out-of-order calls; state-coordinator edits of amount/account before CO approval or after the NEFT starts. |
| consultancy/11_milestone_reject_send_back | #120/#84: SP_MONITORING_REJECT_FINAL_SUBMIT only at 15 (or 7); SP_MONITORING_SEND_BACK_TO_ASSESSOR returns when not at 15; SP_ASSESSMENT_REJECT_UNIT_FOR_SA current milestone, before allotment, once | Repeated or out-of-order calls. |
| surveillance/04_photos_and_nc_history | #119: SP_ASSESSMENT_RA_DELETE_PHOTOS refuses an Id present in both SaPhotos and SaRequirementPhotos of the unit; SP_ASSESSMENT_RA_UPDATE_PHOTOS reads the host from UrlsMasterData instead of a hard-coded one; SP_MOVING_ONE_STEP_BACK_OF_NC renames the withdrawn round's history to `_STEPBACK` (as main) | Removing a photo whose Id collides with an evidence photo of the same unit (error shown, photo stays). Check `UrlsMasterData.UrlName` first: if it is not the portal host, "From Site Tour" evidence starts working only after 04. |
| surveillance/05_monitoring_state_checks | #84, limits #100: SP_MONITORING_REJECT_FINAL_SUBMIT only below 6 or at 7/17; SP_MONITORING_SEND_BACK_TO_ASSESSOR only at 5/15 (NC round up to 5) or 7/17 (round 6) | Rejecting at 6, 8–16 or 99 (no page or job does). Stray send-backs now return an error. |
| surveillance/06_mail_details_no_passwords | #35: SP_EMAIL_GET_DETAILS (Password, MsmePassword, CoAssessorPassword) and SP_EMAIL_GET_DETAILS_FA (Password) return NULL; same columns and types | Old surveillance allotment, NC and FA mails show an empty password cell. |
| msdb/01_report_profile_qci_mailbox | #130: Database Mail profile ZED_Report_Profile sends through dev.zed@qcin.org instead of the vendor's mailbox; optionally deletes the vendor account | Whatever sends through the profile sends as dev.zed@qcin.org. Needs the mailbox password at APPLY. |
| surveillance/07_payment_order_and_errors | #38: SP_MSME_PAYMENT_BASIC_DETAILS checks "already paid" before creating the order; SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS(_WITH_INFO) re-raise the real error | Nothing. A failed manual update is now reported as failed. |

**Run it like this**, in SSMS, connected to the right instance:
1. Open the script. It starts with `USE [database]`.
2. Run it as it is (PREVIEW). Read the counts, compare the printed definition with the live one, and save the live
   one (that is the undo).
3. Set `@Mode = 'APPLY'` and run it again. Each procedure prints "altered".
4. Run it once more. It must say "nothing to change".

**#111 (passwords copied in clear to ZED_SURVEILLANCE.Users): documented, not changed.** Main's `SP_INSERT_USER` copies
a new agency's or assessor's password into `ZED_SURVEILLANCE.dbo.Users`. That copy is the only way those accounts
get a surveillance password: the surveillance site and V4 Surveillance both log in against that table with a
plain-text comparison. Main's `SP_UPDATE_USER` and `SP_BLOCK_UNBLOCK_USER` do not copy the password. Stopping the
copy would leave every new agency and assessor unable to sign in to surveillance. The real fix is #2 (hashed
passwords, with accounts mastered in main) and belongs to V4.

Until then:
- the surveillance Users table holds the same plain-text passwords as main: back it up and restrict it like main's;
- blocking on one side does not block on the other: when an agency or assessor is blocked, block it in both.

## 5. Upload folders: no script execution

Several actions save uploads under the client's file name and extension inside the web root (#44, #50, #74, #75, #81,
#88, #91, #98, #102, #108). An `.aspx` saved there would run. Turn script execution off in every folder the
applications write to, and refuse script and active-content extensions there (an `.html` or `.svg` file would be
stored XSS on the portal's origin).

Both settings go into `applicationHost.config` for the folder's path, so they survive redeploys and need no feature
delegation:
- `handlers accessPolicy="Read"`: the static file handler still serves files; nothing executes.
- a Request Filtering deny list: those files answer 404.7.

```powershell
# Run as administrator on the web server. Idempotent. $site = the IIS site serving loginzed.msme.gov.in.
Import-Module WebAdministration
$site = 'Default Web Site'
$webFolders = 'Uploads','ReceiptInvoice','Excels','ScorerFinalSubmitExcels','CitizenFeedbacExcels','AmcFinalSubmitExcels',
              'GoogleMaps','PDFs','Certificates','WebinarCertificates','StateCoordinatorReports','Images/HomePage',
              'Photos','SaPhotos','App_Data'
$appFolders = 'Photos','SaPhotos','CertifiedPhotos','SaCertifiedPhotos','FacilitatorSelfies','Attendance','Videos','App_Data'
$targets = @{ '' = $webFolders; 'Consultancy' = $webFolders; 'surveillance' = $webFolders;
              'mobileapi' = $appFolders; 'Consultancymobileapi' = $appFolders; 'surveillancemobileapi' = $appFolders }
$deny = '.aspx','.asp','.ashx','.asmx','.asax','.ascx','.axd','.svc','.xamlx','.rem','.soap','.cshtml','.vbhtml',
        '.config','.shtml','.shtm','.stm','.cer','.php','.htm','.html','.xhtml','.svg','.js','.swf','.exe','.dll',
        '.bat','.cmd','.ps1','.vbs'
foreach ($app in $targets.Keys) {
  foreach ($folder in $targets[$app]) {
    $loc = (@($site, $app, $folder) | Where-Object { $_ }) -join '/'
    Set-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $loc -Filter 'system.webServer/handlers' -Name 'accessPolicy' -Value 'Read'
    foreach ($ext in $deny) {
      try { Add-WebConfigurationProperty -PSPath 'MACHINE/WEBROOT/APPHOST' -Location $loc `
              -Filter 'system.webServer/security/requestFiltering/fileExtensions' -Name '.' `
              -Value @{ fileExtension = $ext; allowed = $false } -ErrorAction Stop } catch { }   # already there
    }
    "done: $loc"
  }
}
```

The same as `web.config` XML, for a team that prefers that. Put one block per folder in the application's
`web.config`. The `handlers` part needs Handler Mappings delegated as Read/Write, or IIS answers 500.19.

```xml
<location path="Photos">
  <system.webServer>
    <handlers accessPolicy="Read" />
    <security>
      <requestFiltering>
        <fileExtensions>
          <add fileExtension=".aspx" allowed="false" />
          <add fileExtension=".ashx" allowed="false" />
          <add fileExtension=".asmx" allowed="false" />
          <add fileExtension=".cshtml" allowed="false" />
          <add fileExtension=".config" allowed="false" />
          <add fileExtension=".html" allowed="false" />
          <add fileExtension=".svg" allowed="false" />
          <add fileExtension=".js" allowed="false" />
          <!-- ... the full list as in $deny above -->
        </fileExtensions>
      </requestFiltering>
    </security>
  </system.webServer>
</location>
```

Notes:
- **Folder names.** They come from the code (`Server.MapPath("~/...")` and the services' paths). Folders that do not
  exist cost nothing. The financial-assistance and TU uploads (#74, #75) write to `PhotosPath` from the web
  `Web.config` (the services' `Photos` folder), which this covers.
- **App_Data** is already hidden by IIS (`hiddenSegments`). Check with
  `appcmd list config -section:system.webServer/security/requestFiltering` that it is still listed. Then **purge
  `App_Data\Json`** on every application: request bodies with passwords, PAN, mobiles and tokens (#28, #36, #51, #57,
  #69).
- **Existing files.** Look for script files that are already in these folders, before and after:
  `Get-ChildItem <path> -Recurse -Include *.aspx,*.ashx,*.asmx,*.cshtml,*.config,*.htm*,*.svg,*.js,*.php`.
  Anything found there is an incident, not a cleanup.

## 6. Testing

Run from outside the server (and once from the server itself), against production, right after each step.
`--path-as-is` keeps `//` and `/./` as typed. `--http1.1` shows the reason phrase.

### 6.1 Blocked paths (expect `403 Blocked`)

```powershell
$base = 'https://loginzed.msme.gov.in'
$blocked = @(
  'POST /Pay/success', 'GET /pay/SUCCESS', 'GET /PAY/Success/1', 'POST /Pay//success', 'POST /(S(abc))/Pay/success',
  'POST /SurveillancePay/failure', 'GET /Pay/SubmitFinanceInvoicerData', 'POST /Remote/SaveBase64Image',
  'POST /Monitoring/AppendToDocument', 'POST /SA/AppendToDocument', 'GET /Webinar', 'GET /webinar/GetRegistrations/5',
  'GET /CitizenFeedback,/Index', 'POST /Invoice/UploadAgencyDoc', 'POST /User/ResetMobileNo', 'GET /user/resetmobileno',
  'POST /Home/GetListOfCertifiedUnits', 'POST /ApiSecure/GetAesKey', 'POST /Incentive/Upload',
  'POST /Consultancy/Pay/GetToken', 'POST /consultancy/pay/SubmitZeroPaymentDetails',
  'POST /Consultancy/Assessment/UpdateColumnData', 'POST /consultancy/assessment/updateamounts',
  'POST /Consultancy/Msme/ChangePassword', 'POST /Consultancy/User/ResetMobileNo', 'GET /Consultancy/SA/TuReportSummary/1',
  'POST /surveillance/User/GetAllAmc', 'POST /surveillance/User/UpdateUlbs', 'POST /surveillance/MyDocuments/Upload',
  'POST /surveillance/Assessment/UpdateAmounts', 'POST /surveillance/Neft/UpdateStatus', 'POST /SURVEILLANCE/dynamicreports/GetReportData'
)  # the last one only after tier B (ZED-B10)
foreach ($t in $blocked) {
  $m, $p = $t -split ' ', 2
  $code = curl.exe -s -o NUL --http1.1 --path-as-is -X $m -d '' -w '%{http_code}' "$base$p"
  '{0} {1,-6} {2}' -f ($(if ($code -eq '403') { 'ok  ' } else { 'FAIL' })), $code, $t
}
```

### 6.2 Live paths (expect anything but 403)

These must **not** answer 403. A 200, 302 (to the login page), 404 or the old error page is fine:

```powershell
$live = @(
  'GET /', 'GET /Msme/Login', 'GET /User/Login', 'POST /Pay/successtrans', 'POST /Pay/successtransmobile',
  'POST /Pay/UpdatePaymentReconciliationStatus', 'POST /Pay/GetTokenRSA', 'POST /ConsultancyPay/successtrans',
  'POST /SurveillancePay/successtrans', 'GET /Verify/Pc', 'POST /Token/GenerateToken', 'POST /ApiSecure/GenerateToken',
  'GET /Incentive/Details/1', 'POST /Remote/SaveCapturedPhoto', 'GET /SA/ReportSummary/ZEDMSME000001',  # until tier C
  'GET /Consultancy/User/Login', 'GET /Consultancy/Msme/Profile/ZEDMSME000001', 'POST /Consultancy/Monitoring/GetList',
  'POST /Consultancy/FinancialAssistance/SubmitOpenMeeting', 'POST /Consultancy/Assessment/GetAssessors',
  'GET /surveillance/User/Login', 'GET /surveillance/SA/ReportSummary/ZEDMSME000001', 'GET /surveillance/Incentive/Submissions',
  'POST /mobileapi/SA/Login', 'POST /mobileapi/Msme/Login', 'POST /mobileapi/RA/Login', 'POST /Consultancymobileapi/SA/Login',
  'POST /surveillancemobileapi/Surveillance/Login', 'POST /surveillancemobileapi/SA/SaveCapturedPhoto'
)
foreach ($t in $live) {
  $m, $p = $t -split ' ', 2
  $code = curl.exe -s -o NUL --http1.1 --path-as-is -X $m -d '' -w '%{http_code}' "$base$p"
  '{0} {1,-6} {2}' -f ($(if ($code -ne '403') { 'ok  ' } else { 'FAIL' })), $code, $t
}
```

Then sign in once on each site as an agency, a MasterAdmin and an MSME, and walk the main screens: allotment,
monitoring list, payment (CCAvenue test card only on a test merchant), reports. On the apps: one site-assessor
login, one consultant login and one Bronze-surveillance login.

### 6.3 Upload folders

Request a script extension that does not exist. Request Filtering refuses it before IIS looks for the file:
`curl.exe -s -o NUL -w "%{http_code}" https://loginzed.msme.gov.in/mobileapi/Photos/zz.aspx` should give 404, logged
as `sc-substatus` 7 (404.7). An existing image must still load (200).

For a full test, put a file `zz-exec-test.aspx` containing `<%= 1+1 %>` in one folder per application for a minute.
Request it: expect 404 (404.7), and never the text "2". Then delete it.

### 6.4 Logs

Every request blocked since the change:

```
logparser -i:IISW3C "SELECT cs-uri-stem, cs-method, COUNT(*) AS hits FROM u_ex*.log WHERE sc-status = 403 AND sc-substatus = 0 GROUP BY cs-uri-stem, cs-method ORDER BY hits DESC"
```

Callers of a path, before a tier B/C rule (last 30 days):

```
logparser -i:IISW3C "SELECT cs-uri-stem, c-ip, cs(User-Agent), COUNT(*) FROM u_ex*.log WHERE cs-uri-stem LIKE '/Consultancymobileapi/RA/%' GROUP BY cs-uri-stem, c-ip, cs(User-Agent)"
```

A rule that blocks a caller you did not expect: remove that one rule, find out who it is, and record the decision
in SECURITY-FINDINGS.md.

## 7. Keys and passwords to rotate (names only)

Rotate each one with its owner. Put the new value **only** in the server's configuration, never in source control,
mails or chat. When V4 goes live it reads the new values from its own configuration (see the V4 appsettings and
README).

| What | Where it was exposed | Finding |
|---|---|---|
| **Twilio** API key and secret (and review the account SID) | `MsmeHelper`, `RAServiceHelper` (all three services), `RemoteController`, and `SP_APP_MSME_REMOTE_CHECK_LOGIN` in all three databases, which returned it to every MSME | #29, #48, #96, #110 |
| **SelectPdf** API key | `MonitoringController`, `PdfController` | #29, #63 |
| **UBP** (Udyami Bharat) client secret | `Helpers/UdyamiIntegrationService.cs` | #73 |
| **ERP**: Azure AD client secret of the production Dynamics 365 Business Central | `Helpers/ErpIntegrationService.cs` | #23 |
| **CCAvenue web**: working key and access code (main, Consultancy, Surveillance), plus the reconciliation working key in a `PayController` comment | `Web.config` files, `PayController` | #3, #23 |
| **CCAvenue mobile**: mobile access code and working key | `Web.config` (mobile variants) | #3, #47 |
| PayU key and salt (unused, but committed) | `Web.config` | #3 |
| **SMS gateways**: ValueFirst user and password (in a URL), TextLocal API key, and whatever `SmsProvider` points at | consultancy `OtpController` (live code), `Web.config` | #96 |
| **reCAPTCHA** secret keys | `MsmeController` (main), surveillance `UserController` | #3, #110 |
| **Google Maps** JavaScript API key | 52 views | #82 (restrict it to the portal's referrers, or rotate) |
| Udyam service access key | `MsmeController`; also built into the MSME app (EnterpriseInfoFragment) | #3, #132: rotate only after an app version without it is the minimum supported version |
| App signing keystores of the obsolete apps (passwords in their build.gradle) | ZEDSurveillance, ZED_MAM | #135: if either still signs a live app, move to a new upload key under Play App Signing |
| **SQL login** of the applications, and the production SQL Managed Instance address | `connString` in every `Web.config` (both surveillance ones name the instance) | #110 |
| SMTP mailbox password (`password` key) | every `Web.config` | #3 |
| Partner tokens: the Saathi/Cleartrip base64 token, `apiToken`, the ApiSecure test client and AES key | `MsmeController` comments, `Web.config`, `ApiSecureController` comments | #54, #55 |
| Consultant accounts whose passwords sat in procedure comments | ZED_CONSULTANT login procedures | #96 (change those users' passwords) |

The master passwords (#1, #27) are not rotated: the database scripts make them stop working. Also purge the typed
passwords stored in `FailedLogins` (#2).

## 8. After the change

- Report the new state of each finding to whoever keeps SECURITY-FINDINGS.md: "blocked on the live site (rule
  ZED-xx, date)" or "procedure fixed (script, date)".
- Keep the rules until each application is decommissioned. When V4 takes over an application, its IIS application
  points at V4 and these rules no longer apply to it.
- **Two rules block addresses V4 itself serves** on the same host: ZED-A03 (`/Login…`) and ZED-C01
  (`/Pay/SubmitZeroPaymentDetails`). Remove them when the main IIS application points at V4, and put them back
  if you roll back (docs/CUTOVER.md).
