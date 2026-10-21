using System.Data.Common;
using System.Globalization;
using System.Net.Mail;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.Staff.Schemes;

/// <summary>
/// The incentive catalogue shown on the public incentive pages (Admin, Views/Incentive/Index.cshtml).
/// Port of IncentiveController.Index / GetIncentives / SaveIncentive / UpdateIncentive and the document
/// part of Upload.
/// <para>
/// Legacy holes: SaveIncentive and UpdateIncentive only required a sign-in (any MSME could add or change
/// public incentives, including <c>javascript:</c> links that the public page puts in <c>href</c>), and
/// <c>Incentive/Upload</c> had no sign-in check at all and wrote the upload to
/// <c>~/Uploads/{sectionCode}/{fileName}</c> with both values from the request (anyone could write files
/// anywhere under the site). Here only the Admin role can change incentives, links must be http(s), and
/// the two documents of an incentive are PDFs saved as <c>Uploads/Incentives/{Id}File1.pdf</c> /
/// <c>{Id}File2.pdf</c> (the names the public page links to).
/// </para>
/// </summary>
[Route("api/staff/schemes/incentive-master")]
[StaffRoles(UserRole.Admin)]
public sealed class IncentiveMasterController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<IncentiveMasterController> log) : StaffApiController
{
    public const long MaxDocumentBytes = 2 * 1024 * 1024;

    /// <summary>Incentive types of the legacy menu: Ministry of MSME, other, financial institutions, and one per state.</summary>
    public static readonly string[] Types =
    [
        "Common", "Other", "Financial",
        "ANDAMAN AND NICOBAR ISLANDS", "ANDHRA PRADESH", "ARUNACHAL PRADESH", "ASSAM", "BIHAR", "CHANDIGARH", "CHHATTISGARH", "DELHI",
        "GOA", "GUJARAT", "HARYANA", "HIMACHAL PRADESH", "JAMMU AND KASHMIR", "JHARKHAND", "KARNATAKA", "KERALA", "LADAKH",
        "LAKSHADWEEP", "MADHYA PRADESH", "MAHARASHTRA", "MANIPUR", "MEGHALAYA", "MIZORAM", "NAGALAND", "ODISHA", "PUDUCHERRY",
        "PUNJAB", "RAJASTHAN", "SIKKIM", "TAMIL NADU", "TELANGANA", "THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU", "TRIPURA",
        "UTTAR PRADESH", "UTTARAKHAND", "WEST BENGAL",
    ];

    public static readonly string[] Columns =
    [
        "Id", "IncentiveType", "Incentive", "Details", "MinistryOrDepartment", "ContactPerson", "WebLink", "Email", "MobileNo",
        "VideoLink", "ApplicableForBronze", "ApplicableForSilver", "ApplicableForGold", "ActiveStatus", "OrderNo",
    ];

    public sealed record IncentiveDto(Dictionary<string, object?> Incentive, bool HasDocument1, bool HasDocument2);

    /// <summary>GET api/staff/schemes/incentive-master?type=Common — SP_MASTER_GET_INCENTIVES.</summary>
    [HttpGet]
    public async Task<ActionResult<IReadOnlyList<IncentiveDto>>> List([FromQuery] string? type, CancellationToken ct)
    {
        if (CanonicalType(type ?? "Common") is not { } t) return this.Problem400("Invalid incentive type.");
        return (await Load(t, ct)).Select(r =>
        {
            var id = r.Text("Id");
            return new IncentiveDto(SchemeRows.Pick(r, Columns), System.IO.File.Exists(DocumentPath(id, 1)), System.IO.File.Exists(DocumentPath(id, 2)));
        }).ToList();
    }

    public sealed record IncentiveRequest(
        string? IncentiveType, string? Incentive, string? Details, string? MinistryOrDepartment, string? ContactPerson,
        string? WebLink, string? Email, string? MobileNo, string? VideoLink,
        bool ApplicableForBronze, bool ApplicableForSilver, bool ApplicableForGold, bool ActiveStatus);

    /// <summary>POST api/staff/schemes/incentive-master — SP_MASTER_INSERT_INCENTIVE.</summary>
    [HttpPost]
    public async Task<ActionResult<MessageResponse>> Create(IncentiveRequest req, CancellationToken ct)
    {
        if (Check(req) is { } error) return this.Problem400(error);
        if (!req.ApplicableForBronze && !req.ApplicableForSilver && !req.ApplicableForGold)
            return this.Problem400("Please select the certification levels the incentive applies to.");
        return await Save("SP_MASTER_INSERT_INCENTIVE", Args(req, id: null), "Incentive saved.", ct);
    }

    /// <summary>POST api/staff/schemes/incentive-master/{id} — SP_MASTER_UPDATE_INCENTIVE (the procedure keeps type and levels).</summary>
    [HttpPost("{id:long}")]
    public async Task<ActionResult<MessageResponse>> Update(long id, IncentiveRequest req, CancellationToken ct)
    {
        if (Check(req) is { } error) return this.Problem400(error);
        var type = CanonicalType(req.IncentiveType)!;
        if (!(await Load(type, ct)).Any(r => r.Text("Id") == id.ToString(CultureInfo.InvariantCulture))) return NotFound();
        return await Save("SP_MASTER_UPDATE_INCENTIVE", Args(req, id), "Incentive updated.", ct);
    }

    /// <summary>POST api/staff/schemes/incentive-master/{id}/documents/{n} (multipart "file", PDF up to 2 MB), n = 1 or 2.</summary>
    [HttpPost("{id:long}/documents/{n:int}")]
    [RequestSizeLimit(MaxDocumentBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MaxDocumentBytes + 64 * 1024)]
    public async Task<ActionResult<MessageResponse>> UploadDocument(long id, int n, [FromQuery] string? type, IFormFile? file, CancellationToken ct)
    {
        if (n is not (1 or 2)) return NotFound();
        if (CanonicalType(type) is not { } t || !(await Load(t, ct)).Any(r => r.Text("Id") == id.ToString(CultureInfo.InvariantCulture))) return NotFound();
        if (file is null || await FaVerificationController.UploadKind(file, ct) != ".pdf")
            return this.Problem400("Please upload a valid PDF document (less than 2 MB).");

        var path = DocumentPath(id.ToString(CultureInfo.InvariantCulture), n);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        var temp = path + "." + Guid.NewGuid().ToString("N") + ".tmp";
        await using (var fs = System.IO.File.Create(temp))
            await file.CopyToAsync(fs, ct);
        System.IO.File.Move(temp, path, overwrite: true);
        log.LogInformation("Incentive {Id} document {N} uploaded by {UserId}", id, n, UserId);
        return new MessageResponse("Document Uploaded Successfully.");
    }

    /// <summary>GET api/staff/schemes/incentive-master/{id}/documents/{n} — the uploaded PDF.</summary>
    [HttpGet("{id:long}/documents/{n:int}")]
    public IActionResult Document(long id, int n)
    {
        if (n is not (1 or 2)) return NotFound();
        var path = DocumentPath(id.ToString(CultureInfo.InvariantCulture), n);
        if (!System.IO.File.Exists(path)) return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = Path.GetFileName(path) }.ToString();
        return PhysicalFile(path, "application/pdf");
    }

    public static string? CanonicalType(string? value) =>
        Types.FirstOrDefault(t => string.Equals(t, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>Required fields and lengths (Incentives columns), e-mail, phone and http(s) links ("---" = no web link, as the public page expects).</summary>
    public static string? Check(IncentiveRequest r)
    {
        if (CanonicalType(r.IncentiveType) is null) return "Invalid incentive type.";
        (string? Value, string Label, int Max, bool Required)[] fields =
        [
            (r.Incentive, "Incentive", 4000, true), (r.Details, "Details", 4000, true),
            (r.MinistryOrDepartment, "Ministry/Department Associated", 4000, true), (r.ContactPerson, "Contact Person", 2000, true),
            (r.Email, "Email", 200, true), (r.MobileNo, "Mobile/Phone Number", 15, true),
            (r.WebLink, "Web Link", 1000, true), (r.VideoLink, "Video Link", 2000, false),
        ];
        foreach (var (value, label, max, required) in fields)
        {
            var v = value?.Trim() ?? "";
            if (required && v.Length == 0) return $"{label} required.";
            if (v.Length > max) return $"{label} can be up to {max} characters.";
            if (v.Any(c => char.IsControl(c) && c is not '\n' and not '\r')) return $"{label} contains invalid characters.";
        }
        if (!MailAddress.TryCreate(r.Email!.Trim(), out var mail) || mail.Address != r.Email.Trim()) return "Please enter a valid e-mail address.";
        if (!r.MobileNo!.Trim().All(c => char.IsAsciiDigit(c) || c is '+' or '-' or ' ')) return "Please enter a valid mobile/phone number.";
        if (r.WebLink!.Trim() != "---" && !IsHttpUrl(r.WebLink)) return "Web Link must be a full http(s):// address (or --- for none).";
        if (!string.IsNullOrWhiteSpace(r.VideoLink) && !IsHttpUrl(r.VideoLink)) return "Video Link must be a full http(s):// address.";
        return null;
    }

    public static bool IsHttpUrl(string? value) =>
        Uri.TryCreate(value?.Trim(), UriKind.Absolute, out var u) && (u.Scheme == Uri.UriSchemeHttps || u.Scheme == Uri.UriSchemeHttp) && u.Host.Length > 0;

    private static Dapper.DynamicParameters Args(IncentiveRequest r, long? id)
    {
        var args = new Dictionary<string, object?>
        {
            ["IncentiveType"] = CanonicalType(r.IncentiveType), ["Incentive"] = r.Incentive!.Trim(), ["Details"] = r.Details!.Trim(),
            ["MinistryOrDepartment"] = r.MinistryOrDepartment!.Trim(), ["ContactPerson"] = r.ContactPerson!.Trim(), ["WebLink"] = r.WebLink!.Trim(),
            ["Email"] = r.Email!.Trim(), ["MobileNo"] = r.MobileNo!.Trim(), ["VideoLink"] = string.IsNullOrWhiteSpace(r.VideoLink) ? null : r.VideoLink.Trim(),
            ["ApplicableForBronze"] = r.ApplicableForBronze, ["ApplicableForSilver"] = r.ApplicableForSilver,
            ["ApplicableForGold"] = r.ApplicableForGold, ["ActiveStatus"] = r.ActiveStatus,
        };
        if (id is not null) args["Id"] = id.Value;
        return new Dapper.DynamicParameters(args);
    }

    private async Task<ActionResult<MessageResponse>> Save(string procedure, object args, string message, CancellationToken ct)
    {
        try
        {
            await db.ExecuteProcAsync(procedure, args, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "{Procedure} failed", procedure);
            return this.Problem400("The incentive could not be saved. Please try again.");
        }
        log.LogInformation("{Procedure} by {UserId}", procedure, UserId);
        return new MessageResponse(message);
    }

    private async Task<IReadOnlyList<IDictionary<string, object?>>> Load(string type, CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_MASTER_GET_INCENTIVES", new { IncentiveType = type }, ct))[0];

    private string DocumentPath(string id, int n)
    {
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        // id is digits only (route constraint or the procedure's bigint), so the name cannot leave the folder.
        return MsmeFilePaths.Resolve(root, $"Uploads/Incentives/{string.Concat(id.Where(char.IsAsciiDigit))}File{n}.pdf")
               ?? throw new InvalidOperationException("Invalid incentive document path.");
    }
}
