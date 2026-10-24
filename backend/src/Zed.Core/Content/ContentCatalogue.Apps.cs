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
              <li><b>“MSME KAWACH”</b>, a COVID-19 Support initiative of Ministry of MSME, free of cost.”</li>
            </ul>
            <p>What next?</p>
            <ul>
              <li>Check your email for Pledge Certificate and ZED ID/Password.</li>
              <li>If you did not receive any email, please check in Spam/Junk folder.</li>
              <li>Use the received ZED ID and Password to login again.</li>
            </ul>
            """),

        // MSME app: dashboard
        App("app.msme.dashboard.certificationSteps", "Dashboard: ZED certification steps", MsmeApp, MainAndSurveillance, """
            <ol>
              <li><b>Basic Information &amp; Document Upload</b><br>Provide Processes &amp; Systems information</li>
              <li><b>Desktop Verification</b><br>Desktop verification of documents uploaded. Bronze level applicants will receive certification after this step.</li>
              <li><b>Remote/Onsite Assessment</b><br>Applicable only for Silver &amp; Gold Certification.</li>
              <li><b>Certification</b><br>After conforming to relevant requirements, download your Certificate and Report from your dashboard.</li>
              <li><b>Avail Incentives</b><br>Various incentives will be unlocked and available under "My Incentives"</li>
            </ol>
            """),
        App("app.msme.dashboard.levelInfo.bronze", "My Certifications: Bronze level information", MsmeApp, MainAndSurveillance, """
            <ul>
              <li>This level has 5 parameters, which need to be conformed to, for achieving a Certification.</li>
              <li>The certification cost is Rs. 10,000/- inclusive of taxes, subsidy, as applicable.</li>
            </ul>
            """),
        App("app.msme.dashboard.levelInfo.silver", "My Certifications: Silver level information", MsmeApp, MainAndSurveillance, """
            <ul>
              <li>This level has 14 parameters, which need to be conformed to, for achieving a Certification.</li>
              <li>The certification cost is Rs. 40,000/- inclusive of taxes; subsidy, as applicable.</li>
            </ul>
            """),
        App("app.msme.dashboard.levelInfo.gold", "My Certifications: Gold level information", MsmeApp, MainAndSurveillance, """
            <ul>
              <li>This level has 20 parameters, which need to be conformed to, for achieving a Certification.</li>
              <li>The certification cost is Rs. 90,000/- inclusive of taxes; subsidy, as applicable.</li>
            </ul>
            """),
        App("app.msme.dashboard.info.myCertifications", "Dashboard: My Certifications information", MsmeApp, Main,
            "<p>Please read the complete instructions and requirements before applying for any Certification Level. These are available under \"My Documents\".</p>"),
        App("app.msme.dashboard.info.myIncentives", "Dashboard: My Incentives information", MsmeApp, Main,
            "<p>MSME KAWACH and Joining Reward incentives are available to any applicant which has taken the ZED Pledge. All other incentives &amp; benefits will be activated after attaining the respective Certification Level (Bronze, Silver or Gold). Complete list is available under \"My Documents\".</p>"),
        App("app.msme.incentives.joiningReward.availInfo", "My Incentives: how to avail the joining reward", MsmeApp, Main,
            "<p>Kindly apply for any of the ZED Certification levels (Bronze, Silver, Gold) to avail Joining Reward</p>"),

        // MSME app: the assessment
        // Not shown by the Bronze surveillance build (its step is switched off there).
        App("app.msme.assessment.complianceUndertaking", "Assessment: undertaking of compliances", MsmeApp, Main, """
            <p>I/We understand that the ZED Certification is voluntary and recognize the authority of the Ministry of MSME, Government of India, in issuance of any Certificate.</p>
            <p>By proceeding I/We certify that my/our Enterprise/Unit complies with &amp; fulfils all relevant &amp; applicable regulatory &amp; statutory norms/licenses pertaining to the functioning of this manufacturing unit. If not, then efforts will be taken to fulfil those regulatory/statutory requirements by me/us. If at any stage the Enterprise/Unit is found to be non-compliant with any relevant/applicable regulatory &amp; statutory norms, the competent authority will have the right to recall/withdraw any or all reports or Certifications awarded.</p>
            """),
        App("app.msme.assessment.requirementsAccepted.checkbox", "Assessment: certification requirements read (checkbox)", MsmeApp, MainAndSurveillance,
            "I have read the certification requirements and are following all the requirements to the fullest extent possible."),
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

        // Assessor app (ZED_SA_Studio)
        App("app.assessor.siteTour.pickInstruction", "Site tour: pick a photo", AssessorApp, Main,
            "Simply tap on any photo from the list to pick as evidence"),
        App("app.assessor.siteTour.tourInstruction", "Site tour: capture photos", AssessorApp, Main,
            "Here you can capture Site Photos which can later be used as evidences"),
        App("app.assessor.login.windowNote", "Login: two days before the site assessment", AssessorApp, Main,
            "You can only login 2 days prior to your allocated Site Assessment date"),

        // Consultant app (ZEDConsultant)
        App("app.consultant.siteTour.pickInstruction", "Site tour: pick a photo", ConsultantApp, Consultancy,
            "Simply tap on any photo from the list to pick as evidence"),
        App("app.consultant.siteTour.tourInstruction", "Site tour: capture photos", ConsultantApp, Consultancy,
            "Here you can capture Site Photos which can later be used as evidences"),
        App("app.consultant.login.windowNote", "Login: two days before the site assessment", ConsultantApp, Consultancy,
            "You can only login 2 days prior to your allocated Site Assessment date"),
        App("app.consultant.tu.dataCorrect.checkbox", "Technology Upgradation: data is correct (checkbox)", ConsultantApp, Consultancy,
            "I am confirming that the above data is correct"),
    ];
}
