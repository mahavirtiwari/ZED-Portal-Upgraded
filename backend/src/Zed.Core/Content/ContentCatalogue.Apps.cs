namespace Zed.Core.Content;

public static partial class ContentCatalogue
{
    private const string MsmeApp = "MSME app", AssessorApp = "Assessor app", ConsultantApp = "Consultant app";

    /// <summary>
    /// The apps' texts (Content/Texts on the mobile hosts); docs/mobile/APP-TEXTS.md says where each is shown. The standard
    /// wording is the legacy app's own. MSME-app texts the Bronze surveillance build also shows (it uses the Surveillance
    /// host) are for Main and Surveillance. A short text (a checkbox, an alert) is plain, without a paragraph.
    /// </summary>
    private static IEnumerable<ContentBlock> Apps() =>
    [
        // MSME app: certification payment (also in the Bronze surveillance build: My Certifications → pay)
        App("app.msme.certification.payment.disclaimer", "Certification payment: disclaimer", MsmeApp, MainAndSurveillance, """
            <p>This disclaimer/declaration governs the use of the MSME Standard, various documents, reports and any content therein. The following is accepted in full by the User/applicant Unit:</p>
            <ol>
              <li>By agreeing to proceed and make relevant payment it is assumed that the applicant has read &amp; understood the Scheme Guidelines &amp; the provisions contained therein and is participating in this voluntary scheme on their own volition.</li>
              <li>The applicant has read and understood the requirements of the Certification Level for which the payment is being made and take full responsibility for any non-conformities that may occur during the Certification process.</li>
              <li>The amount once remitted is non-refundable, non-adjustable &amp; non-transferable irrespective of the outcome of the Certification process.</li>
              <li>Submission of relevant documents/evidences/responses in a timely manner is essential and non-conformance to timelines may result in forfeiture of any amount paid.</li>
              <li>The “Joining Reward” (Rs. 10,000/-) will be unlocked only once and can be applied for any Certification Level. Once availed, the Joining Reward cannot be reverted, reinstated or reused in any manner.</li>
              <li>The final payment being made is only the “beneficiary contribution”; the subsidies applicable for this Certification Level is pre-applied.</li>
              <li>Mere submission of relevant payment does not guarantee a Certification. The Certification will only be accorded after completion of due process and closure of all non-conformities, if any, within the stipulated time.</li>
            </ol>
            """),
        App("app.msme.certification.payment.instructions", "Certification payment: instructions", MsmeApp, MainAndSurveillance, """
            <ol>
              <li>After making the payment, the applicant MSME would need to submit necessary information/documents on the “Basic Information &amp; Document Upload” section.</li>
              <li>During the process of “Basic Information and Document Upload”, most relevant information and evidences should be provided/uploaded.</li>
              <li>The desktop assessor will not attempt to ensure the accuracy of information/documents provided and the conclusions of this process will be derived solely from the information provided by the applicant.</li>
              <li>It is expected that the applicants honestly upload the relevant documents/evidences. Information not disclosed or erroneously uploaded by the applicant may lead to non-conformities.</li>
              <li>After the completion of the Basic Information and Document Upload process, a desktop verification of the documents uploaded will be done. Thereafter, the way forward will be provided to the MSME via email.</li>
              <li>Please download the Mobile Application from Google Playstore as and when prompted.</li>
              <li>Please download the User Manual from “My Documents” for detailed instructions &amp; guidance on “Basic Information &amp; Document Upload”.</li>
            </ol>
            """),
        App("app.msme.payment.joiningReward.note", "Payment: joining reward note", MsmeApp, MainAndSurveillance,
            "*Applicable only on one certification (either Bronze or Silver or Gold)"),
        // Shown by the app for a Bronze payment only.
        App("app.msme.payment.joiningReward.bronzeNote", "Payment: balance joining reward note (Bronze)", MsmeApp, MainAndSurveillance,
            "*The balance joining reward i. e. Rs. 2000/- will be adjusted towards \"Surveillance Assessment\" after 18 months of the certification. The validity of availing the balance joining reward i.e. Rs. 2000/- (cost of surveillance assessment of Bronze) will be till the surveillance is done."),
        App("app.msme.payment.success", "Payment: success message", MsmeApp, MainAndSurveillance, """
            <p>Your payment towards ZED Certification is successful.</p>
            <p>You can now start "{{Certification}} Certification" from your Dashboard</p>
            """, "Certification"),
        App("app.msme.payment.failure", "Payment: failure message", MsmeApp, MainAndSurveillance, """
            <p>There seems to be some error in your Payment, please try again or try selecting a different method.</p>
            <p>If this keeps repeating, please contact ZED Support.</p>
            """),

        // MSME app: Financial Assistance (the Incentives menu is hidden in the Bronze surveillance build)
        App("app.msme.schemes.fa.disclaimer", "Financial Assistance: disclaimer", MsmeApp, Main, """
            <ol>
              <li>The benefits/incentives available to a ZED Certified MSME Unit are non-transferrable.</li>
              <li>The Financial Assistance can be applied/claimed only for the Unit which has been ZED Certified and not for any other Unit of the applicant MSME which may not be ZED Certified.</li>
              <li>The Financial Assistance can be applied/claimed only for the activities being conducted at the MSME unit and for the existing product line only, as exhibited during the ZED Certification process.</li>
              <li>This Financial Assistance is at the discretion of Ministry of MSME and cannot be claimed as a right by any ZED Certified MSME.</li>
              <li>The subsidy on the cost of Certification for any Testing, Management System or Product Certification will be subject to the following conditions:
                <ol type="a">
                  <li>The product testing must be through a Laboratory that is accredited by the National Accreditation Board for Testing &amp; Calibration Laboratories (NABL)</li>
                  <li>The Management System Certification must be through a Certification Body that is accredited by the National Accreditation Board for Certification Bodies (NABCB)</li>
                  <li>The Product Certification must be through Bureau of Indian Standards (BIS)</li>
                </ol>
              </li>
              <li>The subsidy will be 75% of the total cost of Testing/System/Product Certification, with the maximum ceiling of subsidy being Rs. 50,000/-. The subsidy will be on the amount which is exclusive of any applicable taxes.</li>
              <li>The date of product/systems/testing Certification, for which the financial assistance is being claimed, must be after the date of ZED Certification. Claim for Certifications which have been procured earlier from the date of ZED Certification will not be entertained.</li>
              <li>The Financial Assistance cannot be claimed retrospectively for ZED Certifications achieved earlier. For example, an MSME which did not claim Financial Assistance for Bronze, achieves Silver and then applies for Financial Assistance: in this case the Financial Assistance can only be claimed for Silver and not for Bronze retrospectively.</li>
              <li>The subsidy will be applicable on only one Testing OR one Quality OR one Product Certification after achieving this Level. The applicant MSME cannot club two or more certifications in the given subsidy/cost.</li>
              <li>The Certification pertaining to Testing, Management Systems or Product, obtained through a Government Agency/Organisation will also be eligible for the said Financial Assistance.</li>
              <li>Any application which is incomplete in any respect will be summarily rejected.</li>
              <li>Information and documents submitted are subject to scrutiny and relevant validation.</li>
              <li>Mere submission of application for this activity does not warrant award of any financial support.</li>
              <li>If at any stage it is found that the documents submitted have been obtained fraudulently, the Ministry of MSME reserves the right to withdraw or recall its decision and seek refund of financial support provided. The Ministry will also be within its rights to initiate legal proceedings for any such cases.</li>
            </ol>
            """),
        App("app.msme.schemes.fa.instructions", "Financial Assistance: instructions", MsmeApp, Main, """
            <ol>
              <li>After agreeing to the disclaimer and reading these instructions, the applicant will follow the directions given hereon and submit relevant information and documents as asked.</li>
              <li>Please keep the scanned images/PDF of the following ready:
                <ol type="a">
                  <li>Testing, Systems or Product Certification, for which financial assistance is being applied for.</li>
                  <li>Invoice/Bill of the Assessment Agency or Authority through which the Testing, Systems or Product Certification is processed.</li>
                  <li>Certificate from the Chartered Accountant (CA) regarding payment of amount to the said Agency/Authority by the MSME. To know the details of information and documents needed to proceed, please see the “My Document” Section in your dashboard.</li>
                </ol>
              </li>
              <li>Relevant document(s) must be uploaded for verification, as and when asked, failing which the application for Financial Assistance will be rejected.</li>
              <li>Ensure to input correct dates, amount, invoice numbers and other details, as and when asked, else the application for Financial Assistance will be rejected if the information is not matched with the uploaded document(s).</li>
              <li>In case your application is rejected, you will be given another opportunity to apply for Financial Assistance for Testing, Quality or Product Certification. The same can be applied through your dashboard.</li>
              <li>You shall be notified in due course of time regarding the outcome of your application.</li>
            </ol>
            """),
        App("app.msme.schemes.fa.accountDeclaration.checkbox", "Financial Assistance: account details declaration (checkbox)", MsmeApp, Main,
            "I hereby declare that the particulars given in the application are correct. In case any of the statement/information furnished in the application/documents is later found to be wrong or incorrect or misleading, I do hereby bind myself and my unit to pay to the Government on demand the full amount received as reimbursement in respect of above mentioned activity, within seven days of the demand being made to me in writing."),

        // MSME app: registration and login (hidden in the Bronze surveillance build)
        App("app.msme.login.newUserEligibility", "Login: new user eligibility", MsmeApp, Main,
            "<p>If you are a first time user, click below on \"Register Now\".<br>(Applicable only for Manufacturing Sector: Section C, NIC 2008.)</p>"),
        App("app.msme.registration.welcome", "Registration: before you start", MsmeApp, Main, """
            <p>To proceed, please keep the following ready:</p>
            <ol>
              <li>The <b>Udyam Registration Number</b> of the Enterprise.</li>
              <li>The <b>Mobile Number</b> that is associated with the Udyam Registration.</li>
            </ol>
            <p>If your Enterprise is not registered on the Udyam Registration, then you may first register on <a href="https://udyamregistration.gov.in">https://udyamregistration.gov.in</a> and then register here.</p>
            """),
        App("app.msme.registration.validatedNote", "Registration: details validated note", MsmeApp, Main,
            "Your details have been validated from MSME Database. (Ministry of MSME, Government of India)"),
        App("app.msme.registration.confirm.checkbox", "Registration: confirm the details (checkbox)", MsmeApp, Main,
            "I confirm the above and agree to proceed with the information provided."),
        // The legacy app said "our plant"; the web pledge (and the pledge certificate) say "our planet".
        App("app.msme.registration.pledge", "Registration: ZED pledge", MsmeApp, Main,
            "<p>We undertake to conform to the values of Zero Defect Zero Effect in our enterprise and ensure that our processes shall be environmentally sound and socially responsible with safe and high quality products. We will give back, in every way we can, to our people, our community and to our planet.</p>"),
        App("app.msme.registration.emailNote", "Registration: e-mail note", MsmeApp, Main,
            "NOTE: Your ZED ID &amp; Password along with your ZED Pledge Certificate will be sent on this Email ID."),
        App("app.msme.registration.otpSent", "Registration: e-mail OTP sent", MsmeApp, Main,
            "OTP is successfully sent to {{Email}}, if not received, please check your junk/spam.", "Email"),
        App("app.msme.registration.success", "Registration: success", MsmeApp, Main, """
            <p>Congratulations! You can now avail:</p>
            <ul>
              <li>Joining reward of Rs. 10,000/- for ZED Certification</li>
            </ul>
            <p>What next?</p>
            <ul>
              <li>Check your email for Pledge Certificate and ZED ID/Password.</li>
              <li>If you did not receive any email, please check in Spam/Junk folder.</li>
              <li>Use the received ZED ID and Password to login again.</li>
            </ul>
            """),

        // MSME app: dashboard
        App("app.msme.dashboard.certificationSteps", "Dashboard: ZED certification steps", MsmeApp, Main, """
            <ol>
              <li><b>Basic Information &amp; Document Upload</b><br>Provide Processes &amp; Systems information</li>
              <li><b>Desktop Verification</b><br>Desktop verification of documents uploaded. Bronze level applicants will receive certification after this step.</li>
              <li><b>Remote/Onsite Assessment</b><br>Applicable only for Silver &amp; Gold Certification.</li>
              <li><b>Certification</b><br>After conforming to relevant requirements, download your Certificate and Report from your dashboard.</li>
              <li><b>Avail Incentives</b><br>Various incentives will be unlocked and available under "My Incentives"</li>
            </ol>
            """),
        App("app.msme.dashboard.levelInfo.bronze", "My Certifications: Bronze level information", MsmeApp, Main, """
            <ul>
              <li>This level has 5 parameters, which need to be conformed to, for achieving a Certification.</li>
              <li>The certification cost is Rs. 10,000/- inclusive of taxes, subsidy, as applicable.</li>
            </ul>
            """),
        App("app.msme.dashboard.levelInfo.silver", "My Certifications: Silver level information", MsmeApp, Main, """
            <ul>
              <li>This level has 14 parameters, which need to be conformed to, for achieving a Certification.</li>
              <li>The certification cost is Rs. 40,000/- inclusive of taxes; subsidy, as applicable.</li>
            </ul>
            """),
        App("app.msme.dashboard.levelInfo.gold", "My Certifications: Gold level information", MsmeApp, Main, """
            <ul>
              <li>This level has 20 parameters, which need to be conformed to, for achieving a Certification.</li>
              <li>The certification cost is Rs. 90,000/- inclusive of taxes; subsidy, as applicable.</li>
            </ul>
            """),
        App("app.msme.dashboard.info.myCertifications", "Dashboard: My Certifications information", MsmeApp, Main,
            "<p>Please read the complete instructions and requirements before applying for any Certification Level. These are available under \"My Documents\".</p>"),
        App("app.msme.dashboard.info.myIncentives", "Dashboard: My Incentives information", MsmeApp, Main,
            "<p>The Joining Reward incentive is available to any applicant which has taken the ZED Pledge. All other incentives &amp; benefits will be activated after attaining the respective Certification Level (Bronze, Silver or Gold). Complete list is available under \"My Documents\".</p>"),
        App("app.msme.incentives.joiningReward.availInfo", "My Incentives: how to avail the joining reward", MsmeApp, Main,
            "<p>Kindly apply for any of the ZED Certification levels (Bronze, Silver, Gold) to avail Joining Reward</p>"),

        // MSME app: the assessment
        // Not shown by the Bronze surveillance build (its step is switched off there).
        // 2026-11-14: the page's heading and the box's heading, editable too.
        App("app.msme.assessment.complianceUndertaking.title", "Assessment: undertaking page heading", MsmeApp, Main, "Undertaking of Compliances"),
        App("app.msme.assessment.complianceUndertaking.heading", "Assessment: undertaking box heading", MsmeApp, Main, "Undertaking of Compliances"),
        App("app.msme.assessment.complianceUndertaking", "Assessment: undertaking of compliances", MsmeApp, Main, """
            <p>I/We understand that the ZED Certification is voluntary and recognize the authority of the Ministry of MSME, Government of India, in issuance of any Certificate.</p>
            <p>By proceeding I/We certify that my/our Enterprise/Unit complies with &amp; fulfils all relevant &amp; applicable regulatory &amp; statutory norms/licenses pertaining to the functioning of this manufacturing unit. If not, then efforts will be taken to fulfil those regulatory/statutory requirements by me/us. If at any stage the Enterprise/Unit is found to be non-compliant with any relevant/applicable regulatory &amp; statutory norms, the competent authority will have the right to recall/withdraw any or all reports or Certifications awarded.</p>
            """),
        App("app.msme.assessment.requirementsAccepted.checkbox", "Assessment: certification requirements read (checkbox)", MsmeApp, Main,
            "I have read the certification requirements and are following all the requirements to the fullest extent possible."),
        // 2026-11-08: the applicant's facilitator question on Documents Upload (Yes opens Facilitator Details).
        App("app.msme.evidences.facilitator.question", "Evidences: ZED Facilitator question", MsmeApp, Main,
            "Were you assisted by a ZED Facilitator?"),
        // 2026-11-21 (the product owner's rule): the handholding milestone 1 payment asks who assisted the unit (Yes = pick the organisation).
        App("app.msme.handholding.payment.coQuestion", "Handholding payment: Consultant Organisation question (milestone 1)", MsmeApp, Main,
            "Did any Consultant Organisation assist you?"),
        // 2026-11-21 (the user: handholding payment screens in the app): the web page's disclaimer and instructions.
        App("app.msme.handholding.payment.disclaimer", "Handholding payment: disclaimer", MsmeApp, Main, """
            <ol>
              <li>By agreeing to proceed and make relevant payment it is assumed that the applicant has read &amp; understood the Scheme Guidelines &amp; the provisions contained therein and is participating in this activity on their own volition.</li>
              <li>The applicant has read and understood the requirements of the handholding process for which the payment is being made and take full responsibility for the outcome of the process.</li>
              <li>The amount once remitted is non-refundable, non-adjustable &amp; non-transferable irrespective of the outcome of the process.</li>
              <li>Submission of relevant documents/evidences/responses in a timely manner is essential.</li>
              <li>Complete support to the Consultant Organisation must be provided by the applicant in order to achieve the desired result.</li>
              <li>The payment being made is only the “beneficiary contribution”; the subsidies applicable for this activity is pre-applied.</li>
            </ol>
            """),
        App("app.msme.handholding.payment.instructions", "Handholding payment: instructions", MsmeApp, Main, """
            <ol>
              <li>There are 3 milestones in the handholding process. Payment will be made at the beginning of each milestone.</li>
              <li>A Consultant Organisation will be allocated to the applicant after payment of the first milestone.</li>
              <li>The applicant would need to submit necessary information/documents as and when sought and extend full support to the consultant organisation.</li>
              <li>Applicant must coordinate closely with the Consultant Organisation to close each milestone and move to the next.</li>
              <li>Activity for each milestone would commence only after payment of that milestone and acceptance of activities performed in the previous milestone, if &amp; as applicable.</li>
            </ol>
            """),
        App("app.msme.handholding.acceptMilestone.confirm", "Handholding: accept milestone confirmation", MsmeApp, Main,
            "I accept the activities conducted &amp; recommendations given in Milestone-{{Milestone}}", "Milestone"),
        App("app.msme.fa.eligibleAmountNote", "Financial Assistance: eligible amount note", MsmeApp, Main,
            "Eligible Financial Assistance: 75% of invoice amount and max. up to 50,000 only"),
        App("app.msme.evidences.finalSubmit.confirm", "Evidences: final submit confirmation", MsmeApp, MainAndSurveillance,
            "I confirm that all information and documents/photos submitted pertain to the selected unit only."),
        App("app.msme.certification.readOnly", "Certification: read-only message", MsmeApp, MainAndSurveillance,
            "To view Basic Information &amp; Documents uploaded, please login through the web module."),
        App("app.msme.nc.whatIsNc", "Non-conformances: what is a non-conformance", MsmeApp, MainAndSurveillance, """
            <p>What is <b>Non-Conformance</b>?</p>
            <p>Any deviation from the requirements of each parameter, as mentioned in the ZED Standard, will be a Non-Conformance (NC). The status of action taken by you on the NC(s) will be as follows:</p>
            """),
        App("app.msme.offline.note", "Offline: banner", MsmeApp, MainAndSurveillance,
            "You are offline, don’t forget to Sync your information once you are connected to Internet again."),
        App("app.msme.offline.evidenceNote", "Offline: evidence not synced", MsmeApp, MainAndSurveillance,
            "Don’t forget to sync your offline changes once you are connected to the Internet again."),

        // MSME app: voice typing (2026-11-21: the mic of every comment box; a tap listens in English (India), a long press in Hindi)
        App("app.msme.voice.button", "Voice typing: mic button (spoken label)", MsmeApp, MainAndSurveillance,
            "Speak to type (hold for Hindi)"),
        App("app.msme.voice.prompt", "Voice typing: listening prompt", MsmeApp, MainAndSurveillance,
            "Speak now"),
        App("app.msme.voice.unavailable", "Voice typing: not available on the phone", MsmeApp, MainAndSurveillance,
            "Voice typing is not available on this phone. Please turn on the Google voice typing service and try again."),
        App("app.msme.voice.failed", "Voice typing: could not start", MsmeApp, MainAndSurveillance,
            "Voice typing could not start, please try again."),
        App("app.msme.voice.cut", "Voice typing: text cut to the box's limit", MsmeApp, MainAndSurveillance,
            "Only part of what you said was added: this box takes up to {{Max}} characters.", "Max"),

        // MSME app: incentive schemes (2026-11-25, the product owner: the Admin's schemes in the app with the full forms; My Incentives
        // and the scheme pages, as the web's msme.incentiveScheme.* texts; a scheme's own disclaimer / instructions / declaration come
        // with the scheme, else app.msme.schemes.fa.*)
        App("app.msme.incentiveSchemes.list.state.open", "Incentive schemes: My Incentives: state: open", MsmeApp, Main, "Open"),
        App("app.msme.incentiveSchemes.list.state.progress", "Incentive schemes: My Incentives: state: in progress", MsmeApp, Main, "In progress"),
        App("app.msme.incentiveSchemes.list.state.onhold", "Incentive schemes: My Incentives: state: on hold", MsmeApp, Main, "On hold"),
        App("app.msme.incentiveSchemes.list.state.availed", "Incentive schemes: My Incentives: state: availed", MsmeApp, Main, "Availed"),
        App("app.msme.incentiveSchemes.list.state.locked", "Incentive schemes: My Incentives: state: locked", MsmeApp, Main, "Locked"),
        App("app.msme.incentiveSchemes.list.notEligible", "Incentive schemes: My Incentives: not available", MsmeApp, Main, "Not yet available for your unit"),
        App("app.msme.incentiveSchemes.list.notCertified", "Incentive schemes: My Incentives: not certified", MsmeApp, Main, "Unlocks once your unit is certified"),
        App("app.msme.incentiveSchemes.list.legacyInProgress", "Incentive schemes: My Incentives: earlier application in progress", MsmeApp, Main, "Your earlier application for this benefit is still in progress. You can follow it on the ZED portal."),
        App("app.msme.incentiveSchemes.list.loadFailed", "Incentive schemes: My Incentives: schemes not loaded", MsmeApp, Main, "The incentive schemes could not be loaded. Pull down or open My Incentives again to retry."),
        App("app.msme.incentiveSchemes.locked.notEligible", "Incentive schemes: Locked: not eligible for benefits", MsmeApp, Main, "You are not eligible for benefits. Please contact ZED team."),
        App("app.msme.incentiveSchemes.locked.notCertified", "Incentive schemes: Locked: not certified", MsmeApp, Main, "Opens after your unit is ZED certified"),
        App("app.msme.incentiveSchemes.locked.notCertifiedLevels", "Incentive schemes: Locked: not certified at the levels", MsmeApp, Main, "Opens after {{Levels}} certification", "Levels"),
        App("app.msme.incentiveSchemes.locked.levelNotCovered", "Incentive schemes: Locked: level not covered", MsmeApp, Main, "For units certified at {{Levels}}", "Levels"),
        App("app.msme.incentiveSchemes.locked.handholding", "Incentive schemes: Locked: after handholding", MsmeApp, Main, "Opens once your Handholding support is completed"),
        App("app.msme.incentiveSchemes.locked.financialBlocked", "Incentive schemes: Locked: financial assistance blocked", MsmeApp, Main, "Financial assistance is not available for your unit. Please contact ZED team."),
        App("app.msme.incentiveSchemes.locked.suspended", "Incentive schemes: Locked: certificate suspended", MsmeApp, Main, "Your highest certificate is suspended or withdrawn. The scheme opens again once it is active."),
        App("app.msme.incentiveSchemes.locked.notGraded", "Incentive schemes: Locked: not set up for the unit", MsmeApp, Main, "This scheme is not yet set up for your unit's certification or size. Please contact ZED team."),
        App("app.msme.incentiveSchemes.locked.legacyInProgress", "Incentive schemes: Locked: earlier application in progress", MsmeApp, Main, "Your earlier application for this benefit is still in progress. It continues on its own page."),
        App("app.msme.incentiveSchemes.locked.closed", "Incentive schemes: Locked: not taking applications", MsmeApp, Main, "This scheme is not taking new applications now."),
        App("app.msme.incentiveSchemes.availed", "Incentive schemes: Page: availed", MsmeApp, Main, "You have availed this scheme for your current certification."),
        App("app.msme.incentiveSchemes.onHold", "Incentive schemes: Page: on hold", MsmeApp, Main, "The application is on hold."),
        App("app.msme.incentiveSchemes.hold.suspended", "Incentive schemes: Page: on hold: certificate suspended", MsmeApp, Main, "Your certificate is suspended; the ZED team will resume or close the application."),
        App("app.msme.incentiveSchemes.hold.withdrawn", "Incentive schemes: Page: on hold: certificate withdrawn", MsmeApp, Main, "Your certificate is withdrawn; the ZED team will resume or close the application."),
        App("app.msme.incentiveSchemes.hold.other", "Incentive schemes: Page: on hold: other", MsmeApp, Main, "The ZED team will resume or close the application."),
        App("app.msme.incentiveSchemes.status.draft", "Incentive schemes: Status: draft", MsmeApp, Main, "Draft"),
        App("app.msme.incentiveSchemes.status.submitted", "Incentive schemes: Status: submitted", MsmeApp, Main, "Submitted"),
        App("app.msme.incentiveSchemes.status.desktop", "Incentive schemes: Status: desktop verification", MsmeApp, Main, "Desktop verification"),
        App("app.msme.incentiveSchemes.status.correction", "Incentive schemes: Status: correction", MsmeApp, Main, "Correction"),
        App("app.msme.incentiveSchemes.status.qc", "Incentive schemes: Status: agency QC", MsmeApp, Main, "Agency QC"),
        App("app.msme.incentiveSchemes.status.approved", "Incentive schemes: Status: approved", MsmeApp, Main, "Approved"),
        App("app.msme.incentiveSchemes.status.paid", "Incentive schemes: Status: paid", MsmeApp, Main, "Paid"),
        App("app.msme.incentiveSchemes.status.rejected", "Incentive schemes: Status: rejected", MsmeApp, Main, "Rejected"),
        App("app.msme.incentiveSchemes.status.onHold", "Incentive schemes: Status: on hold", MsmeApp, Main, "On hold"),
        App("app.msme.incentiveSchemes.step.disclaimer", "Incentive schemes: Steps: disclaimer", MsmeApp, Main, "Disclaimer"),
        App("app.msme.incentiveSchemes.step.instructions", "Incentive schemes: Steps: instructions", MsmeApp, Main, "Instructions"),
        App("app.msme.incentiveSchemes.step.unit", "Incentive schemes: Steps: confirm unit", MsmeApp, Main, "Confirm unit"),
        App("app.msme.incentiveSchemes.step.bank", "Incentive schemes: Steps: bank account", MsmeApp, Main, "Bank account"),
        App("app.msme.incentiveSchemes.step.summary", "Incentive schemes: Steps: review and submit", MsmeApp, Main, "Review &amp; submit"),
        App("app.msme.incentiveSchemes.step.of", "Incentive schemes: Steps: step of steps", MsmeApp, Main, "Step {{Step}} of {{Total}}", "Step", "Total"),
        App("app.msme.incentiveSchemes.disclaimer.consent", "Incentive schemes: Disclaimer: consent (checkbox)", MsmeApp, Main, "I have read and understood the disclaimer and accept it."),
        App("app.msme.incentiveSchemes.unit.title", "Incentive schemes: Unit: heading", MsmeApp, Main, "Confirm your unit"),
        App("app.msme.incentiveSchemes.unit.enterprise", "Incentive schemes: Unit: enterprise", MsmeApp, Main, "Enterprise"),
        App("app.msme.incentiveSchemes.unit.zedId", "Incentive schemes: Unit: ZED ID", MsmeApp, Main, "ZED ID"),
        App("app.msme.incentiveSchemes.unit.udyam", "Incentive schemes: Unit: Udyam number", MsmeApp, Main, "Udyam number"),
        App("app.msme.incentiveSchemes.unit.size", "Incentive schemes: Unit: enterprise size", MsmeApp, Main, "Enterprise size"),
        App("app.msme.incentiveSchemes.unit.unit", "Incentive schemes: Unit: unit", MsmeApp, Main, "Unit"),
        App("app.msme.incentiveSchemes.unit.activity", "Incentive schemes: Unit: activity", MsmeApp, Main, "Activity"),
        App("app.msme.incentiveSchemes.unit.address", "Incentive schemes: Unit: address", MsmeApp, Main, "Address"),
        App("app.msme.incentiveSchemes.unit.confirm", "Incentive schemes: Unit: confirm (checkbox)", MsmeApp, Main, "I confirm that the unit details above are correct and the claim is for this unit."),
        App("app.msme.incentiveSchemes.button.back", "Incentive schemes: Buttons: back", MsmeApp, Main, "Back"),
        App("app.msme.incentiveSchemes.button.proceed", "Incentive schemes: Buttons: proceed", MsmeApp, Main, "Proceed"),
        App("app.msme.incentiveSchemes.button.accept", "Incentive schemes: Buttons: accept and proceed", MsmeApp, Main, "Accept &amp; proceed"),
        App("app.msme.incentiveSchemes.button.saveProceed", "Incentive schemes: Buttons: save and proceed", MsmeApp, Main, "Save &amp; proceed"),
        App("app.msme.incentiveSchemes.button.submit", "Incentive schemes: Buttons: submit application", MsmeApp, Main, "Submit application"),
        App("app.msme.incentiveSchemes.button.applyAgain", "Incentive schemes: Buttons: apply again", MsmeApp, Main, "Apply again"),
        App("app.msme.incentiveSchemes.button.retry", "Incentive schemes: Buttons: retry", MsmeApp, Main, "Retry"),
        App("app.msme.incentiveSchemes.button.done", "Incentive schemes: Buttons: back to My Incentives", MsmeApp, Main, "Back to My Incentives"),
        App("app.msme.incentiveSchemes.items.count", "Incentive schemes: Add more: count", MsmeApp, Main, "{{Count}} of up to {{Max}}", "Count", "Max"),
        App("app.msme.incentiveSchemes.items.item", "Incentive schemes: Add more: item without a name", MsmeApp, Main, "Item"),
        App("app.msme.incentiveSchemes.items.docs", "Incentive schemes: Add more: documents of an item", MsmeApp, Main, "{{Count}} document(s)", "Count"),
        App("app.msme.incentiveSchemes.items.edit", "Incentive schemes: Add more: edit", MsmeApp, Main, "Edit"),
        App("app.msme.incentiveSchemes.items.remove", "Incentive schemes: Add more: remove", MsmeApp, Main, "Remove"),
        App("app.msme.incentiveSchemes.items.cancel", "Incentive schemes: Add more: cancel", MsmeApp, Main, "Cancel"),
        App("app.msme.incentiveSchemes.items.save", "Incentive schemes: Add more: save item", MsmeApp, Main, "Save item"),
        App("app.msme.incentiveSchemes.items.add", "Incentive schemes: Add more: add button", MsmeApp, Main, "+ Add more {{Section}}", "Section"),
        App("app.msme.incentiveSchemes.items.pickLabel", "Incentive schemes: Add more: choose (no label)", MsmeApp, Main, "Choose"),
        App("app.msme.incentiveSchemes.items.pickFallback", "Incentive schemes: Add more: an entry", MsmeApp, Main, "an entry"),
        App("app.msme.incentiveSchemes.field.select", "Incentive schemes: Fields: choose one", MsmeApp, Main, "-Select-"),
        App("app.msme.incentiveSchemes.field.yes", "Incentive schemes: Fields: yes", MsmeApp, Main, "Yes"),
        App("app.msme.incentiveSchemes.field.no", "Incentive schemes: Fields: no", MsmeApp, Main, "No"),
        App("app.msme.incentiveSchemes.field.notValid", "Incentive schemes: Fields: found not valid", MsmeApp, Main, "Not valid"),
        App("app.msme.incentiveSchemes.field.pdf", "Incentive schemes: Fields: a PDF document", MsmeApp, Main, "PDF document {{Number}}", "Number"),
        App("app.msme.incentiveSchemes.field.image", "Incentive schemes: Fields: an image", MsmeApp, Main, "Image {{Number}}", "Number"),
        App("app.msme.incentiveSchemes.field.noFile", "Incentive schemes: Fields: no file", MsmeApp, Main, "No file uploaded"),
        App("app.msme.incentiveSchemes.field.upload", "Incentive schemes: Fields: upload button", MsmeApp, Main, "+ Upload"),
        App("app.msme.incentiveSchemes.field.uploading", "Incentive schemes: Fields: uploading", MsmeApp, Main, "Uploading…"),
        App("app.msme.incentiveSchemes.field.photoHint", "Incentive schemes: Fields: photo hint", MsmeApp, Main, "JPG / PNG up to 5 MB, up to {{Count}} file(s)", "Count"),
        App("app.msme.incentiveSchemes.field.documentHint", "Incentive schemes: Fields: document hint", MsmeApp, Main, "PDF / JPG / PNG up to 5 MB, up to {{Count}} file(s)", "Count"),
        App("app.msme.incentiveSchemes.field.photoError", "Incentive schemes: Fields: a photo only", MsmeApp, Main, "Please upload a photo (JPG / PNG)."),
        App("app.msme.incentiveSchemes.field.sheetTitle", "Incentive schemes: Fields: add document (sheet title)", MsmeApp, Main, "Add document"),
        App("app.msme.incentiveSchemes.field.sheetSubtitle", "Incentive schemes: Fields: add document (sheet note)", MsmeApp, Main, "Choose how to add this document"),
        App("app.msme.incentiveSchemes.field.takePhoto", "Incentive schemes: Fields: take photo", MsmeApp, Main, "Take Photo"),
        App("app.msme.incentiveSchemes.field.pickPhoto", "Incentive schemes: Fields: pick photo", MsmeApp, Main, "Pick Photo from Gallery"),
        App("app.msme.incentiveSchemes.field.pickPdf", "Incentive schemes: Fields: pick PDF", MsmeApp, Main, "Pick PDF from Gallery"),
        App("app.msme.incentiveSchemes.field.cancel", "Incentive schemes: Fields: cancel", MsmeApp, Main, "Cancel"),
        App("app.msme.incentiveSchemes.field.cameraHint", "Incentive schemes: Fields: camera hint", MsmeApp, Main, "Use the camera now"),
        App("app.msme.incentiveSchemes.field.galleryHint", "Incentive schemes: Fields: gallery hint", MsmeApp, Main, "JPG or PNG"),
        App("app.msme.incentiveSchemes.field.pdfHint", "Incentive schemes: Fields: PDF hint", MsmeApp, Main, "One PDF file"),
        App("app.msme.incentiveSchemes.field.uploadFailed", "Incentive schemes: Fields: upload failed", MsmeApp, Main, "The document could not be uploaded. Please try again."),
        App("app.msme.incentiveSchemes.field.openFailed", "Incentive schemes: Fields: document not opened", MsmeApp, Main, "The document could not be opened. Please try again."),
        App("app.msme.incentiveSchemes.field.datePlaceholder", "Incentive schemes: Fields: date placeholder", MsmeApp, Main, "Choose a date"),
        App("app.msme.incentiveSchemes.field.count", "Incentive schemes: Fields: characters", MsmeApp, Main, "{{Count}} / {{Max}}", "Count", "Max"),
        App("app.msme.incentiveSchemes.bank.title", "Incentive schemes: Bank: heading", MsmeApp, Main, "Account details of reimbursement"),
        App("app.msme.incentiveSchemes.bank.accountNo", "Incentive schemes: Bank: account number", MsmeApp, Main, "Account No."),
        App("app.msme.incentiveSchemes.bank.accountAgain", "Incentive schemes: Bank: account number again", MsmeApp, Main, "Re-Enter Account No."),
        App("app.msme.incentiveSchemes.bank.ifsc", "Incentive schemes: Bank: IFSC", MsmeApp, Main, "IFSC Code"),
        App("app.msme.incentiveSchemes.bank.bank", "Incentive schemes: Bank: bank name", MsmeApp, Main, "Name of the Bank"),
        App("app.msme.incentiveSchemes.bank.branch", "Incentive schemes: Bank: branch address", MsmeApp, Main, "Branch Address"),
        App("app.msme.incentiveSchemes.bank.bankBranch", "Incentive schemes: Bank: bank and branch (summary)", MsmeApp, Main, "Bank / branch"),
        App("app.msme.incentiveSchemes.bank.cheque", "Incentive schemes: Bank: cancelled cheque", MsmeApp, Main, "Cancelled cheque copy"),
        App("app.msme.incentiveSchemes.bank.mismatch", "Incentive schemes: Bank: numbers differ", MsmeApp, Main, "Account Numbers must match."),
        App("app.msme.incentiveSchemes.error.consent", "Incentive schemes: Errors: disclaimer", MsmeApp, Main, "Please accept the disclaimer."),
        App("app.msme.incentiveSchemes.error.unit", "Incentive schemes: Errors: unit", MsmeApp, Main, "Please confirm the unit details."),
        App("app.msme.incentiveSchemes.error.unsaved", "Incentive schemes: Errors: item being edited", MsmeApp, Main, "Please save or cancel the item you are editing."),
        App("app.msme.incentiveSchemes.error.minItems", "Incentive schemes: Errors: at least", MsmeApp, Main, "Please add at least {{Count}}.", "Count"),
        App("app.msme.incentiveSchemes.error.pick", "Incentive schemes: Errors: choose", MsmeApp, Main, "Please choose {{Label}}.", "Label"),
        App("app.msme.incentiveSchemes.error.required", "Incentive schemes: Errors: required field", MsmeApp, Main, "Please fill in \"{{Label}}\".", "Label"),
        App("app.msme.incentiveSchemes.error.bankRequired", "Incentive schemes: Errors: bank details", MsmeApp, Main, "Please enter the account details."),
        App("app.msme.incentiveSchemes.error.accountNo", "Incentive schemes: Errors: account number", MsmeApp, Main, "Please enter a valid account number (9 to 18 digits)."),
        App("app.msme.incentiveSchemes.error.accountMismatch", "Incentive schemes: Errors: account numbers differ", MsmeApp, Main, "Account Number and Re-Enter Account Number must match."),
        App("app.msme.incentiveSchemes.error.ifsc", "Incentive schemes: Errors: IFSC", MsmeApp, Main, "Invalid IFSC Code format. Please enter the correct 11-digit code."),
        App("app.msme.incentiveSchemes.error.cheque", "Incentive schemes: Errors: cancelled cheque", MsmeApp, Main, "Please upload the cancelled cheque."),
        App("app.msme.incentiveSchemes.error.declaration", "Incentive schemes: Errors: declaration", MsmeApp, Main, "Please accept the declaration."),
        App("app.msme.incentiveSchemes.error.load", "Incentive schemes: Errors: page not loaded", MsmeApp, Main, "The scheme could not be loaded. Check your internet connection and try again."),
        App("app.msme.incentiveSchemes.error.offline", "Incentive schemes: Errors: offline", MsmeApp, Main, "Please connect to the internet to continue."),
        App("app.msme.incentiveSchemes.error.failed", "Incentive schemes: Errors: request failed", MsmeApp, Main, "Something went wrong. Please try again."),
        App("app.msme.incentiveSchemes.summary.title", "Incentive schemes: Review: heading", MsmeApp, Main, "Review &amp; submit"),
        App("app.msme.incentiveSchemes.answers.none", "Incentive schemes: Answers: nothing added", MsmeApp, Main, "Nothing added."),
        App("app.msme.incentiveSchemes.answers.view", "Incentive schemes: Answers: view a document", MsmeApp, Main, "View {{Number}}", "Number"),
        App("app.msme.incentiveSchemes.claim.title", "Incentive schemes: Claim: heading", MsmeApp, Main, "Your claim"),
        App("app.msme.incentiveSchemes.claim.claimed", "Incentive schemes: Claim: claimed", MsmeApp, Main, "Claimed: ₹ {{Amount}}", "Amount"),
        App("app.msme.incentiveSchemes.claim.eligible", "Incentive schemes: Claim: eligible", MsmeApp, Main, "Eligible: ₹ {{Amount}}", "Amount"),
        App("app.msme.incentiveSchemes.claim.grade", "Incentive schemes: Claim: share and cap", MsmeApp, Main, "{{Share}}% of the claim, up to ₹ {{Max}}", "Share", "Max"),
        App("app.msme.incentiveSchemes.claim.approved", "Incentive schemes: Claim: approved", MsmeApp, Main, "Approved: ₹ {{Amount}}", "Amount"),
        App("app.msme.incentiveSchemes.claim.level", "Incentive schemes: Claim: level", MsmeApp, Main, "Claim for: {{Level}}", "Level"),
        App("app.msme.incentiveSchemes.claim.openedOn", "Incentive schemes: Claim: open since", MsmeApp, Main, "Open since {{Date}}", "Date"),
        App("app.msme.incentiveSchemes.application.title", "Incentive schemes: Application: heading", MsmeApp, Main, "Your application"),
        App("app.msme.incentiveSchemes.application.number", "Incentive schemes: Application: number", MsmeApp, Main, "Application no. {{Id}}", "Id"),
        App("app.msme.incentiveSchemes.application.submitted", "Incentive schemes: Application: submitted", MsmeApp, Main, "Your application has been submitted."),
        App("app.msme.incentiveSchemes.rejected.title", "Incentive schemes: Rejected: heading", MsmeApp, Main, "Your application was rejected."),
        App("app.msme.incentiveSchemes.rejected.reason", "Incentive schemes: Rejected: reason", MsmeApp, Main, "Reason: {{Reason}}", "Reason"),
        App("app.msme.incentiveSchemes.correction.intro", "Incentive schemes: Correction: what to do", MsmeApp, Main, "Please correct the answers marked below and submit the corrections by {{Date}}.", "Date"),
        App("app.msme.incentiveSchemes.correction.closed", "Incentive schemes: Correction: date passed", MsmeApp, Main, "The date for the corrections has passed."),
        App("app.msme.incentiveSchemes.correction.save", "Incentive schemes: Correction: save", MsmeApp, Main, "Save"),
        App("app.msme.incentiveSchemes.correction.saved", "Incentive schemes: Correction: saved", MsmeApp, Main, "Saved."),
        App("app.msme.incentiveSchemes.correction.submit", "Incentive schemes: Correction: submit", MsmeApp, Main, "Submit corrections"),
        App("app.msme.incentiveSchemes.correction.submitted", "Incentive schemes: Correction: submitted", MsmeApp, Main, "Your corrections have been submitted."),
        App("app.msme.incentiveSchemes.history.title", "Incentive schemes: History: heading", MsmeApp, Main, "Earlier applications"),
        App("app.msme.incentiveSchemes.history.row", "Incentive schemes: History: one application", MsmeApp, Main, "{{Date}} · {{Status}}", "Date", "Status"),
        App("app.msme.incentiveSchemes.history.amount", "Incentive schemes: History: amount", MsmeApp, Main, "₹ {{Amount}}", "Amount"),
        App("app.msme.incentiveSchemes.history.reason", "Incentive schemes: History: reason", MsmeApp, Main, "Reason: {{Reason}}", "Reason"),

        // Assessor app (ZED_SA_Studio)
        App("app.assessor.siteTour.pickInstruction", "Site tour: pick a photo", AssessorApp, Main,
            "Simply tap on any photo from the list to pick as evidence"),
        App("app.assessor.siteTour.tourInstruction", "Site tour: capture photos", AssessorApp, Main,
            "Here you can capture Site Photos which can later be used as evidences"),
        // 2026-11-28: the lead's site tour is synced only once every section has its photos (the server refuses it otherwise).
        App("app.assessor.siteTour.missing", "Site tour: sync stopped, sections without their photos", AssessorApp, Main,
            "Site Tour cannot be submitted yet: every section needs its photos. Please capture: {{Sections}}.", "Sections"),
        App("app.assessor.siteTour.missingSection", "Site tour: one section without its photos (in the list above)", AssessorApp, Main,
            "\"{{Section}}\" ({{Captured}} of {{Required}} photos)", "Section", "Captured", "Required"),
        App("app.assessor.login.windowNote", "Login: two days before the site assessment", AssessorApp, Main,
            "You can only login 2 days prior to your allocated Site Assessment date"),

        // Assessor app: Bronze surveillance (2026-11-21: the retired ZED Surveillance app's steps in ZED SA; the steps themselves
        // keep the app.msme.* texts above, from the surveillance host)
        App("app.assessor.bronze.home.title", "Bronze surveillance: Home and list: section heading", AssessorApp, Main, "Bronze Surveillance"),
        App("app.assessor.bronze.home.subtitle", "Bronze surveillance: Home and list: section note", AssessorApp, Main,
            "Units allotted to you as the Bronze surveillance desktop assessor"),
        App("app.assessor.bronze.case.label", "Bronze surveillance: case card: label", AssessorApp, Main, "Bronze Surveillance"),
        App("app.assessor.bronze.case.status", "Bronze surveillance: case card: status (with the desktop assessor)", AssessorApp, Main, "Desktop assessment"),
        App("app.assessor.bronze.case.ncRound", "Bronze surveillance: case card: status (NC round open for the reply)", AssessorApp, Main, "NC {{Round}}: reply due", "Round"),
        App("app.assessor.bronze.case.allotted", "Bronze surveillance: case card: since", AssessorApp, Main, "Since {{Date}}", "Date"),
        App("app.assessor.bronze.case.open", "Bronze surveillance: case card: open button", AssessorApp, Main, "Open"),
        App("app.assessor.bronze.open.offline", "Bronze surveillance: opening offline a case never opened on the phone", AssessorApp, Main,
            "This case has not been opened on this phone yet. Please connect to the internet and open it once."),
        App("app.assessor.bronze.open.notSignedIn", "Bronze surveillance: not signed in to the surveillance server", AssessorApp, Main,
            "Please sign out and sign in again while online to open Bronze surveillance cases."),

        // Assessor app: scheme visits (2026-11-20, incentive schemes phase 2: the onsite verification of an application)
        App("app.assessor.schemes.home.quickAction", "Scheme visits: Home: quick action", AssessorApp, Main, "Scheme visits"),
        App("app.assessor.schemes.home.card", "Scheme visits: Home: visits waiting", AssessorApp, Main, "{{Count}} scheme visit(s) to do", "Count"),
        App("app.assessor.schemes.list.title", "Scheme visits: List: title", AssessorApp, Main, "Scheme visits"),
        App("app.assessor.schemes.list.subtitle", "Scheme visits: List: subtitle", AssessorApp, Main, "Incentive scheme applications allotted to you for onsite verification"),
        App("app.assessor.schemes.list.emptyHeadline", "Scheme visits: List: nothing allotted (headline)", AssessorApp, Main, "No scheme visits"),
        App("app.assessor.schemes.list.emptyText", "Scheme visits: List: nothing allotted", AssessorApp, Main, "Applications allotted to you for onsite verification appear here. Pull down to refresh."),
        App("app.assessor.schemes.list.kept", "Scheme visits: List: kept on the phone (heading)", AssessorApp, Main, "Kept on this phone"),
        App("app.assessor.schemes.list.keptNote", "Scheme visits: List: kept on the phone (note)", AssessorApp, Main, "No longer allotted to you or already submitted. Clear the data once it is synced."),
        App("app.assessor.schemes.list.claim", "Scheme visits: List: claim", AssessorApp, Main, "Claim Rs. {{Amount}}", "Amount"),
        App("app.assessor.schemes.list.allotted", "Scheme visits: List: allotted on", AssessorApp, Main, "Allotted {{Date}}", "Date"),
        App("app.assessor.schemes.list.started", "Scheme visits: List: visit started on", AssessorApp, Main, "Visit started {{Date}}", "Date"),
        App("app.assessor.schemes.list.open", "Scheme visits: List: open button", AssessorApp, Main, "Open"),
        App("app.assessor.schemes.list.clear", "Scheme visits: List: clear data button", AssessorApp, Main, "Clear data"),
        App("app.assessor.schemes.status.toVisit", "Scheme visits: Status: to visit", AssessorApp, Main, "To visit"),
        App("app.assessor.schemes.status.visiting", "Scheme visits: Status: visit started", AssessorApp, Main, "Visit started"),
        App("app.assessor.schemes.status.unsynced", "Scheme visits: Status: unsynced", AssessorApp, Main, "Unsynced"),
        App("app.assessor.schemes.status.submitted", "Scheme visits: Status: submitted", AssessorApp, Main, "Submitted"),
        App("app.assessor.schemes.visit.title", "Scheme visits: Visit: title", AssessorApp, Main, "Scheme visit"),
        App("app.assessor.schemes.visit.offline", "Scheme visits: Visit: offline banner", AssessorApp, Main, "You are offline. Your work is saved on the phone and syncs when you are online."),
        App("app.assessor.schemes.visit.unsynced", "Scheme visits: Visit: waiting to sync", AssessorApp, Main, "{{Count}} change(s) waiting to sync.", "Count"),
        App("app.assessor.schemes.visit.syncFailed", "Scheme visits: Visit: a send was refused", AssessorApp, Main, "Not synced: {{Error}}", "Error"),
        App("app.assessor.schemes.visit.retry", "Scheme visits: Visit: retry button", AssessorApp, Main, "Retry"),
        App("app.assessor.schemes.visit.readOnly", "Scheme visits: Visit: submitted", AssessorApp, Main, "The result of this visit is submitted."),
        App("app.assessor.schemes.visit.notAvailable", "Scheme visits: Visit: not on the phone", AssessorApp, Main, "Could not open the application. Please try again when you are online."),
        App("app.assessor.schemes.visit.unit", "Scheme visits: Visit: unit heading", AssessorApp, Main, "Unit"),
        App("app.assessor.schemes.visit.claimed", "Scheme visits: Visit: claim line", AssessorApp, Main, "Claimed Rs. {{Claim}} · desktop eligible Rs. {{Eligible}}", "Claim", "Eligible"),
        App("app.assessor.schemes.start.heading", "Scheme visits: Start: heading", AssessorApp, Main, "Start the visit"),
        App("app.assessor.schemes.start.note", "Scheme visits: Start: note", AssessorApp, Main, "At the unit, take a selfie and a photo of the site. GPS must be on; the date of verification is saved when the visit starts."),
        App("app.assessor.schemes.start.selfie", "Scheme visits: Start: selfie", AssessorApp, Main, "Selfie at the unit"),
        App("app.assessor.schemes.start.site", "Scheme visits: Start: site photo", AssessorApp, Main, "Site photo"),
        App("app.assessor.schemes.start.capture", "Scheme visits: Start: capture button", AssessorApp, Main, "Capture"),
        App("app.assessor.schemes.start.retake", "Scheme visits: Start: retake button", AssessorApp, Main, "Retake"),
        App("app.assessor.schemes.start.button", "Scheme visits: Start: start button", AssessorApp, Main, "Start visit"),
        App("app.assessor.schemes.start.needBoth", "Scheme visits: Start: both photos needed", AssessorApp, Main, "Please take the selfie and the site photo."),
        App("app.assessor.schemes.start.done", "Scheme visits: Start: started", AssessorApp, Main, "Visit started {{Date}}", "Date"),
        App("app.assessor.schemes.start.queued", "Scheme visits: Start: saved offline", AssessorApp, Main, "The start of the visit is saved on the phone and syncs when you are online."),
        App("app.assessor.schemes.rep.heading", "Scheme visits: Representative: heading", AssessorApp, Main, "Unit representative"),
        App("app.assessor.schemes.rep.name", "Scheme visits: Representative: name", AssessorApp, Main, "Representative's name"),
        App("app.assessor.schemes.rep.mobile", "Scheme visits: Representative: mobile", AssessorApp, Main, "Representative's mobile"),
        App("app.assessor.schemes.rep.mobileInvalid", "Scheme visits: Representative: invalid mobile", AssessorApp, Main, "Please enter a valid 10-digit mobile number."),
        App("app.assessor.schemes.answers.heading", "Scheme visits: Answers: heading", AssessorApp, Main, "Applicant's answers"),
        App("app.assessor.schemes.answers.valid", "Scheme visits: Answers: valid", AssessorApp, Main, "Valid"),
        App("app.assessor.schemes.answers.notValid", "Scheme visits: Answers: not valid", AssessorApp, Main, "Not valid"),
        App("app.assessor.schemes.answers.remark", "Scheme visits: Answers: remark", AssessorApp, Main, "What is not valid"),
        App("app.assessor.schemes.answers.desktop", "Scheme visits: Answers: desktop check", AssessorApp, Main, "Desktop check: {{Status}}", "Status"),
        App("app.assessor.schemes.answers.open", "Scheme visits: Answers: open a document", AssessorApp, Main, "Open"),
        App("app.assessor.schemes.answers.openOffline", "Scheme visits: Answers: document offline", AssessorApp, Main, "Documents open when you are online."),
        App("app.assessor.schemes.answers.openFailed", "Scheme visits: Answers: document not opened", AssessorApp, Main, "The document could not be opened. Please try again."),
        App("app.assessor.schemes.answers.checked", "Scheme visits: Answers: checked count", AssessorApp, Main, "{{Done}} of {{Total}} checked", "Done", "Total"),
        App("app.assessor.schemes.photos.heading", "Scheme visits: Photos: heading", AssessorApp, Main, "Photos"),
        App("app.assessor.schemes.photos.count", "Scheme visits: Photos: count", AssessorApp, Main, "{{Taken}} taken · {{Min}} to {{Max}} needed", "Taken", "Min", "Max"),
        App("app.assessor.schemes.photos.take", "Scheme visits: Photos: take button", AssessorApp, Main, "Take photo"),
        App("app.assessor.schemes.photos.max", "Scheme visits: Photos: maximum reached", AssessorApp, Main, "At most {{Max}} photos for this item.", "Max"),
        App("app.assessor.schemes.photos.removeTitle", "Scheme visits: Photos: remove question", AssessorApp, Main, "Remove this photo?"),
        App("app.assessor.schemes.photos.remove", "Scheme visits: Photos: remove button", AssessorApp, Main, "Remove"),
        App("app.assessor.schemes.photos.onServer", "Scheme visits: Photos: saved on the server", AssessorApp, Main, "On the server"),
        App("app.assessor.schemes.remarks.heading", "Scheme visits: Remarks: heading", AssessorApp, Main, "Overall remarks"),
        App("app.assessor.schemes.remarks.placeholder", "Scheme visits: Remarks: placeholder", AssessorApp, Main, "Your remarks on the visit"),
        App("app.assessor.schemes.decision.heading", "Scheme visits: Result: heading", AssessorApp, Main, "Result of the visit"),
        App("app.assessor.schemes.decision.recommend", "Scheme visits: Result: recommend", AssessorApp, Main, "Recommend"),
        App("app.assessor.schemes.decision.reject", "Scheme visits: Result: reject", AssessorApp, Main, "Reject"),
        App("app.assessor.schemes.decision.verifiedClaim", "Scheme visits: Result: verified claim", AssessorApp, Main, "Verified claim (Rs.)"),
        App("app.assessor.schemes.decision.grade", "Scheme visits: Result: share and maximum", AssessorApp, Main, "Share {{Share}}% up to Rs. {{Max}}", "Share", "Max"),
        App("app.assessor.schemes.decision.eligible", "Scheme visits: Result: eligible amount", AssessorApp, Main, "Eligible amount: Rs. {{Amount}}", "Amount"),
        App("app.assessor.schemes.decision.reason", "Scheme visits: Result: reason for rejection", AssessorApp, Main, "Reason for rejection"),
        App("app.assessor.schemes.decision.missing", "Scheme visits: Result: before you submit", AssessorApp, Main, "Before you submit:"),
        App("app.assessor.schemes.decision.submit", "Scheme visits: Result: submit button", AssessorApp, Main, "Submit result"),
        App("app.assessor.schemes.ready.start", "Scheme visits: Readiness: start the visit", AssessorApp, Main, "Start the visit (selfie and site photo)"),
        App("app.assessor.schemes.ready.repName", "Scheme visits: Readiness: representative's name", AssessorApp, Main, "Enter the representative's name"),
        App("app.assessor.schemes.ready.repMobile", "Scheme visits: Readiness: representative's mobile", AssessorApp, Main, "Enter the representative's 10-digit mobile number"),
        App("app.assessor.schemes.ready.unchecked", "Scheme visits: Readiness: answers to check", AssessorApp, Main, "Check every answer ({{Count}} left)", "Count"),
        App("app.assessor.schemes.ready.notValid", "Scheme visits: Readiness: answers not valid", AssessorApp, Main, "{{Count}} answer(s) marked Not valid: reject the application instead", "Count"),
        App("app.assessor.schemes.ready.remark", "Scheme visits: Readiness: remark missing", AssessorApp, Main, "Write what is not valid for each answer marked Not valid"),
        App("app.assessor.schemes.ready.photos", "Scheme visits: Readiness: photos missing", AssessorApp, Main, "{{Item}}: take at least {{Min}} photo(s)", "Item", "Min"),
        App("app.assessor.schemes.ready.claim", "Scheme visits: Readiness: verified claim", AssessorApp, Main, "Enter the verified claim (up to Rs. {{Claim}})", "Claim"),
        App("app.assessor.schemes.ready.reason", "Scheme visits: Readiness: reason for rejection", AssessorApp, Main, "Enter the reason for rejection"),
        App("app.assessor.schemes.ready.remarks", "Scheme visits: Readiness: overall remarks", AssessorApp, Main, "Write your remarks on the visit"),
        App("app.assessor.schemes.confirm.recommendTitle", "Scheme visits: Confirm: recommend (title)", AssessorApp, Main, "Recommend the application?"),
        App("app.assessor.schemes.confirm.recommendText", "Scheme visits: Confirm: recommend", AssessorApp, Main, "Verified claim Rs. {{Claim}}, eligible Rs. {{Amount}}. It goes to the onsite agency for QC. The visit cannot be changed after this.", "Claim", "Amount"),
        App("app.assessor.schemes.confirm.rejectTitle", "Scheme visits: Confirm: reject (title)", AssessorApp, Main, "Reject the application?"),
        App("app.assessor.schemes.confirm.rejectText", "Scheme visits: Confirm: reject", AssessorApp, Main, "The unit is told and may apply again. The visit cannot be changed after this."),
        App("app.assessor.schemes.confirm.cancel", "Scheme visits: Confirm: cancel", AssessorApp, Main, "Cancel"),
        App("app.assessor.schemes.confirm.submit", "Scheme visits: Confirm: submit", AssessorApp, Main, "Submit"),
        App("app.assessor.schemes.submit.offline", "Scheme visits: Submit: offline", AssessorApp, Main, "Submitting needs an internet connection. Your work is kept on the phone."),
        App("app.assessor.schemes.submit.unsynced", "Scheme visits: Submit: not synced yet", AssessorApp, Main, "Some photos or answers are not synced yet. {{Error}}", "Error"),
        App("app.assessor.schemes.submit.done", "Scheme visits: Submit: done", AssessorApp, Main, "The result is submitted."),
        App("app.assessor.schemes.clear.badge", "Scheme visits: Clear data: badge", AssessorApp, Main, "Scheme visit"),
        App("app.assessor.schemes.clear.start", "Scheme visits: Clear data: start of the visit", AssessorApp, Main, "Start of visit (selfie and site photo)"),
        App("app.assessor.schemes.clear.startNote", "Scheme visits: Clear data: start not synced", AssessorApp, Main, "Not synced yet: clearing it also clears the photos and checks waiting for it."),
        App("app.assessor.schemes.clear.photos", "Scheme visits: Clear data: an item's photos", AssessorApp, Main, "Photos · {{Item}}", "Item"),
        App("app.assessor.schemes.clear.checks", "Scheme visits: Clear data: checks and remarks", AssessorApp, Main, "Checks, representative and remarks"),
        App("app.assessor.schemes.clear.everything", "Scheme visits: Clear data: remove everything", AssessorApp, Main, "Remove everything for this visit"),
        App("app.assessor.schemes.clear.everythingTitle", "Scheme visits: Clear data: remove everything (title)", AssessorApp, Main, "Remove everything for this visit?"),
        App("app.assessor.schemes.clear.confirmText", "Scheme visits: Clear data: what stays", AssessorApp, Main, "They are removed from this phone only. What the server has stays."),
        App("app.assessor.schemes.clear.everythingText", "Scheme visits: Clear data: remove everything (text)", AssessorApp, Main, "The photos, checks and remarks of this visit and the sends waiting to sync are removed from the phone. What the server has stays."),

        // Assessor app: voice typing (2026-11-21: the mic of every comment box; a tap listens in English (India), a long press in Hindi)
        App("app.assessor.voice.button", "Voice typing: mic button (spoken label)", AssessorApp, Main,
            "Speak to type (hold for Hindi)"),
        App("app.assessor.voice.prompt", "Voice typing: listening prompt", AssessorApp, Main,
            "Speak now"),
        App("app.assessor.voice.unavailable", "Voice typing: not available on the phone", AssessorApp, Main,
            "Voice typing is not available on this phone. Please turn on the Google voice typing service and try again."),
        App("app.assessor.voice.failed", "Voice typing: could not start", AssessorApp, Main,
            "Voice typing could not start, please try again."),
        App("app.assessor.voice.cut", "Voice typing: text cut to the box's limit", AssessorApp, Main,
            "Only part of what you said was added: this box takes up to {{Max}} characters.", "Max"),

        // Consultant app (ZEDConsultant)
        App("app.consultant.siteTour.tourInstruction", "Site tour: capture photos", ConsultantApp, Consultancy,
            "Here you can capture Site Photos which can later be used as evidences"),
        // 2026-11-28: the lead's milestone 1 site tour is synced only once every section has its photos (the server refuses it otherwise).
        App("app.consultant.siteTour.missing", "Site tour: sync stopped, sections without their photos", ConsultantApp, Consultancy,
            "Site Tour cannot be submitted yet: every section needs its photos. Please capture: {{Sections}}.", "Sections"),
        App("app.consultant.siteTour.missingSection", "Site tour: one section without its photos (in the list above)", ConsultantApp, Consultancy,
            "\"{{Section}}\" ({{Captured}} of {{Required}} photos)", "Section", "Captured", "Required"),
        App("app.consultant.login.windowNote", "Login: two days before the site assessment", ConsultantApp, Consultancy,
            "You can only login 2 days prior to your allocated Site Assessment date"),
        App("app.consultant.tu.dataCorrect.checkbox", "Technology Upgradation: data is correct (checkbox)", ConsultantApp, Consultancy,
            "I am confirming that the above data is correct"),
        // Consultant app: voice typing (2026-11-21: the mic of every comment box; a tap listens in English (India), a long press in Hindi)
        App("app.consultant.voice.button", "Voice typing: mic button (spoken label)", ConsultantApp, Consultancy,
            "Speak to type (hold for Hindi)"),
        App("app.consultant.voice.prompt", "Voice typing: listening prompt", ConsultantApp, Consultancy,
            "Speak now"),
        App("app.consultant.voice.unavailable", "Voice typing: not available on the phone", ConsultantApp, Consultancy,
            "Voice typing is not available on this phone. Please turn on the Google voice typing service and try again."),
        App("app.consultant.voice.failed", "Voice typing: could not start", ConsultantApp, Consultancy,
            "Voice typing could not start, please try again."),
        App("app.consultant.voice.cut", "Voice typing: text cut to the box's limit", ConsultantApp, Consultancy,
            "Only part of what you said was added: this box takes up to {{Max}} characters.", "Max"),
    ];
}
