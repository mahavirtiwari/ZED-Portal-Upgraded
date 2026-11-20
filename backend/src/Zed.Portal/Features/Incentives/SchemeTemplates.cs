namespace Zed.Portal.Features.Incentives;

/// <summary>
/// "Start from Financial Assistance" / "Start from Technology Upgradation" (2026-11-20, approved): today's two forms as scheme
/// definitions, field for field (MsmeFinancialAssistanceController, MsmeTechnologyUpgradationController): the Admin starts a
/// scheme from one and adjusts it. Two built-in schemes are kept from them (<see cref="SchemeStore.EnsureBuiltInAsync"/>):
/// <see cref="FaCode"/>, the scheme the Financial Assistance card opens (2026-11-20: FA moved to the framework), and
/// <see cref="DirectTuCode"/>, the one the Technology Upgradation card opens when the consultant's recommendation is not
/// required (dbo.Incentives.RecommendationRequired = 0).
/// <para>
/// The legacy validations carried over (2026-11-20, "the same with the current validations"): FA categories Quality / Product /
/// Testing; text lengths 200 / 200 / 50 / 2000 / 50 (FA) and 500 / 500 / 200 / 50 (TU); dates from 01-01-1990 (FA) or from the
/// certification (TU) to today; validity 1–100 years; amounts above 0 (two decimals) up to 10 crore; payment Offline / Online;
/// up to 3 files per document; FA: the copy of the certificate and of the invoice required, the CA certificate optional, at
/// least 2 files among the invoice and the CA certificate (as the live form: two invoice copies also do); the invoice number
/// cannot be used again (the FA procedure refused the same certificate and invoice); TU: the picture and the invoice required,
/// the CA certificate optional; the bank account and the cancelled cheque (up to 3 files) of the standard bank block.
/// </para>
/// </summary>
public static class SchemeTemplates
{
    public const string DirectTuCode = "TU_DIRECT";

    /// <summary>The built-in Financial Assistance scheme the Financial Assistance card opens (created on first use).</summary>
    public const string FaCode = "FA";

    /// <summary>
    /// The templates' version. A built-in scheme stored with a lower <see cref="SchemeDefinition.TemplateVersion"/> is brought up
    /// to date by <see cref="Upgrade"/> (2: legacy categories, 3 files per document, unique invoice number, amounts from 0.01,
    /// the scheme's own texts).
    /// </summary>
    public const int Version = 2;

    private static readonly IReadOnlyList<string> PaymentModes = ["Offline", "Online"];

    /// <summary>The smallest amount (the legacy forms: above 0, two decimals).</summary>
    public const decimal MinAmount = 0.01m;

    /// <summary>Choice values renamed by a template version (old → new): stored definitions and answers are read with them.</summary>
    public static readonly IReadOnlyDictionary<string, string> RenamedOptions = new Dictionary<string, string> { ["System/Quality"] = "Quality" };

    /// <summary>The FA document rule's message of version 1 (replaced by <see cref="Upgrade"/>).</summary>
    private const string FaRuleMessageV1 = "Please upload the invoice copy and the CA certificate of expenditure (at least 2 files).";

    private const string FaRuleMessage =
        "Please upload at least 2 files among the copy of the invoice and the CA certificate of expenditure (for example the invoice and the CA certificate, or two invoice copies).";

    private static FormField Doc(string key, string label, bool required, bool checks = true) =>
        new() { Key = key, Label = label, Type = "document", Required = required, MaxFiles = SchemeRules.MaxFilesPerField, AssessorChecks = checks };

    private static FormField Text(string key, string label, int max, bool required = true, bool checks = false, bool unique = false) =>
        new() { Key = key, Label = label, Type = "text", MaxLength = max, Required = required, AssessorChecks = checks, Unique = unique };

    public static SchemeDefinition FinancialAssistance(string code = "FA_LIKE") => new()
    {
        Code = code,
        Name = "Financial Assistance",
        TemplateVersion = Version,
        Card = new() { Title = "Financial Assistance", Highlight = "75% of Subsidy (Max. Rs. 50,000/-)", Details = "For System Certification or Product Certification or Product Testing", Icon = "rupee" },
        Activation = new() { Mode = SchemeRules.Levels, Levels = ["Bronze", "Silver", "Gold"] },
        Grading = new() { Mode = SchemeRules.ByLevel, Rows = [new("Bronze", 75, 50000), new("Silver", 75, 50000), new("Gold", 75, 50000)] },
        Disclaimer = FaDisclaimer,
        Instructions = FaInstructions,
        Declaration = DeclarationText,
        Form = new()
        {
            Sections =
            [
                new()
                {
                    Key = "certificate", Title = "Certification details",
                    Fields =
                    [
                        new() { Key = "category", Label = "Category of Certificate", Type = "choice", Options = ["Quality", "Product", "Testing"], AssessorChecks = true },
                        Text("certificate_name", "Name of Certificate", 200, checks: true),
                        Text("agency", "Certification Agency", 200, checks: true),
                        Text("certificate_no", "Certificate Number", 50, checks: true),
                        new() { Key = "issued_on", Label = "Date of Issue", Type = "date", DateMin = "date:1990-01-01", DateMax = "today", AssessorChecks = true },
                        new() { Key = "validity", Label = "Validity (years)", Type = "number", Min = 1, Max = 100 },
                        new() { Key = "other_info", Label = "Any other information", Type = "longtext", MaxLength = 2000, Required = false },
                        Doc("certificate_copy", "Copy of Certificate", true),
                    ],
                },
                new()
                {
                    Key = "expenditure", Title = "Details of expenditure",
                    Fields =
                    [
                        new() { Key = "certificate_name_copy", Label = "Name of Certificate", Type = "copy", CopyOf = "certificate.certificate_name", Required = false },
                        new() { Key = "supplier_copy", Label = "Agency/Supplier", Type = "copy", CopyOf = "certificate.agency", Required = false },
                        Text("invoice_no", "Invoice/Bill No.", 50, checks: true, unique: true),
                        new() { Key = "invoice_date", Label = "Invoice/Bill Date", Type = "date", DateMin = "date:1990-01-01", DateMax = "today", AssessorChecks = true },
                        new() { Key = "amount_paid", Label = "Amount Paid", Type = "amount", Min = MinAmount, Max = SchemeRules.AmountCeiling, IsClaim = true, AssessorChecks = true },
                        new() { Key = "payment_mode", Label = "Mode of Payment", Type = "choice", Options = PaymentModes },
                        Doc("ca_certificate", "CA certificate of expenditure", false),
                        Doc("invoice_copy", "Copy of Invoice", true),
                    ],
                },
            ],
            Rules = [new("AtLeast", 2, ["ca_certificate", "invoice_copy"], FaRuleMessage)],
        },
    };

    public static SchemeDefinition TechnologyUpgradation(string code = DirectTuCode) => new()
    {
        Code = code,
        Name = "Technology Upgradation (direct)",
        TemplateVersion = Version,
        Card = new() { Title = "Technology Upgradation", Highlight = "Support of upto Rs. 3,00,000/-", Details = "for moving towards Zero Effect Solutions", Icon = "zap" },
        Activation = new() { Mode = SchemeRules.Levels, Levels = ["Bronze", "Silver", "Gold"] },
        // The user (2026-11-20): without the consultant's recommendation the share is set by enterprise size, with a cap.
        Grading = new() { Mode = SchemeRules.BySize, Rows = [new("Micro", 80, 300000), new("Small", 60, 300000), new("Medium", 50, 300000)] },
        Disclaimer = TuDisclaimer,
        Instructions = TuInstructions,
        Declaration = DeclarationText,
        Form = new()
        {
            Sections =
            [
                new()
                {
                    Key = "technologies", Title = "Technologies", Repeating = true, MinItems = 1, MaxItems = 10,
                    Pick = new() { Kind = SchemeRules.PickTechnologies, Label = "Technology", SectorFilter = true, NoRepeat = true },
                    Fields =
                    [
                        Text("manufacturer", "Name of Manufacturer", 500, checks: true),
                        Text("model", "Make/Model", 500, checks: true),
                        new() { Key = "purchased_on", Label = "Date of Purchase", Type = "date", DateMin = "certified", DateMax = "today", AssessorChecks = true },
                        Text("supplier", "Agency/Supplier", 200),
                        Text("invoice_no", "Invoice No", 50, checks: true),
                        new() { Key = "invoice_date", Label = "Invoice/Bill Date", Type = "date", DateMin = "certified", DateMax = "today", AssessorChecks = true },
                        new() { Key = "amount_paid", Label = "Amount Paid", Type = "amount", Min = MinAmount, Max = SchemeRules.AmountCeiling, IsClaim = true, AssessorChecks = true },
                        new() { Key = "payment_mode", Label = "Mode of Payment", Type = "choice", Options = PaymentModes },
                        Doc("technology_picture", "Picture of Purchased Technology", true),
                        Doc("invoice_copy", "Copy of Invoice", true),
                        Doc("ca_certificate", "CA certificate", false),
                    ],
                },
            ],
        },
    };

    /// <summary>The templates the Admin's "Start from" offers.</summary>
    public static IReadOnlyDictionary<string, Func<string, SchemeDefinition>> All { get; } = new Dictionary<string, Func<string, SchemeDefinition>>
    {
        ["FA"] = FinancialAssistance,
        ["TU"] = TechnologyUpgradation,
    };

    /// <summary>The template a built-in scheme is kept from (<see cref="FaCode"/>, <see cref="DirectTuCode"/>), else null.</summary>
    public static SchemeDefinition? BuiltInTemplate(string? code) =>
        string.Equals(code, FaCode, StringComparison.OrdinalIgnoreCase) ? FinancialAssistance(FaCode)
        : string.Equals(code, DirectTuCode, StringComparison.OrdinalIgnoreCase) ? TechnologyUpgradation(DirectTuCode)
        : null;

    /// <summary>
    /// Brings a stored built-in scheme up to <see cref="Version"/>, keeping the Admin's own changes: the card, name, activation,
    /// grading, verification, labels, help, required / checked marks, the sections and fields the Admin added or removed stay as
    /// they are. Of the fields the template also has (same section and key) only what the fixes touch changes: renamed choice
    /// values (<see cref="RenamedOptions"/>, other options kept), files per document raised to the template's (never lowered),
    /// the template's unique marks added, the template's smallest amount where the field still had the old one (1). The FA
    /// document rule's old message is replaced; the disclaimer, instructions and declaration are filled from the template when
    /// the scheme has none. A scheme already at the version (or not built-in) is returned as it is.
    /// </summary>
    public static SchemeDefinition Upgrade(SchemeDefinition stored)
    {
        if (stored.TemplateVersion >= Version || BuiltInTemplate(stored.Code) is not { } template) return stored;
        var sections = stored.Form.Sections.Select(s =>
        {
            var ts = template.Form.Sections.FirstOrDefault(x => x.Key == s.Key);
            if (ts is null) return s;
            return s with
            {
                Fields = s.Fields.Select(f => ts.Fields.FirstOrDefault(x => x.Key == f.Key && x.Type == f.Type) is { } tf ? Fix(f, tf) : f).ToList(),
            };
        }).ToList();
        var rules = stored.Form.Rules.Select(r => r.Message == FaRuleMessageV1 ? r with { Message = FaRuleMessage } : r).ToList();
        return stored with
        {
            TemplateVersion = Version,
            Disclaimer = string.IsNullOrWhiteSpace(stored.Disclaimer) ? template.Disclaimer : stored.Disclaimer,
            Instructions = string.IsNullOrWhiteSpace(stored.Instructions) ? template.Instructions : stored.Instructions,
            Declaration = string.IsNullOrWhiteSpace(stored.Declaration) ? template.Declaration : stored.Declaration,
            Form = stored.Form with { Sections = sections, Rules = rules },
        };

        static FormField Fix(FormField f, FormField t) => f with
        {
            Options = f.Options.Select(o => RenamedOptions.TryGetValue(o, out var n) && t.Options.Contains(n) ? n : o).Distinct().ToList(),
            MaxFiles = f.Type is "document" or "photo" && (f.MaxFiles ?? 1) < (t.MaxFiles ?? 1) ? t.MaxFiles : f.MaxFiles,
            Unique = f.Unique || t.Unique,
            Min = f.Type == "amount" && f.Min == 1m && t.Min == MinAmount ? MinAmount : f.Min,
        };
    }

    /// <summary>
    /// A by-level grading completed for <paramref name="levels"/> (the Financial Assistance card's "Activates after"): a level
    /// without a row (and no "All" row) gets a copy of the first row's share and maximum. Returns the levels added.
    /// </summary>
    public static (SchemeGrading Grading, IReadOnlyList<string> Added) GradingFor(SchemeGrading grading, IReadOnlyList<string> levels)
    {
        if (grading.Mode != SchemeRules.ByLevel || grading.Rows.Any(r => string.Equals(r.Key, "All", StringComparison.OrdinalIgnoreCase)))
            return (grading, []);
        var first = grading.Rows.FirstOrDefault() ?? new SchemeGrade("All", 75, 50000);
        var added = levels.Where(l => !grading.Rows.Any(r => string.Equals(r.Key, l, StringComparison.OrdinalIgnoreCase))).ToList();
        return added.Count == 0 ? (grading, added)
            : (grading with { Rows = [.. grading.Rows, .. added.Select(l => new SchemeGrade(l, first.SharePercent, first.MaxAmount))] }, added);
    }

    // ----- the applicant's texts (plain text; the scheme editor changes them) -----

    /// <summary>The declaration of the FA and TU pages (msme.schemes.declaration.checkbox).</summary>
    public const string DeclarationText =
        "I hereby declare that the particulars given in the application are correct. In case any of the statement/information/documents furnished in the application/documents is later found to be wrong or incorrect or misleading, I do hereby bind myself and my unit to pay to the Government on demand the full amount received as reimbursement in respect of the above mentioned activity, within seven days of the demand being raised.";

    /// <summary>Today's Financial Assistance disclaimer (msme.schemes.disclaimer) as plain text.</summary>
    public const string FaDisclaimer = """
        Please read and review carefully before proceeding.
        1. The benefits/incentives available to a ZED Certified MSME Unit are non-transferrable.
        2. The Financial Assistance can be applied/claimed only for the Unit which has been ZED Certified and not for any other Unit of the applicant MSME which may not be ZED Certified.
        3. The Financial Assistance can be applied/claimed only for the activities being conducted at the MSME unit and for the existing product line only, as exhibited during the ZED Certification process.
        4. This Financial Assistance is at the discretion of Ministry of MSME and cannot be claimed as a right by any ZED Certified MSME.
        5. The subsidy on the cost of Certification for any Testing, Management System or Product Certification will be subject to the following conditions:
           a. The product testing must be through a Laboratory that is accredited by the National Accreditation Board for Testing & Calibration Laboratories (NABL)
           b. The Management System Certification must be through a Certification Body that is accredited by the National Accreditation Board for Certification Bodies (NABCB)
           c. The Product Certification must be through Bureau of Indian Standards (BIS)
        6. The subsidy will be 75% of the total cost of Testing/System/Product Certification, with the maximum ceiling of subsidy being Rs. 50,000/-. The subsidy will be on the amount which is exclusive of any applicable taxes.
        7. The date of product/systems/testing Certification, for which the financial assistance is being claimed, must be after the date of ZED Certification. Claim for Certifications which have been procured earlier from the date of ZED Certification will not be entertained.
        8. The Financial Assistance cannot be claimed retrospectively for ZED Certifications achieved earlier. For example, an MSME which did not claim Financial Assistance for Bronze, achieves Silver and then applies for Financial Assistance: in this case the Financial Assistance can only be claimed for Silver and not for Bronze retrospectively.
        9. The subsidy will be applicable on only one Testing OR one Quality OR one Product Certification after achieving this Level. The applicant MSME cannot club two or more certifications in the given subsidy/cost.
        10. The Certification pertaining to Testing, Management Systems or Product, obtained through a Government Agency/Organisation will also be eligible for the said Financial Assistance.
        11. Any application which is incomplete in any respect will be summarily rejected.
        12. Information and documents submitted are subject to scrutiny and relevant validation.
        13. Mere submission of application for this activity does not warrant award of any financial support.
        14. If at any stage it is found that the documents submitted have been obtained fraudulently, the Ministry of MSME reserves the right to withdraw or recall its decision and seek refund of financial support provided. The Ministry will also be within its rights to initiate legal proceedings for any such cases.
        """;

    /// <summary>Today's Financial Assistance instructions (msme.schemes.instructions) as plain text.</summary>
    public const string FaInstructions = """
        1. After agreeing to the disclaimer and reading these instructions, the applicant will follow the directions given hereon and submit relevant information and documents as asked.
        2. Please keep the scanned images/PDF of the following ready:
           a. Testing, Systems or Product Certification, for which financial assistance is being applied for.
           b. Invoice/Bill of the Assessment Agency or Authority through which the Testing, Systems or Product Certification is processed.
           c. Certificate from the Chartered Accountant (CA) regarding payment of amount to the said Agency/Authority by the MSME. To know the details of information and documents needed to proceed, please see the "My Document" Section in your dashboard.
        3. Relevant document(s) must be uploaded for verification, as and when asked, failing which the application for Financial Assistance will be rejected.
        4. Ensure to input correct dates, amount, invoice numbers and other details, as and when asked, else the application for Financial Assistance will be rejected if the information is not matched with the uploaded document(s).
        5. In case your application is rejected, you will be given another opportunity to apply for Financial Assistance for Testing, Quality or Product Certification. The same can be applied through your dashboard.
        6. You shall be notified in due course of time regarding the outcome of your application.
        """;

    /// <summary>The Technology Upgradation disclaimer (the old TU page showed the FA text; this one speaks of technologies).</summary>
    public const string TuDisclaimer = """
        Please read and review carefully before proceeding.
        1. The benefits/incentives available to a ZED Certified MSME Unit are non-transferrable.
        2. The support for Technology Upgradation can be applied/claimed only for the Unit which has been ZED Certified and not for any other Unit of the applicant MSME which may not be ZED Certified.
        3. The support can be claimed only for technologies installed and used at the ZED Certified unit, for moving towards Zero Effect Solutions.
        4. This support is at the discretion of Ministry of MSME and cannot be claimed as a right by any ZED Certified MSME.
        5. The support is the share of the cost of the technologies shown on this page, up to the maximum shown. It will be on the amount which is exclusive of any applicable taxes.
        6. The technologies must be purchased after the date of ZED Certification. Purchases made before the date of ZED Certification will not be entertained.
        7. Any application which is incomplete in any respect will be summarily rejected.
        8. Information and documents submitted are subject to scrutiny and relevant validation, including a visit to the unit where the scheme requires it.
        9. Mere submission of application for this activity does not warrant award of any financial support.
        10. If at any stage it is found that the documents submitted have been obtained fraudulently, the Ministry of MSME reserves the right to withdraw or recall its decision and seek refund of financial support provided. The Ministry will also be within its rights to initiate legal proceedings for any such cases.
        """;

    /// <summary>The Technology Upgradation instructions.</summary>
    public const string TuInstructions = """
        1. After agreeing to the disclaimer and reading these instructions, the applicant will follow the directions given hereon and submit relevant information and documents as asked.
        2. Please keep the scanned images/PDF of the following ready, for each technology purchased:
           a. A picture of the purchased technology installed at the unit.
           b. Invoice/Bill of the manufacturer or supplier.
           c. Certificate from the Chartered Accountant (CA) regarding payment of the amount by the MSME (optional).
        3. Keep a copy of a cancelled cheque of the account in which the reimbursement is to be received.
        4. Ensure to input correct dates, amount, invoice numbers and other details, else the application will be rejected if the information is not matched with the uploaded document(s).
        5. In case your application is rejected, you may apply again through your dashboard.
        6. You shall be notified in due course of time regarding the outcome of your application.
        """;
}
