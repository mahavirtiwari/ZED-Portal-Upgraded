using Zed.Core.Http;

namespace Zed.Core.Content;

public static partial class ContentCatalogue
{
    private const string CertificationPayment = "MSME: Certification payment", SurveillancePayment = "MSME: Surveillance payment",
        Handholding = "MSME: Handholding", Schemes = "MSME: Schemes (FA/TU)", Registration = "MSME: Registration", Dashboard = "MSME: Dashboard",
        PublicPages = "Public pages";

    private const string StaffAssessment = "Staff: Assessment", StaffMonitoring = "Staff: Monitoring", StaffConsultancy = "Staff: Consultancy",
        StaffSurveillance = "Staff: Surveillance", StaffSchemes = "Staff: Schemes (FA)";

    private const string FairConfirm = "I confirm that I have verified the information provided by the unit against each requirement in a fair and unbiased manner.";
    private const string ConfirmProceed = "I confirm the above and agree to proceed with the information provided.";
    private const string DataCorrect = "I am confirming that the above data is correct";

    /// <summary>
    /// The MSME pages (main build only: the consultancy and surveillance builds are staff-only, so a payment for another
    /// system is still a main page). A short text (a checkbox, a note in a sentence) is plain, without a paragraph.
    /// </summary>
    private static IEnumerable<ContentBlock> MsmeWeb() =>
    [
        // msme/dashboard: applying for a certification (disclaimer, instructions), then msme/payment/payment-step.
        // The disclaimer is in three parts: points 5–6 are not shown for a re-certification.
        Web("msme.certification.payment.disclaimer", "Certification payment: disclaimer", CertificationPayment, Main, """
            <p>This disclaimer/declaration governs the use of the MSME Standard, various documents, reports and any content therein. The following is accepted in full by the User/applicant Unit:</p>
            <ol>
              <li>By agreeing to proceed and make relevant payment it is assumed that the applicant has read &amp; understood the Scheme Guidelines &amp; the provisions contained therein and is participating in this voluntary scheme on their own volition.</li>
              <li>The applicant has read and understood the requirements of the Certification Level for which the payment is being made and take full responsibility for any non-conformities that may occur during the Certification process.</li>
              <li>The amount once remitted is non-refundable, non-adjustable &amp; non-transferable irrespective of the outcome of the Certification process.</li>
              <li>Submission of relevant documents/evidences/responses in a timely manner is essential and non-conformance to timelines may result in forfeiture of any amount paid.</li>
            </ol>
            """),
        Web("msme.certification.payment.disclaimer.firstCertification", "Certification payment: disclaimer, points of a first certification", CertificationPayment, Main, """
            <ol start="5">
              <li>The “Joining Reward” (Rs. 10,000/-) will be unlocked only once and can be applied for any Certification Level. Once availed, the Joining Reward cannot be reverted, reinstated or reused in any manner.</li>
              <li>The final payment being made is only the “beneficiary contribution”; the subsidies applicable for this Certification Level is pre-applied.</li>
            </ol>
            """),
        // {{Number}}: 7, or 5 for a re-certification (without the points of a first certification).
        Web("msme.certification.payment.disclaimer.closing", "Certification payment: disclaimer, last point", CertificationPayment, Main, """
            <ol start="{{Number}}">
              <li>Mere submission of relevant payment does not guarantee a Certification. The Certification will only be accorded after completion of due process and closure of all non-conformities, if any, within the stipulated time.</li>
            </ol>
            """, "Number"),
        Web("msme.certification.payment.instructions", "Certification payment: instructions", CertificationPayment, Main, """
            <ol>
              <li>After making the payment, the applicant MSME would need to submit necessary information/documents on the “Basic Information &amp; Document Upload” section.</li>
              <li>During the process of “Basic Information and Document Upload”, most relevant information and evidences should be provided/uploaded.</li>
              <li>The desktop assessor will not attempt to ensure the accuracy of information/documents provided and the conclusions of this process will be derived solely from the information provided by the applicant.</li>
              <li>It is expected that the applicants honestly upload the relevant documents/evidences. Information not disclosed or erroneously uploaded by the applicant may lead to non-conformities.</li>
              <li>After the completion of the Basic Information and Document Upload process, a desktop verification of the documents uploaded will be done. Thereafter, the way forward will be provided to the MSME via email.</li>
              <li>Please download the Mobile Application from Google Playstore as and when prompted.</li>
              <li>Please download the User Manual from “My Documents” for detailed instructions &amp; guidance on “Basic Information &amp; Document Upload”</li>
            </ol>
            """),
        Web("msme.payment.joiningReward.note", "Certification payment: joining reward note", CertificationPayment, Main, """
            <p>*Applicable only on one certification (either Bronze or Silver or Gold).</p>
            <p>** In case of Bronze certification, the balance joining reward i.e. Rs. 2000/- will be adjusted towards "Surveillance Assessment" after 18 months of the certification. The validity of availing the balance joining reward i.e. Rs. 2000/- (cost of surveillance assessment of Bronze) will be till the surveillance is done.</p>
            """),

        // msme/payment/surveillance-payment
        Web("msme.surveillance.payment.disclaimer", "Surveillance payment: disclaimer", SurveillancePayment, Main, """
            <p>This disclaimer/declaration governs the use of the MSME Standard, various documents, reports and any content therein. The following is accepted in full by the User/applicant Unit:</p>
            <ol>
              <li>By agreeing to proceed and make relevant payment it is assumed that the applicant has read &amp; understood the Scheme Guidelines &amp; the provisions contained therein and is participating in this voluntary scheme on their own volition.</li>
              <li>The applicant has read and understood the requirements of the Certification Level and the Surveillance assessment for which the payment is being made and take full responsibility for any non-conformities that may occur during the Surveillance assessment.</li>
              <li>The amount once remitted is non-refundable, non-adjustable &amp; non-transferable irrespective of the outcome of the Surveillance process.</li>
              <li>Submission of relevant documents/evidences/responses in a timely manner is essential and non-conformance to timelines may lead to suspension or withdrawal of the Certification.</li>
              <li>The final payment being made is only the “beneficiary contribution”; the subsidies applicable for this Certification Level is pre-applied.</li>
              <li>Mere submission of relevant payment does not guarantee continuation of Certification. The Certification will only be continued after completion of due process of Surveillance assessment and closure of all non-conformities, if any, within the stipulated time.</li>
            </ol>
            """),
        Web("msme.surveillance.payment.instructions", "Surveillance payment: instructions", SurveillancePayment, Main, """
            <ol>
              <li>After making the payment, the applicant MSME would receive a call from QCI empanelled Assessment Agency and the applicant MSME will require to select a mutually agreed date for Surveillance Assessment.</li>
              <li>The Surveillance assessment will be done remotely and the MSME must download the Mobile Application from Google Play Store as and when prompted (if not downloaded already)</li>
              <li>The MSME must ensure that there is a good internet connection.</li>
              <li>The conclusions of the Surveillance assessment will be derived solely from the information provided by the applicant and it is expected that the applicant honestly shares the relevant information/ documents/evidences.</li>
              <li>A User Manual with detailed instructions &amp; guidance on “Surveillance Assessment process” can be downloaded from “My Documents” section of the ZED website.</li>
            </ol>
            """),
        Web("msme.surveillance.payment.joiningReward.note", "Surveillance payment: joining reward note", SurveillancePayment, Main,
            "*Applicable only on one certification (either Bronze or Silver or Gold)."),

        // msme/payment/consultancy-payment and msme/handholding
        Web("msme.handholding.payment.disclaimer", "Handholding payment: disclaimer", Handholding, Main, """
            <ol>
              <li>By agreeing to proceed and make relevant payment it is assumed that the applicant has read &amp; understood the Scheme Guidelines &amp; the provisions contained therein and is participating in this activity on their own volition.</li>
              <li>The applicant has read and understood the requirements of the handholding process for which the payment is being made and take full responsibility for the outcome of the process.</li>
              <li>The amount once remitted is non-refundable, non-adjustable &amp; non-transferable irrespective of the outcome of the process.</li>
              <li>Submission of relevant documents/evidences/responses in a timely manner is essential.</li>
              <li>Complete support to the Consultant Organisation must be provided by the applicant in order to achieve the desired result.</li>
              <li>The payment being made is only the “beneficiary contribution”; the subsidies applicable for this activity is pre-applied.</li>
            </ol>
            """),
        Web("msme.handholding.payment.instructions", "Handholding payment: instructions", Handholding, Main, """
            <ol>
              <li>There are 3 milestones in the handholding process. Payment will be made at the beginning of each milestone.</li>
              <li>A Consultant Organisation will be allocated to the applicant after payment of the first milestone.</li>
              <li>The applicant would need to submit necessary information/documents as and when sought and extend full support to the consultant organisation.</li>
              <li>Applicant must coordinate closely with the Consultant Organisation to close each milestone and move to the next.</li>
              <li>Activity for each milestone would commence only after payment of that milestone and acceptance of activities performed in the previous milestone, if &amp; as applicable.</li>
            </ol>
            """),
        Web("msme.handholding.payment.joiningReward.note", "Handholding payment: joining reward note", Handholding, Main,
            "*Applicable only on one certification (either Bronze or Silver or Gold)."),
        Web("msme.handholding.steps.1", "Handholding steps: 1", Handholding, Main, """
            <h4>Milestone 1: Baseline Diagnostic Study and Handholding Action Plan</h4>
            <p>Provides a clear understanding of where the MSME stands and a time-bound improvement plan identifying the steps, tools and resources required to achieve the desired objectives.</p>
            """),
        Web("msme.handholding.steps.2", "Handholding steps: 2", Handholding, Main, """
            <h4>Milestone 2 &amp; 3: Implementation &amp; Progress Review 1 &amp; 2</h4>
            <p>The plan identified will be implemented by MSME and the progress will be regularly monitored and reviewed.</p>
            """),
        Web("msme.handholding.steps.3", "Handholding steps: 3", Handholding, Main, """
            <h4>Completion of Handholding activity</h4>
            <p>The handholding process will be considered to be completed when all the identified activities as mentioned in the Implementation plan are complete.</p>
            """),
        Web("msme.handholding.info.general", "Handholding: information (Handholding Support)", Handholding, Main, """
            <ul>
              <li><p>Please read the complete instructions and requirements before applying for consultancy. These are available under "My Documents".</p></li>
            </ul>
            """),
        Web("msme.handholding.info.level", "Handholding: information (a level)", Handholding, Main, """
            <ul>
              <li><p>Baseline Diagnostic Study and Handholding Action Plan with defined activities, expected outcome is to achieve the desired level.</p></li>
              <li><p>The Handholding Support cost is Rs. 2,00,000/- inclusive of taxes; subsidy as applicable.</p></li>
            </ul>
            """),
        Web("msme.handholding.acceptMilestone.checkbox", "Handholding: accept milestone check box", Handholding, Main,
            "I accept the activities conducted &amp; recommendations given in Milestone-{{Milestone}}", "Milestone"),

        // msme/schemes: Financial Assistance and Technology Upgradation (the same disclaimer and instructions)
        Web("msme.schemes.disclaimer", "Schemes: disclaimer", Schemes, Main, """
            <p><i>Please read and review carefully before proceeding</i></p>
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
        Web("msme.schemes.instructions", "Schemes: instructions", Schemes, Main, """
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
        Web("msme.fa.confirm.checkbox", "Financial Assistance: confirm and proceed check box", Schemes, Main, ConfirmProceed),
        Web("msme.tu.confirm.checkbox", "Technology Upgradation: confirm and proceed check box", Schemes, Main, ConfirmProceed),
        Web("msme.schemes.declaration.checkbox", "Schemes: declaration check box", Schemes, Main,
            "I hereby declare that the particulars given in the application are correct. In case any of the statement/information/documents furnished in the application/documents is later found to be wrong or incorrect or misleading, I do hereby bind myself and my unit to pay to the Government on demand the full amount received as reimbursement in respect of the above mentioned activity, within seven days of the demand being raised."),
        Web("msme.fa.eligibleAmountNote", "Financial Assistance: eligible amount note", Schemes, Main,
            "Eligible Financial Assistance: 75% of invoice amount and max. up to 50,000 only"),

        // msme/login and msme/register
        Web("msme.login.newUserEligibility", "Login: new user eligibility", Registration, Main, """
            <p>If you are a first time user, click below on “Register Now”.<br>(Applicable only for manufacturing sector: Section C, NIC 2008)</p>
            """),
        Web("msme.registration.welcome", "Registration: welcome", Registration, Main, """
            <p class="info-heading">To proceed, please keep the following ready:</p>
            <ol>
              <li>The <strong>Udyam Registration Number</strong> of the Enterprise.</li>
              <li>The <strong>Mobile Number</strong> that is associated with the Udyam Registration.</li>
            </ol>
            <div class="label-highlight text-center">
              <p>If your Enterprise is not registered under Udyam Registration, then you may first register on<br>
              <a class="udyam-info-link" href="https://udyamregistration.gov.in" target="_blank" rel="noopener">https://udyamregistration.gov.in <img src="/Images/svgicons/nav.svg" alt=""></a><br>
              and then register here.</p>
            </div>
            """),
        Web("msme.registration.plant.validatedNote", "Registration: details validated note", Registration, Main, """
            <p>Your details have been validated from MSME Database (Ministry of MSME, Government of India)</p>
            """),
        Web("msme.registration.emailNote", "Registration: e-mail note (summary)", Registration, Main, """
            <p>Your ZED ID &amp; Password along with your ZED Pledge Certificate will be sent on this email ID.</p>
            """),
        Web("msme.registration.emailModalNote", "Registration: e-mail note (Enter Email ID)", Registration, Main, """
            <p class="small">Your ZED ID, password and Pledge Certificate will be sent to this Email ID.</p>
            """),
        Web("msme.registration.confirm.checkbox", "Registration: confirm and proceed check box", Registration, Main, ConfirmProceed),
        // One paragraph per line: the page fades the lines in one after the other.
        Web("msme.registration.pledge", "Registration: ZED pledge", Registration, Main, """
            <p>We undertake to conform to the values of Zero Defect Zero Effect in our</p>
            <p>enterprise and ensure that our processes shall be environmentally sound and</p>
            <p>socially responsible with safe and high quality products. We will give back, in</p>
            <p>every way we can, to our people, our community and to our planet.</p>
            """),
        Web("msme.registration.success", "Registration: success", Registration, Main, """
            <strong>Congratulations! You can now avail:</strong>
            <ul>
              <li>Joining reward of Rs. 10,000/- for ZED Certification.</li>
            </ul>
            <strong>What next?</strong>
            <ul>
              <li>Check your email for Pledge Certificate and ZED ID/ Password.</li>
              <li>If you did not receive any email, please check in Spam/Junk folder.</li>
              <li>Use the received ZED ID and Password to login again.</li>
            </ul>
            """),

        // msme/dashboard
        Web("msme.dashboard.mobileAppHint", "Dashboard: mobile app hint", Dashboard, Main, """
            <p>You can now start the <strong>"Bronze/Silver/Gold certification"</strong> from the ZED MSME Mobile Application</p>
            """),
        Web("msme.dashboard.levelInfo.bronze", "Dashboard: Bronze information", Dashboard, Main, """
            <ul>
              <li><p>This level has 5 parameters, which need to be conformed to, for achieving a Certification.</p></li>
              <li><p>The certification cost is Rs. 10,000/- inclusive of taxes; subsidy, as applicable.</p></li>
            </ul>
            """),
        Web("msme.dashboard.levelInfo.silver", "Dashboard: Silver information", Dashboard, Main, """
            <ul>
              <li><p>This level has 14 parameters, which need to be conformed to, for achieving a Certification.</p></li>
              <li><p>The certification cost is Rs. 40,000/- inclusive of taxes; subsidy, as applicable.</p></li>
            </ul>
            """),
        Web("msme.dashboard.levelInfo.gold", "Dashboard: Gold information", Dashboard, Main, """
            <ul>
              <li><p>This level has 20 parameters, which need to be conformed to, for achieving a Certification.</p></li>
              <li><p>The certification cost is Rs. 90,000/- inclusive of taxes; subsidy, as applicable.</p></li>
            </ul>
            """),
        Web("msme.dashboard.info.myCertifications", "Dashboard: My Certifications information", Dashboard, Main, """
            <ul>
              <li><p>Please read the complete instructions and requirements before applying for any Certification Level. These are available under "My Documents".</p></li>
            </ul>
            """),
        Web("msme.dashboard.info.myIncentives", "Dashboard: My Incentives information", Dashboard, Main, """
            <ul>
              <li><p>MSME KAWACH and Joining Reward incentives are available to any applicant which has taken the ZED Pledge. All other incentives &amp; benefits will be activated after attaining the respective Certification Level (Bronze, Silver or Gold). Complete list is available under "My Documents".</p></li>
            </ul>
            """),
        Web("msme.dashboard.joiningReward.availInfo", "Dashboard: how to avail the joining reward", Dashboard, Main, """
            <ul>
              <li><p>Kindly apply for any of the ZED Certification levels (Bronze, Silver, Gold) to avail Joining Reward</p></li>
            </ul>
            """),
        Web("msme.dashboard.certificationSteps.1", "Dashboard: certification steps, 1", Dashboard, Main, """
            <h4>Basic Information and Document Upload</h4>
            <p>Provide processes and systems information</p>
            """),
        Web("msme.dashboard.certificationSteps.2", "Dashboard: certification steps, 2", Dashboard, Main, """
            <h4>Desktop Verification</h4>
            <p>Desktop verification of documents uploaded. Bronze level applicants will receive certification after this step.</p>
            """),
        Web("msme.dashboard.certificationSteps.3", "Dashboard: certification steps, 3", Dashboard, Main, """
            <h4>Remote/Onsite Assessment</h4>
            <p>Applicable only for Silver and Gold Certification</p>
            """),
        Web("msme.dashboard.certificationSteps.4", "Dashboard: certification steps, 4", Dashboard, Main, """
            <h4>Certification</h4>
            <p>After conforming to relevant requirements, download your Certificate and Report from your dashboard.</p>
            """),
        Web("msme.dashboard.certificationSteps.5", "Dashboard: certification steps, 5", Dashboard, Main, """
            <h4>Avail Incentives</h4>
            <p>Various incentives will be unlocked and available under "My Incentives"</p>
            """),

        // public/privacy-policy: no text in the old portal; the Admin supplies it.
        Web("public.privacyPolicy", "Privacy policy", PublicPages, Main, """
            <p>The privacy policy will be published here.</p>
            """),
    ];

    /// <summary>The staff pages, for the systems whose build has the page.</summary>
    private static IEnumerable<ContentBlock> StaffWeb() =>
    [
        // staff/assessment (all builds)
        Web("staff.assessment.desktop.validateNote.sitePhotos", "Desktop assessment: site photos note", StaffAssessment, All,
            "<strong>Note: </strong>Click on the site exterior photos to validate"),
        Web("staff.assessment.desktop.validateNote.productPhotos", "Desktop assessment: product photos note", StaffAssessment, All,
            "<strong>Note: </strong>Click on the Product photos to validate"),
        Web("staff.assessment.desktop.validateNote.documents", "Desktop assessment: documents note", StaffAssessment, All,
            "<strong>Note: </strong>Click on the uploaded documents (PDFs) to validate"),
        Web("staff.assessment.desktop.fairConfirm.checkbox", "Desktop assessment: final submit check box", StaffAssessment, All, FairConfirm),
        Web("staff.desktopVerification.accept.confirm", "Desktop verification: accept confirmation", StaffAssessment, All,
            "<strong>Are you sure you want to accept Unit for Desktop Verification?</strong>"),

        // staff/remote (main and surveillance builds)
        Web("staff.assessment.remote.fairConfirm.checkbox", "Remote assessment: final submit check box", StaffAssessment, MainAndSurveillance, FairConfirm),
        // The Instructions tab of the surveillance build: one table row per item.
        Web("staff.surveillance.remote.instructions", "Remote surveillance: instructions", StaffSurveillance, [PortalSystem.Surveillance], """
            <ol>
              <li>Surveillance Assessments are mandatory for all Silver and Gold Certified MSMEs.</li>
              <li>Each certified MSME must undergo Two Surveillance Assessments within a Certification cycle of three years.</li>
              <li>MSMEs that upgrade from Silver to Gold Certification during the certification cycle will not require to undergo Surveillance Assessments for the previous level.</li>
              <li>The Certification shall be suspended/withdrawn if the MSME fails to apply for Surveillance Assessments or the MSME doesn’t successfully completes the Surveillance Assessments.</li>
              <li>In the cases of Withdrawal, the MSME will have to apply a fresh by paying the entire Assessment/ Certification Fee.</li>
              <li>Surveillance Assessment Fee for Silver and Gold Certifications are is Rs.10,000/- and Rs.20,000/-, respectively.</li>
              <li>The MSME shall require to pay the beneficiary contribution in advance (as applicable) at the beginning of each Surveillance Assessment.</li>
              <li>MSMEs will be eligible for the subsidies as specified in ZED Scheme Guidelines for Surveillance Assessment.</li>
              <li>Remote Surveillance Assessment will be conducted by Assessor(s) as allocated by empaneled Assessment Agency.</li>
              <li>A certificate and report will be provided to applicant after successful completion of Surveillance Assessment.</li>
              <li>The Assessment Fee mentioned in the User Manual and at other relevant sources, are all inclusive and are required to be paid online through the ZED portal. MSME shall not pay any other amount to anyone.</li>
              <li>MSME must download ZED MSME mobile application available on Google Play Store (Android) and App Store (iPhone) on or before the day of Surveillance Assessment.</li>
              <li>A Weblink will be provided by the Assessment Agency to conduct the remote assessment. MSME must join the meeting by clicking on the link on the day of assessment.</li>
            </ol>
            """),

        // staff/monitoring/review-actions: the agency's pop-ups on the desktop and site review pages (all builds)
        Web("staff.monitoring.review.exemptionsReviewed.checkbox", "Review final submit: exemptions check box", StaffMonitoring, All,
            "I have reviewed all the exemptions, and they have been applied correctly."),
        Web("staff.monitoring.review.qualityChecked.checkbox", "Review final submit: quality check box", StaffMonitoring, All,
            "I confirm that the quality check of the assessment has been done and relevant amendments made wherever applicable."),
        Web("staff.monitoring.review.reject.checkbox", "Review reject: check box", StaffMonitoring, All,
            "I confirm that the quality check of the assessment has been done and rejecting the certification."),

        // staff/consultancy (consultancy build)
        Web("staff.consultancy.milestone.review.checkbox", "Milestone review: check box", StaffConsultancy, Consultancy,
            "I confirm that the review of the milestone has been done and relevant amendments made wherever applicable."),
        Web("staff.consultancy.milestone.reject.checkbox", "Milestone reject: check box", StaffConsultancy, Consultancy,
            "I confirm that the milestone has been reviewed and the handholding support is rejected."),
        Web("staff.consultancy.technologyRecommendation.note", "Technology recommendation: selection note", StaffConsultancy, Consultancy,
            "<strong>Note:</strong> Select minimum 1 and maximum {{Max}} technologies for recommendation.", "Max"),
        Web("staff.consultancy.technologyRecommendation.fairConfirm.checkbox", "Technology recommendation: submit check box", StaffConsultancy, Consultancy, FairConfirm),
        Web("staff.consultancy.tuVerification.dataCorrect.checkbox", "Technology Upgradation verification: check box", StaffConsultancy, Consultancy, DataCorrect),

        // staff/schemes (main build)
        Web("staff.schemes.faVerification.dataCorrect.checkbox", "Financial Assistance verification: check box", StaffSchemes, Main, DataCorrect),
    ];
}
