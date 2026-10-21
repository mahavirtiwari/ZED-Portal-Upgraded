using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Schemes;

namespace Zed.Portal.Features.Msme.Schemes;

/// <summary>
/// The public incentive pages: the incentives a ZED-certified unit can avail (Ministry of MSME, states,
/// financial institutions, others) and the public list of incentives disbursed to certified units.
/// Port of IncentiveController.Details / DetailsMobile (SP_GET_INCENTIVES) and SubmissionsPublic
/// (SP_GET_API_INCENTIVES). No sign-in, as before: the MSME dashboard, the certification pages and the
/// mobile app (SP_APP_MSME_CHECK_LOGIN / SP_APP_MSME_STATUS build <c>{site}/Incentive/Details/{StateId}?ct=</c>) link here.
/// <para>
/// Changes: links are passed on only when they are http(s) (the catalogue's WebLink/VideoLink went into
/// <c>href</c> as stored); the documents are served from here only for incentives listed for the level;
/// the public submissions list no longer shows Udyam numbers, scheme application ids, gender or amounts,
/// and cannot be filtered by gender (decision pending, SECURITY-FINDINGS #46).
/// </para>
/// </summary>
[ApiController]
[AllowAnonymous]
[Route("api/public/incentives")]
public sealed class PublicIncentivesController(
    ISqlExecutor db,
    IWebHostEnvironment env,
    IOptions<PortalOptions> portal,
    ILogger<PublicIncentivesController> log) : ControllerBase
{
    private static readonly string[] Sizes = ["Micro", "Small", "Medium"];

    public sealed record IncentiveDto(
        long Id, string? MinistryOrDepartment, string? Incentive, string? Details, string? ContactPerson, string? Email,
        string? MobileNo, string? WebLink, string? VideoLink, string? Document1, string? Document2);

    public sealed record DetailsResponse(
        string? Certification, int? State, IReadOnlyList<IncentiveDto> Common, IReadOnlyList<IncentiveDto> States,
        IReadOnlyList<IncentiveDto> Other, IReadOnlyList<IncentiveDto> Financial, IReadOnlyList<string> FinancialDepartments);

    /// <summary>GET api/public/incentives?ct=Bronze&amp;id=9 — SP_GET_INCENTIVES (no level = nothing, as the procedure).</summary>
    [HttpGet]
    public async Task<ActionResult<DetailsResponse>> Details([FromQuery] string? ct, [FromQuery] int? id, CancellationToken cancel)
    {
        var level = FaApplications.Canonical(ct);
        if (!string.IsNullOrEmpty(ct) && level is null) return this.Problem400("Invalid certification level.");
        if (id is < 0 or > 99) return this.Problem400("Invalid state.");
        // State 0 was offered as "Common incentives" once; the procedure treats it as no state match, as before.
        var sets = await db.QueryProcMultipleAsync("SP_GET_INCENTIVES",
            new { State = id?.ToString(CultureInfo.InvariantCulture), CertificationType = level }, cancel);
        IReadOnlyList<IncentiveDto> Map(int i) => sets[i].Select(r => ToDto(r, level)).Where(d => d.Id > 0).ToList();
        return new DetailsResponse(level, id, Map(0), Map(1), Map(2), Map(3),
            sets[4].Select(r => r.Text("MinistryOrDepartment")).Where(s => s.Length > 0).ToList());
    }

    /// <summary>GET api/public/incentives/{id}/documents/{n}?ct=Bronze — Uploads/Incentives/{Id}File{n}.pdf of a listed incentive.</summary>
    [HttpGet("{id:long}/documents/{n:int}")]
    public async Task<IActionResult> Document(long id, int n, [FromQuery] string? ct, CancellationToken cancel)
    {
        if (n is not (1 or 2) || FaApplications.Canonical(ct) is not { } level) return NotFound();
        var sets = await db.QueryProcMultipleAsync("SP_GET_INCENTIVES", new { State = (string?)null, CertificationType = level }, cancel);
        var key = id.ToString(CultureInfo.InvariantCulture);
        if (!Enumerable.Range(0, 4).Any(i => sets[i].Any(r => r.Text("Id") == key))) return NotFound();
        var path = DocumentPath(key, n);
        if (path is null || !System.IO.File.Exists(path)) return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.ContentDisposition = new ContentDispositionHeaderValue("inline") { FileNameStar = Path.GetFileName(path) }.ToString();
        return PhysicalFile(path, "application/pdf");
    }

    /// <summary>Only non-personal columns: no Udyam number, application id, certificate number, gender, amounts or token.</summary>
    public static readonly string[] SubmissionColumns = ["PUnitName", "PStateName", "Certification", "ServiceName", "IncentiveName", "DataFrom"];

    /// <summary>GET api/public/incentives/submissions?id=&amp;ct=&amp;msmeSize= — SP_GET_API_INCENTIVES without Udyam, certificate or gender filters.</summary>
    [HttpGet("submissions")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<IReadOnlyList<Dictionary<string, object?>>>> Submissions(
        [FromQuery] int? id, [FromQuery] string? ct, [FromQuery] string? msmeSize, CancellationToken cancel)
    {
        if (id is < 1 or > 99) return this.Problem400("Invalid state.");
        string? level = null, size = null;
        if (!string.IsNullOrEmpty(ct) && (level = FaApplications.Canonical(ct)) is null) return this.Problem400("Invalid certification level.");
        if (!string.IsNullOrEmpty(msmeSize) && (size = Sizes.FirstOrDefault(s => s.Equals(msmeSize, StringComparison.OrdinalIgnoreCase))) is null)
            return this.Problem400("Invalid MSME size.");
        var sets = await db.QueryProcMultipleAsync("SP_GET_API_INCENTIVES", new
        {
            UdyamNo = (string?)null, CertificateNo = (string?)null, State = id?.ToString(CultureInfo.InvariantCulture),
            CertificationType = level, MsmeSize = size, Sector = (string?)null, Gender = (string?)null,
        }, cancel);
        return sets[0].Select(r => SchemeRows.Pick(r, SubmissionColumns)).ToList();
    }

    private IncentiveDto ToDto(IDictionary<string, object?> r, string? level)
    {
        var id = long.TryParse(r.Text("Id"), NumberStyles.None, CultureInfo.InvariantCulture, out var v) ? v : 0;
        string? Doc(int n) => level is not null && id > 0 && DocumentPath(id.ToString(CultureInfo.InvariantCulture), n) is { } p && System.IO.File.Exists(p)
            ? $"/api/public/incentives/{id}/documents/{n}?ct={level}"
            : null;
        return new IncentiveDto(id, Text(r, "MinistryOrDepartment"), Text(r, "Incentive"), Text(r, "Details"), Text(r, "ContactPerson"),
            Text(r, "Email"), Text(r, "MobileNo"), Link(r.Text("WebLink")), Link(r.Text("VideoLink")), Doc(1), Doc(2));
    }

    private static string? Text(IDictionary<string, object?> r, string column) => r.Text(column) is { Length: > 0 } s ? s : null;

    /// <summary>An absolute http(s) link, or null ("---" means no link on the catalogue; anything else could be javascript:).</summary>
    private string? Link(string value)
    {
        if (value.Trim() is not { Length: > 0 } v || v == "---") return null;
        if (IncentiveMasterController.IsHttpUrl(v)) return v;
        log.LogWarning("Incentive link that is not http(s) left out: {Link}", v.Length > 100 ? v[..100] : v);
        return null;
    }

    private string? DocumentPath(string id, int n)
    {
        var root = Path.GetFullPath(Path.Combine(env.ContentRootPath, portal.Value.StorageRoot));
        return MsmeFilePaths.Resolve(root, $"Uploads/Incentives/{string.Concat(id.Where(char.IsAsciiDigit))}File{n}.pdf");
    }
}
