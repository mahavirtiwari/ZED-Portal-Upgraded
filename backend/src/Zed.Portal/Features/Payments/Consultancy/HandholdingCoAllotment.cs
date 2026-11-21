using System.Data.Common;
using Microsoft.Data.SqlClient;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Email;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Expenditure;
using Zed.Portal.Templates;

namespace Zed.Portal.Features.Payments.Consultancy;

/// <summary>
/// ZED_CONSULTANT for the handholding milestone 1 allotment (2026-11-21), with write access. The MSME pays on main, so main runs
/// the allotment that the Consultancy host's Master Admin otherwise does: main's own login (which the payment procedures already
/// use to write ZED_CONSULTANT) with ZED_CONSULTANT as its database, so the Consultancy procedures and queries
/// (SP_ASSESSMENT_AGENCIES_TO_ALLOT, SP_ASSESSMENT_ALLOT_TO_AGENCY, the purchase orders) run exactly as on that host. Not
/// ConnectionStrings:Consultancy of main: that login is read-only (<see cref="Documents.SystemDatabases"/>).
/// <list type="bullet">
/// <item>A keyed <see cref="ISqlExecutor"/> under <see cref="WriteKey"/> wins (tests).</item>
/// <item>On the Consultancy host (the staff "update payment status"): its own database.</item>
/// <item>Else ConnectionStrings:Main with ZED_CONSULTANT (with the Database:Prefix of a prefixed set) as its catalog; null without it.</item>
/// </list>
/// </summary>
public static class ConsultancyDatabase
{
    public const string WriteKey = "Consultancy.Allotment";

    /// <summary>The system whose rules the allotment follows (agencies, purchase orders, mails).</summary>
    public static readonly PortalHost Host = new(PortalSystem.Consultancy);

    public static ISqlExecutor? Open(IServiceProvider services)
    {
        if (services.GetKeyedService<ISqlExecutor>(WriteKey) is { } keyed) return keyed;
        if (services.GetRequiredService<PortalHost>().System == PortalSystem.Consultancy) return services.GetRequiredService<ISqlExecutor>();
        var cs = services.GetRequiredService<IConfiguration>().GetConnectionString(ZedDatabases.Main);
        if (string.IsNullOrWhiteSpace(cs)) return null;
        var consultancy = new SqlConnectionStringBuilder(cs) { InitialCatalog = ZedDatabaseNames.Physical("ZED_CONSULTANT") }.ConnectionString;
        // One executor per connection string, so the per-executor throttles (the expenditure sweep of the purchase orders) hold.
        return Built.GetOrAdd(consultancy, c => new SqlExecutor(c));
    }

    private static readonly System.Collections.Concurrent.ConcurrentDictionary<string, ISqlExecutor> Built = new(StringComparer.Ordinal);

    /// <summary>The Consultancy portal's address for its mails: this host's, or main's with /Consultancy (where that portal is served).</summary>
    public static IOptions<PortalOptions> Portal(IServiceProvider services)
    {
        var portal = services.GetRequiredService<IOptions<PortalOptions>>();
        if (services.GetRequiredService<PortalHost>().System == PortalSystem.Consultancy) return portal;
        var p = portal.Value;
        return Options.Create(new PortalOptions
        {
            PublicBaseUrl = p.PublicBaseUrl.TrimEnd('/') + "/Consultancy",
            LegacyBaseUrl = p.LegacyBaseUrl.TrimEnd('/') + "/Consultancy",
            ContactUrl = p.ContactUrl,
            StorageRoot = p.StorageRoot,
            DashboardCountsTestUnits = p.DashboardCountsTestUnits,
            EnvironmentLabel = p.EnvironmentLabel,
        });
    }
}

/// <summary>
/// 2026-11-21 (the product owner's rule): "Did any Consultant Organisation assist you?" at the payment of handholding milestone 1
/// (web page and ZED MSME app). Yes = the unit picks the organisation from every active one (Users RoleId 2, IsActive) whose
/// purchase order for the level is not used up (<see cref="PoLimits"/>); the server checks the choice again when the order is
/// made. The answer is kept with the order (PaymentGatewayTransactions.AssistedByCo / AssistedCoId, migration 0111), or with the
/// payment record for a zero payment recorded without an order (MsmePaymentInfo). Not asked for milestones 2 and 3.
/// </summary>
public static class HandholdingCoChoice
{
    public const string Required = "Please answer whether any Consultant Organisation assisted you.";
    public const string ChooseOne = "Please choose the Consultant Organisation that assisted you.";
    public const string NotAvailable = "The Consultant Organisation you chose cannot be chosen now. Please choose it again.";
    public const string NotSaved = "Your answer about the Consultant Organisation could not be saved. Please try again.";

    /// <param name="UserId">The organisation's user id.</param>
    public sealed record Organisation(string UserId, string Name);

    /// <summary>The unit's answer: Yes with the organisation, or No.</summary>
    public sealed record Answer(bool Assisted, string? CoId);

    internal const string ActiveSql = "SELECT UserId, UserName FROM dbo.Users WHERE RoleId = 2 AND IsActive = 1 ORDER BY UserName;";

    private sealed class UserRow
    {
        public string? UserId { get; init; }
        public string? UserName { get; init; }
    }

    /// <summary>The organisations the unit may name for the level: active, purchase order for the level not used up; by name.</summary>
    public static async Task<IReadOnlyList<Organisation>> ListAsync(ISqlExecutor consultancy, string level, ILogger log, CancellationToken ct)
    {
        var users = await consultancy.QuerySqlAsync<UserRow>(ActiveSql, null, ct);
        var stopped = (await PoLimits.StatusAsync(consultancy, ConsultancyDatabase.Host, null, level, log, ct))
            .Where(s => s.Stopped).Select(s => s.PartyId.Trim()).ToHashSet(StringComparer.OrdinalIgnoreCase);
        return users
            .Select(u => new Organisation(u.UserId?.Trim() ?? "", u.UserName?.Trim() ?? ""))
            .Where(o => o.UserId.Length > 0 && !stopped.Contains(o.UserId))
            .GroupBy(o => o.UserId, StringComparer.OrdinalIgnoreCase).Select(g => g.First())
            .OrderBy(o => o.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    /// <summary>
    /// The answer of an order for <paramref name="milestone"/>: (null, null) when the question is not asked (milestones 2 and 3),
    /// else the checked answer or the reason it is refused.
    /// </summary>
    public static async Task<(Answer? Answer, string? Refusal)> CheckAsync(
        ISqlExecutor? consultancy, string level, int milestone, bool? assisted, string? coId, ILogger log, CancellationToken ct)
    {
        if (milestone != 1) return (null, null);
        if (assisted is null) return (null, Required);
        if (assisted == false) return (new Answer(false, null), null);
        var id = coId?.Trim() ?? "";
        if (id.Length is 0 or > 50) return (null, ChooseOne);
        if (consultancy is null) return (null, NotAvailable);
        var chosen = (await ListAsync(consultancy, level, log, ct)).FirstOrDefault(o => string.Equals(o.UserId, id, StringComparison.OrdinalIgnoreCase));
        if (chosen is null)
        {
            log.LogWarning("Handholding milestone 1 of {Level}: Consultant Organisation {Co} refused (not active, or its purchase order is used up)", level, id);
            return (null, NotAvailable);
        }
        return (new Answer(true, chosen.UserId), null);
    }

    internal const string OrderSql =
        "UPDATE dbo.PaymentGatewayTransactions SET AssistedByCo = @Assisted, AssistedCoId = @CoId WHERE TransactionId = @TransactionId AND ZedId = @ZedId;";

    /// <summary>The newest milestone 1 payment record of the unit's level (written just before by the zero procedure).</summary>
    internal const string PaymentInfoSql =
        "UPDATE dbo.MsmePaymentInfo SET AssistedByCo = @Assisted, AssistedCoId = @CoId WHERE Id = (SELECT MAX(Id) FROM dbo.MsmePaymentInfo " +
        "WHERE ZedId = @ZedId AND Certification = @Certification AND MileStoneNum = 1);";

    /// <summary>Keeps the answer with the order just created. Throws when it cannot be saved (the order is then not offered for payment).</summary>
    public static Task RecordOnOrderAsync(ISqlExecutor consultancy, Answer answer, string zedId, string orderId, CancellationToken ct) =>
        consultancy.ExecuteSqlAsync(OrderSql, new
        {
            Assisted = answer.Assisted, CoId = AssessmentInput.Ansi(answer.CoId),
            TransactionId = AssessmentInput.Ansi(orderId), ZedId = AssessmentInput.Ansi(zedId),
        }, ct);

    /// <summary>
    /// <see cref="RecordOnOrderAsync"/> for a checkout: null when kept (or nothing to keep: milestones 2 and 3), else the refusal
    /// (the order is then not paid, so the unit's answer is never lost).
    /// </summary>
    public static async Task<string?> KeepOnOrderAsync(ISqlExecutor? consultancy, Answer? answer, string zedId, string orderId, ILogger log, CancellationToken ct)
    {
        if (answer is null) return null;
        if (consultancy is null) return NotSaved;
        try
        {
            await RecordOnOrderAsync(consultancy, answer, zedId, orderId, ct);
            return null;
        }
        catch (DbException ex)
        {
            log.LogError(ex, "Handholding milestone 1 order {OrderId} of {ZedId}: the Consultant Organisation answer was not saved (is migration 0111 applied?)", orderId, zedId);
            return NotSaved;
        }
    }

    /// <summary>
    /// <see cref="RecordOnPaymentAsync"/> after a zero payment recorded without an order. The payment is recorded already, so a failure
    /// is only logged (the case then goes by round robin, or waits for the Master Admin).
    /// </summary>
    public static async Task KeepOnPaymentAsync(ISqlExecutor? consultancy, Answer? answer, string zedId, string level, ILogger log, CancellationToken ct)
    {
        if (answer is null) return;
        try
        {
            if (consultancy is null) throw new InvalidOperationException("ZED_CONSULTANT is not available.");
            await RecordOnPaymentAsync(consultancy, answer, zedId, level, ct);
        }
        catch (Exception ex) when (ex is DbException or InvalidOperationException)
        {
            log.LogError(ex, "Handholding milestone 1 zero payment of {ZedId}/{Level}: the Consultant Organisation answer ({Assisted}, {Co}) was not saved",
                zedId, level, answer.Assisted, answer.CoId);
        }
    }

    /// <summary>Keeps the answer with the payment record of a zero payment recorded without an order.</summary>
    public static Task RecordOnPaymentAsync(ISqlExecutor consultancy, Answer answer, string zedId, string level, CancellationToken ct) =>
        consultancy.ExecuteSqlAsync(PaymentInfoSql, new
        {
            Assisted = answer.Assisted, CoId = AssessmentInput.Ansi(answer.CoId),
            ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level),
        }, ct);
}

/// <summary>
/// 2026-11-21 (the product owner's rule): when the payment of handholding milestone 1 is recorded, the milestone row (written by the
/// legacy payment procedures without an organisation) is allotted at once, instead of waiting on Allot Consultancy:
/// <list type="bullet">
/// <item>the unit said a Consultant Organisation assisted it: to that organisation, if it is still active and its purchase order for
/// the level is not used up (else, logged, by round robin);</item>
/// <item>the unit said No: by round robin among the organisations the Master Admin could allot it to
/// (<see cref="AllotmentAgencies.ForAsync"/> on the Consultancy rules: active, site verification, the unit's states and NIC sectors,
/// its kind), leaving out those whose purchase order is used up, in Users.Id order after the organisation of the level's last
/// round-robin allotment (main's AgencyAllotmentHistory, AllotType <see cref="AutoType"/>);</item>
/// <item>no such organisation: the row waits on Allot Consultancy as before (CoAllotType 'NoEligible') and the ZED team inbox is told
/// (<see cref="ConsultancyNoEligibleCoEmail"/>).</item>
/// </list>
/// The allotment is the Master Admin's (<see cref="AllotmentAgencies.AllotAsync"/>: SP_ASSESSMENT_ALLOT_TO_AGENCY, its history line,
/// the mail "Allocation of MSME for Handholding Support (Milestone 1)"); then the way is recorded on the row (CoAllotType), in
/// MsmeHistory and in AgencyAllotmentHistory. Called after every recorded handholding payment (<see cref="ConsultancyPaymentCompletion"/>:
/// gateway web and app, reconciliation, zero amounts; the staff "update payment status"); it does nothing unless the latest milestone
/// row is milestone 1 without an organisation and not handled yet, so milestones 2 and 3 are untouched. It never throws: a failure
/// is logged and the case waits for the Master Admin.
/// </summary>
public sealed class HandholdingAutoAllotment(
    IServiceProvider services, IEmailSender email, IHtmlTemplateRenderer templates, EmailAddresses addresses, ILogger<HandholdingAutoAllotment> log)
{
    public const string ChosenType = "HandholdingChosen";
    public const string AutoType = "HandholdingAuto";

    public enum Way { Chosen, RoundRobin, NoEligible }

    /// <param name="Organisation">The organisation allotted (null for <see cref="Way.NoEligible"/>).</param>
    public sealed record Outcome(Way Way, string? Organisation, string? Name);

    public static HandholdingAutoAllotment Create(IServiceProvider services) => ActivatorUtilities.CreateInstance<HandholdingAutoAllotment>(services);

    internal const string MilestoneSql =
        "SELECT TOP 1 NcCount, CertificationBodyUserId, CoAllotType FROM dbo.MsmeCertifications " +
        "WHERE ZedId = @ZedId AND Certification = @Certification AND IdDisabled IS NULL ORDER BY NcCount DESC, Id DESC;";

    /// <summary>The unit's answer for milestone 1: on its paid order, else on the payment record (a zero payment without an order).</summary>
    internal const string AnswerSql =
        "SELECT TOP 1 AssistedByCo, AssistedCoId FROM (" +
        "SELECT 1 AS Src, Id, AssistedByCo, AssistedCoId FROM dbo.PaymentGatewayTransactions " +
        "WHERE ZedId = @ZedId AND Certification = @Certification AND MileStoneNumber = 1 AND PaymentStatus = 'Success' " +
        "UNION ALL SELECT 2 AS Src, Id, AssistedByCo, AssistedCoId FROM dbo.MsmePaymentInfo " +
        "WHERE ZedId = @ZedId AND Certification = @Certification AND MileStoneNum = 1 AND AssistedByCo IS NOT NULL" +
        ") A ORDER BY CASE WHEN A.AssistedByCo IS NULL THEN 1 ELSE 0 END, A.Src, A.Id DESC;";

    internal const string UserIdsSql = "SELECT UserId, Id FROM dbo.Users WHERE RoleId = 2 AND UserId IN @Ids;";

    internal const string LastSql =
        "SELECT TOP 1 AgencyId FROM ZEDCS_V2_LIVE.dbo.AgencyAllotmentHistory WHERE AllotType = '" + AutoType + "' AND CertificationType = @Certification ORDER BY Id DESC;";

    internal const string HistorySql =
        "INSERT INTO ZEDCS_V2_LIVE.dbo.AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType, Descrip, CreatedDate) " +
        "VALUES (@Agency, @ZedId, @Certification, @AllotType, @Descrip, GETDATE());";

    /// <summary>The way on milestone 1's row (only while it is still milestone 1's latest row) and the unit's history line.</summary>
    internal const string MarkSql =
        "UPDATE dbo.MsmeCertifications SET CoAllotType = @Type WHERE ZedId = @ZedId AND Certification = @Certification AND NcCount = 1 AND IdDisabled IS NULL; " +
        "INSERT INTO dbo.MsmeHistory (ZedId, Descrip, CreatedDate, CertificationType, StatusType, NcCount) VALUES (@ZedId, @Descrip, GETDATE(), @Certification, NULL, 1);";

    internal const string UnitSql = "SELECT TOP 1 EnterpriseName FROM dbo.Msme WHERE ZedId = @ZedId;";

    private sealed class MilestoneRow
    {
        public int? NcCount { get; init; }
        public string? CertificationBodyUserId { get; init; }
        public string? CoAllotType { get; init; }
    }

    private sealed class AnswerRow
    {
        public bool? AssistedByCo { get; init; }
        public string? AssistedCoId { get; init; }
    }

    private sealed class IdRow
    {
        public string? UserId { get; init; }
        public long Id { get; init; }
    }

    private sealed class AgencyRow
    {
        public string? AgencyId { get; init; }
    }

    private sealed class UnitRow
    {
        public string? EnterpriseName { get; init; }
    }

    /// <summary>After a recorded handholding payment of the level. Null when there was nothing to do (or it failed, logged).</summary>
    public async Task<Outcome?> RunAsync(string zedId, string level, CancellationToken ct)
    {
        try
        {
            return await AllotAsync(zedId, level, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Handholding milestone 1 of {ZedId}/{Level}: the automatic allotment failed; it waits for the Master Admin", zedId, level);
            return null;
        }
    }

    private async Task<Outcome?> AllotAsync(string zedId, string level, CancellationToken ct)
    {
        if (ConsultancyDatabase.Open(services) is not { } db)
        {
            log.LogError("Handholding milestone 1 of {ZedId}/{Level}: ConnectionStrings:Main is not set; it waits for the Master Admin", zedId, level);
            return null;
        }
        var unit = new { ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level) };
        var row = (await db.QuerySqlAsync<MilestoneRow>(MilestoneSql, unit, ct)).FirstOrDefault();
        // Milestones 2 and 3 follow the previous organisation (the payment procedures); an allotted or handled row is left alone.
        if (row is not { NcCount: 1 } || !string.IsNullOrWhiteSpace(row.CertificationBodyUserId) || !string.IsNullOrWhiteSpace(row.CoAllotType))
            return null;

        var answer = (await db.QuerySqlAsync<AnswerRow>(AnswerSql, unit, ct)).FirstOrDefault();
        string? refusedChoice = null;
        if (answer is { AssistedByCo: true, AssistedCoId: { Length: > 0 } coId })
        {
            var chosen = (await HandholdingCoChoice.ListAsync(db, level, log, ct))
                .FirstOrDefault(o => string.Equals(o.UserId, coId.Trim(), StringComparison.OrdinalIgnoreCase));
            if (chosen is not null) return await AllotToAsync(db, zedId, level, Way.Chosen, chosen.UserId, chosen.Name, null, ct);
            refusedChoice = coId.Trim();
            log.LogWarning("Handholding milestone 1 of {ZedId}/{Level}: the organisation the unit chose ({Co}) is no longer active or its purchase order " +
                "is used up; allotted by round robin instead", zedId, level, refusedChoice);
        }

        var offered = (await AllotmentAgencies.ForAsync(db, ConsultancyDatabase.Host, zedId, level, log, ct))
            .Where(p => !p.PoStopped && p.UserId.Trim().Length > 0)
            .GroupBy(p => p.UserId.Trim(), StringComparer.OrdinalIgnoreCase).Select(g => g.First()).ToList();
        List<IdRow> ordered = offered.Count == 0 ? [] :
            (await db.QuerySqlAsync<IdRow>(UserIdsSql, new { Ids = offered.Select(p => p.UserId.Trim()).ToArray() }, ct))
            .Where(r => !string.IsNullOrWhiteSpace(r.UserId)).OrderBy(r => r.Id).ToList();
        if (ordered.Count == 0) return await NoneEligibleAsync(db, zedId, level, refusedChoice, ct);

        long? lastId = null;
        if (await LastAsync(db, level, ct) is { Length: > 0 } last)
            lastId = (await db.QuerySqlAsync<IdRow>(UserIdsSql, new { Ids = new[] { last } }, ct)).FirstOrDefault()?.Id;
        var next = (ordered.FirstOrDefault(r => lastId is null || r.Id > lastId) ?? ordered[0]).UserId!.Trim();
        var name = offered.First(p => string.Equals(p.UserId.Trim(), next, StringComparison.OrdinalIgnoreCase)).UserName;
        return await AllotToAsync(db, zedId, level, Way.RoundRobin, next, name, refusedChoice, ct);
    }

    /// <summary>The organisation of the level's last round-robin allotment (null when none, or main's history cannot be read).</summary>
    private async Task<string?> LastAsync(ISqlExecutor db, string level, CancellationToken ct)
    {
        try
        {
            return (await db.QuerySqlAsync<AgencyRow>(LastSql, new { Certification = AssessmentInput.Ansi(level) }, ct)).FirstOrDefault()?.AgencyId?.Trim();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Handholding round robin of {Level}: the last allotment could not be read; it starts from the first organisation", level);
            return null;
        }
    }

    private async Task<Outcome> AllotToAsync(ISqlExecutor db, string zedId, string level, Way way, string co, string name, string? refusedChoice, CancellationToken ct)
    {
        var emails = DesktopAssessmentEmails.Create(services, db, ConsultancyDatabase.Host, ConsultancyDatabase.Portal(services));
        await AllotmentAgencies.AllotAsync(db, ConsultancyDatabase.Host, emails, zedId, level, co, log, ct);
        var who = string.IsNullOrWhiteSpace(name) ? co : $"{name.Trim()} ({co})";
        var descrip = way == Way.Chosen
            ? $"Milestone 1 allotted to {who}: assisted by {who}, as the unit answered at payment"
            : $"Milestone 1 allotted by round robin to {who}" +
              (refusedChoice is null ? "" : $" (the organisation the unit chose, {refusedChoice}, could not be allotted)");
        log.LogInformation("Handholding milestone 1 of {ZedId}/{Level} allotted to {Co} ({Way})", zedId, level, co, way);
        await MarkAsync(db, zedId, level, way == Way.Chosen ? "Chosen" : "RoundRobin", descrip, ct);
        try
        {
            await db.ExecuteSqlAsync(HistorySql, new
            {
                Agency = AssessmentInput.Ansi(co), ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level),
                AllotType = AssessmentInput.Ansi(way == Way.Chosen ? ChosenType : AutoType, 2000), Descrip = AssessmentInput.Ansi(descrip, 2000),
            }, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Handholding milestone 1 of {ZedId}/{Level}: the allotment history row was not written", zedId, level);
        }
        return new Outcome(way, co, name);
    }

    private async Task<Outcome> NoneEligibleAsync(ISqlExecutor db, string zedId, string level, string? refusedChoice, CancellationToken ct)
    {
        var reason = refusedChoice is null
            ? "No Consultant Organisation is eligible for the round robin (active, site verification, the unit's state, NIC sector and kind, purchase order not used up)."
            : $"The organisation the unit chose ({refusedChoice}) can no longer be allotted, and no Consultant Organisation is eligible for the round robin.";
        log.LogWarning("Handholding milestone 1 of {ZedId}/{Level}: no eligible Consultant Organisation; it waits for the Master Admin", zedId, level);
        await MarkAsync(db, zedId, level, "NoEligible", "Milestone 1 waits for the Master Admin's allotment: " + reason, ct);
        try
        {
            var unitName = (await db.QuerySqlAsync<UnitRow>(UnitSql, new { ZedId = AssessmentInput.Ansi(zedId) }, ct)).FirstOrDefault()?.EnterpriseName ?? "";
            var to = await addresses.GetAsync(EmailAddresses.ZedTeamInbox, ct) ?? EmailAddresses.LegacyTeamInbox;
            var html = await templates.RenderAsync<ConsultancyNoEligibleCoEmail>(new Dictionary<string, object?>
            {
                [nameof(ConsultancyNoEligibleCoEmail.ZedId)] = zedId,
                [nameof(ConsultancyNoEligibleCoEmail.UnitName)] = unitName,
                [nameof(ConsultancyNoEligibleCoEmail.Level)] = LevelRegistry.NameOf(level),
                [nameof(ConsultancyNoEligibleCoEmail.Milestone)] = "1",
                [nameof(ConsultancyNoEligibleCoEmail.Reason)] = reason,
                [nameof(ConsultancyNoEligibleCoEmail.PublicBaseUrl)] = ConsultancyDatabase.Portal(services).Value.PublicBaseUrl,
            });
            await email.SendAsync(new EmailMessage(to,
                $"Handholding Support (Milestone 1) waiting for allotment: no eligible Consultant Organisation - {zedId}", html, EmailProfiles.Allocation), ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "Handholding milestone 1 of {ZedId}/{Level}: the mail to the ZED team failed", zedId, level);
        }
        return new Outcome(Way.NoEligible, null, null);
    }

    private async Task MarkAsync(ISqlExecutor db, string zedId, string level, string type, string descrip, CancellationToken ct)
    {
        try
        {
            await db.ExecuteSqlAsync(MarkSql, new
            {
                Type = AssessmentInput.Ansi(type, 20), ZedId = AssessmentInput.Ansi(zedId), Certification = AssessmentInput.Ansi(level),
                Descrip = AssessmentInput.Ansi(descrip.Length > 2000 ? descrip[..2000] : descrip, 2000),
            }, ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Handholding milestone 1 of {ZedId}/{Level}: how it was allotted was not recorded (is migration 0111 applied?)", zedId, level);
        }
    }
}
