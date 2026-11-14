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
    ISqlExecutor db, IWebHostEnvironment env, IOptions<PortalOptions> portal, PortalHost host, ILogger<CertificationLevelsController> log) : StaffApiController
{
    /// <param name="Fees">2026-11-08: the level's fees in Masters → Payments (with GST, before subsidy) by enterprise type.</param>
    /// <param name="Readiness">2026-11-08 (generic levels): what a V4 level still needs before it can be enabled.</param>
    public sealed record LevelItem(CertificationLevel Level, string Sample, string? LogoUrl)
    {
        public IReadOnlyList<LevelFee> Fees { get; init; } = [];
        public LevelReadiness Readiness { get; init; } = LevelReadiness.Complete(0);
        /// <summary>2026-11-14: how the level is assessed (<see cref="LevelFlows"/>) and the surveillance's mode.</summary>
        public string AssessmentFlow { get; init; } = LevelFlows.DesktopOnsite;
        public string SurveillanceMode { get; init; } = LevelFlows.Remote;
        /// <summary>The choices the portal runs today (the others are shown as "available soon").</summary>
        public IReadOnlyList<string> AvailableFlows { get; init; } = LevelFlows.Available;
        public IReadOnlyList<string> AvailableSurveillanceModes { get; init; } = LevelFlows.AvailableSurveillance;
    }

    /// <summary>The checklist of a level (Administration → Certification Levels). Bronze, Silver, Gold and ZED-X: all true.</summary>
    /// <param name="Questionnaire">The level has at least one parameter (dbo.Sections of its code).</param>
    /// <param name="Fees">Masters → Payments has its Micro, Small and Medium fees (dbo.AssessmentFee).</param>
    /// <param name="Artwork">The certificate background and the report picture are there (<see cref="LevelArtwork"/>).</param>
    /// <param name="Agencies">At least one active desktop-verification agency may be allotted the level (Users.Allow{Code}Assessments).</param>
    /// <param name="Columns">The level's columns exist (Msme.Is{Code}PaymentDone, IsSur{Code}PaymentDone, Users.Allow{Code}Assessments,
    /// ReasonForBlock{Code}; ZED_SURVEILLANCE Msme.Is{Code}PaymentDone).</param>
    /// <param name="ColumnsMessage">Why <paramref name="Columns"/> is false.</param>
    public sealed record LevelReadiness(bool Questionnaire, int ParameterCount, bool Fees, bool Artwork, bool Agencies, bool Columns, string? ColumnsMessage)
    {
        public static LevelReadiness Complete(int parameterCount) => new(true, parameterCount, true, true, true, true, null);

        /// <summary>What keeps the level from being enabled (agencies are not required: the Master Admin can allot by hand).</summary>
        public IReadOnlyList<string> Missing()
        {
            var missing = new List<string>();
            if (!Questionnaire) missing.Add("its questionnaire (Questionnaire menu)");
            if (!Fees) missing.Add("its Micro, Small and Medium fees (Masters → Payments)");
            if (!Artwork) missing.Add("its certificate and report artwork");
            if (!Columns) missing.Add("its database columns (" + (ColumnsMessage ?? ColumnsPending) + ")");
            return missing;
        }
    }

    public const string ColumnsPending = "Ready after the next update";

    public sealed record LevelFee(string Type, decimal? Total);

    public sealed class FeeRow
    {
        public string? Certification { get; init; }
        public string? Type { get; init; }
        public decimal? Total { get; init; }
    }

    /// <summary>The Micro / Small / Medium fee with GST of each level (one value per type; the categories differ only in subsidy).</summary>
    internal const string FeesSql =
        "SELECT LTRIM(RTRIM(Certification)) AS Certification, LTRIM(RTRIM(EnterpriseTypee)) AS Type, MAX(Total) AS Total FROM dbo.AssessmentFee " +
        "WHERE EnterpriseTypee IN ('Micro', 'Small', 'Medium') GROUP BY LTRIM(RTRIM(Certification)), LTRIM(RTRIM(EnterpriseTypee));";

    public sealed record LevelsResponse(IReadOnlyList<LevelItem> Levels, IReadOnlyList<string> Tokens, bool Stored);

    [HttpGet]
    public async Task<LevelsResponse> List(CancellationToken ct)
    {
        var levels = await CertificationLevels.AllAsync(db, log, ct);
        var stored = !ReferenceEquals(levels, CertificationLevels.BuiltIn);
        IReadOnlyList<FeeRow> fees;
        try { fees = await db.QuerySqlAsync<FeeRow>(FeesSql, null, ct); }
        catch (System.Data.Common.DbException ex) { log.LogWarning(ex, "Fees of the levels not readable"); fees = []; }
        string[] order = ["Micro", "Small", "Medium"];
        var parameters = await ParameterCountsAsync(ct);
        var flows = await LevelFlows.StoredAsync(db, log, ct);
        var items = new List<LevelItem>();
        foreach (var l in levels)
        {
            var levelFees = fees.Where(f => string.Equals(f.Certification, l.Code, StringComparison.OrdinalIgnoreCase) && f.Type is not null)
                .OrderBy(f => Array.FindIndex(order, o => string.Equals(o, f.Type, StringComparison.OrdinalIgnoreCase)))
                .Select(f => new LevelFee(f.Type!, f.Total)).ToList();
            var levelFlow = flows.GetValueOrDefault(l.Code);
            items.Add(Item(l) with
            {
                Fees = levelFees, Readiness = await ReadinessAsync(l, levelFees, parameters, ct),
                AssessmentFlow = LevelFlows.FlowOf(levelFlow?.AssessmentFlow, l.AssessmentMode),
                SurveillanceMode = LevelFlows.SurveillanceModeOf(levelFlow?.SurveillanceMode),
            });
        }
        return new LevelsResponse(items, CertificateNumbers.Tokens, stored);
    }

    /// <summary>Bronze, Silver, Gold and ZED-X: their procedures, artwork and columns came with the portal.</summary>
    public static bool IsBuiltIn(string code) => LevelRegistry.BuiltIn.Any(b => string.Equals(b.Code, code, StringComparison.OrdinalIgnoreCase));

    public sealed class CountRow
    {
        public string? Code { get; init; }
        public int Count { get; init; }
    }

    internal const string ParameterCountsSql =
        "SELECT LTRIM(RTRIM(SectionType)) AS Code, COUNT(*) AS Count FROM dbo.Sections WHERE SectionType IS NOT NULL GROUP BY LTRIM(RTRIM(SectionType));";

    private async Task<IReadOnlyList<CountRow>> ParameterCountsAsync(CancellationToken ct)
    {
        try { return await db.QuerySqlAsync<CountRow>(ParameterCountsSql, null, ct); }
        catch (DbException ex) { log.LogWarning(ex, "Parameters of the levels not counted"); return []; }
    }

    /// <summary>Active agencies that do desktop verification and may be allotted the level (the column names the level; NULL = allowed).</summary>
    internal static string AgenciesSql(string code) =>
        "SELECT COUNT(*) FROM dbo.Users WHERE RoleId = 2 AND IsActive = 1 AND DesktopVerification = 1 " +
        $"AND ISNULL([{LevelRegistry.AgencyColumn(code)}], 1) = 1;";

    /// <summary>1 when the level's columns exist: main's four and ZED_SURVEILLANCE's payment flag (main), or the surveillance flag (Surveillance).</summary>
    internal const string ColumnsSql =
        "SELECT CASE WHEN COL_LENGTH('dbo.Msme', @Pay) IS NULL OR COL_LENGTH('dbo.Msme', @SurPay) IS NULL OR COL_LENGTH('dbo.Users', @Allow) IS NULL " +
        "OR COL_LENGTH('dbo.Users', @Reason) IS NULL OR COL_LENGTH('ZED_SURVEILLANCE.dbo.Msme', @Pay) IS NULL THEN 0 ELSE 1 END;";

    internal const string SurveillanceColumnsSql = "SELECT CASE WHEN COL_LENGTH('dbo.Msme', @Pay) IS NULL THEN 0 ELSE 1 END;";

    private async Task<LevelReadiness> ReadinessAsync(CertificationLevel l, IReadOnlyList<LevelFee> fees, IReadOnlyList<CountRow> parameters, CancellationToken ct)
    {
        var count = parameters.Where(p => string.Equals(p.Code, l.Code, StringComparison.OrdinalIgnoreCase)).Sum(p => p.Count);
        if (IsBuiltIn(l.Code) || !LevelRegistry.CodePattern().IsMatch(l.Code)) return LevelReadiness.Complete(count);
        var hasFees = new[] { "Micro", "Small", "Medium" }.All(t => fees.Any(f => string.Equals(f.Type, t, StringComparison.OrdinalIgnoreCase)));
        var artwork = LevelArtwork.Ready(MsmeFilePaths.Root(env, portal.Value), DocumentAssets, l);
        var columns = await ColumnsExistAsync(l.Code, ct);
        var agencies = false;
        if (columns)
        {
            try
            {
                var sql = AgenciesSql(l.Code);
                if (host.System != PortalSystem.Main) sql = sql.Replace("FROM dbo.Users", "FROM ZEDCS_V2_LIVE.dbo.Users");
                agencies = (await db.QuerySqlAsync<int>(sql, null, ct)).FirstOrDefault() > 0;
            }
            catch (DbException ex) { log.LogWarning(ex, "Agencies of level {Code} not counted", l.Code); }
        }
        return new LevelReadiness(count > 0, count, hasFees, artwork, agencies, columns, columns ? null : ColumnsPending);
    }

    private async Task<bool> ColumnsExistAsync(string code, CancellationToken ct)
    {
        try
        {
            var args = new
            {
                Pay = $"Is{code}PaymentDone", SurPay = $"IsSur{code}PaymentDone",
                Allow = LevelRegistry.AgencyColumn(code), Reason = LevelRegistry.AgencyReasonColumn(code),
            };
            return (await db.QuerySqlAsync<int>(host.System == PortalSystem.Main ? ColumnsSql : SurveillanceColumnsSql, args, ct)).FirstOrDefault() == 1;
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Columns of level {Code} not checked", code);
            return false;
        }
    }

    internal static string DocumentAssets => Path.Combine(AppContext.BaseDirectory, "Assets", "Documents");

    /// <summary>The checklist of one level (for the refusal to enable it).</summary>
    private async Task<LevelReadiness> ReadinessAsync(CertificationLevel l, CancellationToken ct)
    {
        IReadOnlyList<FeeRow> fees;
        try { fees = await db.QuerySqlAsync<FeeRow>(FeesSql, null, ct); }
        catch (DbException ex) { log.LogWarning(ex, "Fees of the levels not readable"); fees = []; }
        var levelFees = fees.Where(f => string.Equals(f.Certification, l.Code, StringComparison.OrdinalIgnoreCase) && f.Type is not null)
            .Select(f => new LevelFee(f.Type!, f.Total)).ToList();
        return await ReadinessAsync(l, levelFees, await ParameterCountsAsync(ct), ct);
    }

    /// <summary>Null when the level may be enabled; otherwise why not (V4 levels the Admin added need their checklist complete).</summary>
    private async Task<string?> NotReadyAsync(CertificationLevel level, CancellationToken ct)
    {
        if (IsBuiltIn(level.Code)) return null;
        var missing = (await ReadinessAsync(level, ct)).Missing();
        return missing.Count == 0 ? null : $"{level.Name} cannot be enabled yet. It still needs {string.Join(", ", missing)}.";
    }

    /// <summary>The level registry of this host's level checks, read again after a change (main's table).</summary>
    private async Task RefreshRegistryAsync(CancellationToken ct)
    {
        try { await LevelRegistry.RefreshAsync(db, host.System != PortalSystem.Main, ct); }
        catch (Exception ex) when (ex is DbException or InvalidOperationException) { log.LogWarning(ex, "Certification levels not read again after a change"); }
    }

    internal static LevelItem Item(CertificationLevel l) =>
        new(l, CertificateNumbers.Format(l.CertNoFormat, DateTime.Today, "ZEDM000123", l.Code, null), LogoUrl(l));

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
        bool? SurveillanceAutoApply = null, int? SurveillanceSuspendRounds = null,
        string? AssessmentFlow = null, string? SurveillanceMode = null);

    /// <summary>The request with the old AssessmentMode set from the chosen flow (2026-11-14), and why the flow cannot be saved.</summary>
    private static (LevelRequest Request, string? Problem) WithFlow(LevelRequest req, string code) =>
        (req.AssessmentFlow is { } flow && LevelFlows.Flows.Contains(flow) ? req with { AssessmentMode = LevelFlows.AssessmentModeOf(flow) } : req,
         LevelFlows.Problem(req.AssessmentFlow, req.SurveillanceMode, code));

    /// <summary>Saves the chosen flow and surveillance mode after the level's row; the message's tail when it could not.</summary>
    private async Task<string> SaveFlowAsync(string code, LevelRequest req, CancellationToken ct)
    {
        if (req.AssessmentFlow is null && req.SurveillanceMode is null) return "";
        var flow = req.AssessmentFlow ?? LevelFlows.FlowOf(null, req.AssessmentMode ?? CertificationLevels.Site);
        return await LevelFlows.SaveAsync(db, code, flow, req.SurveillanceMode ?? LevelFlows.Remote, log, ct) ? "" : LevelFlows.NotSaved;
    }

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
        (req, var flowProblem) = WithFlow(req, level.Code);
        if (flowProblem is not null) return this.Problem400(flowProblem);
        if (Validate(req, level.Code) is { } problem) return this.Problem400(problem);
        if (req.IsEnabled && !level.IsEnabled && await NotReadyAsync(level, ct) is { } notReady) return this.Problem400(notReady);
        if (!await RunAsync(UpdateSql, Args(level.Code, req), ct)) return Unavailable();
        var flowNote = await SaveFlowAsync(level.Code, req, ct);
        await RefreshRegistryAsync(ct);
        log.LogInformation("Certification level {Code} saved ({State}) by {Actor}", level.Code, req.IsEnabled ? "enabled" : "disabled", UserId);
        return new MessageResponse($"{req.Name!.Trim()} saved." + flowNote);
    }

    public sealed record SwitchRequest(bool Enabled);

    internal const string SwitchSql =
        "UPDATE dbo.SectionTypes SET IsEnabled = @Enabled, UpdatedBy = @UpdatedBy, UpdatedOn = SYSUTCDATETIME() WHERE SectionType = @Code AND IsCertificationLevel = 1;";

    /// <summary>Shows or hides a level for MSMEs (its questionnaire, fees and certificates stay).</summary>
    [HttpPut("{code}/enabled")]
    public async Task<ActionResult<MessageResponse>> Switch(string code, SwitchRequest req, CancellationToken ct)
    {
        if (await StoredAsync(code, ct) is not { } level) return NotFound();
        if (req.Enabled && await NotReadyAsync(level, ct) is { } notReady) return this.Problem400(notReady);
        if (!await RunAsync(SwitchSql, new { Code = level.Code, req.Enabled, UpdatedBy = Actor() }, ct)) return Unavailable();
        await RefreshRegistryAsync(ct);
        log.LogWarning("Certification level {Code} {State} by {Actor}", level.Code, req.Enabled ? "enabled" : "disabled", UserId);
        return new MessageResponse(req.Enabled ? $"{level.Name} is enabled: MSMEs see it." : $"{level.Name} is disabled: MSMEs do not see it.");
    }

    private static Regex CodePattern() => LevelRegistry.CodePattern();

    /// <summary>
    /// Adds a level. Its code is stored with its questionnaire, fees and certificates and cannot change; MSMEs can apply
    /// once its questionnaire and fees are in place and it is enabled. 2026-11-08 (generic levels): a new level is stored
    /// disabled (it can be enabled once its checklist is complete); the portal adds its database columns
    /// (<see cref="ColumnsDdl"/>; when its SQL login may not, migration 0065 does on the next update) and gives it a QR digit.
    /// </summary>
    [HttpPost]
    public async Task<ActionResult<MessageResponse>> Add(LevelRequest req, CancellationToken ct)
    {
        var code = req.Code?.Trim() ?? "";
        if (!CodePattern().IsMatch(code)) return this.Problem400("The code must be 2 to 20 letters and digits, starting with a letter (e.g. ZEDX).");
        (req, var flowProblem) = WithFlow(req, code);
        if (flowProblem is not null) return this.Problem400(flowProblem);
        if (Validate(req, code) is { } problem) return this.Problem400(problem);
        var all = await CertificationLevels.AllAsync(db, log, ct);
        if (ReferenceEquals(all, CertificationLevels.BuiltIn)) return Unavailable();
        if (all.Any(l => string.Equals(l.Code, code, StringComparison.OrdinalIgnoreCase) || string.Equals(l.Name, req.Name!.Trim(), StringComparison.OrdinalIgnoreCase)))
            return this.Problem400("A level with this code or name already exists.");
        if (!await RunAsync(InsertSql, Args(code, req with { IsEnabled = false }), ct)) return Unavailable();
        log.LogWarning("Certification level {Code} added by {Actor}", code, UserId);
        var columns = await AddColumnsAsync(code, ct);
        await AssignQrDigitAsync(code, ct);
        var flowNote = await SaveFlowAsync(code, req, ct);
        await RefreshRegistryAsync(ct);
        return new MessageResponse($"{req.Name!.Trim()} added (disabled). Add its questionnaire (Questionnaire menu), its fees (Masters → Payments) " +
            "and its certificate and report artwork before enabling it." +
            (columns ? "" : $" Its database columns could not be added by the portal: {ColumnsPending.ToLowerInvariant()}.") + flowNote);
    }

    /// <summary>
    /// The columns of a V4 level on legacy tables (as ZED-X's of migrations 0029, 0033 and 0060): main's Msme.Is{Code}PaymentDone
    /// and IsSur{Code}PaymentDone, Users.Allow{Code}Assessments and ReasonForBlock{Code}; ZED_SURVEILLANCE's Msme.Is{Code}PaymentDone.
    /// The code is checked (letters and digits) before it names a column. Each statement is safe to run again.
    /// </summary>
    internal static IReadOnlyList<string> ColumnsDdl(string code, PortalSystem system)
    {
        if (!LevelRegistry.CodePattern().IsMatch(code)) throw new ArgumentException("Invalid level code.", nameof(code));
        static string Col(string table, string column, string type) =>
            $"IF COL_LENGTH('{table}', '{column}') IS NULL ALTER TABLE {table} ADD [{column}] {type} NULL;";
        var pay = $"Is{code}PaymentDone";
        if (system != PortalSystem.Main) return [Col("dbo.Msme", pay, "bit")];
        return
        [
            Col("dbo.Msme", pay, "bit") + " " + Col("dbo.Msme", $"IsSur{code}PaymentDone", "bit") + " " +
            Col("dbo.Users", LevelRegistry.AgencyColumn(code), "bit") + " " + Col("dbo.Users", LevelRegistry.AgencyReasonColumn(code), "nvarchar(2000)"),
            Col("ZED_SURVEILLANCE.dbo.Msme", pay, "bit"),
        ];
    }

    /// <summary>Runs <see cref="ColumnsDdl"/>; false when the portal's SQL login may not alter the tables (the level stays added).</summary>
    private async Task<bool> AddColumnsAsync(string code, CancellationToken ct)
    {
        var ok = true;
        foreach (var ddl in ColumnsDdl(code, host.System))
        {
            try { await db.ExecuteSqlAsync(ddl, null, ct); }
            catch (DbException ex)
            {
                // 229 / 262 / 297 / 1088: no ALTER permission. Migration 0065 adds the columns on the next update.
                log.LogWarning(ex, "Columns of the new level {Code} not added by the portal; migration 0065 adds them on the next update", code);
                ok = false;
            }
        }
        return ok;
    }

    /// <summary>
    /// The level's QR digit (SectionTypes.QrDigit, migration 0065): the first of 6-9, A-Z that no level has. Main only;
    /// skipped before the migration (which gives every V4 level one).
    /// </summary>
    internal const string QrDigitSql =
        "IF COL_LENGTH('dbo.SectionTypes', 'QrDigit') IS NOT NULL " +
        "EXEC sp_executesql N'UPDATE dbo.SectionTypes SET QrDigit = (SELECT TOP (1) d.Digit FROM (VALUES " +
        "(1, ''6''), (2, ''7''), (3, ''8''), (4, ''9''), (5, ''A''), (6, ''B''), (7, ''C''), (8, ''D''), (9, ''E''), (10, ''F''), (11, ''G''), (12, ''H''), " +
        "(13, ''I''), (14, ''J''), (15, ''K''), (16, ''L''), (17, ''M''), (18, ''N''), (19, ''O''), (20, ''P''), (21, ''Q''), (22, ''R''), (23, ''S''), " +
        "(24, ''T''), (25, ''U''), (26, ''V''), (27, ''W''), (28, ''X''), (29, ''Y''), (30, ''Z'')) d(n, Digit) " +
        "WHERE NOT EXISTS (SELECT 1 FROM dbo.SectionTypes s WHERE s.QrDigit = d.Digit) ORDER BY d.n) " +
        "WHERE SectionType = @Code AND IsCertificationLevel = 1 AND QrDigit IS NULL AND SectionType NOT IN (''Bronze'', ''Silver'', ''Gold'', ''ZEDX'');', " +
        "N'@Code varchar(50)', @Code = @Code;";

    private async Task AssignQrDigitAsync(string code, CancellationToken ct)
    {
        if (host.System != PortalSystem.Main) return;
        try { await db.ExecuteSqlAsync(QrDigitSql, new { Code = code }, ct); }
        catch (DbException ex) { log.LogWarning(ex, "QR digit of the new level {Code} not set; migration 0065 sets it", code); }
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
        await RefreshRegistryAsync(ct);
        log.LogInformation("Logo of certification level {Code} uploaded by {Actor}", level.Code, UserId);
        return new MessageResponse("Logo saved.");
    }

    public const long ArtworkMaxBytes = 2 * 1024 * 1024;

    /// <summary>
    /// The certificate background (kind=certificate) or the report's level picture (kind=report) of a V4 level, PNG or JPG up
    /// to 2 MB, saved as <see cref="LevelArtwork"/>. The certificate background must have the size of the built-in ones of
    /// the level's assessment mode (the texts are placed in pixels: Silver / Gold's for site levels, Bronze's for desktop).
    /// </summary>
    [HttpPost("{code}/artwork")]
    [RequestSizeLimit(ArtworkMaxBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = ArtworkMaxBytes + 64 * 1024)]
    public async Task<ActionResult<MessageResponse>> Artwork(string code, [FromQuery] string? kind, IFormFile? file, CancellationToken ct)
    {
        if (await StoredAsync(code, ct) is not { } level) return NotFound();
        if (LevelArtwork.Kind(kind) is not { } k) return this.Problem400("Please choose the certificate or the report artwork.");
        if (LevelRegistry.IsLegacy(level.Code)) return this.Problem400($"{level.Name} uses the portal's own artwork.");
        var (type, error) = await MasterUploads.CheckAsync(file, LogoTypes, ArtworkMaxBytes, ct);
        if (type is null) return this.Problem400(error!);
        byte[] content;
        await using (var input = file!.OpenReadStream())
        using (var ms = new MemoryStream())
        {
            await input.CopyToAsync(ms, ct);
            content = ms.ToArray();
        }
        var size = ImageSize(content);
        if (size is null) return this.Problem400("The picture could not be read. Please upload a valid PNG or JPG file.");
        if (k == LevelArtwork.Certificate)
        {
            var desktop = level.AssessmentMode == CertificationLevels.Desktop;
            if (ImageSize(LevelArtwork.SizeReference(DocumentAssets, desktop)) is { } expected && expected != size.Value)
                return this.Problem400($"The certificate background must be {expected.Width} x {expected.Height} pixels (as the built-in " +
                    $"{(desktop ? "desktop" : "site")} certificates); this picture is {size.Value.Width} x {size.Value.Height}.");
        }
        var root = MsmeFilePaths.Root(env, portal.Value);
        var relative = LevelArtwork.Relative(level.Code, k, type.Extension);
        var full = MsmeFilePaths.Resolve(root, relative) ?? throw new InvalidOperationException("Invalid artwork path.");
        Directory.CreateDirectory(Path.GetDirectoryName(full)!);
        var temp = full + "." + Guid.NewGuid().ToString("N") + ".tmp";
        await System.IO.File.WriteAllBytesAsync(temp, content, ct);
        System.IO.File.Move(temp, full, overwrite: true);
        // The other picture type of the same kind would be found first: remove it.
        foreach (var other in new[] { ".jpg", ".png" }.Where(e => e != type.Extension))
            if (MsmeFilePaths.Resolve(root, LevelArtwork.Relative(level.Code, k, other)) is { } old && System.IO.File.Exists(old)) System.IO.File.Delete(old);
        log.LogInformation("{Kind} artwork of certification level {Code} uploaded by {Actor}", k, level.Code, UserId);
        return new MessageResponse(k == LevelArtwork.Certificate ? "Certificate artwork saved." : "Report artwork saved.");
    }

    /// <summary>The artwork in force (uploaded, else bundled) for the page's preview.</summary>
    [HttpGet("{code}/artwork")]
    public async Task<IActionResult> GetArtwork(string code, [FromQuery] string? kind, CancellationToken ct)
    {
        if (await StoredAsync(code, ct) is not { } level) return NotFound();
        if (LevelArtwork.Kind(kind) is not { } k) return this.Problem400("Please choose the certificate or the report artwork.");
        var root = MsmeFilePaths.Root(env, portal.Value);
        var path = k == LevelArtwork.Certificate
            ? LevelArtwork.CertificateTemplate(root, DocumentAssets, level.Code, level.AssessmentMode == CertificationLevels.Desktop)
            : LevelArtwork.Uploaded(root, level.Code, LevelArtwork.Report) ?? LevelArtwork.BundledReport(DocumentAssets, level.Code);
        if (path is null) return NotFound();
        Response.Headers.XContentTypeOptions = "nosniff";
        Response.Headers.CacheControl = "private, no-store";
        return PhysicalFile(path, path.EndsWith(".png", StringComparison.OrdinalIgnoreCase) ? "image/png" : "image/jpeg");
    }

    private static (int Width, int Height)? ImageSize(byte[] content)
    {
        using var data = SkiaSharp.SKData.CreateCopy(content);
        using var codec = SkiaSharp.SKCodec.Create(data);
        return codec is null ? null : (codec.Info.Width, codec.Info.Height);
    }

    private static (int Width, int Height)? ImageSize(string path)
    {
        if (!System.IO.File.Exists(path)) return null;
        using var codec = SkiaSharp.SKCodec.Create(path);
        return codec is null ? null : (codec.Info.Width, codec.Info.Height);
    }

    private static string? Validate(LevelRequest r, string code)
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
        if (r.SurveillanceEnabled && r.SurveillanceAutoApply == true && !AutoApplies(code, r.AssessmentMode))
            return "Only Bronze can be applied for its surveillance by the portal.";
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
        SurveillanceAutoApply = schedule is null ? (bool?)null : r.SurveillanceAutoApply == true && AutoApplies(code, r.AssessmentMode),
        SurveillanceSuspendRounds = schedule is null ? null : r.SurveillanceSuspendRounds,
        };
    }

    /// <summary>
    /// The portal applies a unit for its surveillance only for Bronze (desktop): the legacy apply procedure records it as a zero
    /// payment on the coupon fee row without checking the amount (SP_V4_LEVEL_SURVEILLANCE_SCHEDULE, migration 0037).
    /// </summary>
    internal static bool AutoApplies(string code, string? assessmentMode) =>
        string.Equals(code, "Bronze", StringComparison.OrdinalIgnoreCase) && assessmentMode == CertificationLevels.Desktop;

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
    /// <param name="AssessmentFlow">2026-11-14: how the level is assessed (<see cref="LevelFlows"/>), for the MSME's status steps.</param>
    public sealed record PublicLevel(string Code, string Name, string? Description, string? Comment, string? LogoUrl, string AssessmentMode,
        int ValidityMonths, decimal? Fee, PublicSurveillance? Surveillance = null, string? AssessmentFlow = null, string? SurveillanceMode = null);

    /// <summary>
    /// When surveillance falls due, for the level's dashboard card; null without surveillance. Every level gives its whole
    /// schedule (Bronze / Silver / Gold too, since the V4 schedule runs them: migration 0037), as the Admin's card shows it.
    /// </summary>
    public sealed record PublicSurveillance(int FirstDueMonths, int? Count, int? IntervalMonths);

    [HttpGet]
    public async Task<IReadOnlyList<PublicLevel>> Enabled(CancellationToken ct)
    {
        var flows = await LevelFlows.StoredAsync(db, log, ct);
        return (await CertificationLevels.AllAsync(db, log, ct)).Where(l => l.IsEnabled)
            // Fee: none since 2026-11-08 (the dashboard shows the unit's own fee from Masters → Payments, api/msme/dashboard/level-fees).
            .Select(l => new PublicLevel(l.Code, l.Name, l.Description, l.Comment, CertificationLevelsController.LogoUrl(l), l.AssessmentMode, l.ValidityMonths, null,
                SurveillanceOf(l), LevelFlows.FlowOf(flows.GetValueOrDefault(l.Code)?.AssessmentFlow, l.AssessmentMode),
                LevelFlows.SurveillanceModeOf(flows.GetValueOrDefault(l.Code)?.SurveillanceMode)))
            .ToList();
    }

    /// <param name="AssessmentMode">"Desktop" or "Site".</param>
    public sealed record LevelSummary(string Code, string Name, bool IsEnabled, string AssessmentMode, string? LogoUrl, int OrderNo);

    /// <summary>
    /// Every level, enabled or not, by order number (2026-11-08): for the staff filters, menus and tables that also list
    /// disabled levels with old records. Before migration 0028 (or when the table cannot be read): the built-in four.
    /// </summary>
    [HttpGet("all")]
    public async Task<IReadOnlyList<LevelSummary>> All(CancellationToken ct)
    {
        var levels = await CertificationLevels.AllAsync(db, log, ct);
        if (ReferenceEquals(levels, CertificationLevels.BuiltIn))
            return LevelRegistry.All.Select(l => new LevelSummary(l.Code, l.Name, l.IsEnabled, l.AssessmentMode,
                CertificationLevelsController.LogoUrl(new CertificationLevel(l.Code, l.Name, l.OrderNo, null, null, null, l.IsEnabled, l.AssessmentMode,
                    36, false, null, CertificateNumbers.Default, null, null, null)), l.OrderNo)).ToList();
        return levels.Select(l => new LevelSummary(l.Code, l.Name, l.IsEnabled, l.AssessmentMode, CertificationLevelsController.LogoUrl(l), l.OrderNo)).ToList();
    }

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
