using SkiaSharp;
using Zed.Core.Data;

namespace Zed.Portal.Features.Documents;

/// <summary>
/// The handholding milestone report of ZEDCS_CONSULTANCY, drawn from ZED_CONSULTANT's SP_REPORT_GET_DETAILS
/// (<c>@NcCount</c> = milestone). Port of its live page Frontend/SA/ReportSummary.cshtml (<c>int milestone</c>): cover per
/// milestone (Summary1.jpg, Summary1_m2.jpg, Summary1_m3.jpg), disclaimer, overview with the milestone dates and the
/// location, existing and desired level, basic information photos, opening and closing meeting, findings per
/// requirement with the milestone's own block (1: baseline diagnostic, handholding action plan, technology
/// intervention; 2 and 3: progress review), way forward and the closing page. The page header is the consultancy
/// PdfHeader.jpg ("Handholding through Consultancy Report"), the footer "{ZedId}/ASSESSMENT REPORT" as in its PdfFooter.
/// <para>
/// The SA/Summary1 and Summary2 views that GenerateSaRepory converted are copies of main's report and read result sets
/// (up to 43) that ZED_CONSULTANT's procedure no longer returns; ReportSummary is the layout that matches it.
/// </para>
/// <para>Result sets (Silver/Gold): 0 unit (NcCount, BdsFromDate, HapFromDate, LastestCertification), 1 products,
/// 2 raw materials, 3 sections, 4 requirements (BaselineDate, HActionPlanDate, EstimatedTimeInDays, Intervention,
/// InterventionDate, IsProposedActivityCompleted[2], ProgressReviewRemarks[2], ProgressReviewDate[2]), 5 options,
/// 6 sub-options, 7 evidence photos, 8 site photos, 9 location, 10/11 opening meeting and participants, 12/13 closing
/// meeting and participants, 14/15 opening/closing meeting photos, 16 requirement bullets (ReqType, RequirementId).</para>
/// </summary>
public static class MilestoneReport
{
    public sealed record Assets(SKImage Cover, SKImage Header, SKImage? Existing, SKImage? Desired, SKImage LastPage, SKImage? Map);

    private static readonly SKColor Milestone1 = new(0xF7, 0xF7, 0xF7);
    private static readonly SKColor Milestone2 = new(0xB3, 0xE0, 0x79);
    private static readonly SKColor Milestone3 = new(0x45, 0xA5, 0xAD);

    public static byte[] Render(ResultSets sets, Assets assets, ReportPhotos photos) =>
        Render(sets, MilestoneReportData.Parse(sets), assets, photos);

    /// <summary>The PDF of <paramref name="data"/> (read from <paramref name="sets"/>, whose texts the fonts are subset to).</summary>
    public static byte[] Render(ResultSets sets, MilestoneReportData data, Assets assets, ReportPhotos photos)
    {
        var unit = data.Unit;
        var milestone = data.Milestone;
        var rejected = unit.Rejected;

        var characters = Enumerable.Range(0, sets.Count).SelectMany(i => sets[i]).SelectMany(r => r.Values)
            .OfType<string>().SelectMany(v => v);
        using var pdf = new ReportPdf(unit.ZedId + "/ASSESSMENT REPORT", assets.Header, characters);

        AssessmentReport.Cover(pdf, new AssessmentReport.Assets(assets.Cover, assets.Header, assets.Cover, null, assets.LastPage, null),
            unit.Name, unit.Place, data.Latitude, data.Longitude);

        // ----- disclaimer
        pdf.NewPage();
        pdf.Panel("DISCLAIMER");
        pdf.Paragraph(Texts.DisclaimerIntro, italic: true);
        for (var i = 0; i < Texts.Disclaimer.Length; i++)
            pdf.Paragraph(Texts.Disclaimer[i], 9.5f, indent: 22, bullet: (i + 1) + ".");

        // ----- overview, location and levels
        pdf.NewPage();
        pdf.Panel("OVERVIEW");
        pdf.Table(new TableSpec(1.1f, 2f) { LabelColumn = true, FontSize = 9 }
            .Row(Cell.Of("Unit Name"), Cell.Of(unit.Name))
            .Row(Cell.Of("Udyam Registration Number"), Cell.Of(unit.Text("UdyogAadharNo")))
            .Row(Cell.Of("Enterprise Type"), Cell.Of(unit.Text("EnterpriseTypee")))
            .Row(Cell.Of("NIC Sector (2 Digit)"), Cell.Of(unit.Text("TwoDigitActivity")))
            .Row(Cell.Of("Unit Address"), Cell.Of(unit.Text("PlantAddress")))
            .Row(Cell.Of(rejected ? "Rejected Date" : $"Milestone {milestone} Date"), Cell.Of(Dates(unit, milestone))));
        pdf.Ensure(assets.Map is null ? 60 : 300);
        pdf.Heading("Location", size: 10);
        pdf.Panel($"Latitude: {data.Latitude}; Longitude: {data.Longitude}");
        if (assets.Map is not null) pdf.Image(assets.Map, Math.Min(pdf.ContentWidth, 420));

        if (!rejected)
        {
            pdf.Ensure(240);
            pdf.Panel("CERTIFICATION LEVEL");
            Levels(pdf, assets.Existing, assets.Desired);
        }

        // ----- basic information
        pdf.NewPage();
        pdf.Panel("BASIC INFORMATION");
        pdf.Paragraph(Texts.BasicInformation, 9.5f);
        var site = data.SitePhotos
            .Select(p => (Image: photos.Load([.. p.Candidates]), p.Caption))
            .Where(p => p.Image is not null)
            .Select(p => (p.Image!, p.Caption))
            .ToList();
        pdf.Gallery(site, maxWidth: 240, maxHeight: 260);

        // ----- meetings
        Meeting(pdf, "OPENING MEETING", "Opening Meeting Photo:", data.Opening, photos);
        Meeting(pdf, "CLOSING MEETING", "Closing Meeting Photo:", data.Closing, photos);

        // ----- findings
        pdf.NewPage();
        pdf.Panel("FINDINGS");
        pdf.Paragraph(Texts.Findings, 9.5f);
        foreach (var s in data.Sections)
        {
            pdf.Space(6);
            pdf.Heading($"{s.Code}. {s.Name}");
            foreach (var r in data.Requirements.Where(r => r.Requirement.SectionCode == s.Code))
                Requirement(pdf, milestone, r);
        }

        // ----- way forward and closing page
        pdf.NewPage();
        pdf.Panel("WAY FORWARD");
        foreach (var p in Texts.WayForward) pdf.Paragraph(p, 9.5f);
        pdf.ImagePage(assets.LastPage);
        return pdf.Finish();
    }

    /// <summary>The milestone's dates as the old page wrote them (BDSR and HAP for milestone 1, PR1 / PR2 after).</summary>
    public static string Dates(ReportUnit unit, string milestone) => milestone switch
    {
        "1" => $"BDSR: {unit.Text("BdsFromDate")}\nHAP: {unit.Text("HapFromDate")}",
        "2" => $"PR1: {unit.Text("BdsFromDate")}",
        "3" => $"PR2: {unit.Text("BdsFromDate")}",
        _ => "",
    };

    private static void Levels(ReportPdf pdf, SKImage? existing, SKImage? desired)
    {
        const float badge = 110, labelHeight = 18;
        var top = pdf.Y;
        var half = pdf.ContentWidth / 2;
        var canvas = pdf.Canvas;
        using var font = pdf.Font(11, bold: true);
        using var ink = ReportPdf.Paint(ReportPdf.Ink);
        using var border = new SKPaint { Color = new SKColor(0x2E, 0x7D, 0x32), IsStroke = true, StrokeWidth = 0.8f, IsAntialias = true };
        canvas.DrawRect(SKRect.Create(ReportPdf.Margin, top, pdf.ContentWidth, badge + labelHeight + 24), border);
        foreach (var (title, image, column) in new[] { ("Existing Level", existing, 0), ("Desired Level", desired, 1) })
        {
            var cx = ReportPdf.Margin + half * column + half / 2;
            canvas.DrawText(title, cx, top + 10 + font.Size, SKTextAlign.Center, font, ink);
            if (image is null) continue;
            var (w, h) = ReportPdf.Fit(image, badge, badge);
            canvas.DrawImage(image, SKRect.Create(cx - w / 2, top + 14 + labelHeight, w, h), ReportPdf.Sampling);
        }
        pdf.Space(badge + labelHeight + 34);
    }

    private static void Meeting(ReportPdf pdf, string title, string photoTitle, ReportMeeting meeting, ReportPhotos photos)
    {
        pdf.NewPage();
        pdf.Panel(title);
        var photo = meeting.Photo is { } p ? photos.Load([.. p.Candidates]) : null;
        var photoCell = new List<CellItem> { new CellText(photoTitle, Bold: true) };
        if (photo is not null) photoCell.Add(new CellImage(photo, 260));
        pdf.Table(new TableSpec(3f, 2f) { FontSize = 9 }
            .Row(new Cell([new CellText("CONSULTANT REMARK", Bold: true), new CellText(meeting.Remark)]), new Cell(photoCell)));

        pdf.Heading("PARTICIPANTS", size: 10);
        foreach (var (name, designation) in meeting.Participants)
        {
            pdf.Ensure(30);
            pdf.Paragraph(name, 9.5f, bold: true);
            if (designation.Length > 0) pdf.Paragraph(designation, 9, indent: 12);
        }
    }

    private static void Requirement(ReportPdf pdf, string milestone, ReportMilestoneRequirement m)
    {
        var r = m.Requirement;
        var requirement = new List<CellItem> { new CellText("REQUIREMENT", Bold: true) };
        foreach (var o in r.Options)
        {
            requirement.Add(new CellText(o.Name));
            requirement.AddRange(o.SubOptions.Select(so => new CellText(so, Bullet: "•")));
        }

        var table = new TableSpec(1.15f, 3.6f) { LabelColumn = true, FontSize = 8.5f };
        table.Row(Cell.Of($"{r.SectionCode}.{r.RequirementCode}", center: true), new Cell(requirement));

        static IEnumerable<CellItem> List(IReadOnlyList<string> bullets) => bullets.Select(b => (CellItem)new CellText(b, Bullet: "•"));
        CellText Title(string text, string date) => new(date.Length > 0 ? $"{text}   ({date})" : text, Bold: true);

        switch (milestone)
        {
            case "1":
                table.Row(Cell.Of("Milestone 1 : Basic Diagnostic Study", center: true, fill: Milestone1), new Cell(
                [
                    new CellText($"Conformance: {m.Text("SaConformance")}"),
                    Title("GAPS IDENTIFIED", m.Text("BaselineDate")),
                    .. List(m.Gaps),
                ]));
                table.Row(Cell.Of("Milestone 1 : Handholding Action Plan", center: true, fill: Milestone2), new Cell(
                [
                    Title("PLANNED ACTIVITIES", m.Text("HActionPlanDate")),
                    .. List(m.Plan),
                    Title("ESTIMATED TIME (IN DAYS)", m.Text("HActionPlanDate")),
                    new CellText(m.Text("EstimatedTimeInDays")),
                ]));
                table.Row(Cell.Of("Milestone 1 : Technology Intervention", center: true, fill: Milestone3), new Cell(
                [
                    Title("SUGGESTED TECHNOLOGY INTERVENTION", m.Text("InterventionDate")),
                    .. List(m.Technology),
                    Title("RATIONALE FOR TECHNOLOGY INTERVENTION", m.Text("InterventionDate")),
                    new CellText(m.Text("Intervention")),
                ]));
                break;
            case "2":
            case "3":
                var suffix = milestone == "2" ? "" : "2";
                table.Row(Cell.Of($"Milestone {milestone} : Progress Review {(milestone == "2" ? 1 : 2)}", center: true, fill: Milestone1), new Cell(
                [
                    new CellText($"Is Proposed Activity Completed: {m.Text("IsProposedActivityCompleted" + suffix)}"),
                    Title("REMARKS IF ANY", m.Text("ProgressReviewDate" + suffix)),
                    new CellText(m.Text("ProgressReviewRemarks" + suffix)),
                ]));
                break;
        }
        pdf.Space(4);
        // Keep a requirement and its milestone block together where they fit on a page.
        pdf.Ensure(milestone == "1" ? 220 : 110);
        pdf.Table(table, repeatHeader: false);
    }

    /// <summary>The fixed texts of the consultancy page (where they differ from main's report).</summary>
    internal static class Texts
    {
        public const string DisclaimerIntro = "This disclaimer governs the use of this report. By using this report, you accept this disclaimer in full.";

        public static readonly string[] Disclaimer =
        [
            "This is an electronically generated report/transcript. It does not require any signature.",
            "The report provided pertains to the systems and processes of this unit only.",
            "This report is for the purpose of summarizing the outcomes of the said handholding milestone of the applicant Unit as per the information provided by the Consultant Organisation.",
            "This Report contains a summary of handholding milestone as validated by the Consultant Organisation which is based on the requirements of the selected parameters of the relevant ZED Certification level.",
            "This report has been made for the exclusive use and benefit of the applicant MSME. The Ministry of MSME or any of its implementation partner will not accept any liability that may arise if this report is used for any purpose other than intended for nor to any third party in respect of this report.",
            "This report is not an alternative to legal / financial / taxation / accountancy / other advice from an appropriately qualified professional.",
            "Ministry of MSME or any of its implementation partner do not represent, warrant, undertake or guarantee that the use of information or guidance (if any) in the report will lead to any particular outcome or result.",
            "While every attempt has been made to ensure the veracity of this report, Ministry of MSME and QCI are not responsible for any errors or omissions, or for the results obtained from the use of the information contained herein. All information in this report is provided “as is”.",
            "Information not disclosed by the applicant MSME could alter the findings outlined in this report. In such situations, Ministry of MSME reserves the right to withdraw or amend it opinions/suggestions, conclusions and findings as mentioned in this report.",
        ];

        public const string BasicInformation = "Information contained in this section is as provided by the applicant Unit and as observed by the Consultant(s), relevant to the requirements contained in the applicable Guidelines. The Photographs depicted are geo-tagged & time-stamped and have been uploaded by the consultant(s).";
        public const string Findings = "To ensure transparency in the process, the entire process (documents, photographs, comments etc.) is captured on a secured server. No physical document (as evidence) has been sought. The data/evidence captured is not shared externally with anyone, except with the relevant stakeholders involved in the preparation of this report or for award of Certification, as applicable.";

        public static readonly string[] WayForward =
        [
            "Quality improvement models vary in approach and methods; however, a basic underlying principle is that quality improvement is a continuous activity and not a one-time thing. As you implement changes, there will always be concerns to address and challenges to manage. The ZED Model strives to assist you in moving incrementally towards your improvement goals. Today's global business environment calls for organizations to develop, implement and maintain effective quality management systems. While the objectives of quality improvement are clear, the roadmap to reaching a superior quality operation, though more difficult and complex, is achievable when practiced.",
            "Compared to large companies, MSMEs actually have a significant advantage in implementing environmental friendly practices. The small scale of operations makes it flexible to adapt with constantly changing regulation or environmental requirements. Environmental sustainability is a major focus in today’s business world. Companies across all sectors explicitly state environmental concerns as being part of their management agenda. Businesses are striving to be more responsible towards the environment, whether by reducing their operational impact, by working towards a sustainable environment or by taking preventive measures. It is hence imperative that MSMEs realize the significant advantages of inculcating quality practices in their processes and adopting environment-friendly initiatives. We encourage you to adopt such measures and are confident that you will understand and prioritize your business needs by helping identify any deficiencies or shortcomings that need to be overcome, thereby performing better on the ZED parameters.",
            "ZED handholding is to help you see the processes from a fresh perspective and enable you to implement Zero Defect Zero Effect practices in the right spirit. This will also enable you to apply for a higher Certification Level. You will also be eligible to avail various others benefits and incentives after achieving a higher Certification Level. Please log-on to the ZED Portal to know more.",
            "Finally, we urge you to explore participating in various schemes offered by the Government, for example schemes related to Technology Upgradation, Lean Manufacturing, Digital MSME etc., which are aimed at encouraging, enhancing and handholding the MSMEs resulting in improved quality, enhanced productivity & higher profitability of the enterprises and making them adopt environment friendly technologies. To know more about the Ministry of MSME Schemes, please visit: http://msme.gov.in.",
            "All the best!",
        ];
    }
}
