using System.Data.Common;
using System.Globalization;
using System.Security.Cryptography;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Payments;
using Zed.Portal.Features.Payments.Consultancy;

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
    /// <para>
    /// The push goes through the module checks and the completion of the browser callback
    /// (<see cref="CcAvenueResponseProcessor.ReconcileAsync"/>): the consultancy milestone check before it is recorded and,
    /// when the push is what marked the order paid, the module's completion (ZED-X / surveillance paid steps, the consultancy
    /// parameters, receipt, mail and ERP). Before, a payment first recorded here got none of them, and a late milestone-1
    /// payment could open milestone 2.
    /// </para>
    /// </summary>
    [HttpPost("/Pay/UpdatePaymentReconciliationStatus")]
    [HttpPost("/SurveillancePay/UpdatePaymentReconciliationStatus")]
    [Consumes("application/x-www-form-urlencoded")]
    public async Task<IActionResult> Reconciliation([FromForm(Name = "encResp")] string? encResp, CancellationToken ct)
    {
        if (!Processor.TryDecrypt(encResp, options.Value.ReconciliationWorkingKey, out var decrypted, out var r))
            return BadRequest(new { status = "400", errorMessage = "Invalid data." });

        // In the routing procedure's order: ZED_SURVEILLANCE, ZED_CONSULTANT, then main.
        CcAvenueGatewayModule[] modules =
        [
            CcAvenueGatewayModule.Surveillance(surveillance),
            ConsultancyGateway.Module(ConsultancyPaymentCompletion.Create(HttpContext.RequestServices), db),
            CcAvenueGatewayModule.Certification(completion),
        ];
        await Processor.ReconcileAsync(encResp!, decrypted, r, modules, ClientIp, ct);
        return Ok(new { status = "200", errorMessage = "Success" });
    }

    private CcAvenueResponseProcessor Processor => new(db, log);

    private string? ClientIp => HttpContext.Connection.RemoteIpAddress?.ToString();

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
    /// <summary>
    /// A success the database did not record (its procedure failed: a deadlock, a timeout). Nothing is completed: no receipt,
    /// mail or ERP posting; the gateway's reconciliation records it later.
    /// </summary>
    NotRecorded,
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
    /// <summary>
    /// One response is recorded at a time in this process. Each path (web, app, reconciliation) reads the order, records the
    /// response and decides from what it read whether it is the one that marked the order paid; serialised, two responses for
    /// one order (a browser callback and the reconciliation push arriving together) never both complete it.
    /// </summary>
    private static readonly SemaphoreSlim Recording = new(1, 1);

    public async Task<CcAvenueOutcome> ProcessAsync(string? encResp, string workingKey, CcAvenueGatewayModule module, string? ip, CancellationToken ct)
    {
        if (!TryDecrypt(encResp, workingKey, out var decrypted, out var r))
            return new(CcAvenueResult.Invalid, null, "Invalid response from the payment gateway.", r);

        (CcAvenueOutcome Outcome, string? PaidBy) recorded;
        await Recording.WaitAsync(ct);
        try
        {
            recorded = await RecordAsync(decrypted, r, module, ip, ct);
        }
        finally
        {
            Recording.Release();
        }

        // Receipt, mail and ERP outside the lock; only the response that recorded the payment gets here.
        if (recorded.PaidBy is { } zedId) await module.Complete(zedId, recorded.Outcome.Certification!, ct);
        return recorded.Outcome;
    }

    /// <returns>The outcome, and the unit whose payment to complete when this response recorded it as paid.</returns>
    private async Task<(CcAvenueOutcome Outcome, string? PaidBy)> RecordAsync(
        string decrypted, Dictionary<string, string> r, CcAvenueGatewayModule module, string? ip, CancellationToken ct)
    {
        var orderId = r.GetValueOrDefault("order_id") ?? "";
        var zedId = r.GetValueOrDefault("merchant_param1") ?? "";
        var certification = Certifications.CanonicalApplicable(r.GetValueOrDefault("merchant_param2")) ?? "";
        var status = r.GetValueOrDefault("order_status") ?? "";

        // The order must be one this portal created, for the same unit and level.
        var order = await OrderAsync(module, orderId, ct);
        if (order is null || !string.Equals(order.ZedId, zedId, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(order.Certification, certification, StringComparison.OrdinalIgnoreCase))
        {
            log.LogError("CCAvenue response for unknown or mismatched order {OrderId} ({ZedId}/{Certification}) in {Orders}", orderId, zedId, certification, module.Orders);
            return (new CcAvenueOutcome(CcAvenueResult.Unmatched, certification, "The payment could not be matched to an application. Please contact zed.support@qcin.org.", r), null);
        }

        var success = string.Equals(status, "Success", StringComparison.OrdinalIgnoreCase);
        if (success && !SameAmount(r.GetValueOrDefault("amount"), order.Amount))
        {
            log.LogError("CCAvenue amount {Paid} differs from order amount {Expected} for {OrderId}", r.GetValueOrDefault("amount"), order.Amount, orderId);
            status = "AmountMismatch";
            success = false;
        }

        if (IsPaid(order.PaymentStatus))
            return (new CcAvenueOutcome(CcAvenueResult.AlreadyPaid, certification, null, r), null);   // already recorded (e.g. the reconciliation came first)

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
            // The procedure raises an error for a repeated response. Complete only a payment that is recorded: a repeat that
            // lost the race to the first response is that one's (it completes it), and a failed recording is left to the
            // reconciliation; completing either would send a second receipt, mail and ERP invoice, or one for an unpaid level.
            log.LogWarning(ex, "{Procedure} refused order {OrderId}", module.Procedure, orderId);
            if (success)
            {
                if (IsPaid((await OrderAsync(module, orderId, ct))?.PaymentStatus))
                    return (new CcAvenueOutcome(CcAvenueResult.AlreadyPaid, certification, null, r), null);
                log.LogError("CCAvenue success for order {OrderId} ({ZedId}/{Certification}) was not recorded; left to the reconciliation",
                    orderId, order.ZedId, certification);
                return (new CcAvenueOutcome(CcAvenueResult.NotRecorded, certification,
                    "Your payment was received, but it could not be recorded yet. It will be updated automatically; if your application does not show it within a day, please contact zed.support@qcin.org.", r), null);
            }
        }

        if (!success)
            return (new CcAvenueOutcome(CcAvenueResult.Failed, certification,
                r.GetValueOrDefault("status_message") is { Length: > 0 } m ? m : r.GetValueOrDefault("failure_message"), r), null);

        return (new CcAvenueOutcome(CcAvenueResult.Paid, certification, null, r), order.ZedId);
    }

    /// <summary>
    /// CCAvenue's status push (reconciliation), decrypted with the reconciliation key. Recorded as before through
    /// SP_MSME_PAYMENT_GATEWAY_DETAILS_RECONCILIATION (it logs every push and routes it by order id to the module's gateway
    /// procedure, skipping a payment already recorded), now with the checks and the completion of <see cref="ProcessAsync"/>:
    /// <list type="bullet">
    /// <item>the order is looked up in the modules' tables, in the procedure's order, and must be for the pushed unit and
    /// level, or nothing is recorded (an order no module knows is passed on: the procedure only logs it);</item>
    /// <item>a success for another amount (order_amt, when sent) is recorded as "AmountMismatch", and one the module's check
    /// refuses (the consultancy milestone) with the module's status: neither marks anything paid, so a late milestone-1
    /// payment no longer opens milestone 2;</item>
    /// <item>the module's completion runs only when this push turned the pending order into a paid one: never for an order
    /// the browser callback or an earlier push had recorded, so never twice.</item>
    /// </list>
    /// The completion posts to the ERP as the browser callback does. The MVC action never posted ZED payments here (its module
    /// check was inverted), so a payment first recorded by the push was left to SP_API_FINANCE_GET_ZEDIDS_PENDING.
    /// </summary>
    /// <param name="modules">The modules whose orders the push may be for, in the routing procedure's order.</param>
    public async Task ReconcileAsync(string encResp, string decrypted, IReadOnlyDictionary<string, string> r,
        IReadOnlyList<CcAvenueGatewayModule> modules, string? ip, CancellationToken ct)
    {
        var orderId = r.GetValueOrDefault("order_id") ?? "";
        var pushedZedId = r.GetValueOrDefault("order_mer_param1");
        var pushedLevel = r.GetValueOrDefault("order_mer_param2");
        var status = r.GetValueOrDefault("order_status") ?? "";
        if (string.Equals(status, "Shipped", StringComparison.OrdinalIgnoreCase)) status = "Success";

        // The module checks read the checkout's fields by their redirect names (merchant_param3: the milestone).
        var fields = new Dictionary<string, string>(r);
        foreach (var (name, value) in r)
            if (name.StartsWith("order_mer_param", StringComparison.Ordinal)) fields.TryAdd("merchant_param" + name["order_mer_param".Length..], value);

        CcAvenueGatewayModule? module = null;
        PendingOrder? order = null;
        string? certification = null, paidBy = null;
        await Recording.WaitAsync(ct);
        try
        {
            foreach (var m in modules)
            {
                if (await OrderAsync(m, orderId, ct) is not { } found) continue;
                (module, order) = (m, found);
                break;
            }

            var success = string.Equals(status, "Success", StringComparison.OrdinalIgnoreCase);
            var wasPaid = false;
            if (module is not null && order is not null)
            {
                certification = Certifications.CanonicalApplicable(pushedLevel);
                if (!string.Equals(order.ZedId, pushedZedId, StringComparison.OrdinalIgnoreCase) ||
                    !string.Equals(order.Certification, certification, StringComparison.OrdinalIgnoreCase))
                {
                    log.LogError("Reconciliation for order {OrderId} ({ZedId}/{Certification}) does not match the order in {Orders}; not recorded",
                        orderId, pushedZedId, pushedLevel, module.Orders);
                    return;
                }
                wasPaid = IsPaid(order.PaymentStatus);
                if (success && !wasPaid)
                {
                    if (r.GetValueOrDefault("order_amt") is { Length: > 0 } amount && !SameAmount(amount, order.Amount))
                    {
                        log.LogError("Reconciliation amount {Paid} differs from order amount {Expected} for {OrderId}", amount, order.Amount, orderId);
                        (status, success) = ("AmountMismatch", false);
                    }
                    else if (module.Verify is not null && await module.Verify(order.ZedId, certification!, orderId, fields, ct) is { Length: > 0 } refused)
                    {
                        log.LogError("Reconciliation for order {OrderId} ({ZedId}/{Certification}) refused by the module check: {Status}",
                            orderId, order.ZedId, certification, refused);
                        (status, success) = (refused, false);
                    }
                }
            }

            var sets = await db.QueryProcMultipleAsync("SP_MSME_PAYMENT_GATEWAY_DETAILS_RECONCILIATION", new
            {
                ZedId = order?.ZedId ?? pushedZedId,
                Certification = certification ?? pushedLevel,
                TransactionId = orderId,
                PaymentStatus = status,
                PaymentResponse = Cut(decrypted),
                PaymentResponseNv = Cut(decrypted),
                RawData = Cut(encResp),
                ApiType = "RECONCILIATION",
                IpAddress = ip,
            }, ct);
            log.LogInformation("Reconciliation {OrderId}: {Status} (module {Module})", orderId, status, sets[0].FirstOrDefault()?.Text("ModuleName"));

            // Paid by this push only when the order was pending and is paid now (the procedure skips a recorded payment).
            if (module is not null && order is not null && success && !wasPaid)
            {
                if (IsPaid((await OrderAsync(module, orderId, ct))?.PaymentStatus)) paidBy = order.ZedId;
                else log.LogWarning("Reconciliation success for order {OrderId} ({ZedId}/{Certification}) was not recorded as paid", orderId, order.ZedId, certification);
            }
        }
        finally
        {
            Recording.Release();
        }

        if (paidBy is not null) await module!.Complete(paidBy, certification!, ct);
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

    private async Task<PendingOrder?> OrderAsync(CcAvenueGatewayModule module, string orderId, CancellationToken ct) =>
        (await db.QuerySqlAsync<PendingOrder>(
            $"SELECT ZedId, Certification, Amount, PaymentStatus FROM {module.Orders} WHERE TransactionId = @TransactionId",
            new { TransactionId = new Dapper.DbString { Value = orderId, IsAnsi = true, Length = 50 } }, ct)).FirstOrDefault();

    private static bool IsPaid(string? status) => string.Equals(status, "Success", StringComparison.OrdinalIgnoreCase);

    private static bool SameAmount(string? paid, decimal? expected) =>
        expected is { } b && decimal.TryParse(paid, NumberStyles.Number, CultureInfo.InvariantCulture, out var a) && a == b;

    private static string Cut(string s) => s.Length > 5000 ? s[..5000] : s;

    private sealed record PendingOrder(string ZedId, string Certification, decimal? Amount, string? PaymentStatus);
}
