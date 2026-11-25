using Microsoft.AspNetCore.Mvc;
using Zed.Core.Mobile;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Msme.Schemes;
using static Zed.Portal.Features.Incentives.Applicant.SchemeApplicantService;

namespace Zed.Portal.Features.Incentives.Applicant;

/// <summary>
/// New (2026-11-25, the product owner: the Admin's incentive schemes in the ZED MSME app with the full forms): the incentive
/// schemes of the web page (<see cref="MsmeIncentiveSchemesController"/>) with the app's sign-in token (<see cref="AppTokens.Header"/>,
/// as <see cref="MsmeAppProfileController"/>): the dashboard tiles, one scheme's page, the draft, the plain sections and the
/// "Add more" items, the documents (multipart, camera / gallery / PDF of the app), the submission and the answers to a correction
/// round. The logic is <see cref="SchemeApplicantService"/>, the same as the web's; the ZED ID is always the token's unit, never a
/// value of the request. The app's client has GET and POST only, so the saves and the removal are POSTs. Answers
/// <c>{status: "1", dashboard | page | upload}</c> (the web's JSON, camelCase) or <c>{status: "0", errorMessage}</c> with the
/// web's sentence; 401 when the token is not accepted (the app then signs out). Each change is in the unit's Edit History
/// (channel Mobile), as the web's.
/// </summary>
public sealed class MsmeAppIncentiveSchemesController(SchemeApplicantService schemes, IMsmeEditHistory history, AppTokens tokens) : LegacyMobileController
{
    /// <summary>The answer when the scheme (or the unit) is not there (the web's 404).</summary>
    public const string NotAvailableMessage = "This scheme is not available for your unit.";

    public sealed record AppSectionRequest(string? Section, Dictionary<string, string?>? Values);

    public sealed record AppItemRequest(string? Section, int? Index, string? Pick, Dictionary<string, string?>? Values);

    public sealed record AppRemoveRequest(string? Section, int? Index);

    /// <summary>Why the last <see cref="UnitAsync"/> refused the token.</summary>
    private AppTokenCheck refusal = AppTokenCheck.Missing;

    /// <summary>The unit of a valid ZED MSME app token, else null.</summary>
    private async Task<string?> UnitAsync(CancellationToken ct)
    {
        var (zedId, check) = await MsmeAppToken.UnitAsync(Request, tokens, ct);
        refusal = check;
        return zedId;
    }

    /// <summary>The service's answer for the app: <c>{status: "1", name: value}</c>, else <c>{status: "0", errorMessage}</c>.</summary>
    private static IActionResult Answer<T>(Outcome<T> r, string name) where T : class
    {
        if (r.Missing) return Refused(NotAvailableMessage);
        if (r.Problem is { } problem) return Refused(problem);
        return new JsonResult(new Dictionary<string, object?> { ["status"] = "1", [name] = r.Value });
    }

    private static JsonResult Refused(string message) => new(new { status = "0", errorMessage = message });

    /// <summary>A change of the unit's application in its Edit History, as the web's <see cref="MsmeEditAuditAttribute"/> records it.</summary>
    private async Task<IActionResult> AuditedAsync<T>(string zedId, string action, IDictionary<string, object?> request, Outcome<T> r, string name, CancellationToken ct)
        where T : class
    {
        var problem = r.Missing ? NotAvailableMessage : r.Problem;
        await history.RecordAsync(new MsmeEdit
        {
            Channel = LoginChannels.Mobile, ZedId = zedId, Action = action, Path = Request.Path.Value, Success = problem is null, Message = problem,
            IpAddress = ClientIp, Data = MsmeEditAuditAttribute.Snapshot(request),
            UserAgent = Request.Headers.UserAgent.ToString() is { Length: > 0 } ua ? ua : null,
        }, ct);
        return Answer(r, name);
    }

    /// <summary>GET /Msme/AppIncentiveSchemes — the dashboard tiles (as GET api/msme/incentive-schemes).</summary>
    [HttpGet("/Msme/AppIncentiveSchemes")]
    public async Task<IActionResult> Dashboard(CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return MsmeAppToken.Refused(this, refusal);
        return Answer(await schemes.DashboardAsync(zedId, ct), "dashboard");
    }

    /// <summary>GET /Msme/AppIncentiveSchemes/{code} — the scheme's page (as GET api/msme/incentive-schemes/{code}).</summary>
    [HttpGet("/Msme/AppIncentiveSchemes/{code}")]
    public async Task<IActionResult> Page([FromRoute] string code, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return MsmeAppToken.Refused(this, refusal);
        return Answer(await schemes.PageAsync(zedId, code, ct), "page");
    }

    /// <summary>POST /Msme/AppIncentiveSchemes/{code}/Draft — starts (or returns) the application of the open claim window.</summary>
    [HttpPost("/Msme/AppIncentiveSchemes/{code}/Draft")]
    public async Task<IActionResult> Draft([FromRoute] string code, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return MsmeAppToken.Refused(this, refusal);
        return await AuditedAsync(zedId, "Incentive scheme: application started", new Dictionary<string, object?> { ["code"] = code },
            await schemes.DraftAsync(zedId, code, ct), "page", ct);
    }

    /// <summary>POST /Msme/AppIncentiveSchemes/{code}/Section — a plain section's values, checked as a whole.</summary>
    [HttpPost("/Msme/AppIncentiveSchemes/{code}/Section")]
    public async Task<IActionResult> SaveSection([FromRoute] string code, [FromBody] AppSectionRequest? req, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return MsmeAppToken.Refused(this, refusal);
        var r = await schemes.SaveSectionAsync(zedId, code, req?.Section ?? "", new SectionRequest(req?.Values), ct);
        return await AuditedAsync(zedId, "Incentive scheme: section saved", new Dictionary<string, object?> { ["code"] = code, ["req"] = req }, r, "page", ct);
    }

    /// <summary>POST /Msme/AppIncentiveSchemes/{code}/Item — an "Add more" item (index = count: a new one).</summary>
    [HttpPost("/Msme/AppIncentiveSchemes/{code}/Item")]
    public async Task<IActionResult> SaveItem([FromRoute] string code, [FromBody] AppItemRequest? req, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return MsmeAppToken.Refused(this, refusal);
        var r = req?.Index is not { } index
            ? new Outcome<PageDto>(null, "Invalid item.", false)
            : await schemes.SaveItemAsync(zedId, code, req.Section ?? "", index, new ItemRequest(req.Pick, req.Values), ct);
        return await AuditedAsync(zedId, "Incentive scheme: item saved", new Dictionary<string, object?> { ["code"] = code, ["req"] = req }, r, "page", ct);
    }

    /// <summary>POST /Msme/AppIncentiveSchemes/{code}/RemoveItem — removes an "Add more" item of the draft.</summary>
    [HttpPost("/Msme/AppIncentiveSchemes/{code}/RemoveItem")]
    public async Task<IActionResult> RemoveItem([FromRoute] string code, [FromBody] AppRemoveRequest? req, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return MsmeAppToken.Refused(this, refusal);
        var r = req?.Index is not { } index
            ? new Outcome<PageDto>(null, "Invalid item.", false)
            : await schemes.RemoveItemAsync(zedId, code, req.Section ?? "", index, ct);
        return await AuditedAsync(zedId, "Incentive scheme: item removed", new Dictionary<string, object?> { ["code"] = code, ["req"] = req }, r, "page", ct);
    }

    /// <summary>
    /// POST /Msme/AppIncentiveSchemes/{code}/Document (multipart: section, item, field, file) — one document of a field (or the
    /// cancelled cheque: section "_bank", field "cheque"); the app then saves the item with the returned name.
    /// </summary>
    [HttpPost("/Msme/AppIncentiveSchemes/{code}/Document")]
    [RequestSizeLimit(SchemeUploads.MaxBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = SchemeUploads.MaxBytes + 64 * 1024)]
    public async Task<IActionResult> Upload([FromRoute] string code, [FromForm] string? section, [FromForm] int? item, [FromForm] string? field, [FromForm] IFormFile? file,
        CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return MsmeAppToken.Refused(this, refusal);
        var r = await schemes.UploadAsync(zedId, code, section, item, field, file, FileUrl, ct);
        return await AuditedAsync(zedId, "Incentive scheme: document uploaded",
            new Dictionary<string, object?> { ["code"] = code, ["section"] = section, ["item"] = item, ["field"] = field, ["file"] = file }, r, "upload", ct);
    }

    /// <summary>GET /Msme/AppIncentiveSchemes/{code}/File?name= — one of the unit's own scheme documents (the app downloads it with the token).</summary>
    [HttpGet("/Msme/AppIncentiveSchemes/{code}/File")]
    public async Task<IActionResult> Document([FromRoute] string code, [FromQuery] string? name, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return MsmeAppToken.Refused(this, refusal);
        var full = string.IsNullOrWhiteSpace(name) ? null : schemes.DocumentPath(zedId, name);
        return full is null ? NotFound() : SchemeUploads.Serve(this, full);
    }

    /// <summary>POST /Msme/AppIncentiveSchemes/{code}/Submit — the whole form checked, the amounts computed, then the staff workflow.</summary>
    [HttpPost("/Msme/AppIncentiveSchemes/{code}/Submit")]
    public async Task<IActionResult> Submit([FromRoute] string code, [FromBody] SubmitRequest? req, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return MsmeAppToken.Refused(this, refusal);
        var r = await schemes.SubmitAsync(zedId, code, req ?? new SubmitRequest(null, null, false, false), ct);
        return await AuditedAsync(zedId, "Incentive scheme: application submitted", new Dictionary<string, object?> { ["code"] = code, ["req"] = req }, r, "page", ct);
    }

    /// <summary>POST /Msme/AppIncentiveSchemes/{code}/Correction — the corrections go back to the assessor (by the round's date).</summary>
    [HttpPost("/Msme/AppIncentiveSchemes/{code}/Correction")]
    public async Task<IActionResult> Correction([FromRoute] string code, [FromBody] CorrectionRequest? req, CancellationToken ct)
    {
        if (await UnitAsync(ct) is not { } zedId) return MsmeAppToken.Refused(this, refusal);
        var r = await schemes.CorrectionAsync(zedId, code, req ?? new CorrectionRequest(null, null), ct);
        return await AuditedAsync(zedId, "Incentive scheme: corrections submitted", new Dictionary<string, object?> { ["code"] = code, ["req"] = req }, r, "page", ct);
    }

    /// <summary>The address the app downloads a document from (relative to the portal).</summary>
    private static string FileUrl([FromRoute] string code, string name) =>
        $"/Msme/AppIncentiveSchemes/{Uri.EscapeDataString(code)}/File?name={Uri.EscapeDataString(name)}";
}
