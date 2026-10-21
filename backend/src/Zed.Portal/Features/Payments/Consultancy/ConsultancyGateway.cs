using Zed.Core.Data;

namespace Zed.Portal.Features.Payments.Consultancy;

/// <summary>
/// The handholding (consultancy) payment as a <see cref="CcAvenueGatewayModule"/>: orders in
/// ZED_CONSULTANT, recorded by SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS, completed by
/// <see cref="ConsultancyPaymentCompletion"/>. Shared by the web callback
/// (<see cref="ConsultancyCallbackController"/>) and the app callbacks (ConsultancyPay/successtransmobile, ...).
/// <para>
/// Besides order, unit, level and amount (checked by <see cref="CcAvenueResponseProcessor"/>), a successful
/// response must be for the milestone that is due: the gateway procedure opens milestone
/// max(NcCount)+1 for whatever order it is given, so a second order paid for the same milestone (two
/// tabs, or an old order paid late) would otherwise open the next milestone without its own payment.
/// Such a response is recorded as "MilestoneMismatch" (not paid), like a different amount.
/// </para>
/// </summary>
public static class ConsultancyGateway
{
    public const string Orders = "ZED_CONSULTANT.dbo.PaymentGatewayTransactions";
    public const string Procedure = "SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS";
    public const string MilestoneMismatch = "MilestoneMismatch";

    public static CcAvenueGatewayModule Module(ConsultancyPaymentCompletion completion, ISqlExecutor db) => new(
        Orders, Procedure, Kind: "consultancy",
        (zedId, certification, token) => completion.CompleteAsync(zedId, certification, gateway: true, token),
        (zedId, certification, orderId, fields, token) => VerifyMilestoneAsync(db, orderId, fields, token));

    /// <summary>The order's milestone, the milestone due now, and whether that milestone already has a payment.</summary>
    public const string MilestoneQuery =
        "SELECT T.MileStoneNumber AS OrderMilestone, " +
        "(SELECT ISNULL(MAX(C.NcCount), 0) + 1 FROM ZED_CONSULTANT.dbo.MsmeCertifications C WHERE C.ZedId = T.ZedId AND C.Certification = T.Certification) AS DueMilestone, " +
        "(SELECT COUNT(*) FROM ZED_CONSULTANT.dbo.MsmePaymentInfo P WHERE P.ZedId = T.ZedId AND P.Certification = T.Certification AND P.MileStoneNum = T.MileStoneNumber) AS Payments " +
        "FROM ZED_CONSULTANT.dbo.PaymentGatewayTransactions T WHERE T.TransactionId = @TransactionId";

    private static async Task<string?> VerifyMilestoneAsync(ISqlExecutor db, string orderId, IReadOnlyDictionary<string, string> fields, CancellationToken ct)
    {
        var m = (await db.QuerySqlAsync<MilestoneState>(MilestoneQuery,
            new { TransactionId = new Dapper.DbString { Value = orderId, IsAnsi = true, Length = 50 } }, ct)).FirstOrDefault();
        if (m?.OrderMilestone is not { } order || order != m.DueMilestone || m.Payments > 0) return MilestoneMismatch;
        // merchant_param3 is "Milestone n" from the checkout (inside the encrypted response).
        if (fields.GetValueOrDefault("merchant_param3") is { Length: > 0 } p3 && !string.Equals(p3.Trim(), $"Milestone {order}", StringComparison.OrdinalIgnoreCase))
            return MilestoneMismatch;
        return null;
    }

    private sealed record MilestoneState(int? OrderMilestone, int DueMilestone, int Payments);
}
