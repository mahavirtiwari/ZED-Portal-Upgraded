using System.Data.Common;
using System.Globalization;
using Zed.Core.Data;

namespace Zed.Portal.Features.Payments;

/// <summary>
/// 2026-11-17 (the user): "if there is any amount more than 0 then it goes to the payment gateway; further, keep the record
/// of zero payment also". A payment with nothing to pay (a 100% subsidy) is recorded without the gateway, through the same
/// procedures a gateway payment uses: the order (amount 0) is created as for the gateway, then recorded as a successful
/// payment with the gateway type "Zero amount". So every level and step a paid order opens (surveillance of Silver and Gold,
/// the second surveillance, the handholding milestone) opens the same way, the order is in the transactions, and the payment
/// record (MsmePaymentInfo) is marked <see cref="PaymentType"/> with amount 0. No money moves, so nothing goes to the ERP.
/// </summary>
public static class ZeroAmountPayment
{
    /// <summary>PaymentGatewayTransactions.PgType of a zero-amount order.</summary>
    public const string GatewayType = "Zero amount";

    /// <summary>MsmePaymentInfo.PaymentType of a zero-amount payment (beside PaymentGateway, NEFT, PaidAtMilestone1).</summary>
    public const string PaymentType = "ZeroAmount";

    /// <summary>One module's procedures and tables (the order, the recording, the payment records).</summary>
    public sealed record Module(string OrderProcedure, string RecordProcedure, string Orders, string PaymentInfo);

    public static readonly Module Surveillance = new(
        "SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS", "SP_SURVEILLANCE_MSME_PAYMENT_GATEWAY_DETAILS",
        CcAvenueGatewayModule.SurveillanceOrders, "ZED_SURVEILLANCE.dbo.MsmePaymentInfo");

    public static readonly Module Handholding = new(
        "SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS", "SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS",
        Consultancy.ConsultancyGateway.Orders, "ZED_CONSULTANT.dbo.MsmePaymentInfo");

    /// <summary>The recording's response text, in the gateway's form (the procedures keep it on the order).</summary>
    public static string Response(string orderId) =>
        $"order_id={orderId}&order_status=Success&amount=0.00&payment_mode={GatewayType}&status_message=Nothing to pay after subsidy/reward";

    /// <summary>
    /// Records the zero-amount payment. <paramref name="orderArgs"/> gives the module's order procedure arguments (with the
    /// fee row the checkout chose) for an order id. Null when recorded; otherwise the message for the user.
    /// </summary>
    /// <param name="milestone">Handholding: the order must be for this milestone (the procedure's MerchantParam3).</param>
    /// <param name="onOrder">
    /// Run with the order id once the order is created and checked, before it is recorded as paid (2026-11-21: the handholding
    /// milestone 1 answer about the Consultant Organisation is kept with the order). Its message, when not null, refuses the
    /// payment and nothing is recorded.
    /// </param>
    public static async Task<string?> RecordAsync(ISqlExecutor db, Module module, string zedId, string certification, Func<string, object> orderArgs,
        string? ip, ILogger log, CancellationToken ct, int? milestone = null, Func<string, Task<string?>>? onOrder = null)
    {
        var orderId = Guid.NewGuid().ToString();

        IDictionary<string, object?>? order;
        try
        {
            order = (await db.QueryProcMultipleAsync(module.OrderProcedure, orderArgs(orderId), ct))[0].FirstOrDefault();
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "{Procedure} refused the zero-amount order of {ZedId}/{Certification}", module.OrderProcedure, zedId, certification);
            return AlreadyPaid(milestone);
        }
        if (order is null) return AlreadyPaid(milestone);   // the procedures answer no row for a level already paid

        // The amount the procedure put on the order must be nothing (e.g. not its hard-coded Rs 1 test list).
        var amountText = order.Text("AmountToBePaid");
        if (!decimal.TryParse(amountText, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) || amount != 0 ||
            (milestone is { } m && order.Text("MerchantParam3") != $"Milestone {m}"))
        {
            log.LogError("Zero-amount order of {ZedId}/{Certification}: procedure amount {Amount}, {Param3} (milestone {Milestone})",
                zedId, certification, amountText, order.Text("MerchantParam3"), milestone);
            return "The payment amount could not be confirmed. Please contact zed.support@qcin.org.";
        }

        if (onOrder is not null && await onOrder(orderId) is { } refused) return refused;

        try
        {
            await db.ExecuteProcAsync(module.RecordProcedure, new
            {
                ZedId = zedId, Certification = certification, TransactionId = orderId, PaymentStatus = "Success",
                PaymentResponse = Response(orderId), IpAddress = ip, PgType = GatewayType, AmountPaid = "0", ApiType = "ZERO",
            }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "{Procedure} failed to record the zero-amount order {OrderId} of {ZedId}/{Certification}", module.RecordProcedure, orderId, zedId, certification);
            return "The payment could not be recorded. Please contact zed.support@qcin.org.";
        }

        var status = (await db.QuerySqlAsync<OrderStatus>(StatusSql(module.Orders),
            new { TransactionId = new Dapper.DbString { Value = orderId, IsAnsi = true, Length = 50 } }, ct)).FirstOrDefault()?.PaymentStatus;
        if (!string.Equals(status, "Success", StringComparison.OrdinalIgnoreCase))
        {
            log.LogError("Zero-amount order {OrderId} of {ZedId}/{Certification} was not recorded as paid ({Status})", orderId, zedId, certification, status);
            return "The payment could not be recorded. Please contact zed.support@qcin.org.";
        }

        // The payment record the procedure wrote ("PaymentGateway"): a zero-amount payment of Rs 0.
        await db.ExecuteSqlAsync(MarkSql(module.PaymentInfo), new { ZedId = zedId, Certification = certification, PaymentType }, ct);
        log.LogInformation("Zero-amount payment recorded for {ZedId}/{Certification} (order {OrderId}{Milestone})", zedId, certification, orderId,
            milestone is { } n ? $", milestone {n}" : "");
        return null;
    }

    /// <summary>The order's status after the recording.</summary>
    public static string StatusSql(string orders) => $"SELECT PaymentStatus FROM {orders} WHERE TransactionId = @TransactionId";

    public sealed record OrderStatus(string? PaymentStatus);

    /// <summary>The newest gateway payment record of the unit's level becomes a zero-amount one.</summary>
    public static string MarkSql(string paymentInfo) =>
        $"UPDATE {paymentInfo} SET PaymentType = @PaymentType, AmountPaid = 0 WHERE Id = (SELECT MAX(Id) FROM {paymentInfo} " +
        "WHERE ZedId = @ZedId AND Certification = @Certification AND PaymentType = 'PaymentGateway');";

    private static string AlreadyPaid(int? milestone) =>
        milestone is null ? "Payment is already done for this certification." : "Payment is already done for this milestone.";
}
