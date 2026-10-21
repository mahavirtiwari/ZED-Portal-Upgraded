using System.Globalization;
using SkiaSharp;
using Zed.Core.Data;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Portal.Features.Consultancy.TechnologyUpgradation;

/// <summary>
/// The TU verification report (port of the consultancy Frontend/SA/TuReportSummary.cshtml) drawn with
/// <see cref="ReportPdf"/>: unit and verification details, site photos, recommended and purchased technologies, the
/// opening meeting, the DFO's evidence per technology, and the summary of amounts. Sets of
/// SP_REPORT_GET_TECHNOLOGY_UPGRADATION_DETAILS: 0 application, 1 site exterior/interior photos, 2 recommended
/// technologies, 3 purchased (eligible) technologies, 4 meetings, 5 participants, 6 opening meeting photo,
/// 7 screenshots per technology. The legacy page was public and its data set carried the payout bank account
/// (finding #92); the account is not printed here, and the report is only served to those who may open the application.
/// </summary>
public static class TuReport
{
    private const int MaxPixels = 900;

    public static byte[] Build(ResultSets sets, string zedId, string certification, TuStorage storage)
    {
        var unit = sets[0][0];
        var characters = Enumerable.Range(0, sets.Count).SelectMany(i => sets[i]).SelectMany(r => r.Values)
            .OfType<string>().SelectMany(v => v);
        var images = new List<SKImage>();
        try
        {
            using var pdf = new ReportPdf(zedId + "/TECHNOLOGY UPGRADATION REPORT", null, characters);
            pdf.NewPage();
            pdf.Heading("Financial Support for Zero Effect Solution: Verification Report");
            pdf.Paragraph($"Unit Name: {unit.Text("PUnitName")}", 10, bold: true);
            pdf.Paragraph($"ZED Certification Level: {unit.Text("CertificationType")}", 10, bold: true);
            pdf.Paragraph($"Date Of Verification: {unit.Text("DateOfVerification")}", 10, bold: true);
            pdf.Space(6);

            pdf.Panel("UNIT DETAILS");
            pdf.Table(new TableSpec(1.2f, 2.8f) { LabelColumn = true }
                .Row(Cell.Of("ZED ID"), Cell.Of(zedId))
                .Row(Cell.Of("Unit Name"), Cell.Of(unit.Text("PUnitName")))
                .Row(Cell.Of("Udyam Registration No."), Cell.Of(unit.Text("UdyogAadharNo")))
                .Row(Cell.Of("Unit Address"), Cell.Of(unit.Text("PlantAddress")))
                .Row(Cell.Of("Certification Level"), Cell.Of(unit.Text("CertificationType")))
                .Row(Cell.Of("Verification Date"), Cell.Of(unit.Text("DateOfVerification")))
                .Row(Cell.Of("MSME DFO Office"), Cell.Of(unit.Text("MSMEDFOOffice")))
                .Row(Cell.Of("Verified By"), Cell.Of(unit.Text("ApproverOfficialName"))), repeatHeader: false);

            var site = MeetingPhotos(sets[1], zedId, certification, storage, images);
            if (site.Count > 0)
            {
                pdf.Panel("SITE PHOTOGRAPHS");
                pdf.Gallery(site);
            }

            pdf.Panel("LIST OF RECOMMENDED TECHNOLOGIES");
            var recommended = new TableSpec(0.4f, 3.6f) { Header = [Cell.Of("S.No"), Cell.Of("Technology")] };
            var n = 0;
            foreach (var t in sets[2]) recommended.Row(Cell.Of((++n).ToString(CultureInfo.InvariantCulture)), Cell.Of(t.Text("TechnologyName")));
            if (n == 0) recommended.Row(Cell.Of("No data", colSpan: 2));
            pdf.Table(recommended);

            pdf.Panel("LIST OF PURCHASED TECHNOLOGIES");
            foreach (var t in sets[3])
            {
                pdf.Table(new TableSpec(1.6f, 2.4f) { LabelColumn = true }
                    .Row(Cell.Of($"Name of Purchased Technology {t.Text("techCount")}"), Cell.Of(t.Text("TechnologyName"), bold: true))
                    .Row(Cell.Of("Date of Purchase"), Cell.Of(t.Text("DateOfPurchase")))
                    .Row(Cell.Of("Make/Model Name"), Cell.Of(t.Text("MakeOrModelName")))
                    .Row(Cell.Of("Invoice Bill Date"), Cell.Of(t.Text("InvoiceBillDate")))
                    .Row(Cell.Of("Purchased Technology Invoice Cost (Rs.)"), Cell.Of(t.Text("AmountPaid"))), repeatHeader: false);
                pdf.Space(4);
            }

            pdf.Panel("TECHNOLOGY VERIFICATION DETAILS");
            var meeting = sets[4].LastOrDefault(m => Same(m.Text("CertificationType"), certification));
            pdf.Heading("OPENING MEETING", size: 10);
            pdf.Paragraph("DFO COMMENTS", bold: true);
            pdf.Paragraph(meeting?.Text("Comments") is { Length: > 0 } c ? c : "No comments provided.");
            var opening = MeetingPhotos(sets[6], zedId, certification, storage, images);
            if (opening.Count > 0) pdf.Gallery(opening);
            var participants = new TableSpec(0.4f, 2f, 1.6f) { Header = [Cell.Of("S.No"), Cell.Of("Participant"), Cell.Of("Designation")] };
            n = 0;
            foreach (var p in sets[5].Where(p => Same(p.Text("CertificationType"), certification)))
                participants.Row(Cell.Of((++n).ToString(CultureInfo.InvariantCulture)), Cell.Of(p.Text("Name")), Cell.Of(p.Text("Designation")));
            if (n > 0)
            {
                pdf.Paragraph("PARTICIPANTS", bold: true);
                pdf.Table(participants);
            }

            foreach (var group in sets[7].GroupBy(r => r.Text("TechnologyCode")))
            {
                var first = group.First();
                pdf.Heading($"Name of the Purchased Technology {first.Text("techCount")}: {first.Text("TechnologyName")}", size: 10);
                var evidence = new List<(SKImage, string)>();
                foreach (var item in group)
                {
                    if (FaFilePaths.FileName(item.Text("FileName")) is not { } file || file.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase)) continue;
                    if (Load(storage, $"{TuStorage.ScreenshotFolder(zedId, certification)}/{file}", images) is { } img)
                        evidence.Add((img, item.Text("PhotoType") == "Purchased Technology" ? "Photograph" : "Invoice Copy"));
                }
                if (evidence.Count > 0) pdf.Gallery(evidence);
                pdf.Paragraph("Comments: " + (first.Text("AssessorRemarks") is { Length: > 0 } r ? r : "No remarks provided."));
            }

            pdf.Panel("SUMMARY");
            var summary = new TableSpec(3f, 1f) { Header = [Cell.Of("Name Of Technology"), Cell.Of("Amount (Rs.)")] };
            foreach (var t in sets[3]) summary.Row(Cell.Of(t.Text("TechnologyName")), Cell.Of(t.Text("AmountPaid")));
            summary.Row(Cell.Of("Total Amount", bold: true), Cell.Of(unit.Text("TotalPaidAfterQc"), bold: true));
            summary.Row(Cell.Of("Technology Support Eligible Amount", bold: true), Cell.Of(unit.Text("EligibleAmount"), bold: true));
            pdf.Table(summary);
            return pdf.Finish();
        }
        finally
        {
            foreach (var i in images) i.Dispose();
        }
    }

    private static List<(SKImage, string)> MeetingPhotos(IEnumerable<IDictionary<string, object?>> rows, string zedId, string certification,
        TuStorage storage, List<SKImage> images)
    {
        var result = new List<(SKImage, string)>();
        foreach (var p in rows)
        {
            if (TuStorage.MeetingFile(p.Text("Name"), p.Text("PhotoId")) is not { } file) continue;
            if (Load(storage, $"{TuStorage.MeetingFolder(zedId, certification)}/{file}", images) is { } img) result.Add((img, p.Text("Name")));
        }
        return result;
    }

    private static SKImage? Load(TuStorage storage, string relative, List<SKImage> images)
    {
        if (storage.Find([relative]) is not { } path) return null;
        var image = ReportPhotos.Downscale(path, MaxPixels);
        if (image is not null) images.Add(image);
        return image;
    }

    private static bool Same(string a, string b) => string.Equals(a, b, StringComparison.OrdinalIgnoreCase);
}
