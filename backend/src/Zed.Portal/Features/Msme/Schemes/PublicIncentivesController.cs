using System.Globalization;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
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

    /// <summary>ZED-X (Export), which SP_GET_INCENTIVES does not know (2026-11-16, Incentives.ApplicableForZEDX, migration 0091).</summary>
    public const string ZedX = "ZEDX";

    /// <summary>Bronze, Silver, Gold or ZEDX ("ZED-X" too), else null.</summary>
    public static string? CanonicalLevel(string? ct) =>
        FaApplications.Canonical(ct) ?? (ct?.Trim().Replace("-", "") is { } c && c.Equals(ZedX, StringComparison.OrdinalIgnoreCase) ? ZedX : null);

    internal const string ZedXSql = "SELECT * FROM dbo.Incentives WHERE ApplicableForZEDX = 1 AND ActiveStatus = 1 ORDER BY OrderNo;";

    /// <summary>
    /// The five lists of SP_GET_INCENTIVES (Ministry of MSME, states, others, financial institutions, the financial
    /// departments) for a level. ZED-X: the same lists from V4's own query (the procedure returns none for it).
    /// </summary>
    private async Task<ResultSets> ListsAsync(string? level, int? state, CancellationToken cancel)
    {
        if (level != ZedX)
            // State 0 was offered as "Common incentives" once; the procedure treats it as no state match, as before.
            return await db.QueryProcMultipleAsync("SP_GET_INCENTIVES", new { State = state?.ToString(CultureInfo.InvariantCulture), CertificationType = level }, cancel);
        IReadOnlyList<IDictionary<string, object?>> rows;
        try
        {
            rows = (await db.QuerySqlAsync<object>(ZedXSql, null, cancel)).Select(AsRow).OfType<IDictionary<string, object?>>().ToList();
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "ZED-X incentives not readable (is migration 0091 applied?)");
            rows = [];
        }
        string Type(IDictionary<string, object?> r) => r.Text("IncentiveType").Trim();
        var stateNames = Staff.Masters.StateMaster.All
            .Where(s => state is null || (int.TryParse(s.Code, NumberStyles.None, CultureInfo.InvariantCulture, out var c) && c == state))
            .Select(s => s.Name).ToHashSet(StringComparer.OrdinalIgnoreCase);
        var financial = rows.Where(r => Type(r) == "Financial").ToList();
        return new ResultSets(new List<IReadOnlyList<IDictionary<string, object?>>>
        {
            rows.Where(r => Type(r) == "Common").ToList(),
            rows.Where(r => stateNames.Contains(Type(r))).ToList(),
            rows.Where(r => Type(r) == "Other").ToList(),
            financial,
            financial.Select(r => r.Text("MinistryOrDepartment").Trim()).Where(d => d.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase)
                .Order(StringComparer.OrdinalIgnoreCase).Select(d => (IDictionary<string, object?>)new Dictionary<string, object?> { ["MinistryOrDepartment"] = d }).ToList(),
        });
    }

    /// <summary>
    /// GET api/public/incentives?ct=Bronze&amp;id=9&amp;act=Manufacturing — SP_GET_INCENTIVES (no level = nothing, as the
    /// procedure); ct=ZEDX from V4's own query. act (2026-11-16): an incentive for the other activity only is left out;
    /// without act, a signed-in MSME sees the incentives of its own activity (its Udyam major activity), anyone else all.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<DetailsResponse>> Details([FromQuery] string? ct, [FromQuery] int? id, [FromQuery] string? act, CancellationToken cancel)
    {
        var level = CanonicalLevel(ct);
        if (!string.IsNullOrEmpty(ct) && level is null) return this.Problem400("Invalid certification level.");
        if (id is < 0 or > 99) return this.Problem400("Invalid state.");
        if (IncentiveMasterController.CanonicalActivity(act) is not { } activity) return this.Problem400("Invalid activity.");
        if (string.IsNullOrWhiteSpace(act) && User.IsInRole(nameof(UserRole.Msme)) && ZedUser.FromPrincipal(User)?.UserId is { Length: > 0 } zedId
            && IncentiveMasterController.CanonicalActivity(await MsmeDashboardController.ActivityAsync(db, zedId, log, cancel)) is { } own)
            activity = own;
        var sets = await ListsAsync(level, id, cancel);
        // An incentive the Admin put on the MSME dashboard has its own card there, not in the stakeholder lists (migration 0026).
        IReadOnlyList<IncentiveDto> Map(int i) => sets[i]
            .Where(r => !string.Equals(r.Text("DisplayOn"), IncentiveMasterController.OnDashboard, StringComparison.OrdinalIgnoreCase))
            .Where(r => activity == IncentiveMasterController.Both || IncentiveMasterController.AppliesToActivity(r.Text("ApplicableActivity"), activity))
            .Select(r => ToDto(r, level)).Where(d => d.Id > 0).ToList();
        var financial = Map(3);
        return new DetailsResponse(level, id, Map(0), Map(1), Map(2), financial,
            sets[4].Select(r => r.Text("MinistryOrDepartment")).Where(s => s.Length > 0)
                .Where(d => activity == IncentiveMasterController.Both || financial.Any(f => string.Equals(f.MinistryOrDepartment?.Trim(), d.Trim(), StringComparison.OrdinalIgnoreCase)))
                .ToList());
    }

    /// <summary>GET api/public/incentives/{id}/documents/{n}?ct=Bronze — Uploads/Incentives/{Id}File{n}.pdf of a listed incentive.</summary>
    [HttpGet("{id:long}/documents/{n:int}")]
    public async Task<IActionResult> Document(long id, int n, [FromQuery] string? ct, CancellationToken cancel)
    {
        if (n is not (1 or 2) || CanonicalLevel(ct) is not { } level) return NotFound();
        var sets = await ListsAsync(level, null, cancel);
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

    /// <summary>A row of an inline SELECT * (Dapper's rows are dictionaries; a JSON object as a test double gives).</summary>
    private static IDictionary<string, object?>? AsRow(object? row) => row switch
    {
        IDictionary<string, object?> d => d,
        System.Text.Json.JsonElement { ValueKind: System.Text.Json.JsonValueKind.Object } e => e.EnumerateObject().ToDictionary(
            p => p.Name, p => p.Value.ValueKind switch
            {
                System.Text.Json.JsonValueKind.Null => null,
                System.Text.Json.JsonValueKind.True => true,
                System.Text.Json.JsonValueKind.False => false,
                _ => (object?)p.Value.ToString(),
            }),
        _ => null,
    };

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
