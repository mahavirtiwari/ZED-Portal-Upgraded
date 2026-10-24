using System.Data.Common;
using System.Text.Json;
using Zed.Core.Forms;
using Zed.Core.Http;
using AssessorModels = Zed.Main.MobileApi.Models.Assessor;
using ConsultancyModels = Zed.Main.MobileApi.Models.Consultancy;
using MsmeModels = Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// The Admin's form (Admin → App Forms) at a Basic Information submit: checked before the procedure runs, the answers to
/// the Admin's own fields stored after it succeeded (dbo.V4AppFormValues). Builds that send no <c>formVersion</c> are
/// held to nothing new: only the answers they send are checked and stored (docs/mobile/APP-FORMS.md).
/// </summary>
internal sealed class AppFormSubmission
{
    internal const string FormChanged = "(The form was changed on the server; please refresh it.)";

    private readonly IAppFormStore store;
    private readonly AppFormCheck check;

    private AppFormSubmission(IAppFormStore store, EffectiveAppForm form, AppFormCheck check, string? error)
    {
        this.store = store;
        this.check = check;
        Form = form;
        Error = error;
    }

    public EffectiveAppForm Form { get; }

    /// <summary>The refusal to answer with (status "0"), or null.</summary>
    public string? Error { get; }

    public static async Task<AppFormSubmission> CheckAsync(HttpContext http, string formKey, PortalSystem system,
        IReadOnlyDictionary<string, JsonElement>? customFields, string? formVersion, AppFormAnswers standard, CancellationToken ct)
    {
        var forms = http.RequestServices.GetRequiredService<AppForms>();
        var form = await forms.GetAsync(system, formKey, ct) ?? throw new InvalidOperationException($"{formKey} is not a form of {system}.");
        var strict = !string.IsNullOrWhiteSpace(formVersion);
        var check = AppFormRules.Check(form, customFields, standard, strict);
        var error = check.Error;
        if (error is not null && strict && !string.Equals(formVersion!.Trim(), form.Version, StringComparison.Ordinal)) error += " " + FormChanged;
        return new AppFormSubmission(forms.Store, form, check, error);
    }

    /// <summary>Stores the answers to the Admin's fields; false (logged) when the database refused them.</summary>
    public async Task<bool> SaveAsync(string zedId, string certification, string submittedBy, ILogger log, CancellationToken ct)
    {
        if (check.CustomValues.Count == 0) return true;
        try
        {
            await store.SaveValuesAsync(Form.Spec.Key, zedId, Certification(certification), check.CustomValues, submittedBy, ct);
            return true;
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Could not store the answers to the Admin's fields of {Form} for {ZedId}", Form.Spec.Key, zedId);
            return false;
        }
    }

    /// <summary>A known level in its usual spelling (as the portal reads it back).</summary>
    internal static string Certification(string? value)
    {
        var v = value?.Trim() ?? "";
        return MsmeController.PathCertifications.FirstOrDefault(c => string.Equals(c, v, StringComparison.OrdinalIgnoreCase)) ?? (v.Length <= 50 ? v : v[..50]);
    }

    // ---------- Standard answers of each request ----------

    private static IReadOnlyList<string?> Many(IEnumerable<string?>? values) => values?.ToList() ?? [];

    /// <summary>The MSME app and the Bronze surveillance app (Models.BasicInformation).</summary>
    public static AppFormAnswers Answers(MsmeModels.BasicInformation info)
    {
        var products = (info.productDetailsList ?? []).Where(p => p is not null).ToList();
        var a = UnitAnswers(info.auditsConducted, info.domesticCustomers, info.internationalCustomers, info.rawMaterialImported,
            info.outsourcedProcesses, info.energySources, info.monthlyManufacturingCapacityUnits, info.monthlyManufacturingCapacityValue,
            info.monthlyUtilizationUnits, info.monthlyUtilizationValue,
            products.Select(p => (p.productName, p.exported, p.productPhoto?.photoId, p.productDescriptionPhoto?.photoId)).ToList(),
            (info.rawMaterialsList ?? []).Where(m => m is not null).Select(m => (m.rawMaterialName, m.rawMaterialPercentage, m.countryName)).ToList());
        a["siteExteriorPhotos"] = Many(info.siteExteriorPhotos?.Where(p => p is not null).Select(p => p.photoId ?? p.photo));
        a["assessorSelfie"] = AppFormAnswers.One(info.assessorSelfie is { } s ? s.photoId ?? s.photo : null);
        return a;
    }

    /// <summary>The site assessment app (Models.Assessor.BasicInformation).</summary>
    public static AppFormAnswers Answers(AssessorModels.BasicInformation info) =>
        UnitAnswers(info.auditsConducted, info.domesticCustomers, info.internationalCustomers, info.rawMaterialImported,
            info.outsourcedProcesses, info.energySources, info.monthlyManufacturingCapacityUnits, info.monthlyManufacturingCapacityValue,
            info.monthlyUtilizationUnits, info.monthlyUtilizationValue,
            (info.productDetailsList ?? []).Where(p => p is not null)
                .Select(p => (p.productName, p.exported, p.productPhoto?.photoId, p.productDescriptionPhoto?.photoId)).ToList(),
            (info.rawMaterialsList ?? []).Where(m => m is not null).Select(m => (m.rawMaterialName, m.rawMaterialPercentage, m.countryName)).ToList());

    private static AppFormAnswers UnitAnswers(string? audits, string? domestic, string? international, string? rawImported, string? outsourced,
        IEnumerable<string>? energy, string? capacityUnits, string? capacityValue, string? utilizationUnits, string? utilizationValue,
        IReadOnlyList<(string? Name, string? Exported, string? Photo, string? DescriptionPhoto)> products,
        IReadOnlyList<(string? Name, string? Percentage, string? Country)> rawMaterials)
    {
        const char c = AppFormCatalogue.ColumnSeparator;
        return new AppFormAnswers
        {
            ["auditsConducted"] = AppFormAnswers.One(audits),
            ["domesticCustomers"] = AppFormAnswers.One(domestic),
            ["internationalCustomers"] = AppFormAnswers.One(international),
            ["rawMaterialImported"] = AppFormAnswers.One(rawImported),
            ["outsourcedProcesses"] = AppFormAnswers.One(outsourced),
            ["energySources"] = Many(energy),
            ["monthlyManufacturingCapacityUnits"] = AppFormAnswers.One(capacityUnits),
            ["monthlyManufacturingCapacityValue"] = AppFormAnswers.One(capacityValue),
            ["monthlyUtilizationUnits"] = AppFormAnswers.One(utilizationUnits),
            ["monthlyUtilizationValue"] = AppFormAnswers.One(utilizationValue),
            ["productDetailsList"] = products.Select(_ => (string?)"row").ToList(),
            [$"productDetailsList{c}productName"] = products.Select(p => p.Name).ToList(),
            [$"productDetailsList{c}exported"] = products.Select(p => p.Exported).ToList(),
            [$"productDetailsList{c}productPhoto"] = products.Select(p => p.Photo).ToList(),
            [$"productDetailsList{c}productDescriptionPhoto"] = products.Select(p => p.DescriptionPhoto).ToList(),
            ["rawMaterialsList"] = rawMaterials.Select(_ => (string?)"row").ToList(),
            [$"rawMaterialsList{c}rawMaterialName"] = rawMaterials.Select(m => m.Name).ToList(),
            [$"rawMaterialsList{c}rawMaterialPercentage"] = rawMaterials.Select(m => m.Percentage).ToList(),
            [$"rawMaterialsList{c}countryName"] = rawMaterials.Select(m => m.Country).ToList(),
        };
    }

    /// <summary>The handholding consultant app: every figure under its group path (occupationalSafety.numOfAccidents, ...).</summary>
    public static AppFormAnswers Answers(ConsultancyModels.BasicInfoConsultancy info)
    {
        var a = new AppFormAnswers();
        void Put(string key, string? value) => a[key] = AppFormAnswers.One(value);

        var os = info.occupationalSafety;
        Put("occupationalSafety.numOfAccidents", os?.numOfAccidents);
        Put("occupationalSafety.numOfNearMisses", os?.numOfNearMisses);
        Put("occupationalSafety.manHoursLast", os?.manHoursLast);
        Put("occupationalSafety.lostTimeInjuryFrequencyRate", os?.lostTimeInjuryFrequencyRate);
        var td = info.measurementOfTimelyDelivery;
        Put("measurementOfTimelyDelivery.numOfDeliveries", td?.numOfDeliveries);
        Put("measurementOfTimelyDelivery.numOfDeliveriesOnTimeInFull", td?.numOfDeliveriesOnTimeInFull);
        var pm = info.plannedMaintenanceCalibration;
        Put("plannedMaintenanceCalibration.meanTimeToRepair", pm?.meanTimeToRepair);
        Put("plannedMaintenanceCalibration.meanTimeBetweenFailure", pm?.meanTimeBetweenFailure);
        var em = info.energyManagement;
        foreach (var (name, p) in new[] { ("electrical", em?.electrical), ("solar", em?.solar), ("wind", em?.wind), ("fossilFuel", em?.fossilFuel), ("gas", em?.gas), ("others", em?.others) })
        {
            Put($"energyManagement.{name}.unit", p?.unit);
            Put($"energyManagement.{name}.totalConsumptionPercentage", p?.totalConsumptionPercentage);
        }
        Put("energyManagement.totalCost", em?.totalCost);
        Put("energyManagement.measuresTaken", em?.measuresTaken);
        var env = info.environmentManagement;
        Put("environmentManagement.cox", env?.cox);
        Put("environmentManagement.nox", env?.nox);
        Put("environmentManagement.sox", env?.sox);
        Put("environmentManagement.suspendedParticulateMaterial", env?.suspendedParticulateMaterial);
        Put("environmentManagement.totalSuspendedSolid", env?.totalSuspendedSolid);
        Put("environmentManagement.biochemicalOxygenDemand", env?.biochemicalOxygenDemand);
        Put("environmentManagement.solidWaste", env?.solidWaste);
        Put("environmentManagement.plasticWaste", env?.plasticWaste);
        Put("environmentManagement.eWaste", env?.eWaste);
        Put("environmentManagement.hazardousWaste", env?.hazardousWaste);
        Put("environmentManagement.noiseLevel", env?.noiseLevel);
        Put("environmentManagement.measuresTaken", env?.measuresTaken);
        var hr = info.humanResourceManagement;
        Put("humanResourceManagement.employeesEngagedInActivities", hr?.employeesEngagedInActivities);
        Put("humanResourceManagement.noOfSuggestions", hr?.noOfSuggestions);
        Put("humanResourceManagement.measuresTaken", hr?.measuresTaken);
        var ma = info.measurementAnalysis;
        Put("measurementAnalysis.defects", ma?.defects);
        Put("measurementAnalysis.rework", ma?.rework);
        Put("measurementAnalysis.customerRejections", ma?.customerRejections);
        Put("measurementAnalysis.numberOfCustomerComplaints", ma?.numberOfCustomerComplaints);
        Put("measurementAnalysis.numberOfComplaintsResolved", ma?.numberOfComplaintsResolved);
        Put("measurementAnalysis.customerSatisfactionLevel", ma?.customerSatisfactionLevel);
        Put("measurementAnalysis.costOfPoorQuality", ma?.costOfPoorQuality);
        var nr = info.naturalResourcesManagement;
        Put("naturalResourcesManagement.water", nr?.water);
        Put("naturalResourcesManagement.minerals", nr?.minerals);
        Put("naturalResourcesManagement.wood", nr?.wood);
        Put("naturalResourcesManagement.others", nr?.others);
        Put("naturalResourcesManagement.waterRecycling", nr?.waterRecycling);
        Put("naturalResourcesManagement.waterReuse", nr?.waterReuse);
        Put("naturalResourcesManagement.rainWaterHarvesting", nr?.rainWaterHarvesting);
        Put("naturalResourcesManagement.noOfTreePlanted", nr?.noOfTreePlanted);
        Put("naturalResourcesManagement.measuresTaken", nr?.measuresTaken);
        var fp = info.financialPerformance;
        Put("financialPerformance.turnover", fp?.turnover);
        Put("financialPerformance.grossProfit", fp?.grossProfit);
        return a;
    }

    /// <summary>
    /// The consultancy procedure call reads every group; a group the app left out is accepted (as empty figures, NULL for
    /// the procedure) when none of its shown fields is required.
    /// </summary>
    public void FillOptionalGroups(ConsultancyModels.BasicInfoConsultancy info)
    {
        bool Optional(string prefix) => Form.NothingRequiredUnder(prefix + ".");
        if (info.occupationalSafety is null && Optional("occupationalSafety")) info.occupationalSafety = new();
        if (info.measurementOfTimelyDelivery is null && Optional("measurementOfTimelyDelivery")) info.measurementOfTimelyDelivery = new();
        if (info.plannedMaintenanceCalibration is null && Optional("plannedMaintenanceCalibration")) info.plannedMaintenanceCalibration = new();
        if (info.energyManagement is null && Optional("energyManagement")) info.energyManagement = new();
        if (info.energyManagement is { } em)
        {
            if (em.electrical is null && Optional("energyManagement.electrical")) em.electrical = new();
            if (em.solar is null && Optional("energyManagement.solar")) em.solar = new();
            if (em.wind is null && Optional("energyManagement.wind")) em.wind = new();
            if (em.fossilFuel is null && Optional("energyManagement.fossilFuel")) em.fossilFuel = new();
            if (em.gas is null && Optional("energyManagement.gas")) em.gas = new();
            if (em.others is null && Optional("energyManagement.others")) em.others = new();
        }
        if (info.environmentManagement is null && Optional("environmentManagement")) info.environmentManagement = new();
        if (info.humanResourceManagement is null && Optional("humanResourceManagement")) info.humanResourceManagement = new();
        if (info.measurementAnalysis is null && Optional("measurementAnalysis")) info.measurementAnalysis = new();
        if (info.naturalResourcesManagement is null && Optional("naturalResourcesManagement")) info.naturalResourcesManagement = new();
        if (info.financialPerformance is null && Optional("financialPerformance")) info.financialPerformance = new();
    }
}
