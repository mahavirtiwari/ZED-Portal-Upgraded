using Zed.Core.Http;

namespace Zed.Core.Forms;

/// <summary>Field types of the apps' configurable forms (docs/mobile/APP-FORMS.md).</summary>
public static class AppFieldTypes
{
    public const string Text = "text", Number = "number", Decimal = "decimal", Date = "date", YesNo = "yesno", Dropdown = "dropdown",
        MultiSelect = "multiselect", Checkboxes = "checkboxes", Photo = "photo", Rows = "rows";

    /// <summary>Types an Admin can give a field of their own.</summary>
    public static readonly IReadOnlyList<string> Custom = [Text, Number, Decimal, Date, YesNo, Dropdown, MultiSelect, Checkboxes];

    /// <summary>Types whose answer is picked from <see cref="AppFormFieldSpec.Options"/>.</summary>
    public static readonly IReadOnlyList<string> Choice = [Dropdown, MultiSelect, Checkboxes];

    /// <summary>Types with several answers.</summary>
    public static readonly IReadOnlyList<string> Multiple = [MultiSelect, Checkboxes];

    public static bool IsChoice(string? type) => type is not null && Choice.Contains(type);
}

/// <summary>A field shown only when another field (or, for <c>rows/column</c>, any row's column) has the given answer.</summary>
public sealed record AppFieldCondition(string Field, string EqualsValue);

/// <summary>
/// A standard field of a form, as the app builds it. <paramref name="Key"/> is stable: for a standard field it is the
/// property path inside the request's <c>basicInformation</c> object where the app sends the answer.
/// </summary>
public sealed record AppFormFieldSpec(string Key, string Label, string Type, bool Required, string Section, int Order)
{
    public string? Help { get; init; }
    /// <summary>Sub-heading the app shows above the field (e.g. "Emissions").</summary>
    public string? Heading { get; init; }
    public IReadOnlyList<string>? Options { get; init; }
    /// <summary>The app's own list of options (<c>countries</c>: assets/countries.json).</summary>
    public string? OptionsSource { get; init; }
    /// <summary>Several answers sent in one text property, joined with this separator.</summary>
    public string? Separator { get; init; }
    /// <summary>Photos: most photos; rows: most rows.</summary>
    public int? MaxItems { get; init; }
    public int? MaxLength { get; init; }
    public decimal? Min { get; init; }
    public decimal? Max { get; init; }
    public AppFieldCondition? When { get; init; }
    /// <summary>Rows: the fields of one row (keys are relative to the row).</summary>
    public IReadOnlyList<AppFormFieldSpec>? Columns { get; init; }
    /// <summary>Systems where the field exists; null: every system of the form.</summary>
    public IReadOnlyList<PortalSystem>? Systems { get; init; }
}

public sealed record AppFormSection(string Key, string Label);

/// <summary>A configurable form of an app. <paramref name="Numbered"/>: the app numbers the top-level fields (1, 2, ...).</summary>
public sealed record AppFormSpec(string Key, string Name, string App, IReadOnlyList<PortalSystem> Systems, bool Numbered,
    IReadOnlyList<AppFormSection> Sections, IReadOnlyList<AppFormFieldSpec> Fields);

/// <summary>
/// The apps' "Basic Information" forms with their standard fields, as the legacy apps build them (Admin → App Forms changes
/// them per system: dbo.V4AppFormFields, migration 0017). The submit endpoints still read the standard fields from their
/// legacy request properties; fields the Admin adds are sent in <c>customFields</c>.
/// </summary>
public static class AppFormCatalogue
{
    public const string MsmeBasicInfo = "msme.basicInfo";
    public const string AssessorBasicInfo = "assessor.basicInfo";
    public const string ConsultantBasicInfo = "consultant.basicInfo";

    /// <summary>Separator of a column key: <c>productDetailsList/productName</c>.</summary>
    public const char ColumnSeparator = '/';

    private const string Basic = "basic";
    private static readonly string[] CapacityUnits = ["Metric Ton", "Litre", "Meter", "Number"];
    private static readonly string[] EnergySources = ["Electricity", "Petrol", "Diesel", "Coal", "Solar", "Wood", "Natural Gas", "Other"];

    public static readonly IReadOnlyList<AppFormSpec> All =
    [
        // ZED MSME app (BasicInformationActivity) and its Bronze surveillance build, where the desktop assessor fills it in for the unit.
        new(MsmeBasicInfo, "Basic Information", "MSME app / Bronze surveillance app", [PortalSystem.Main, PortalSystem.Surveillance], false,
            [new(Basic, "Basic Information")],
            [
                new("assessorSelfie", "Assessor Selfie", AppFieldTypes.Photo, true, Basic, 10) { MaxItems = 1, Systems = [PortalSystem.Surveillance] },
                new("siteExteriorPhotos", "Site Exterior Photos (max. 2 photos)", AppFieldTypes.Photo, true, Basic, 20) { MaxItems = 2 },
                .. UnitQuestions(30),
            ]),
        // Site assessment app (ZED_SA_Studio): the same questions without the photos, numbered 1-10.
        new(AssessorBasicInfo, "Basic Information", "Site assessment app", [PortalSystem.Main, PortalSystem.Surveillance], true,
            [new(Basic, "Basic Information")],
            [.. UnitQuestions(10, productDescriptionPhoto: "Product Description Photo")]),
        // Handholding consultant app (ZEDConsultant): the unit's baseline figures in nine groups.
        new(ConsultantBasicInfo, "Basic Information", "Handholding consultant app", [PortalSystem.Consultancy], false,
            [
                new("occupationalSafety", "Occupational (Workplace) Safety"),
                new("measurementOfTimelyDelivery", "Measurement of Timely Delivery"),
                new("plannedMaintenanceCalibration", "Planned Maintenance & Calibration"),
                new("energyManagement", "Energy Management"),
                new("environmentManagement", "Environment Management"),
                new("humanResourceManagement", "Human Resource Management"),
                new("measurementAnalysis", "Measurement & Analysis"),
                new("naturalResourcesManagement", "Natural Resources Management"),
                new("financialPerformance", "Financial Performance (Previous Financial Year)"),
            ],
            [.. ConsultantFields()]),
    ];

    /// <summary>The forms served by a system's hosts.</summary>
    public static IEnumerable<AppFormSpec> For(PortalSystem system) => All.Where(f => f.Systems.Contains(system));

    public static AppFormSpec? Find(PortalSystem system, string? key) =>
        For(system).FirstOrDefault(f => string.Equals(f.Key, key?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>The form's standard fields on a system (a field limited to other systems is left out).</summary>
    public static IEnumerable<AppFormFieldSpec> FieldsOn(AppFormSpec form, PortalSystem system) =>
        form.Fields.Where(f => f.Systems is null || f.Systems.Contains(system));

    private static IEnumerable<AppFormFieldSpec> UnitQuestions(int first, string productDescriptionPhoto = "Product Label/Description Photo")
    {
        var o = first;
        yield return new("auditsConducted", "Whether 3rd Party Financial Audits are conducted?", AppFieldTypes.YesNo, true, Basic, o);
        yield return new("productDetailsList", "Products", AppFieldTypes.Rows, true, Basic, o += 10)
        {
            Columns =
            [
                new("productName", "Name of Product manufactured", AppFieldTypes.Text, true, Basic, 10),
                new("exported", "Whether Exported?", AppFieldTypes.YesNo, true, Basic, 20),
                new("productPhoto", "Product Photo", AppFieldTypes.Photo, true, Basic, 30) { MaxItems = 1 },
                new("productDescriptionPhoto", productDescriptionPhoto, AppFieldTypes.Photo, true, Basic, 40) { MaxItems = 1 },
            ],
        };
        yield return new("domesticCustomers", "Key Domestic Customers", AppFieldTypes.Text, true, Basic, o += 10);
        yield return new("internationalCustomers", "Key International Customers", AppFieldTypes.Text, true, Basic, o += 10)
        {
            Help = "Asked when a product is exported.",
            When = new("productDetailsList" + ColumnSeparator + "exported", "Yes"),
        };
        yield return new("rawMaterialImported", "Whether Raw Material is imported?", AppFieldTypes.YesNo, true, Basic, o += 10);
        yield return new("rawMaterialsList", "Raw Materials", AppFieldTypes.Rows, true, Basic, o += 10)
        {
            When = new("rawMaterialImported", "Yes"),
            Columns =
            [
                new("rawMaterialName", "Name of Raw Material", AppFieldTypes.Text, true, Basic, 10),
                new("rawMaterialPercentage", "% of raw material imported", AppFieldTypes.Number, true, Basic, 20) { Min = 0, Max = 100 },
                new("countryName", "Name of Country", AppFieldTypes.MultiSelect, true, Basic, 30) { OptionsSource = "countries", Separator = ", " },
            ],
        };
        yield return new("monthlyManufacturingCapacityUnits", "What is the unit monthly manufacturing capacity? (unit)", AppFieldTypes.Dropdown, true, Basic, o += 10)
            { Options = CapacityUnits };
        yield return new("monthlyManufacturingCapacityValue", "Monthly manufacturing capacity (value)", AppFieldTypes.Number, true, Basic, o += 10)
            { MaxLength = 20 };
        yield return new("monthlyUtilizationUnits", "What is the monthly utilization of the capacity against the manufacturing capacity? (unit)",
            AppFieldTypes.Dropdown, true, Basic, o += 10) { Options = CapacityUnits };
        yield return new("monthlyUtilizationValue", "Monthly utilization (value)", AppFieldTypes.Number, true, Basic, o += 10) { MaxLength = 20 };
        yield return new("outsourcedProcesses", "Processes Outsourced, if any", AppFieldTypes.Text, false, Basic, o += 10);
        yield return new("energySources", "Energy Source(s) used", AppFieldTypes.Checkboxes, true, Basic, o + 10) { Options = EnergySources };
    }

    private static IEnumerable<AppFormFieldSpec> ConsultantFields()
    {
        const string Measures = "Measures Taken (New technologies, new machines, new processes etc.)";
        static IEnumerable<AppFormFieldSpec> Group(string section, params (string Key, string Label, string Type, string? Heading)[] fields) =>
            fields.Select((f, i) => new AppFormFieldSpec($"{section}.{f.Key}", f.Label, f.Type, true, section, (i + 1) * 10) { Heading = f.Heading });
        const string N = AppFieldTypes.Number, D = AppFieldTypes.Decimal, T = AppFieldTypes.Text;

        return
        [
            .. Group("occupationalSafety",
                ("numOfAccidents", "No. of accidents (incl. fatalities & disabilities caused, if any)", N, null),
                ("numOfNearMisses", "No. of near misses", N, null),
                ("manHoursLast", "Man hours lost", N, null),
                ("lostTimeInjuryFrequencyRate", "Lost Time Injury Frequency Rate (LTIFR)", N, null)),
            .. Group("measurementOfTimelyDelivery",
                ("numOfDeliveries", "Number of Deliveries", N, null),
                ("numOfDeliveriesOnTimeInFull", "Number of Deliveries made On Time In Full (OTIF) per month", N, null)),
            .. Group("plannedMaintenanceCalibration",
                ("meanTimeToRepair", "Mean Time To Repair (MTTR)", N, null),
                ("meanTimeBetweenFailure", "Mean Time Between Failure (MTBF)", N, null)),
            .. Group("energyManagement",
                ("electrical.unit", "Electrical: Unit", T, "A. Electrical"),
                ("electrical.totalConsumptionPercentage", "Electrical: % of total consumption", D, null),
                ("solar.unit", "Solar: Unit", T, "B. Solar"), ("solar.totalConsumptionPercentage", "Solar: % of total consumption", D, null),
                ("wind.unit", "Wind: Unit", T, "C. Wind"), ("wind.totalConsumptionPercentage", "Wind: % of total consumption", D, null),
                ("fossilFuel.unit", "Fossil Fuel: Unit", T, "D. Fossil Fuel"),
                ("fossilFuel.totalConsumptionPercentage", "Fossil Fuel: % of total consumption", D, null),
                ("gas.unit", "Gas: Unit", T, "E. Gas"), ("gas.totalConsumptionPercentage", "Gas: % of total consumption", D, null),
                ("others.unit", "Others: Unit", T, "F. Others"), ("others.totalConsumptionPercentage", "Others: % of total consumption", D, null),
                ("totalCost", "Total Cost", N, null),
                ("measuresTaken", Measures, T, null)),
            .. Group("environmentManagement",
                ("cox", "COx (please mention unit)", N, "Emissions"), ("nox", "NOx (please mention unit)", N, null),
                ("sox", "SOx (please mention unit)", N, null), ("suspendedParticulateMaterial", "Suspended Particulate Material (SPM)", N, null),
                ("totalSuspendedSolid", "Total Suspended Solid (TSS)", N, "Effluents"), ("biochemicalOxygenDemand", "Biochemical Oxygen Demand (BOD)", N, null),
                ("solidWaste", "Solid Waste (Kg/Month)", N, "Solid Waste & Hazardous Waste"), ("plasticWaste", "Plastic Waste (Kg/Month)", N, null),
                ("eWaste", "e-Waste (Kg/Month)", N, null), ("hazardousWaste", "Hazardous Waste (Kg/Month)", N, null),
                ("noiseLevel", "Noise Level (dB)", N, "Noise Level"), ("measuresTaken", Measures, T, null)),
            .. Group("humanResourceManagement",
                ("employeesEngagedInActivities", "% of employees engaged in improvement activities", N, null),
                ("noOfSuggestions", "No. of suggestions received", N, null),
                ("measuresTaken", "Measures Taken to develop human resources", T, null)),
            .. Group("measurementAnalysis",
                ("defects", "Defects (%)", D, null), ("rework", "Rework (%)", D, null), ("customerRejections", "Customer Rejections (%)", D, null),
                ("numberOfCustomerComplaints", "Number of Customer Complaints", N, null),
                ("numberOfComplaintsResolved", "Customer Complaints resolved (%)", D, null),
                ("customerSatisfactionLevel", "Customer Satisfaction level (%)", D, null),
                ("costOfPoorQuality", "Cost of Poor Quality (COPQ)", N, null)),
            .. Group("naturalResourcesManagement",
                ("water", "Water (Litres)", N, "Consumption of natural resources"), ("minerals", "Minerals (Coal) (Kg)", N, null),
                ("wood", "Wood (Kg)", N, null), ("others", "Others", N, null),
                ("waterRecycling", "Water recycling (Litres)", N, "Conservation"), ("waterReuse", "Water reuse (Litres)", N, null),
                ("rainWaterHarvesting", "Rain water harvesting (Litres)", N, null), ("noOfTreePlanted", "No. of Tree planted", N, null),
                ("measuresTaken", Measures, T, null)),
            .. Group("financialPerformance",
                ("turnover", "Turnover (Rupees in Lakhs)", N, null),
                ("grossProfit", "Gross Profit (Rupees in Lakhs)", N, null)),
        ];
    }
}
