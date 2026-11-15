using System.Globalization;
using Zed.Core.Data;

namespace Zed.Portal.Features.Documents;

/// <summary>
/// The result sets of SP_REPORT_GET_DETAILS read once into plain records, shared by the PDF writers
/// (<see cref="AssessmentReport"/>, <see cref="MilestoneReport"/>) and the report page (<see cref="ReportPages"/>), so the two
/// show the same rows, the same photos and the same texts. Photos are kept as their candidate addresses (the procedure's
/// URL, the relative path the old page built, and its <c>this.src="..."</c> fallback): <see cref="ReportPhotos"/> picks the
/// first that exists in the record's own folder.
/// </summary>
public sealed record ReportPhotoRef(IReadOnlyList<string> Candidates, string Caption = "");

public sealed record ReportRawMaterial(string Name, string Percentage, string Country);

public sealed record ReportProduct(
    string Name, string Exported, IReadOnlyList<string> Photo, IReadOnlyList<string> Description, bool DescriptionIsPdf,
    string Verified, string Remarks);

public sealed record ReportOption(string Code, string Name, IReadOnlyList<string> SubOptions);

/// <param name="Id">MsmeRequirements.Id (the checkpoint answers are keyed by it); 0 when the procedure did not give it.</param>
public sealed record ReportRequirement(long Id, string SectionCode, string RequirementCode, string Name, string Conformance, string Remarks,
    IReadOnlyList<ReportOption> Options, IDictionary<string, object?> Row);

public sealed record ReportSection(string Code, string Name, bool Exempted, string Ofi, IReadOnlyList<ReportRequirement> Requirements);

public sealed record ReportNcRound(int Round, IReadOnlyList<ReportProduct> Products, IReadOnlyList<ReportSection> Sections);

/// <summary>The unit row of the report (result set 0).</summary>
public sealed record ReportUnit(IDictionary<string, object?> Row)
{
    public string ZedId => Row.Text("ZedId");
    public string Level => Row.Text("Certification");
    public string Name => Row.Text("PUnitName");
    public string Place => $"{Row.Text("PDistrictName")}, {Row.Text("PStateName")}";
    public bool Rejected => Row.Text("CertificationStatus") == DocumentLevels.Rejected.ToString(CultureInfo.InvariantCulture);
    public string Text(string column) => Row.Text(column);
}

/// <summary>The assessment (and surveillance) report data; result sets as documented on <see cref="AssessmentReport"/>.</summary>
public sealed record AssessmentReportData(
    ReportUnit Unit, bool Surveillance, string Latitude, string Longitude, string DateLabel,
    IReadOnlyList<ReportPhotoRef> SitePhotos, IReadOnlyList<ReportProduct> Products, IReadOnlyList<ReportRawMaterial> RawMaterials,
    IReadOnlyList<ReportSection> Sections, IReadOnlyList<ReportNcRound> NcRounds)
{
    public const int MaxNcRounds = 5;

    public bool Bronze => Unit.Level == "Bronze";

    /// <summary>Opportunities for Improvement are a row of each section of a main Silver/Gold report.</summary>
    public bool Ofi => !Bronze && !Surveillance;

    public static AssessmentReportData Parse(ResultSets sets, bool surveillance)
    {
        var row = sets[0].FirstOrDefault() ?? throw new DocumentNotAvailableException("No report data.");
        var unit = new ReportUnit(row);
        var level = unit.Level;
        var bronze = level == "Bronze";
        var location = sets[9].FirstOrDefault();
        var app = surveillance ? "surveillancemobileapi" : "mobileapi";
        var photoBase = row.Text("PhotosPath").Length > 0 ? $"{app}/CertifiedPhotos" : $"{app}/Photos";

        var exterior = sets[8].Select(p => new ReportPhotoRef(bronze
                ? [$"{photoBase}/{p.Text("ZedId")}/{p.Text("Certification")}/SiteExteriorPhotos/{p.Text("PhotoId")}.{p.Text("PhotoExtension")}", p.Text("OldPath")]
                : [p.Text("Photo"), p.Text("OldPath")], "Site Exterior Picture"))
            .ToList();

        var rounds = new List<ReportNcRound>();
        for (var n = 1; n <= MaxNcRounds; n++)
        {
            var b = 10 + 7 * (n - 1);
            if (sets[b].Count == 0 && sets[b + 1].Count == 0) continue;
            rounds.Add(new ReportNcRound(n, ReadProducts(sets[b], bronze, photoBase, app, ncRound: true),
                ReadSections(sets[b + 1], sets[b + 2], sets[b + 3], sets[b + 4], exemptions: false)));
        }

        return new AssessmentReportData(unit, surveillance, location?.Text("Latitude") ?? "", location?.Text("Longitude") ?? "",
            DateLabelOf(row, bronze, unit.Rejected, surveillance), exterior,
            ReadProducts(sets[1], bronze, photoBase, app, ncRound: false),
            sets[2].Select(r => new ReportRawMaterial(r.Text("RawMaterialName"), r.Text("Percentage"), r.Text("CountryName"))).ToList(),
            ReadSections(sets[3], sets[4], sets[5], sets[6], exemptions: true), rounds);
    }

    /// <summary>Last row of the summary table (and the page's date row).</summary>
    private static string DateLabelOf(IDictionary<string, object?> unit, bool bronze, bool rejected, bool surveillance) =>
        !surveillance ? (rejected ? "Rejected Date" : "Certification Date")
        : bronze ? (rejected ? "SURVEILLANCE REJECTED ON" : "Surveillance Completed on")
        : rejected ? "SURVEILLANCE 1 REJECTED ON"
        : $"Surveillance {unit.Text("SurveillanceNo")} Completed on".Replace("  ", " ");

    private static List<ReportProduct> ReadProducts(IReadOnlyList<IDictionary<string, object?>> rows, bool bronze, string photoBase, string app, bool ncRound)
    {
        var list = new List<ReportProduct>();
        foreach (var p in rows)
        {
            var store = bronze ? photoBase : $"{app}/SaPhotos";
            var basicInfo = $"{store}/{p.Text("ZedId")}/{p.Text("Certification")}/BasicInfo/";
            string[] Candidates(string file, string old) => bronze || !ncRound ? [basicInfo + file, old] : [file, basicInfo + file];

            var description = p.Text("ProductDescriptionPhoto");
            var pdf = description.Contains(".pdf", StringComparison.OrdinalIgnoreCase);
            var image = !pdf && description.Contains(".jpg", StringComparison.OrdinalIgnoreCase);
            list.Add(new ReportProduct(
                p.Text("ProductName"), p.Text("Exported"),
                Candidates(p.Text("ProductPhoto"), p.Text("OldProductPhoto")),
                image ? Candidates(description, p.Text("OldProductDescPhoto")) : [],
                pdf, p.Text("IsVerified"), p.Text("AssessorRemarks")));
        }
        return list;
    }

    internal static List<ReportSection> ReadSections(
        IReadOnlyList<IDictionary<string, object?>> sections, IReadOnlyList<IDictionary<string, object?>> requirements,
        IReadOnlyList<IDictionary<string, object?>> options, IReadOnlyList<IDictionary<string, object?>> subOptions, bool exemptions)
    {
        var list = new List<ReportSection>();
        foreach (var s in sections)
        {
            var code = s.Text("SectionCode");
            var exempted = exemptions && s.Text("IsAssessmentExcempted") == "Yes";
            var items = exempted ? [] : requirements.Where(r => r.Text("SectionCode") == code).Select(r => Requirement(code, r, options, subOptions)).ToList();
            list.Add(new ReportSection(code, s.Text("SectionName"), exempted, s.Text("OfiComments"), items));
        }
        return list;
    }

    internal static ReportRequirement Requirement(string code, IDictionary<string, object?> r,
        IReadOnlyList<IDictionary<string, object?>> options, IReadOnlyList<IDictionary<string, object?>> subOptions)
    {
        var rc = r.Text("RequirementCode");
        var opts = options.Where(o => o.Text("SectionCode") == code && o.Text("RequirementCode") == rc)
            .Select(o => new ReportOption(o.Text("OptionCode"), o.Text("OptionName"), subOptions
                .Where(so => so.Text("SectionCode") == code && so.Text("RequirementCode") == rc && so.Text("OptionCode") == o.Text("OptionCode"))
                .Select(so => so.Text("SubOptionName")).ToList()))
            .ToList();
        return new ReportRequirement(long.TryParse(r.Text("Id"), NumberStyles.Integer, CultureInfo.InvariantCulture, out var id) ? id : 0,
            code, rc, r.Text("RequirementName"), r.Text("Conformance"), r.Text("AssessorRemarks"), opts, r);
    }
}

/// <summary>A handholding meeting (opening or closing) of a milestone report.</summary>
public sealed record ReportMeeting(string Remark, ReportPhotoRef? Photo, IReadOnlyList<(string Name, string Designation)> Participants);

/// <summary>A requirement's handholding bullets (MsmeRequirementBullets: BaselineDiagnostic, HandholdingActionPlan, TechnologyIntervention).</summary>
public sealed record ReportMilestoneRequirement(ReportRequirement Requirement, string SectionName,
    IReadOnlyList<string> Gaps, IReadOnlyList<string> Plan, IReadOnlyList<string> Technology)
{
    public string Text(string column) => Requirement.Row.Text(column);
}

/// <summary>The handholding milestone report data; result sets as documented on <see cref="MilestoneReport"/>.</summary>
public sealed record MilestoneReportData(
    ReportUnit Unit, string Milestone, string Latitude, string Longitude, IReadOnlyList<ReportPhotoRef> SitePhotos,
    ReportMeeting Opening, ReportMeeting Closing, IReadOnlyList<ReportSection> Sections, IReadOnlyList<ReportMilestoneRequirement> Requirements)
{
    public static MilestoneReportData Parse(ResultSets sets)
    {
        var row = sets[0].FirstOrDefault() ?? throw new DocumentNotAvailableException("No report data.");
        return Parse(sets, row);
    }

    /// <param name="unitRow">The unit row (set 0); for an earlier milestone the procedure gives it only for the current one.</param>
    /// <param name="milestone">The milestone of the other sets, when the unit row is the current milestone's.</param>
    public static MilestoneReportData Parse(ResultSets sets, IDictionary<string, object?> unitRow, string? milestone = null)
    {
        var unit = new ReportUnit(unitRow);
        var zedId = unit.ZedId;
        var location = sets[9].FirstOrDefault();
        var site = sets[8].Select(p => new ReportPhotoRef([p.Text("Photo"), PhotoPath(p, zedId)], p.Text("Name"))).ToList();
        var sections = AssessmentReportData.ReadSections(sets[3], sets[4], sets[5], sets[6], exemptions: false);

        IReadOnlyList<string> List(ReportRequirement r, string type) => sets[16]
            .Where(b => b.Text("ReqType") == type && b.Text("RequirementId") == r.Row.Text("Id"))
            .Select(b => b.Text("BulletPoints")).ToList();
        var requirements = sections.SelectMany(s => s.Requirements.Select(r =>
            new ReportMilestoneRequirement(r, s.Name, List(r, "BaselineDiagnostic"), List(r, "HandholdingActionPlan"), List(r, "TechnologyIntervention"))))
            .ToList();

        return new MilestoneReportData(unit, milestone ?? unitRow.Text("NcCount"), location?.Text("Latitude") ?? "", location?.Text("Longitude") ?? "", site,
            Meeting(sets[10], sets[11], sets[14]), Meeting(sets[12], sets[13], sets[15]), sections, requirements);
    }

    /// <summary>The page built the site photo address from the name and photo id when Photo was empty.</summary>
    private static string PhotoPath(IDictionary<string, object?> p, string zedId) =>
        $"consultancymobileapi/SaPhotos/{zedId}/{p.Text("Certification")}/{p.Text("Name")}_{p.Text("PhotoId")}.jpg";

    private static ReportMeeting Meeting(IReadOnlyList<IDictionary<string, object?>> meetings, IReadOnlyList<IDictionary<string, object?>> participants,
        IReadOnlyList<IDictionary<string, object?>> photos) =>
        new(meetings.FirstOrDefault()?.Text("Comments") ?? "",
            photos.FirstOrDefault() is { } p ? new ReportPhotoRef([p.Text("PhotoPath"), p.Text("Photo")]) : null,
            participants.Select(x => (x.Text("ParticipantName"), x.Text("Designation"))).ToList());
}
