using SkiaSharp;
using Zed.Core.Data;

namespace Zed.Portal.Features.Documents;

/// <summary>
/// The assessment report, drawn from SP_REPORT_GET_DETAILS. Port of Views/SA/ReportSummary.cshtml (the page
/// behind "Download Report"), which the browser printed to PDF. Same sections and texts:
/// cover, about/disclaimer, assessment summary with location, certification level, basic information with
/// photos and products, assessment findings per section, up to five non-conformance rounds, way forward and
/// the closing page.
/// <para>Result sets: 0 unit, 1 products, 2 raw materials, 3 sections, 4 requirements, 5 options,
/// 6 sub-options, 7 evidences, 8 site exterior photos, 9 location; NC round n (1..5) starts at 10 + 7(n-1):
/// products, sections, requirements, options, sub-options, evidences, photos.</para>
/// </summary>
public static class AssessmentReport
{
    public sealed record Assets(SKImage Cover, SKImage Header, SKImage About, SKImage? Level, SKImage LastPage, SKImage? Map);

    private const int NcRounds = 5;

    public static byte[] Render(ResultSets sets, Assets assets, ReportPhotos photos)
    {
        var unit = sets[0].FirstOrDefault() ?? throw new DocumentNotAvailableException("No report data.");
        var zedId = unit.Text("ZedId");
        var level = unit.Text("Certification");
        var rejected = unit.Text("CertificationStatus") == DocumentLevels.Rejected.ToString(System.Globalization.CultureInfo.InvariantCulture);
        var location = sets[9].FirstOrDefault();
        var latitude = location?.Text("Latitude") ?? "";
        var longitude = location?.Text("Longitude") ?? "";
        var photoBase = unit.Text("PhotosPath").Length > 0 ? "mobileapi/CertifiedPhotos" : "mobileapi/Photos";
        var bronze = level == "Bronze";

        // Fonts are subset to the characters of the data (fixed texts are covered by FontSubsetter.BasicCharacters).
        var characters = Enumerable.Range(0, sets.Count).SelectMany(i => sets[i]).SelectMany(r => r.Values)
            .OfType<string>().SelectMany(v => v);
        using var pdf = new ReportPdf(zedId + "/ASSESSMENT REPORT", assets.Header, characters);

        Cover(pdf, assets, unit.Text("PUnitName"), $"{unit.Text("PDistrictName")}, {unit.Text("PStateName")}", latitude, longitude);

        // ----- about, disclaimer, summary
        pdf.NewPage();
        pdf.Panel("ABOUT THE ZED ASSESSMENT REPORT");
        pdf.Paragraph(Texts.About1);
        pdf.Image(assets.About, pdf.ContentWidth / 2);
        pdf.Paragraph(Texts.About2, 9.5f);
        pdf.Paragraph(Texts.About3, 9.5f);
        pdf.Space(4);
        pdf.Panel("DISCLAIMER");
        pdf.Paragraph(Texts.DisclaimerIntro, italic: true);
        for (var i = 0; i < Texts.Disclaimer.Length; i++)
            pdf.Paragraph(Texts.Disclaimer[i], 9.5f, indent: 22, bullet: (char)('a' + i) + ".");

        pdf.Space(4);
        // Keep the summary table and the location together, as the old page did.
        pdf.Ensure(assets.Map is null ? 230 : 520);
        pdf.Panel("ASSESSMENT SUMMARY");
        pdf.Table(new TableSpec(1.1f, 2f) { LabelColumn = true, FontSize = 9 }
            .Row(Cell.Of("Unit Name"), Cell.Of(unit.Text("PUnitName")))
            .Row(Cell.Of("Udyam Registration Number"), Cell.Of(unit.Text("UdyogAadharNo")))
            .Row(Cell.Of("Enterprise Type"), Cell.Of(unit.Text("EnterpriseTypee")))
            .Row(Cell.Of("NIC Sector (2 Digit)"), Cell.Of(unit.Text("TwoDigitActivity")))
            .Row(Cell.Of("Unit Address"), Cell.Of(unit.Text("PlantAddress")))
            .Row(Cell.Of(rejected ? "Rejected Date" : "Certification Date"), Cell.Of(unit.Text("AssessmentDate"))));
        pdf.Ensure(assets.Map is null ? 40 : 300);
        pdf.Panel($"Latitude: {latitude}: Longitude: {longitude}");
        if (assets.Map is not null) pdf.Image(assets.Map, Math.Min(pdf.ContentWidth, 420));

        // ----- certification level and basic information
        pdf.NewPage();
        if (!rejected)
        {
            pdf.Space(10);
            pdf.Paragraph("ZED CERTIFICATION LEVEL", 12, bold: true, align: SKTextAlign.Center);
            pdf.Paragraph(Texts.LevelAwarded, 9.5f, align: SKTextAlign.Center);
            if (assets.Level is not null) pdf.Image(assets.Level, 150, border: 10);
            pdf.Space(8);
        }

        pdf.Panel("BASIC INFORMATION");
        pdf.Paragraph(Texts.BasicInformation, 9.5f);
        var exterior = sets[8].Select(p => bronze
                ? photos.Load($"{photoBase}/{p.Text("ZedId")}/{p.Text("Certification")}/SiteExteriorPhotos/{p.Text("PhotoId")}.{p.Text("PhotoExtension")}", p.Text("OldPath"))
                : photos.Load(p.Text("Photo"), p.Text("OldPath")))
            .OfType<SKImage>().ToList();
        pdf.Gallery(exterior, "Site Exterior Picture");

        var basic = new TableSpec(0.45f, 2.2f, 3f) { Header = [Cell.Of("S.No"), Cell.Of("Fields"), Cell.Of("Input")] };
        basic.Row(Cell.Of("1"), Cell.Of("Whether 3rd Party Financial Audits are conducted?"), Cell.Of(unit.Text("AuditsConducted")));
        basic.Row(Cell.Of("2"), Cell.Of("Product manufactured"), Cell.Of(""));
        pdf.Table(basic, repeatHeader: true);
        pdf.Space(-8);
        pdf.Table(Products(sets[1], level, photoBase, photos, "Conformance"));

        var rest = new TableSpec(0.45f, 2.2f, 3f);
        rest.Row(Cell.Of("3"), Cell.Of("Key Domestic Customers"), Cell.Of(unit.Text("DomesticCustomers")));
        rest.Row(Cell.Of("4"), Cell.Of("Key International Customers"), Cell.Of(unit.Text("InternationalCustomers")));
        rest.Row(Cell.Of("5"), Cell.Of("Whether Raw Material is Imported?"), Cell.Of(unit.Text("RawMaterialImported")));
        pdf.Space(-8);
        pdf.Table(rest);
        if (sets[2].Count > 0)
        {
            pdf.Space(-8);
            var raw = new TableSpec(2f, 1.2f, 1.4f) { Header = [Cell.Of("Raw Material Name"), Cell.Of("% of Raw Material Imported"), Cell.Of("Name of Country")] };
            foreach (var r in sets[2]) raw.Row(Cell.Of(r.Text("RawMaterialName")), Cell.Of(r.Text("Percentage")), Cell.Of(r.Text("CountryName")));
            pdf.Table(raw);
        }
        var last = new TableSpec(0.45f, 2.2f, 3f);
        last.Row(Cell.Of("6"), Cell.Of("Processed Outsourced, if any?"), Cell.Of(unit.Text("OutsourcedProcesses")));
        last.Row(Cell.Of("7"), Cell.Of("Energy Source(s) Used"), Cell.Of(unit.Text("EnergySources")));
        pdf.Space(-8);
        pdf.Table(last);

        // ----- findings
        pdf.Panel("ASSESSMENT FINDINGS");
        pdf.Paragraph(Texts.Findings, 9.5f);
        Sections(pdf, sets[3], sets[4], sets[5], sets[6], ofi: !bronze, exemptions: true);

        for (var n = 1; n <= NcRounds; n++)
        {
            var b = 10 + 7 * (n - 1);
            if (sets[b].Count == 0 && sets[b + 1].Count == 0) continue;
            pdf.Panel($"Non Conformance {n}");
            if (sets[b].Count > 0)
            {
                pdf.Heading("Product Manufactured");
                pdf.Table(Products(sets[b], level, photoBase, photos, "Verified", ncRound: true));
            }
            Sections(pdf, sets[b + 1], sets[b + 2], sets[b + 3], sets[b + 4], ofi: false, exemptions: false);
        }

        // ----- way forward and closing page
        pdf.NewPage();
        pdf.Panel("WAY FORWARD");
        foreach (var p in Texts.WayForward) pdf.Paragraph(p, 9.5f);
        var half = pdf.ContentWidth / 2;
        pdf.Space(4);
        foreach (var p in Texts.Quote) pdf.Paragraph(p, 9.5f, italic: true, left: half, width: half);
        pdf.Paragraph("Drury, Eklund: 1997", 9.5f, align: SKTextAlign.Right, left: half, width: half);

        pdf.ImagePage(assets.LastPage);
        return pdf.Finish();
    }

    private static void Cover(ReportPdf pdf, Assets assets, string unitName, string place, string latitude, string longitude)
    {
        var canvas = pdf.BarePage();
        var top = 20f;
        var headerHeight = pdf.ContentWidth * assets.Header.Height / assets.Header.Width;
        canvas.DrawImage(assets.Header, SKRect.Create(ReportPdf.Margin, top, pdf.ContentWidth, headerHeight), ReportPdf.Sampling);

        var areaTop = top + headerHeight + 10;
        var areaHeight = ReportPdf.PageHeight - areaTop - 10;
        var (w, h) = ReportPdf.Fit(assets.Cover, ReportPdf.PageWidth, areaHeight);
        var left = (ReportPdf.PageWidth - w) / 2;
        canvas.DrawImage(assets.Cover, SKRect.Create(left, areaTop, w, h), ReportPdf.Sampling);

        // ".header-text-position": left 80px, bottom 20% (print), 70% wide; unit name and place in orange.
        using var big = pdf.Font(20, bold: true);
        using var small = pdf.Font(10);
        using var orange = ReportPdf.Paint(new SKColor(0xFF, 0xA5, 0x00));
        using var ink = ReportPdf.Paint(ReportPdf.Ink);
        var textWidth = w * 0.7f;
        var lines = new List<(string Text, SKFont Font, SKPaint Paint)>();
        lines.AddRange(ReportPdf.Wrap(unitName, big, textWidth).Select(l => (l, big, orange)));
        lines.AddRange(ReportPdf.Wrap(place, big, textWidth).Select(l => (l, big, orange)));
        lines.Add(($"Latitude: {latitude}", small, ink));
        lines.Add(($"Longitude: {longitude}", small, ink));
        var blockHeight = lines.Sum(l => l.Font.Spacing + 2);
        var y = areaTop + h * 0.8f - blockHeight;
        foreach (var (text, font, paint) in lines)
        {
            canvas.DrawText(text, left + 50, y + font.Size, SKTextAlign.Left, font, paint);
            y += font.Spacing + 2;
        }
    }

    private static TableSpec Products(IReadOnlyList<IDictionary<string, object?>> rows, string level, string photoBase, ReportPhotos photos,
        string verifiedHeader, bool ncRound = false)
    {
        var bronze = level == "Bronze";
        var table = new TableSpec(1.6f, 0.9f, 1.2f, 1.2f, 1f, 1.8f)
        {
            Header = [Cell.Of("Product Name"), Cell.Of("Whether Exported"), Cell.Of("Product Photo"), Cell.Of("Product Description Photo"), Cell.Of(verifiedHeader), Cell.Of("Assessor Remarks")],
            FontSize = 8,
        };
        foreach (var p in rows)
        {
            var zed = p.Text("ZedId");
            var cert = p.Text("Certification");
            var store = bronze ? photoBase : "mobileapi/SaPhotos";
            string Path(string file) => $"{store}/{zed}/{cert}/BasicInfo/{file}";

            var productPhoto = p.Text("ProductPhoto");
            var photo = bronze || !ncRound
                ? photos.Load(Path(productPhoto), p.Text("OldProductPhoto"))
                : photos.Load(productPhoto, Path(productPhoto));

            var description = p.Text("ProductDescriptionPhoto");
            Cell descriptionCell;
            if (description.Contains(".pdf", StringComparison.OrdinalIgnoreCase))
                descriptionCell = Cell.Of("PDF document (available on the portal)");
            else if (description.Contains(".jpg", StringComparison.OrdinalIgnoreCase) &&
                     (bronze || !ncRound ? photos.Load(Path(description), p.Text("OldProductDescPhoto")) : photos.Load(description, Path(description))) is { } d)
                descriptionCell = new Cell([new CellImage(d, 60)]);
            else
                descriptionCell = Cell.Of("");

            table.Row(
                Cell.Of(p.Text("ProductName")),
                Cell.Of(p.Text("Exported")),
                photo is null ? Cell.Of("") : new Cell([new CellImage(photo, 60)]),
                descriptionCell,
                Cell.Of(p.Text("IsVerified"), center: true),
                Cell.Of(p.Text("AssessorRemarks")));
        }
        return table;
    }

    private static void Sections(ReportPdf pdf,
        IReadOnlyList<IDictionary<string, object?>> sections, IReadOnlyList<IDictionary<string, object?>> requirements,
        IReadOnlyList<IDictionary<string, object?>> options, IReadOnlyList<IDictionary<string, object?>> subOptions,
        bool ofi, bool exemptions)
    {
        foreach (var s in sections)
        {
            var code = s.Text("SectionCode");
            var exempted = exemptions && s.Text("IsAssessmentExcempted") == "Yes";
            pdf.Space(6);
            pdf.Heading($"{code}. {s.Text("SectionName")}", exempted ? "Exempted from Assessment" : null);

            var table = new TableSpec(0.55f, 3.2f, 0.9f, 2.2f)
            {
                Header = [Cell.Of("Code"), Cell.Of("Requirement"), Cell.Of("Conformance (Yes/No)"), Cell.Of("Assessor Remark")],
            };
            if (!exempted)
            {
                foreach (var r in requirements.Where(r => r.Text("SectionCode") == code))
                {
                    var rc = r.Text("RequirementCode");
                    var items = new List<CellItem>();
                    foreach (var o in options.Where(o => o.Text("SectionCode") == code && o.Text("RequirementCode") == rc))
                    {
                        items.Add(new CellText(o.Text("OptionName")));
                        items.AddRange(subOptions
                            .Where(so => so.Text("SectionCode") == code && so.Text("RequirementCode") == rc && so.Text("OptionCode") == o.Text("OptionCode"))
                            .Select(so => new CellText(so.Text("SubOptionName"), Bullet: "•")));
                    }
                    table.Row(Cell.Of($"{code}.{rc}", bold: true), new Cell(items), Cell.Of(r.Text("Conformance"), center: true), Cell.Of(r.Text("AssessorRemarks")));
                }
                if (ofi)
                    table.Row(Cell.Of("Opportunities for Improvement", bold: true, colSpan: 2), Cell.Of(s.Text("OfiComments"), colSpan: 2));
            }
            pdf.Table(table);
        }
    }

    /// <summary>The fixed texts of the old report page.</summary>
    private static class Texts
    {
        public const string About1 = "The MSME Sustainable (ZED) Certification is a scheme of Ministry of MSME to facilitate, assess and certify the applicant MSME based on a matrix of Quality, Productivity, Environment, Energy and other Parameters, leading to the following Certification Levels:";
        public const string About2 = "This report is an outcome of an assessment (Desktop or Remote or Site, as per Certification Level) of the applicant MSME’s unit based on the requirements as laid down in the relevant Certification Level. The intent of this report is to provide information useful for the MSME for it to strengthen its systems and processes and move ahead on the journey of ZED.";
        public const string About3 = "In this report, findings are presented on an exception basis only.";
        public const string DisclaimerIntro = "This disclaimer governs the use of this report. By using this report, you accept this disclaimer in full.";

        public static readonly string[] Disclaimer =
        [
            "This is an electronically generated report/transcript. It does not require any signature.",
            "The Certification is voluntary and the report provided pertains to the systems and processes of this unit only.",
            "This report is for the purpose of summarizing the outcomes of the assessment process for the applicant Unit as per the information provided by the Applicant.",
            "The assessment has been conducted subsequent to the undertaking by the MSME that it complies with and fulfils all relevant and applicable regulatory and statutory norms/licenses/requirements pertaining to the functioning of this manufacturing unit. Any deviation from this undertaking may result in recall/withdrawal of the Certification provided.",
            "The Certification is valid only for a period of 3 years from the date of issue as mentioned on the Certificate, subject to surveillance assessment (as applicable) conducted within the validity period. The cost of surveillance will be borne by the applicant MSME.",
            "This Report contains a summary of assessment findings as validated through the assessment which is based on the requirements of the relevant ZED Certification Level.",
            "The ZED logo can only be used by those MSMEs which have successfully achieved a Certification (Bronze, Silver or Gold). The guidelines regarding logo usage are being sent separately.",
            "This report has been made for the exclusive use and benefit of the MSME assessed and Ministry of MSME or any of its implementation partner will not accept any liability that may arise if this report is used for any purpose other than intended for nor to any third party in respect of this report.",
            "This report is not an alternative to legal / financial / taxation / accountancy / other advice from an appropriately qualified professional.",
            "Ministry of MSME or any of its implementation partner do not represent, warrant, undertake or guarantee that the use of information or guidance (if any) in the report will lead to any particular outcome or result.",
            "While every attempt has been made to ensure the veracity of this report, Ministry of MSME and QCI are not responsible for any errors or omissions, or for the results obtained from the use of the information contained herein. All information in this report is provided “as is”.",
            "Information not disclosed by the applicant MSME could alter the findings outlined in this report. In such situations, Ministry of MSME reserves the right to withdraw or amend it opinions/suggestions, conclusions and Certification provided.",
        ];

        public const string LevelAwarded = "Awarded to the applicant MSME after fulfilling all requirements of this Certification Level as laid down in the MSME sustainable (ZED) Certification Scheme Guidelines of Ministry of MSME";
        public const string BasicInformation = "Information contained in this section is as provided by the applicant MSME, relevant to the requirements contained in this Certification Level. The Photographs depicted are geo-tagged & time-stamped and have been uploaded by the applicant through the ZED online systems.";
        public const string Findings = "To ensure transparency in the assessment process, the entire process (documents, photographs, comments etc.) is captured on a secured ZED server. No physical document (as evidence) has been sought. The data/evidence captured is not shared externally with anyone, except with the relevant stakeholders involved for award of Certification.";

        public static readonly string[] WayForward =
        [
            "Quality improvement models vary in approach and methods; however, a basic underlying principle is that quality improvement is a continuous activity and not a one-time thing. As you implement changes, there will always be concerns to address and challenges to manage. The ZED Model strives to assist you in moving incrementally towards your improvement goals. Today's global business environment calls for organizations to develop, implement and maintain effective quality management systems. While the objectives of quality improvement are clear, the roadmap to reaching a superior quality operation, though more difficult and complex, is achievable when practiced.",
            "Compared to large companies, MSMEs actually have a significant advantage in implementing environmental friendly practices. The small scale of operations makes it flexible to adapt with constantly changing regulation or environmental requirements. Environmental sustainability is a major focus in today’s business world. Companies across all sectors explicitly state environmental concerns as being part of their management agenda. Businesses are striving to be more responsible towards the environment, whether by reducing their operational impact, by working towards a sustainable environment or by taking preventive measures. It is hence imperative that MSMEs realize the significant advantages of inculcating quality practices in their processes and adopting environment-friendly initiatives. We encourage you to adopt such measures and are confident that you will understand and prioritize your business needs by helping identify any deficiencies or shortcomings that need to be overcome, thereby performing better on the ZED parameters.",
            "We urge you to leverage the competence of ZED trained consultants who will share their expertise and knowledge to help your business attain goals and solve problems. These trained professionals will view the situation from a fresh perspective and can act as a catalyst for change. A Consulting Organization will be allocated to you after a due process after you have achieved a minimum Bronze rating and you will also be eligible for financial support if you opt for this component. After the handholding process is complete, you have an option to apply for a higher Certification Level (if applicable) if you are confident that your processes have considerably improved.",
            "You will also be eligible to avail various others benefits and incentives after achieving a Certification Level. Please log-on to the ZED Portal to know more.",
            "Finally, we urge you to explore participating in various schemes offered by the Government, for example schemes related to Technology Upgradation, Lean Manufacturing, Intellectual Property Rights, etc., which are aimed at encouraging, enhancing and handholding the MSMEs resulting in improved quality, enhanced productivity & higher profitability of the enterprises and making them adopt environment friendly technologies. To know more about the Ministry of MSME Schemes, please visit: http://msme.gov.in.",
            "All the best!",
        ];

        public static readonly string[] Quote =
        [
            "The quality movement in product manufacturing and delivery of service has undergone change from its initial emphasis on quality through inspection, to the present-day emphasis on quality through the development of robust processes capable of performing consistently in developing products and services that meet and exceed user needs and expectations.",
        ];
    }
}
