namespace Zed.Portal.Features.Incentives;

/// <summary>
/// "Start from Financial Assistance" / "Start from Technology Upgradation" (2026-11-20, approved): today's two forms as scheme
/// definitions, field for field (MsmeFinancialAssistanceController, MsmeTechnologyUpgradationController): the Admin starts a
/// scheme from one and adjusts it. <see cref="DirectTu"/> is the scheme the Technology Upgradation card opens when the
/// consultant's recommendation is not required (dbo.Incentives.RecommendationRequired = 0).
/// </summary>
public static class SchemeTemplates
{
    public const string DirectTuCode = "TU_DIRECT";

    private static readonly IReadOnlyList<string> PaymentModes = ["Offline", "Online"];

    private static FormField Doc(string key, string label, bool required, int files = 1, bool checks = true) =>
        new() { Key = key, Label = label, Type = "document", Required = required, MaxFiles = files, AssessorChecks = checks };

    private static FormField Text(string key, string label, int max, bool required = true, bool checks = false) =>
        new() { Key = key, Label = label, Type = "text", MaxLength = max, Required = required, AssessorChecks = checks };

    public static SchemeDefinition FinancialAssistance(string code = "FA_LIKE") => new()
    {
        Code = code,
        Name = "Financial Assistance",
        Card = new() { Title = "Financial Assistance", Highlight = "75% of Subsidy (Max. Rs. 50,000/-)", Details = "For System Certification or Product Certification or Product Testing", Icon = "rupee" },
        Activation = new() { Mode = SchemeRules.Levels, Levels = ["Bronze", "Silver", "Gold"] },
        Grading = new() { Mode = SchemeRules.ByLevel, Rows = [new("Bronze", 75, 50000), new("Silver", 75, 50000), new("Gold", 75, 50000)] },
        Form = new()
        {
            Sections =
            [
                new()
                {
                    Key = "certificate", Title = "Certification details",
                    Fields =
                    [
                        new() { Key = "category", Label = "Category of Certificate", Type = "choice", Options = ["System/Quality", "Product", "Testing"], AssessorChecks = true },
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
                        Text("invoice_no", "Invoice/Bill No.", 50, checks: true),
                        new() { Key = "invoice_date", Label = "Invoice/Bill Date", Type = "date", DateMin = "date:1990-01-01", DateMax = "today", AssessorChecks = true },
                        new() { Key = "amount_paid", Label = "Amount Paid", Type = "amount", Min = 1, Max = SchemeRules.AmountCeiling, IsClaim = true, AssessorChecks = true },
                        new() { Key = "payment_mode", Label = "Mode of Payment", Type = "choice", Options = PaymentModes },
                        Doc("ca_certificate", "CA certificate of expenditure", false),
                        Doc("invoice_copy", "Copy of Invoice", true),
                    ],
                },
            ],
            Rules = [new("AtLeast", 2, ["ca_certificate", "invoice_copy"], "Please upload the invoice copy and the CA certificate of expenditure (at least 2 files).")],
        },
    };

    public static SchemeDefinition TechnologyUpgradation(string code = DirectTuCode) => new()
    {
        Code = code,
        Name = "Technology Upgradation (direct)",
        Card = new() { Title = "Technology Upgradation", Highlight = "Support of upto Rs. 3,00,000/-", Details = "for moving towards Zero Effect Solutions", Icon = "zap" },
        Activation = new() { Mode = SchemeRules.Levels, Levels = ["Bronze", "Silver", "Gold"] },
        // The user (2026-11-20): without the consultant's recommendation the share is set by enterprise size, with a cap.
        Grading = new() { Mode = SchemeRules.BySize, Rows = [new("Micro", 80, 300000), new("Small", 60, 300000), new("Medium", 50, 300000)] },
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
                        new() { Key = "amount_paid", Label = "Amount Paid", Type = "amount", Min = 1, Max = SchemeRules.AmountCeiling, IsClaim = true, AssessorChecks = true },
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
}
