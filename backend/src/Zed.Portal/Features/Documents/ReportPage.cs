using System.Data.Common;
using System.Globalization;
using Microsoft.Extensions.Options;
using QRCoder;
using SkiaSharp;
using Zed.Core.Assessment;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Staff.Assessment;

namespace Zed.Portal.Features.Documents;

// ====================================================================== page model (JSON)

/// <summary>
/// A ZED report as page data (2026-11-15, docs/designs/reports-html.html): the assessment report, the surveillance report and
/// the handholding milestone report, built from the live data each time they are opened, as the pledge certificate page is.
/// The portal draws it as A4 sheets with Print and Download PDF (the browser's print to PDF); nothing is stored on the server.
/// Only what the procedures give is shown: a row without data is left out. <see cref="StoredPdf"/>: an earlier handholding
/// milestone whose report was stored as a PDF when it was completed; the page then only links to that file.
/// </summary>
public sealed record ReportPageView(
    string Kind, string Title, string ZedId, string RecordId, string Level, string LevelName, string? Badge,
    bool Draft, bool Rejected, string Footer, string FileName,
    ReportPageUnit? Unit, ReportPageResult? Result, IReadOnlyList<ReportPageFact> Facts, IReadOnlyList<ReportPageRow> Journey,
    IReadOnlyList<ReportPageSectionResult> SectionResults, IReadOnlyList<ReportPagePhoto> SitePhotos, IReadOnlyList<ReportPageProduct> Products,
    IReadOnlyList<ReportPageRow> UnitInfo, IReadOnlyList<ReportRawMaterial> RawMaterials, IReadOnlyList<ReportPageSection> Findings,
    IReadOnlyList<ReportPageNcRound> NcRounds, bool NcClosed, ReportPageMilestone? Milestone, IReadOnlyList<string> WayForward,
    IReadOnlyList<string> Disclaimer, ReportPageVerify? Verify, string? StoredPdf, ReportPageRow? Dated = null)
{
    /// <summary>An earlier milestone's stored PDF (the page shows a note and opens the file).</summary>
    public static ReportPageView Stored(string zedId, string level, int milestone, string pdfUrl) =>
        new(ReportLinks.Milestone, "Handholding Report", AssessmentInput.BaseZedId(zedId), zedId, level, LevelRegistry.NameOf(level), null,
            false, false, "", "", null, null, [], [], [], [], [], [], [], [], [], false,
            new ReportPageMilestone(milestone, "", level, "", "", [], [], [], null, []), [], [], null, pdfUrl);
}

public sealed record ReportPageUnit(string Name, string Place, string Udyam, string EnterpriseType, string Nic, string Address,
    string Latitude, string Longitude, string? MapImage);

/// <summary>The result banner: <c>Tone</c> ok (certified / completed), rej (rejected), draft, info (handholding).</summary>
public sealed record ReportPageResult(string Tone, string Heading, string Detail);

/// <summary>A key-fact tile: <c>Tone</c> "", g (green), r (red), a (amber).</summary>
public sealed record ReportPageFact(string Value, string Label, string Tone = "");

public sealed record ReportPageRow(string Label, string Value);

public sealed record ReportPageSectionResult(string Code, string Name, int Conformed, int Total, bool Exempted);

public sealed record ReportPagePhoto(string Url, string Caption);

public sealed record ReportPageProduct(string Name, string Exported, string? Photo, string? DescriptionPhoto, string? DescriptionNote,
    string Verified, string Tone, string Remarks);

/// <summary>A finding: <c>Tone</c> y (conforms), n (NC raised), p (partial), x (exempted / not recorded).</summary>
public sealed record ReportPageRequirement(string Code, string Name, string Result, string Tone, string Remarks, IReadOnlyList<ReportPageCheckpoint> Checkpoints);

/// <summary>A checkpoint (option) of a requirement, with the assessor's Yes / Partial / No where it was answered (V4).</summary>
public sealed record ReportPageCheckpoint(string Code, string Text, IReadOnlyList<string> SubOptions, string? Answer);

public sealed record ReportPageSection(string Code, string Name, bool Exempted, string? Ofi, IReadOnlyList<ReportPageRequirement> Requirements);

public sealed record ReportPageNcItem(string Code, string Requirement, string Remarks, string Status, string Tone);

public sealed record ReportPageNcRound(int Round, IReadOnlyList<ReportPageProduct> Products, IReadOnlyList<ReportPageNcItem> Items);

public sealed record ReportPageStep(int Number, string Name, string Status, string Tone, string Date);

public sealed record ReportPageGap(string Code, string Requirement, string Conformance, IReadOnlyList<string> Gaps, IReadOnlyList<string> Plan,
    string Days, IReadOnlyList<string> Technology, string Rationale);

public sealed record ReportPageProgressItem(string Code, string Requirement, string Completed, string Tone, string Remarks, string Date);

public sealed record ReportPageProgress(int Completed, int Total, IReadOnlyList<ReportPageProgressItem> Items);

public sealed record ReportPageMeeting(string Title, string Remark, string? Photo, IReadOnlyList<ReportPageRow> Participants);

public sealed record ReportPageMilestone(int Number, string Existing, string Target, string Consultant, string Dates,
    IReadOnlyList<ReportPageStep> Steps, IReadOnlyList<ReportPageFact> Facts, IReadOnlyList<ReportPageGap> Gaps, ReportPageProgress? Progress,
    IReadOnlyList<ReportPageMeeting> Meetings);

public sealed record ReportPageVerify(string Url, string QrImage);

// ====================================================================== builder

/// <summary>
/// Builds <see cref="ReportPageView"/> from the same procedures and parsing as the PDF (<see cref="AssessmentReportData"/>,
/// <see cref="MilestoneReportData"/>), plus, for a certified record, the certificate's number and QR address
/// (SP_DA/RA_GET_CERTIFICATE_DETAILS, as the certificate) and its expiry and surveillance due date (SP_VERIFY_QR_CODE, as the
/// public verification page), and the V4 checkpoint answers (<see cref="CheckpointAnswers"/>). Photos are addressed by signed
/// tokens (<see cref="ReportLinks"/>) to the record's own folder.
/// </summary>
public sealed class ReportPages(IWebHostEnvironment env, IOptions<PortalOptions> portal, ReportLinks links, ILogger<ReportPages> log)
{
    private readonly DocumentRenderer _renderer = new(env, portal, log);

    private static readonly string[] MilestoneNames = ["BDSR / HAP", "Progress review 1", "Progress review 2"];

    // ------------------------------------------------------------------ assessment and surveillance

    /// <param name="draft">Staff preview before the final submit: no certificate, marked DRAFT.</param>
    public async Task<ReportPageView> AssessmentAsync(ISqlExecutor db, string recordId, string level, bool surveillance, bool draft, CancellationToken ct)
    {
        var sets = await DocumentRenderer.AssessmentSetsAsync(db, recordId, level, ct);
        var data = AssessmentReportData.Parse(sets, surveillance);
        var unit = data.Unit;
        var rejected = unit.Rejected;
        var certified = !draft && !rejected;
        var levelName = LevelRegistry.NameOf(level);
        var settings = await CertificationLevels.FindAsync(db, level, log, ct, fromOtherDatabase: surveillance);
        var validity = settings?.ValidityMonths ?? DocumentLevels.DefaultValidityMonths;

        var certificate = certified ? await CertificateAsync(db, recordId, level, surveillance, ct) : null;
        var certificateNo = certificate is { } c ? c.Row.Text(c.AtDesktop ? "DaCertificateNo" : "SaCertificateNo") : "";
        var verifyUrl = certificate is { } cr ? DocumentRenderer.VerifyUrl(portal.Value.PublicBaseUrl, level, cr.Row.Text("QrCodeSeqNo")) : "";
        // The public verification page's expiry and due date: main's own certificates (the assessment report on main).
        var verified = certified && !surveillance && verifyUrl.Length > 0 ? await VerifyAsync(db, level, verifyUrl, ct) : null;
        var checkpoints = await CheckpointAnswers.LoadAsync(db, recordId, level, null, "dbo", log, ct);

        using var photos = new ReportPhotos(_renderer.Storage.Root, recordId);
        string? Photo(IEnumerable<string> candidates) => photos.Locate(candidates) is { } relative ? links.Photo(recordId, relative) : null;

        // ----- findings (the first assessment) and their results by section
        var findings = data.Sections.Select(s => new ReportPageSection(s.Code, s.Name, s.Exempted, data.Ofi && !s.Exempted ? s.Ofi : null,
            s.Requirements.Select(r => Finding(s.Code, r, Checkpoints(r, checkpoints, level, surveillance))).ToList())).ToList();
        var assessed = data.Sections.Where(s => !s.Exempted).SelectMany(s => s.Requirements).ToList();
        var conformed = assessed.Count(r => Is(r.Conformance, "Yes"));
        var ncs = assessed.Count(r => Is(r.Conformance, "No"));
        var sectionResults = data.Sections.Select(s => new ReportPageSectionResult(s.Code, s.Name,
            s.Requirements.Count(r => Is(r.Conformance, "Yes")), s.Requirements.Count, s.Exempted)).ToList();

        // ----- non-conformance rounds
        var rounds = data.NcRounds.Select(n => new ReportPageNcRound(n.Round,
            n.Products.Select(p => Product(p, Photo)).ToList(),
            n.Sections.SelectMany(s => s.Requirements.Select(r =>
            {
                var (status, tone) = Is(r.Conformance, "Yes") ? ("Closed", "y") : Is(r.Conformance, "No") ? ("Not closed", "n")
                    : r.Conformance.Length > 0 ? (r.Conformance, "x") : ("Pending", "x");
                return new ReportPageNcItem($"{s.Code}.{r.RequirementCode}", RequirementText(r), r.Remarks, status, tone);
            })).ToList())).ToList();
        var lastRound = rounds.LastOrDefault();
        var ncClosed = certified && lastRound is not null && lastRound.Items.Count > 0 && lastRound.Items.All(i => i.Tone == "y");

        // ----- summary
        var date = unit.Text("AssessmentDate");
        var surveillanceNo = DocumentRenderer.SurveillanceRound(unit.Text("SurveillanceNo"));
        var hasRound = unit.Text("SurveillanceNo").Any(char.IsAsciiDigit);
        var result = draft
            ? new ReportPageResult("draft", "DRAFT: not yet final", "A preview for staff before the final submit; it changes with the assessment.")
            : rejected
                ? new ReportPageResult("rej", surveillance ? $"Surveillance rejected: ZED {levelName}" : $"Rejected: ZED {levelName}",
                    Join(" ", data.DateLabel.Length > 0 && date.Length > 0 ? $"{Sentence(data.DateLabel)} {date}" : ""))
                : surveillance
                    ? new ReportPageResult("ok", date.Length > 0 ? $"Surveillance {(hasRound ? surveillanceNo + " " : "")}completed on {date}" : "Surveillance completed",
                        certificateNo.Length > 0 ? $"Certificate {certificateNo}" : "")
                    : new ReportPageResult("ok", $"Certified: ZED {levelName}",
                        Join(" · ", certificateNo.Length > 0 ? $"Certificate {certificateNo}" : "",
                            Value(verified, "DateOfExpiry") is { Length: > 0 } expiry ? $"valid till {expiry}" : "",
                            certificateNo.Length == 0 && date.Length > 0 ? $"Certified on {date}" : ""));

        List<ReportPageFact> facts =
        [
            new(assessed.Count.ToString(CultureInfo.InvariantCulture), surveillance ? "Requirements checked" : "Requirements assessed"),
            new(conformed.ToString(CultureInfo.InvariantCulture), surveillance ? "Still conforming" : "Conformed", "g"),
            new(ncs.ToString(CultureInfo.InvariantCulture), "NCs raised", "r"),
            surveillance && hasRound
                ? new($"Round {surveillanceNo}", "Surveillance", "a")
                : new(rounds.Count.ToString(CultureInfo.InvariantCulture), "NC rounds", "a"),
        ];

        var journey = new List<ReportPageRow>();
        Add(journey, surveillance ? "Desktop verification" : "Desktop assessment",
            unit.Text("DesktopAssessorName") is { Length: > 0 } assessor ? $"Assessor: {assessor}" : "");
        Add(journey, "Assessment agency", certificate?.Row.Text("AssessmentAgency") ?? "");
        if (rounds.Count > 0)
            Add(journey, "Non-conformance rounds", $"{rounds.Count} round{(rounds.Count == 1 ? "" : "s")}{(ncClosed ? ", all closed" : "")}");
        if (!draft && date.Length > 0) Add(journey, Sentence(data.DateLabel), date);
        if (certificateNo.Length > 0) Add(journey, "Certificate number", certificateNo);
        Add(journey, "Next surveillance due", Value(verified, "FirstSurveDueDate") ?? "");

        // ----- unit details
        var unitInfo = new List<ReportPageRow>();
        Add(unitInfo, "3rd party financial audits", unit.Text("AuditsConducted"));
        Add(unitInfo, "Customers", Join(" · ",
            unit.Text("DomesticCustomers") is { Length: > 0 } d ? $"Domestic: {d}" : "",
            unit.Text("InternationalCustomers") is { Length: > 0 } i ? $"International: {i}" : ""));
        Add(unitInfo, "Raw material imported", unit.Text("RawMaterialImported"));
        Add(unitInfo, "Processes outsourced", unit.Text("OutsourcedProcesses"));
        Add(unitInfo, "Energy sources", unit.Text("EnergySources"));

        var mapPath = _renderer.MapPath(surveillance ? "Surveillance/" : "", recordId, level);
        var kind = surveillance ? ReportLinks.Surveillance : ReportLinks.Assessment;
        var title = surveillance ? "Surveillance Assessment Report" : "Assessment Report";

        return new ReportPageView(
            kind, title, AssessmentInput.BaseZedId(unit.ZedId.Length > 0 ? unit.ZedId : recordId), recordId, level, levelName,
            DocumentLevels.IsBuiltIn(level) ? null : await BadgeAsync(db, level, ct), draft, rejected,
            $"{AssessmentInput.BaseZedId(recordId)} / {title.ToUpperInvariant()}", FileName(recordId, level, title),
            UnitOf(unit, data.Latitude, data.Longitude, mapPath is null ? null : links.Map(recordId, mapPath)),
            result, facts, journey, sectionResults,
            data.SitePhotos.Select(p => Photo(p.Candidates) is { } url ? new ReportPagePhoto(url, p.Caption) : null).OfType<ReportPagePhoto>().ToList(),
            data.Products.Select(p => Product(p, Photo)).ToList(),
            unitInfo, data.RawMaterials, findings, rounds, ncClosed, null,
            WayForward(level, levelName, surveillance, draft, rejected, Value(verified, "FirstSurveDueDate")),
            AssessmentReport.Disclaimer(validity),
            certified && verifyUrl.Length > 0 ? new ReportPageVerify(verifyUrl, QrDataUri(verifyUrl)) : null,
            null,
            draft || date.Length == 0 ? null
                : new ReportPageRow(rejected ? "Rejected on" : surveillance ? "Surveillance completed on" : "Certified on", date));
    }

    // ------------------------------------------------------------------ handholding milestone

    /// <param name="record">The unit's MsmeCertifications row (its NcCount is the current milestone).</param>
    /// <param name="draft">Staff preview of the current milestone before the CO's final submit.</param>
    public async Task<ReportPageView> MilestoneAsync(ISqlExecutor db, string zedId, string level, int milestone, CertificationRecord record, bool draft,
        CancellationToken ct)
    {
        var sets = await DocumentRenderer.MilestoneSetsAsync(db, zedId, level, milestone, ct);
        var row = sets[0].FirstOrDefault();
        var own = row is not null;
        if (row is null && milestone < record.Nc)
        {
            // The procedure gives the unit row for the current milestone only; the earlier milestone's own sets are still answered.
            row = (await DocumentRenderer.MilestoneSetsAsync(db, zedId, level, null, ct))[0].FirstOrDefault();
        }
        if (row is null) throw new DocumentNotAvailableException("No report data.");
        var data = MilestoneReportData.Parse(sets, row, milestone.ToString(CultureInfo.InvariantCulture));
        var unit = data.Unit;
        var rejected = own && unit.Rejected;
        var levelName = LevelRegistry.NameOf(level);
        var existing = DocumentLevels.Level(unit.Text("LastestCertification")) is { } latest ? LevelRegistry.NameOf(latest) : unit.Text("LastestCertification");
        var consultant = unit.Text("DesktopAssessorName");
        var dates = own ? MilestoneReport.Dates(unit, data.Milestone).Replace("\n", " · ", StringComparison.Ordinal) : "";

        using var photos = new ReportPhotos(_renderer.Storage.Root, zedId);
        string? Photo(IEnumerable<string> candidates) => photos.Locate(candidates) is { } relative ? links.Photo(zedId, relative) : null;

        // ----- the three milestones
        var status = record.CertificationStatus;
        var steps = Enumerable.Range(1, DocumentLevels.Milestones).Select(n =>
        {
            var (label, tone) = n < milestone || (n == milestone && n < record.Nc) ? ("Done", "y")
                : n > milestone ? (n <= record.Nc ? "Done" : "Later", n <= record.Nc ? "y" : "x")
                : rejected ? ("Rejected", "n")
                : DocumentLevels.IsMilestoneCompleted(status) ? ("Done", "y")
                : status == 15 ? ("Under review", "p")
                : ("In progress", "p");
            return new ReportPageStep(n, $"Milestone {n}: {MilestoneNames[n - 1]}", label, tone, n == milestone ? dates : "");
        }).ToList();

        // ----- milestone 1: gaps and plan; 2 and 3: progress against the plan
        List<ReportPageFact> facts;
        var gaps = new List<ReportPageGap>();
        ReportPageProgress? progress = null;
        if (milestone == 1)
        {
            foreach (var m in data.Requirements)
            {
                if (m.Gaps.Count == 0 && m.Plan.Count == 0 && m.Technology.Count == 0 && m.Text("Intervention").Length == 0) continue;
                gaps.Add(new ReportPageGap($"{m.Requirement.SectionCode}.{m.Requirement.RequirementCode}", RequirementText(m.Requirement),
                    m.Text("SaConformance"), m.Gaps, m.Plan, m.Text("EstimatedTimeInDays"), m.Technology, m.Text("Intervention")));
            }
            var days = data.Requirements.Sum(m => int.TryParse(m.Text("EstimatedTimeInDays").Trim(), NumberStyles.Integer, CultureInfo.InvariantCulture, out var d) && d > 0 ? d : 0);
            facts =
            [
                new(data.Requirements.Count(m => m.Gaps.Count > 0).ToString(CultureInfo.InvariantCulture), "Requirements with gaps", "r"),
                new(data.Requirements.Sum(m => m.Plan.Count).ToString(CultureInfo.InvariantCulture), "Activities planned"),
                new(days.ToString(CultureInfo.InvariantCulture), "Days estimated (total)", "a"),
                new(data.Requirements.Sum(m => m.Technology.Count).ToString(CultureInfo.InvariantCulture), "Technology ideas", "g"),
            ];
        }
        else
        {
            var suffix = milestone == 2 ? "" : "2";
            var items = data.Requirements
                .Where(m => m.Text("IsProposedActivityCompleted" + suffix).Length > 0 || m.Text("ProgressReviewRemarks" + suffix).Length > 0)
                .Select(m =>
                {
                    var done = m.Text("IsProposedActivityCompleted" + suffix);
                    return new ReportPageProgressItem($"{m.Requirement.SectionCode}.{m.Requirement.RequirementCode}", RequirementText(m.Requirement),
                        done, ToneOf(done), m.Text("ProgressReviewRemarks" + suffix), m.Text("ProgressReviewDate" + suffix));
                }).ToList();
            var completed = items.Count(i => i.Tone == "y");
            progress = new ReportPageProgress(completed, items.Count, items);
            facts =
            [
                new(completed.ToString(CultureInfo.InvariantCulture), "Activities completed", "g"),
                new((items.Count - completed).ToString(CultureInfo.InvariantCulture), "Not completed yet", "r"),
                new(items.Count.ToString(CultureInfo.InvariantCulture), "Requirements reviewed"),
                new((data.Opening.Participants.Count + data.Closing.Participants.Count).ToString(CultureInfo.InvariantCulture), "Meeting participants", "a"),
            ];
        }

        ReportPageMeeting Meeting(string title, ReportMeeting m) => new(title, m.Remark, m.Photo is { } p ? Photo(p.Candidates) : null,
            m.Participants.Select(x => new ReportPageRow(x.Name, x.Designation)).ToList());
        var meetings = new List<ReportPageMeeting>();
        if (data.Opening.Remark.Length > 0 || data.Opening.Photo is not null || data.Opening.Participants.Count > 0) meetings.Add(Meeting("Opening meeting", data.Opening));
        if (data.Closing.Remark.Length > 0 || data.Closing.Photo is not null || data.Closing.Participants.Count > 0) meetings.Add(Meeting("Closing meeting", data.Closing));

        var result = draft
            ? new ReportPageResult("draft", "DRAFT: not yet final", "A preview for staff before the Consultant Organisation's final submit.")
            : rejected
                ? new ReportPageResult("rej", "Handholding rejected", own && unit.Text("AssessmentDate") is { Length: > 0 } d ? $"Rejected on {d}" : "")
                : new ReportPageResult("info", existing.Length > 0 ? $"Existing: {existing} · Target: {levelName}" : $"Target: {levelName}",
                    Join(" · ", consultant.Length > 0 ? $"Consultant: {consultant}" : "", dates));

        var title = "Handholding Report";
        var mapPath = _renderer.MapPath("Consultancy/", zedId, level);
        return new ReportPageView(
            ReportLinks.Milestone, title, AssessmentInput.BaseZedId(zedId), zedId, level, levelName, null, draft, rejected,
            $"{AssessmentInput.BaseZedId(zedId)} / HANDHOLDING REPORT · MILESTONE {milestone}",
            FileName(zedId, level, $"Handholding Milestone {milestone} Report"),
            UnitOf(unit, data.Latitude, data.Longitude, mapPath is null ? null : links.Map(zedId, mapPath)),
            result, facts, [], [],
            data.SitePhotos.Select(p => Photo(p.Candidates) is { } url ? new ReportPagePhoto(url, p.Caption) : null).OfType<ReportPagePhoto>().ToList(),
            [], [], [], [], [], false,
            new ReportPageMilestone(milestone, existing, levelName, consultant, dates, steps, facts, gaps, progress, meetings),
            MilestoneWayForward(milestone, levelName, rejected),
            MilestoneReport.Texts.Disclaimer,
            null, null,
            dates.Length > 0 ? new ReportPageRow($"Milestone {milestone}", dates) : null);
    }

    // ------------------------------------------------------------------ helpers

    private static ReportPageUnit UnitOf(ReportUnit unit, string latitude, string longitude, string? map) =>
        new(unit.Name, unit.Place.Trim(' ', ','), unit.Text("UdyogAadharNo"), unit.Text("EnterpriseTypee"), unit.Text("TwoDigitActivity"),
            unit.Text("PlantAddress"), latitude, longitude, map);

    private static ReportPageRequirement Finding(string sectionCode, ReportRequirement r, IReadOnlyList<ReportPageCheckpoint> checkpoints)
    {
        var (label, tone) = Is(r.Conformance, "Yes") ? ("Conforms", "y")
            : Is(r.Conformance, "No") ? ("NC raised", "n")
            : Is(r.Conformance, "Partial") ? ("Partial", "p")
            : r.Conformance.Length > 0 ? (r.Conformance, "x")
            : ("Not recorded", "x");
        return new ReportPageRequirement($"{sectionCode}.{r.RequirementCode}", r.Name, label, tone, r.Remarks, checkpoints);
    }

    /// <summary>The requirement's checkpoints, with the answer of the assessment the report is of (site, else desktop).</summary>
    private static IReadOnlyList<ReportPageCheckpoint> Checkpoints(ReportRequirement r, IReadOnlyList<CheckpointAnswers.Checkpoint> answers, string level, bool surveillance)
    {
        var desktopLevel = surveillance ? LevelRegistry.IsLegacyDesktop(level) : DocumentLevels.IsDesktop(level);
        var own = r.Id > 0 ? answers.Where(a => a.RequirementId == r.Id).ToList() : [];
        return r.Options.Select(o =>
        {
            var a = own.FirstOrDefault(x => x.OptionCode == o.Code.Trim());
            var answer = desktopLevel ? (a?.Desktop ?? a?.Site) : (a?.Site ?? a?.Desktop);
            return new ReportPageCheckpoint(o.Code, o.Name, o.SubOptions, answer?.Value);
        }).ToList();
    }

    private static ReportPageProduct Product(ReportProduct p, Func<IEnumerable<string>, string?> photo) =>
        new(p.Name, p.Exported, photo(p.Photo), p.Description.Count > 0 ? photo(p.Description) : null,
            p.DescriptionIsPdf ? "PDF document (on the ZED portal)" : null, p.Verified, ToneOf(p.Verified), p.Remarks);

    /// <summary>The requirement's own text, else its first checkpoint (old rows without a name).</summary>
    private static string RequirementText(ReportRequirement r) =>
        r.Name.Length > 0 ? r.Name : r.Options.FirstOrDefault()?.Name ?? "";

    private static string ToneOf(string value) =>
        Is(value, "Yes") ? "y" : Is(value, "No") ? "n" : Is(value, "Partial") ? "p" : "x";

    private static bool Is(string value, string expected) => string.Equals(value.Trim(), expected, StringComparison.OrdinalIgnoreCase);

    private static void Add(List<ReportPageRow> rows, string label, string value)
    {
        if (!string.IsNullOrWhiteSpace(value)) rows.Add(new ReportPageRow(label, value.Trim()));
    }

    private static string Join(string separator, params string[] parts) => string.Join(separator, parts.Where(p => !string.IsNullOrWhiteSpace(p)));

    /// <summary>"SURVEILLANCE REJECTED ON" → "Surveillance rejected on" (the PDF's labels as page text).</summary>
    private static string Sentence(string label) =>
        label.Length == 0 || label.Any(char.IsLower) ? label : char.ToUpperInvariant(label[0]) + label[1..].ToLowerInvariant();

    private static string? Value(IDictionary<string, object?>? row, string column) => row?.Text(column).Trim() is { Length: > 0 } v ? v : null;

    private static string FileName(string zedId, string level, string title) =>
        string.Concat($"{AssessmentInput.BaseZedId(zedId)}_{level}_{title}".Select(ch => char.IsLetterOrDigit(ch) ? ch : '_'));

    private static IReadOnlyList<string> WayForward(string level, string levelName, bool surveillance, bool draft, bool rejected, string? surveillanceDue)
    {
        if (draft) return [];
        if (rejected)
            return
            [
                $"You may apply again for the ZED {levelName} level: sign in to the ZED portal and pay the fee that applies.",
                "Use the findings and the assessor's remarks in this report to strengthen the systems and processes of the unit.",
            ];
        var list = new List<string>();
        if (surveillanceDue is { Length: > 0 }) list.Add($"Keep the certificate valid: surveillance is due by {surveillanceDue}.");
        else if (surveillance) list.Add("Keep the certificate valid: complete each surveillance assessment on time.");
        var next = level switch { "Bronze" => "Silver", "Silver" => "Gold", _ => null };
        if (next is not null && !surveillance) list.Add($"Apply for the ZED {next} level when ready; ZED trained consultants can help through handholding.");
        list.Add($"See the incentives you can claim as a ZED {levelName} unit in the ZED MSME app or on the ZED portal.");
        return list;
    }

    private static IReadOnlyList<string> MilestoneWayForward(int milestone, string levelName, bool rejected) => rejected ? [] : milestone switch
    {
        1 => ["Carry out the planned activities with the consultant; progress is reviewed at milestone 2.", $"Aim for the ZED {levelName} level once the gaps are closed."],
        2 => ["Complete the remaining activities before the second progress review (milestone 3).", $"Aim for the ZED {levelName} level once the gaps are closed."],
        _ => [$"Apply for the ZED {levelName} certification when ready.", "See the incentives you can claim in the ZED MSME app or on the ZED portal."],
    };

    private async Task<(IDictionary<string, object?> Row, bool AtDesktop)?> CertificateAsync(ISqlExecutor db, string zedId, string level, bool surveillance,
        CancellationToken ct)
    {
        try
        {
            return await DocumentRenderer.CertificateRowAsync(db, zedId, level, surveillance, ct);
        }
        catch (Exception ex) when (ex is DocumentNotAvailableException or DbException)
        {
            log.LogInformation("Report page of {ZedId} {Level}: no certificate details ({Reason})", zedId, level, ex.GetType().Name);
            return null;
        }
    }

    /// <summary>SP_VERIFY_QR_CODE's row for the certificate's QR code (DateOfExpiry, FirstSurveDueDate), null when not read.</summary>
    private async Task<IDictionary<string, object?>?> VerifyAsync(ISqlExecutor db, string level, string verifyUrl, CancellationToken ct)
    {
        var code = verifyUrl.Split('/', StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? "";
        if (code.Length == 0 || VerifyController.TypeOf(verifyUrl.Split('/')[^2]) is not { } type) return null;
        try
        {
            return (await db.QueryProcMultipleAsync("SP_VERIFY_QR_CODE",
                new { QrCodeNo = AssessmentInput.Ansi(code), CertificationType = AssessmentInput.Ansi(type) }, ct))[0].FirstOrDefault();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Report page: verification details of {Level} not read", level);
            return null;
        }
    }

    private async Task<string?> BadgeAsync(ISqlExecutor db, string level, CancellationToken ct)
    {
        try
        {
            using var badge = await _renderer.BadgeAsync(db, level, ct);
            return PngDataUri(badge, 240);
        }
        catch (Exception ex) when (ex is FileNotFoundException or DbException)
        {
            return null;
        }
    }

    internal static string PngDataUri(SKImage image, int maxPixels)
    {
        var scale = Math.Min(1f, (float)maxPixels / Math.Max(image.Width, image.Height));
        var info = new SKImageInfo(Math.Max(1, (int)(image.Width * scale)), Math.Max(1, (int)(image.Height * scale)));
        using var surface = SKSurface.Create(info);
        surface.Canvas.Clear(SKColors.Transparent);
        surface.Canvas.DrawImage(image, SKRect.Create(info.Width, info.Height), new SKSamplingOptions(SKFilterMode.Linear, SKMipmapMode.Linear));
        using var snapshot = surface.Snapshot();
        using var png = snapshot.Encode(SKEncodedImageFormat.Png, 100);
        return "data:image/png;base64," + Convert.ToBase64String(png.ToArray());
    }

    /// <summary>The QR code as a PNG data URI, drawn on the server as for the pledge certificate page.</summary>
    internal static string QrDataUri(string content)
    {
        using var generator = new QRCodeGenerator();
        using var data = generator.CreateQrCode(content, QRCodeGenerator.ECCLevel.M);
        var png = new PngByteQRCode(data).GetGraphic(6, drawQuietZones: true);
        return "data:image/png;base64," + Convert.ToBase64String(png);
    }
}
