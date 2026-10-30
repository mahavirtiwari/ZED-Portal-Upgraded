using System.Data.Common;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Microsoft.Net.Http.Headers;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Staff.Masters;

namespace Zed.Portal.Features.CertLevels;

/// <summary>
/// Administration → Certification Levels (new in V4): the boxes of the certification levels (Bronze, Silver, Gold,
/// ZED-X, and levels the Admin adds): name, logo, description and information text, shown or hidden, and their
/// certificate settings (validity, surveillance, number formats in general and for Manufacturing / Services).
/// Kept in dbo.SectionTypes (migration 0028), per system (Main and Surveillance, which have the questionnaire).
/// </summary>
[Route("api/staff/settings/levels")]
[StaffRoles(UserRole.Admin)]
[PortalSystems(PortalSystem.Main, PortalSystem.Surveillance)]
public sealed partial class CertificationLevelsController(
    ISqlExecutor db, IWebHostEnvironment env, IOptions<PortalOptions> portal, ILogger<CertificationLevelsController> log) : StaffApiController
{
    public sealed record LevelItem(CertificationLevel Level, string Sample, string? LogoUrl);

    public sealed record LevelsResponse(IReadOnlyList<LevelItem> Levels, IReadOnlyList<string> Tokens, bool Stored);

    [HttpGet]
    public async Task<LevelsResponse> List(CancellationToken ct)
    {
        var levels = await CertificationLevels.AllAsync(db, log, ct);
        var stored = !ReferenceEquals(levels, CertificationLevels.BuiltIn);
        return new LevelsResponse(levels.Select(Item).ToList(), CertificateNumbers.Tokens, stored);
    }

    internal static LevelItem Item(CertificationLevel l) =>
        new(l, CertificateNumbers.Format(l.CertNoFormat, DateTime.Today, "ZEDMSME129350", l.Code, null), LogoUrl(l));

    /// <summary>The level's logo: the uploaded one, or the built-in picture of Bronze / Silver / Gold.</summary>
    public static string? LogoUrl(CertificationLevel l) =>
        l.LogoPath is { Length: > 0 } ? $"/api/public/levels/{Uri.EscapeDataString(l.Code)}/logo?v={l.UpdatedOn?.Ticks ?? 0}"
        : l.Code is "Bronze" or "Silver" or "Gold" ? $"/Images/Dashboard/{l.Code.ToLowerInvariant()}.png"
        : l.Code == "ZEDX" ? "/Images/Dashboard/zedx.svg"
        : null;

    /// <param name="Name">What pages show ("ZED-X").</param>
    public sealed record LevelRequest(
        string? Name, string? Description, string? Comment, bool IsEnabled, string? AssessmentMode, int? ValidityMonths,
        bool SurveillanceEnabled, int? FirstSurveillanceMonths, string? CertNoFormat, string? CertNoFormatManufacturing,
        string? CertNoFormatService, decimal? Fee, string? Code = null,
        int? SurveillanceCount = null, int? SurveillanceIntervalMonths = null, int? SurveillanceNoticeMonths = null, int? SurveillanceReminders = null,
        int? SurveillanceReminderEveryMonths = null, int? SurveillanceSuspendAfterMonths = null, int? SurveillanceWithdrawAfterDays = null,
        bool? SurveillanceAutoApply = null, int? SurveillanceSuspendRounds = null);

    internal const string UpdateSql =
        "UPDATE dbo.SectionTypes SET DisplayName = @Name, Description = @Description, Comment = @Comment, IsEnabled = @IsEnabled, " +
        "AssessmentMode = @AssessmentMode, ValidityMonths = @ValidityMonths, SurveillanceEnabled = @SurveillanceEnabled, " +
        "FirstSurveillanceMonths = @FirstSurveillanceMonths, CertNoFormat = @CertNoFormat, CertNoFormatManufacturing = @CertNoFormatManufacturing, " +
        "CertNoFormatService = @CertNoFormatService, Fee = @Fee, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME(), " +
        "SurveillanceCount = @SurveillanceCount, SurveillanceIntervalMonths = @SurveillanceIntervalMonths, SurveillanceNoticeMonths = @SurveillanceNoticeMonths, " +
        "SurveillanceReminders = @SurveillanceReminders, SurveillanceReminderEveryMonths = @SurveillanceReminderEveryMonths, " +
        "SurveillanceSuspendAfterMonths = @SurveillanceSuspendAfterMonths, SurveillanceWithdrawAfterDays = @SurveillanceWithdrawAfterDays, " +
        "SurveillanceAutoApply = @SurveillanceAutoApply, SurveillanceSuspendRounds = @SurveillanceSuspendRounds " +
        "WHERE SectionType = @Code AND IsCertificationLevel = 1;";

    internal const string InsertSql =
        "INSERT INTO dbo.SectionTypes (SectionType, OrderNo, DisplayName, Description, Comment, IsEnabled, IsCertificationLevel, AssessmentMode, " +
        "ValidityMonths, SurveillanceEnabled, FirstSurveillanceMonths, CertNoFormat, CertNoFormatManufacturing, CertNoFormatService, Fee, UpdatedBy, UpdatedOn, " +
        "SurveillanceCount, SurveillanceIntervalMonths, SurveillanceNoticeMonths, SurveillanceReminders, SurveillanceReminderEveryMonths, " +
        "SurveillanceSuspendAfterMonths, SurveillanceWithdrawAfterDays, SurveillanceAutoApply, SurveillanceSuspendRounds) " +
        "SELECT @Code, ISNULL(MAX(CASE WHEN IsCertificationLevel = 1 THEN OrderNo END), 0) + 10, @Name, @Description, @Comment, @IsEnabled, 1, @AssessmentMode, " +
        "@ValidityMonths, @SurveillanceEnabled, @FirstSurveillanceMonths, @CertNoFormat, @CertNoFormatManufacturing, @CertNoFormatService, @Fee, " +
        "@UpdatedBy, SYSUTCDATETIME(), @SurveillanceCount, @SurveillanceIntervalMonths, @SurveillanceNoticeMonths, @SurveillanceReminders, " +
        "@SurveillanceReminderEveryMonths, @SurveillanceSuspendAfterMonths, @SurveillanceWithdrawAfterDays, @SurveillanceAutoApply, @SurveillanceSuspendRounds " +
        "FROM dbo.SectionTypes;";

    [HttpPut("{code}")]
    public async Task<ActionResult<MessageResponse>> Update(string code, LevelRequest req, CancellationToken ct)
    {
        if (await StoredAsync(code, ct) is not { } level) return NotFound();
        if (Validate(req) is { } problem) return this.Problem400(problem);
        if (!await RunAsync(UpdateSql, Args(level.Code, req), ct)) return Unavailable();
        log.LogInformation("Certification level {Code} saved ({State}) by {Actor}", level.Code, req.IsEnabled ? "enabled" : "disabled", UserId);
        return new MessageResponse($"{req.Name!.Trim()} saved.");
    }

    public sealed record SwitchRequest(bool Enabled);

    internal const string SwitchSql =
        "UPDATE dbo.SectionTypes SET IsEnabled = @Enabled, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME() WHERE SectionType = @Code AND IsCertificationLevel = 1;";

    /// <summary>Shows or hides a level for MSMEs (its questionnaire, fees and certificates stay).</summary>
    [HttpPut("{code}/enabled")]
    public async Task<ActionResult<MessageResponse>> Switch(string code, SwitchRequest req, CancellationToken ct)
    {
        if (await StoredAsync(code, ct) is not { } level) return NotFound();
        if (!await RunAsync(SwitchSql, new { Code = level.Code, req.Enabled, UpdatedBy = Actor() }, ct)) return Unavailable();
        log.LogWarning("Certification level {Code} {State} by {Actor}", level.Code, req.Enabled ? "enabled" : "disabled", UserId);
        return new MessageResponse(req.Enabled ? $"{level.Name} is enabled: MSMEs see it." : $"{level.Name} is disabled: MSMEs do not see it.");
    }

    [GeneratedRegex("^[A-Za-z][A-Za-z0-9]{1,19}$")]
    private static partial Regex CodePattern();

    /// <summary>
    /// Adds a level. Its code is stored with its questionnaire, fees and certificates and cannot change; MSMEs can apply
    /// once its questionnaire and fees are in place and it is enabled.
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<MessageResponse>> Add(LevelRequest req, CancellationToken ct)
    {
        var code = req.Code?.Trim() ?? "";
        if (!CodePattern().IsMatch(code)) return this.Problem400("The code must be 2 to 20 letters and digits, starting with a letter (e.g. ZEDX).");
        if (Validate(req) is { } problem) return this.Problem400(problem);
        var all = await CertificationLevels.AllAsync(db, log, ct);
        if (ReferenceEquals(all, CertificationLevels.BuiltIn)) return Unavailable();
        if (all.Any(l => string.Equals(l.Code, code, StringComparison.OrdinalIgnoreCase) || string.Equals(l.Name, req.Name!.Trim(), StringComparison.OrdinalIgnoreCase)))
            return this.Problem400("A level with this code or name already exists.");
        if (!await RunAsync(InsertSql, Args(code, req), ct)) return Unavailable();
        log.LogWarning("Certification level {Code} added by {Actor}", code, UserId);
        return new MessageResponse($"{req.Name!.Trim()} added. Add its questionnaire (Questionnaire menu) and its fees (Masters → Payments) before enabling it.");
    }

    public const long LogoMaxBytes = 1024 * 1024;
    private static readonly MasterUploads.FileType[] LogoTypes = MasterUploads.DocumentTypes.Where(t => t.Extension is ".png" or ".jpg").ToArray();

    internal const string LogoSql =
        "UPDATE dbo.SectionTypes SET LogoPath = @LogoPath, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME() WHERE SectionType = @Code AND IsCertificationLevel = 1;";

    /// <summary>The level's logo (PNG or JPG, up to 1 MB), saved as Uploads/Levels/{code}{ext}.</summary>
    [HttpPost("{code}/logo")]
    [RequestSizeLimit(LogoMaxBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = LogoMaxBytes + 64 * 1024)]
    public async Task<ActionResult<MessageResponse>> Logo(string code, IFormFile? file, CancellationToken ct)
    {
        if (await StoredAsync(code, ct) is not { } level) return NotFound();
        var (type, error) = await MasterUploads.CheckAsync(file, LogoTypes, LogoMaxBytes, ct);
        if (type is null) return this.Problem400(error!);
        var relative = $"Uploads/Levels/{level.Code}{type.Extension}";
        var root = MsmeFilePaths.Root(env, portal.Value);
        var full = MsmeFilePaths.Resolve(root, relative) ?? throw new InvalidOperationException("Invalid logo path.");
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        var temp = full + "." + Guid.NewGuid().ToString("N") + ".tmp";
        await using (var fs = System.IO.File.Create(temp))
            await file!.CopyToAsync(fs, ct);
        System.IO.File.Move(temp, full, overwrite: true);
        if (!await RunAsync(LogoSql, new { Code = level.Code, LogoPath = relative, UpdatedBy = Actor() }, ct)) return Unavailable();
        log.LogInformation("Logo of certification level {Code} uploaded by {Actor}", level.Code, UserId);
        return new MessageResponse("Logo saved.");
    }

    private static string? Validate(LevelRequest r)
    {
        var name = r.Name?.Trim() ?? "";
        if (name.Length == 0) return "Please enter the level's name.";
        if (name.Length > 100) return "The name can be up to 100 characters.";
        if ((r.Description?.Trim().Length ?? 0) > 1000) return "The description can be up to 1000 characters.";
        if ((r.Comment?.Trim().Length ?? 0) > 2000) return "The comment can be up to 2000 characters.";
        if (new[] { name, r.Description ?? "", r.Comment ?? "" }.Any(t => t.Any(c => char.IsControl(c) && c is not '\n' and not '\r')))
            return "The text contains invalid characters.";
        if (r.AssessmentMode is not (CertificationLevels.Desktop or CertificationLevels.Site)) return "Please choose desktop or desktop and site assessment.";
        if (r.ValidityMonths is not (>= 1 and <= 120)) return "The validity must be 1 to 120 months.";
        if (r.SurveillanceEnabled && r.FirstSurveillanceMonths is not (>= 1 and <= 120)) return "The first surveillance must be due 1 to 120 months after certification.";
        if (r.SurveillanceEnabled && r.FirstSurveillanceMonths >= r.ValidityMonths) return "The first surveillance must be due before the certificate expires.";
        if (CertificateNumbers.Problem(r.CertNoFormat) is { } general) return general;
        if (CertificateNumbers.Problem(r.CertNoFormatManufacturing, required: false) is { } m) return "Manufacturing: " + m;
        if (CertificateNumbers.Problem(r.CertNoFormatService, required: false) is { } s) return "Services: " + s;
        if (r.Fee is < 0 or > 10_000_000) return "The fee must be between 0 and 1,00,00,000.";
        if (r.SurveillanceEnabled && Schedule(r).Problem(r.ValidityMonths!.Value) is { } schedule) return schedule;
        if (r.SurveillanceEnabled && r.SurveillanceAutoApply == true && r.AssessmentMode != CertificationLevels.Desktop)
            return "Only a desktop assessment level (as Bronze) can be applied for its surveillance by the portal.";
        if (r.SurveillanceEnabled && r.SurveillanceAutoApply == true && (r.SurveillanceReminders ?? SurveillanceSchedule.Default.Reminders) < 1)
            return "To apply for the surveillance on the last reminder, please keep at least one reminder.";
        if (r.SurveillanceEnabled && r.SurveillanceSuspendRounds is < 0 or > 5) return "Please choose which surveillances suspend the certificate.";
        return null;
    }

    private static SurveillanceSchedule Schedule(LevelRequest r)
    {
        var d = SurveillanceSchedule.Default;
        return new(r.FirstSurveillanceMonths ?? d.FirstDueMonths, r.SurveillanceCount ?? d.Count, r.SurveillanceIntervalMonths ?? d.IntervalMonths,
            r.SurveillanceNoticeMonths ?? d.NoticeMonths, r.SurveillanceReminders ?? d.Reminders, r.SurveillanceReminderEveryMonths ?? d.ReminderEveryMonths,
            r.SurveillanceSuspendAfterMonths ?? d.SuspendAfterMonths, r.SurveillanceWithdrawAfterDays ?? d.WithdrawAfterDays);
    }

    private object Args(string code, LevelRequest r)
    {
        var schedule = r.SurveillanceEnabled ? Schedule(r) : null;
        return new
        {
        Code = code, Name = r.Name!.Trim(), Description = Text(r.Description), Comment = Text(r.Comment), r.IsEnabled, r.AssessmentMode,
        r.ValidityMonths, r.SurveillanceEnabled, FirstSurveillanceMonths = r.SurveillanceEnabled ? r.FirstSurveillanceMonths : null,
        CertNoFormat = r.CertNoFormat!.Trim(), CertNoFormatManufacturing = Text(r.CertNoFormatManufacturing), CertNoFormatService = Text(r.CertNoFormatService),
        r.Fee, UpdatedBy = Actor(),
        SurveillanceCount = schedule?.Count, SurveillanceIntervalMonths = schedule?.IntervalMonths, SurveillanceNoticeMonths = schedule?.NoticeMonths,
        SurveillanceReminders = schedule?.Reminders, SurveillanceReminderEveryMonths = schedule?.ReminderEveryMonths,
        SurveillanceSuspendAfterMonths = schedule?.SuspendAfterMonths, SurveillanceWithdrawAfterDays = schedule?.WithdrawAfterDays,
        SurveillanceAutoApply = schedule is null ? (bool?)null : r.SurveillanceAutoApply == true && r.AssessmentMode == CertificationLevels.Desktop,
        SurveillanceSuspendRounds = schedule is null ? null : r.SurveillanceSuspendRounds,
        };
    }

    private static string? Text(string? v) => string.IsNullOrWhiteSpace(v) ? null : v.Trim();

    /// <summary>A level stored in the table (none before migration 0028).</summary>
    private async Task<CertificationLevel?> StoredAsync(string code, CancellationToken ct)
    {
        var all = await CertificationLevels.AllAsync(db, log, ct);
        return ReferenceEquals(all, CertificationLevels.BuiltIn) ? null
            : all.FirstOrDefault(l => string.Equals(l.Code, code, StringComparison.OrdinalIgnoreCase));
    }

    private async Task<bool> RunAsync(string sql, object args, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(sql, args, ct);
            return true;
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Certification level not saved (is migration 0028 applied?)");
            return false;
        }
    }

    private ActionResult Unavailable() =>
        this.Problem400("The certification levels cannot be saved yet. Please ask the administrator to apply the database migrations (0028, 0032, 0037).");

    private string Actor() => UserId.Length <= 50 ? UserId : UserId[..50];
}

/// <summary>The enabled levels for the MSME pages, and the logos (no sign-in: the dashboard and public pages show them).</summary>
[ApiController]
[AllowAnonymous]
[Route("api/public/levels")]
public sealed class PublicLevelsController(ISqlExecutor db, IWebHostEnvironment env, IOptions<PortalOptions> portal, ILogger<PublicLevelsController> log) : ControllerBase
{
    public sealed record PublicLevel(string Code, string Name, string? Description, string? Comment, string? LogoUrl, string AssessmentMode,
        int ValidityMonths, decimal? Fee, PublicSurveillance? Surveillance = null);

    /// <summary>
    /// When surveillance falls due, for the level's dashboard card; null without surveillance. Every level gives its whole
    /// schedule (Bronze / Silver / Gold too, since the V4 schedule runs them: migration 0037), as the Admin's card shows it.
    /// </summary>
    public sealed record PublicSurveillance(int FirstDueMonths, int? Count, int? IntervalMonths);

    [HttpGet]
    public async Task<IReadOnlyList<PublicLevel>> Enabled(CancellationToken ct) =>
        (await CertificationLevels.AllAsync(db, log, ct)).Where(l => l.IsEnabled)
            .Select(l => new PublicLevel(l.Code, l.Name, l.Description, l.Comment, CertificationLevelsController.LogoUrl(l), l.AssessmentMode, l.ValidityMonths, l.Fee,
                SurveillanceOf(l)))
            .ToList();

    internal static PublicSurveillance? SurveillanceOf(CertificationLevel l)
    {
        if (!l.SurveillanceEnabled) return null;
        var s = l.Schedule;
        return new PublicSurveillance(s.FirstDueMonths, s.Count, s.IntervalMonths);
    }

    [HttpGet("{code}/logo")]
    public async Task<IActionResult> Logo(string code, CancellationToken ct)
    {
        var level = await CertificationLevels.FindAsync(db, code, log, ct);
        if (level?.LogoPath is not { Length: > 0 } relative) return NotFound();
        var full = MsmeFilePaths.Resolve(MsmeFilePaths.Root(env, portal.Value), relative);
        if (full is null || !System.IO.File.Exists(full)) return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "public, max-age=3600";
        return PhysicalFile(full, relative.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ? "image/png" : "image/jpeg");
    }
}
