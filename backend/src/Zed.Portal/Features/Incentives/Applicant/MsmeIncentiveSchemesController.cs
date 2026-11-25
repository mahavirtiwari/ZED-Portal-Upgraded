using Microsoft.AspNetCore.Mvc;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Msme.Schemes;
using static Zed.Portal.Features.Incentives.Applicant.SchemeApplicantService;

namespace Zed.Portal.Features.Incentives.Applicant;

/// <summary>
/// The applicant side of the incentive schemes on the web (2026-11-20, approved design): the dashboard tiles of the Admin's
/// schemes and one scheme's page (draft, sections, "Add more" items, documents, submission, correction round). The logic is
/// <see cref="SchemeApplicantService"/>, shared with the ZED MSME app (<see cref="MsmeAppIncentiveSchemesController"/>,
/// 2026-11-25); the ZED ID always comes from the sign-in cookie.
/// </summary>
[Route("api/msme/incentive-schemes")]
public sealed class MsmeIncentiveSchemesController(SchemeApplicantService schemes) : MsmeApiController
{
    public const string TuCard = SchemeApplicantService.TuCard;
    public const string FaCard = SchemeApplicantService.FaCard;
    public const string TechnologiesSql = SchemeApplicantService.TechnologiesSql;
    public const string SaveAnswersSql = SchemeApplicantService.SaveAnswersSql;
    public const string SubmitSql = SchemeApplicantService.SubmitSql;
    public const string CorrectionSql = SchemeApplicantService.CorrectionSql;
    public const string LegacyInvoiceField = SchemeApplicantService.LegacyInvoiceField;

    /// <summary>The 2-digit NIC code at the start of the unit's sector ("24 - Manufacture of basic metals" → "24"), or null.</summary>
    internal static string? SectorCode(string? twoDigitActivity) => SchemeApplicantService.SectorCode(twoDigitActivity);

    /// <summary>The answer of the service: 404, a 400 problem with the applicant's sentence, or the value.</summary>
    private ActionResult<T> Answer<T>(Outcome<T> r) where T : class
    {
        if (r.Missing) return NotFound();
        if (r.Problem is { } problem) return this.Problem400(problem);
        return r.Value!;
    }

    /// <summary>
    /// GET api/msme/incentive-schemes — the schemes' tiles, the Financial Assistance card's scheme (2026-11-20) and the Technology
    /// Upgradation card's direct scheme, with the legacy applications in progress the two cards open instead.
    /// </summary>
    [HttpGet]
    public async Task<ActionResult<DashboardDto>> Dashboard(CancellationToken ct) => Answer(await schemes.DashboardAsync(ZedId, ct));

    /// <summary>GET api/msme/incentive-schemes/{code} — the scheme's form, the unit, the claim window, the application and its history.</summary>
    [HttpGet("{code}")]
    public async Task<ActionResult<PageDto>> Page(string code, CancellationToken ct) => Answer(await schemes.PageAsync(ZedId, code, ct));

    /// <summary>POST api/msme/incentive-schemes/{code}/draft — starts (or returns) the application of the open claim window.</summary>
    [HttpPost("{code}/draft")]
    [MsmeEditAudit("Incentive scheme: application started")]
    public async Task<ActionResult<PageDto>> Draft(string code, CancellationToken ct) => Answer(await schemes.DraftAsync(ZedId, code, ct));

    /// <summary>PUT api/msme/incentive-schemes/{code}/sections/{section} — a plain section's values, checked as a whole.</summary>
    [HttpPut("{code}/sections/{section}")]
    [MsmeEditAudit("Incentive scheme: section saved")]
    public async Task<ActionResult<PageDto>> SaveSection(string code, string section, SectionRequest req, CancellationToken ct) =>
        Answer(await schemes.SaveSectionAsync(ZedId, code, section, req, ct));

    /// <summary>PUT api/msme/incentive-schemes/{code}/sections/{section}/items/{index} — an "Add more" item (index = count: a new one).</summary>
    [HttpPut("{code}/sections/{section}/items/{index:int}")]
    [MsmeEditAudit("Incentive scheme: item saved")]
    public async Task<ActionResult<PageDto>> SaveItem(string code, string section, int index, ItemRequest req, CancellationToken ct) =>
        Answer(await schemes.SaveItemAsync(ZedId, code, section, index, req, ct));

    /// <summary>DELETE api/msme/incentive-schemes/{code}/sections/{section}/items/{index} — removes an "Add more" item of the draft.</summary>
    [HttpDelete("{code}/sections/{section}/items/{index:int}")]
    [MsmeEditAudit("Incentive scheme: item removed")]
    public async Task<ActionResult<PageDto>> RemoveItem(string code, string section, int index, CancellationToken ct) =>
        Answer(await schemes.RemoveItemAsync(ZedId, code, section, index, ct));

    /// <summary>
    /// POST api/msme/incentive-schemes/{code}/documents (multipart: section, item, field, file) — one document of a field (or the
    /// cancelled cheque: section "_bank", field "cheque"), PDF / JPEG / PNG up to 5 MB (a photo field: JPEG / PNG). The page then
    /// saves the item with the returned name.
    /// </summary>
    [HttpPost("{code}/documents")]
    [MsmeEditAudit("Incentive scheme: document uploaded")]
    [RequestSizeLimit(SchemeUploads.MaxBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = SchemeUploads.MaxBytes + 64 * 1024)]
    public async Task<ActionResult<UploadDto>> Upload(string code, [FromForm] string? section, [FromForm] int? item, [FromForm] string? field,
        IFormFile? file, CancellationToken ct) =>
        Answer(await schemes.UploadAsync(ZedId, code, section, item, field, file, FileUrl, ct));

    /// <summary>GET api/msme/incentive-schemes/{code}/files/{name} — one of the signed-in unit's own scheme documents.</summary>
    [HttpGet("{code}/files/{name}")]
    public IActionResult Document(string code, string name)
    {
        var full = schemes.DocumentPath(ZedId, name);
        return full is null ? NotFound() : SchemeUploads.Serve(this, full);
    }

    /// <summary>POST api/msme/incentive-schemes/{code}/submit — the whole form checked, the amounts computed, then the staff workflow.</summary>
    [HttpPost("{code}/submit")]
    [MsmeEditAudit("Incentive scheme: application submitted")]
    public async Task<ActionResult<PageDto>> Submit(string code, SubmitRequest req, CancellationToken ct) =>
        Answer(await schemes.SubmitAsync(ZedId, code, req, ct));

    /// <summary>
    /// POST api/msme/incentive-schemes/{code}/correction — the corrected answers (saved by the section / item PUTs) go back to the
    /// assessor; the bank account and the cancelled cheque change here when they were found not valid. Refused after the round's date.
    /// </summary>
    [HttpPost("{code}/correction")]
    [MsmeEditAudit("Incentive scheme: corrections submitted")]
    public async Task<ActionResult<PageDto>> Correction(string code, CorrectionRequest req, CancellationToken ct) =>
        Answer(await schemes.CorrectionAsync(ZedId, code, req, ct));

    private static string FileUrl(string code, string name) =>
        $"/api/msme/incentive-schemes/{Uri.EscapeDataString(code)}/files/{Uri.EscapeDataString(name)}";
}
