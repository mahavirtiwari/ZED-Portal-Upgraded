using System.Data.Common;
using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Payments;

namespace Zed.Portal.Features.Payments;

/// <summary>
/// Calls from CCAvenue. Authenticity comes from the encryption: only CCAvenue and this server know the
/// working keys. Nothing here trusts the browser or a signed-in user.
/// </summary>
[ApiController]
[AllowAnonymous]
[IgnoreAntiforgeryToken]
public sealed class CcAvenueCallbackController(
    ISqlExecutor db,
    PaymentCompletion completion,
    SurveillancePaymentCompletion surveillance,
    IOptions<CcAvenueOptions> options,
    ILogger<CcAvenueCallbackController> log) : ControllerBase
{
    private const string ResultPage = "/msme/payment/result";

    /// <summary>
    /// redirect_url and cancel_url of the web checkout (PayController.successtrans / failuretrans).
    /// Records the result, then sends the browser to the Angular result page.
    /// </summary>
    [HttpPost(MsmePaymentController.ResponsePath)]
    [Consumes("application/x-www-form-urlencoded")]
    public async Task<IActionResult> GatewayResponse([FromForm(Name = "encResp")] string? encResp, CancellationToken ct)
    {
        var module = CcAvenueGatewayModule.Certification(completion);
        return Result(await Processor.ProcessAsync(encResp, options.Value.WorkingKey, module, ClientIp, ct), module.Kind);
    }

    /// <summary>
    /// redirect_url and cancel_url of the surveillance checkout (SurveillancePayController.successtrans /
    /// failuretrans). Same checks as the certification payment; the orders are in ZED_SURVEILLANCE.
    /// </summary>
    [HttpPost(SurveillancePaymentController.ResponsePath)]
    [Consumes("application/x-www-form-urlencoded")]
    public async Task<IActionResult> SurveillanceGatewayResponse([FromForm(Name = "encResp")] string? encResp, CancellationToken ct)
    {
        var module = CcAvenueGatewayModule.Surveillance(surveillance);
        return Result(await Processor.ProcessAsync(encResp, options.Value.WorkingKey, module, ClientIp, ct), module.Kind);
    }

    /// <summary>
    /// CCAvenue's server-to-server status push, at the address registered with CCAvenue
    /// (PayController.UpdatePaymentReconciliationStatus), and at the old surveillance address
    /// (SurveillancePayController.UpdatePaymentReconciliationStatus).
    /// <para>
    /// Both record through SP_MSME_PAYMENT_GATEWAY_DETAILS_RECONCILIATION, which finds the module from the
    /// order id (ZED_SURVEILLANCE, ZED_CONSULTANT or main PaymentGatewayTransactions) and calls that
    /// module's gateway procedure. The old surveillance action called
    /// SP_SURVEILLANCE_MSME_PAYMENT_GATEWAY_DETAILS_RECONCILIATION, which no longer exists (renamed
    /// ..._delete when the routing procedure took over), decrypted with the web working key, and read the
    /// ZED ID from a property the reconciliation field names never bind to; so it recorded nothing and
    /// never reached its mail and ERP code.
    /// </para>
    /// </summary>
    [HttpPost("/Pay/UpdatePaymentReconciliationStatus")]
    [HttpPost("/SurveillancePay/UpdatePaymentReconciliationStatus")]
    [Consumes("application/x-www-form-urlencoded")]
    public async Task<IActionResult> Reconciliation([FromForm(Name = "encResp")] string? encResp, CancellationToken ct)
    {
        if (!Processor.TryDecrypt(encResp, options.Value.ReconciliationWorkingKey, out var decrypted, out var r))
            return BadRequest(new { status = "400", errorMessage = "Invalid data." });

        var status = r.GetValueOrDefault("order_status") ?? "";
        if (string.Equals(status, "Shipped", StringComparison.OrdinalIgnoreCase)) status = "Success";

        var sets = await db.QueryProcMultipleAsync("SP_MSME_PAYMENT_GATEWAY_DETAILS_RECONCILIATION", new
        {
            ZedId = r.GetValueOrDefault("order_mer_param1"),
            Certification = r.GetValueOrDefault("order_mer_param2"),
            TransactionId = r.GetValueOrDefault("order_id"),
            PaymentStatus = status,
            PaymentResponse = Cut(decrypted),
            PaymentResponseNv = Cut(decrypted),
            RawData = Cut(encResp!),
            ApiType = "RECONCILIATION",
            IpAddress = ClientIp,
        }, ct);

        // The MVC action meant to post to the ERP here, but its module check was inverted: it never posted
        // ZED payments (those post from the browser callback) and posted other modules' payments with the
        // ZED procedures (the wrong documents). The old surveillance action never got that far (see above).
        // Effective behaviour, kept: nothing is posted here. ZED and surveillance payments post from the
        // browser callback; anything missed is listed by SP_API_FINANCE_GET_ZEDIDS_PENDING.
        log.LogInformation("Reconciliation {OrderId}: {Status} (module {Module})", r.GetValueOrDefault("order_id"), status, sets[0].FirstOrDefault()?.Text("ModuleName"));
        return Ok(new { status = "200", errorMessage = "Success" });
    }

    private CcAvenueResponseProcessor Processor => new(db, log);

    private string? ClientIp => HttpContext.Connection.RemoteIpAddress?.ToString();

    private static string Cut(string s) => s.Length > 5000 ? s[..5000] : s;

    private StatusCodeResult Result(CcAvenueOutcome outcome, string? kind) => outcome.Result switch
    {
        CcAvenueResult.Invalid => Result("failure", null, kind, outcome.Message),
        CcAvenueResult.Paid or CcAvenueResult.AlreadyPaid => Result("success", outcome.Certification, kind, null),
        _ => Result("failure", outcome.Certification, kind, outcome.Message),
    };

    private StatusCodeResult Result(string status, string? certification, string? kind, string? message)
    {
        var query = $"?status={status}&certification={Uri.EscapeDataString(certification ?? "")}";
        if (kind is not null) query += "&kind=" + kind;
        if (!string.IsNullOrEmpty(message)) query += "&message=" + Uri.EscapeDataString(message.Length > 300 ? message[..300] : message);
        // 303 See Other: the browser follows the gateway's POST with a GET of the result page.
        Response.Headers.Location = ResultPage + query;
        return StatusCode(StatusCodes.Status303SeeOther);
    }
}

/// <summary>Where a gateway response for one payment module is checked and recorded.</summary>
/// <param name="Orders">Table holding the pending order (a constant, never request data).</param>
/// <param name="Procedure">Records the gateway response and, on success, marks the level paid.</param>
/// <param name="Kind">Web result page variant (<c>kind</c> query parameter); null for the certification payment.</param>
/// <param name="Complete">Receipt, mail and ERP after a successful payment.</param>
/// <param name="Verify">
/// Optional module-specific check of a successful, not yet recorded response (ZED ID, level, order id,
/// decrypted fields). Returns null when it may be recorded as paid, or the status to record instead
/// (as "AmountMismatch" for a different amount); e.g. the consultancy module checks the milestone.
/// </param>
public sealed record CcAvenueGatewayModule(
    string Orders, string Procedure, string? Kind, Func<string, string, CancellationToken, Task> Complete,
    Func<string, string, string, IReadOnlyDictionary<string, string>, CancellationToken, Task<string?>>? Verify = null)
{
    public const string CertificationOrders = "PaymentGatewayTransactions";
    public const string SurveillanceOrders = "ZED_SURVEILLANCE.dbo.PaymentGatewayTransactions";

    public static CcAvenueGatewayModule Certification(PaymentCompletion completion) => new(
        CertificationOrders, "SP_MSME_PAYMENT_GATEWAY_DETAILS", Kind: null,
        (zedId, certification, token) => completion.CompleteAsync(zedId, certification, postToErp: true, token));

    public static CcAvenueGatewayModule Surveillance(SurveillancePaymentCompletion completion) => new(
        SurveillanceOrders, "SP_SURVEILLANCE_MSME_PAYMENT_GATEWAY_DETAILS", Kind: "surveillance",
        (zedId, certification, token) => completion.CompleteAsync(zedId, certification, postToErp: true, token));
}

public enum CcAvenueResult
{
    /// <summary>Missing, not decryptable with the working key, or garbled. Nothing recorded.</summary>
    Invalid,
    /// <summary>Decrypted, but not an order this portal created for that unit and level. Nothing recorded.</summary>
    Unmatched,
    /// <summary>The order was already paid (a repeated response, or the reconciliation came first).</summary>
    AlreadyPaid,
    /// <summary>Recorded as not paid: the gateway's own failure/abort, or a different amount.</summary>
    Failed,
    /// <summary>Recorded as paid; receipt, mail and ERP done.</summary>
    Paid,
}

/// <param name="Fields">The decrypted response (empty when <see cref="Result"/> is Invalid).</param>
public sealed record CcAvenueOutcome(CcAvenueResult Result, string? Certification, string? Message, IReadOnlyDictionary<string, string> Fields);

/// <summary>
/// The verified handling of a CCAvenue redirect/cancel response, shared by the web callbacks
/// (<see cref="CcAvenueCallbackController"/>) and the mobile app callbacks (Pay/successtransmobile, ...):
/// decrypt with the integration's working key, find the order this portal created, require the same ZED
/// ID, level and amount, ignore repeats, record through the module's procedure, then complete.
/// </summary>
public sealed class CcAvenueResponseProcessor(ISqlExecutor db, ILogger log)
{
    public async Task<CcAvenueOutcome> ProcessAsync(string? encResp, string workingKey, CcAvenueGatewayModule module, string? ip, CancellationToken ct)
    {
        if (!TryDecrypt(encResp, workingKey, out var decrypted, out var r))
            return new(CcAvenueResult.Invalid, null, "Invalid response from the payment gateway.", r);

        var orderId = r.GetValueOrDefault("order_id") ?? "";
        var zedId = r.GetValueOrDefault("merchant_param1") ?? "";
        var certification = Certifications.Canonical(r.GetValueOrDefault("merchant_param2")) ?? "";
        var status = r.GetValueOrDefault("order_status") ?? "";

        // The order must be one this portal created, for the same unit and level.
        var order = (await db.QuerySqlAsync<PendingOrder>(
            $"SELECT ZedId, Certification, Amount, PaymentStatus FROM {module.Orders} WHERE TransactionId = @TransactionId",
            new { TransactionId = new Dapper.DbString { Value = orderId, IsAnsi = true, Length = 50 } }, ct)).FirstOrDefault();
        if (order is null || !string.Equals(order.ZedId, zedId, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(order.Certification, certification, StringComparison.OrdinalIgnoreCase))
        {
            log.LogError("CCAvenue response for unknown or mismatched order {OrderId} ({ZedId}/{Certification}) in {Orders}", orderId, zedId, certification, module.Orders);
            return new(CcAvenueResult.Unmatched, certification, "The payment could not be matched to an application. Please contact zed.support@qcin.org.", r);
        }

        var success = string.Equals(status, "Success", StringComparison.OrdinalIgnoreCase);
        if (success && !SameAmount(r.GetValueOrDefault("amount"), order.Amount))
        {
            log.LogError("CCAvenue amount {Paid} differs from order amount {Expected} for {OrderId}", r.GetValueOrDefault("amount"), order.Amount, orderId);
            status = "AmountMismatch";
            success = false;
        }

        if (string.Equals(order.PaymentStatus, "Success", StringComparison.OrdinalIgnoreCase))
            return new(CcAvenueResult.AlreadyPaid, certification, null, r);   // already recorded (e.g. the reconciliation came first)

        if (success && module.Verify is not null && await module.Verify(order.ZedId, certification, orderId, r, ct) is { Length: > 0 } refused)
        {
            log.LogError("CCAvenue response for order {OrderId} ({ZedId}/{Certification}) refused by the module check: {Status}", orderId, order.ZedId, certification, refused);
            status = refused;
            success = false;
        }

        try
        {
            await db.ExecuteProcAsync(module.Procedure, new
            {
                ZedId = order.ZedId, Certification = certification, TransactionId = orderId, PaymentStatus = status,
                PaymentResponse = decrypted.Length > 5000 ? decrypted[..5000] : decrypted,
                IpAddress = ip,
            }, ct);
        }
        catch (DbException ex)
        {
            // The procedure raises an error for a repeated response; the first one was recorded.
            log.LogWarning(ex, "{Procedure} refused order {OrderId}", module.Procedure, orderId);
        }

        if (!success)
            return new(CcAvenueResult.Failed, certification,
                r.GetValueOrDefault("status_message") is { Length: > 0 } m ? m : r.GetValueOrDefault("failure_message"), r);

        await module.Complete(order.ZedId, certification, ct);
        return new(CcAvenueResult.Paid, certification, null, r);
    }

    public bool TryDecrypt(string? encResp, string key, out string decrypted, out Dictionary<string, string> fields)
    {
        decrypted = "";
        fields = [];
        if (string.IsNullOrWhiteSpace(encResp)) return false;
        try
        {
            decrypted = CcAvenueCrypto.Decrypt(encResp, key);
            fields = CcAvenueCrypto.ParseResponse(decrypted);
            return true;
        }
        catch (Exception ex) when (ex is FormatException or CryptographicException or InvalidOperationException)
        {
            log.LogWarning(ex, "CCAvenue payload could not be decrypted");
            return false;
        }
    }

    private static bool SameAmount(string? paid, decimal? expected) =>
        expected is { } b && decimal.TryParse(paid, NumberStyles.Number, CultureInfo.InvariantCulture, out var a) && a == b;

    private sealed record PendingOrder(string ZedId, string Certification, decimal? Amount, string? PaymentStatus);
}
