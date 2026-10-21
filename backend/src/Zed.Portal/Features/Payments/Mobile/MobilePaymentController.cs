using System.Data.Common;
using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Payments;

namespace Zed.Portal.Features.Payments.Mobile;

/// <summary>
/// The MSME app's payment actions on the portal, at their old addresses (PayController and
/// SurveillancePayController in SwatchSarvekshan, conventional route {controller}/{action}): GetToken,
/// GetTokenRSA and SubmitZeroPaymentDetails, plus the fee lists the app shows before paying
/// (Msme/GetPaymentDetailsByType, SurveillancePay/GetSurveillancePaymentDetailsByType). The gateway's
/// answers come back to <see cref="MobilePaymentResultController"/>.
/// <para>
/// The app has no session, so the ZED ID comes from the request; every action that acts for a unit is
/// <see cref="DeviceBoundAttribute">device-bound</see>. Unlike the MVC actions, the fee row, the amount,
/// the order id and the zero-amount decision are made here from the procedures (as the web checkout,
/// <see cref="MsmePaymentController"/>): PaymentRefId and Amount from the app are only compared, and a
/// different value is refused. Request bodies are not written to disk.
/// </para>
/// </summary>
public sealed partial class MobilePaymentController(
    ISqlExecutor db,
    ICcAvenueMobileClient gateway,
    PaymentCompletion completion,
    SurveillancePaymentCompletion surveillanceCompletion,
    IOptions<CcAvenueOptions> ccavenue,
    ILogger<MobilePaymentController> log) : LegacyMobileController
{
    private static readonly MobileModule Certification = new(
        "Pay", "SP_MSME_GET_PAYMENT_DETAILS", "SP_MSME_PAYMENT_BASIC_DETAILS", "SP_MSME_ZERO_PAYMENT_DETAILS",
        CcAvenueGatewayModule.CertificationOrders, Surveillance: false);

    private static readonly MobileModule Surveillance = new(
        "SurveillancePay", "SP_SURVEILLANCE_MSME_GET_PAYMENT_DETAILS", "SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS",
        "SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS", CcAvenueGatewayModule.SurveillanceOrders, Surveillance: true);

    private static readonly string[] FeeSetNames = ["WithCoupon", "WithOutCoupon", "CouponStatus"];
    private static readonly ResultSets NoFees = new(FeeSetNames.Select(_ => (IReadOnlyList<IDictionary<string, object?>>)[]).ToList());

    private const string InvalidDetails = "Invalid details.";
    private const string FeeChanged = "The fee details have changed. Please open the payment screen again.";
    private const string NotEligible = "Surveillance payment is not available for this certification.";

    // ----- GetToken -----

    /// <summary>
    /// PayController.GetToken: creates the order (SP_MSME_PAYMENT_BASIC_DETAILS) and returns what the
    /// CCAvenue mobile SDK needs: orderId, amount, accessCode, merchantId and
    /// requestHash = SHA-512(orderId + "INR" + amount + secureToken), the secure token coming from
    /// CCAvenue's getSecureToken (requestHash SHA-512(orderId + mobile working key + merchant id)).
    /// </summary>
    [HttpPost("/Pay/GetToken")]
    [DeviceBound(MobileApps.Msme, "zedId")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public Task<IActionResult> GetToken(PaymentsViewModel model, CancellationToken ct) => GetTokenFor(Certification, model, ct);

    /// <summary>
    /// SurveillancePayController.GetToken. The old action called the procedure without an order id, which
    /// ZED_SURVEILLANCE.dbo.SP_MSME_PAYMENT_BASIC_DETAILS answers with a forced error, so it always failed;
    /// here the order id is a GUID, as in the web surveillance checkout.
    /// </summary>
    [HttpPost("/SurveillancePay/GetToken")]
    [DeviceBound(MobileApps.Msme, "zedId")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public Task<IActionResult> SurveillanceGetToken(PaymentsViewModel model, CancellationToken ct) => GetTokenFor(Surveillance, model, ct);

    private async Task<IActionResult> GetTokenFor(MobileModule m, PaymentsViewModel model, CancellationToken ct)
    {
        var o = ccavenue.Value;
        if (string.IsNullOrEmpty(o.MerchantId) || string.IsNullOrEmpty(o.MobileAccessCode) || string.IsNullOrEmpty(o.MobileWorkingKey))
        {
            log.LogError("CCAvenue mobile access code or working key is not configured");
            return Refuse("Payment gateway is not available. Please try again later.");
        }

        var (p, error) = await PrepareAsync(m, model, ct);
        if (p is null) return Refuse(error!);
        if (p.Fee.Amount("ApplicantContributionAfterSubsidy") <= 0) return Refuse("No payment is due for this certification.");

        var expected = p.Fee.Payable(p.Tds);
        var newOrderId = m.Surveillance ? Guid.NewGuid().ToString() : null;   // main: the procedure takes the next PaymentSequence value
        var row = (await db.QueryProcMultipleAsync(m.BasicProc, p.Args(newOrderId), ct))[0].FirstOrDefault();
        if (row is null) return Refuse("Payment is already done for this certification.");

        var amountText = row.Text("AmountToBePaid");
        if (!decimal.TryParse(amountText, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) || amount != expected)
        {
            // e.g. the hard-coded ₹1 "test the payment gateway" lists in the procedures.
            log.LogError("Mobile {Module} amount mismatch for {ZedId}/{Certification}: procedure {Amount}, fee row {Expected}", m.Name, p.ZedId, p.Cert, amountText, expected);
            return Refuse("The payment amount could not be confirmed. Please contact zed.support@qcin.org.");
        }
        var orderId = row.Text("TransactionId");
        if (orderId.Length == 0 || (newOrderId is not null && orderId != newOrderId))
        {
            log.LogError("Mobile {Module} order for {ZedId}/{Certification} came back without the expected order id", m.Name, p.ZedId, p.Cert);
            return Refuse("Unexpected error occurred. Please try after some time.");
        }

        var response = new RequestHashResponse { status = "1" };
        SecureTokenResponse? token;
        try
        {
            token = await gateway.GetSecureTokenAsync(orderId, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            log.LogWarning(ex, "CCAvenue getSecureToken failed for order {OrderId}", orderId);
            token = null;
        }

        if (token is { responseStatus: "Successful", secureToken.Length: > 0 })
        {
            response.requestHash = MobilePaymentHashes.Sha512(orderId + "INR" + amountText + token.secureToken);
            response.orderId = orderId;
            response.accessCode = o.MobileAccessCode;
            response.merchantId = o.MerchantId;
            response.amount = amountText;
            log.LogInformation("Mobile {Module} order {OrderId} for {ZedId}/{Certification}, amount {Amount}", m.Name, orderId, p.ZedId, p.Cert, amountText);
        }
        else
        {
            response.status = "0";
            response.errorMessage = token?.responseStatus is { Length: > 0 } s ? s : "Unable to reach the payment gateway. Please try again later.";
            log.LogWarning("Mobile {Module} order {OrderId} for {ZedId}/{Certification}: no secure token ({Status})", m.Name, orderId, p.ZedId, p.Cert, token?.responseStatus ?? "no answer");
        }
        return LegacyJson(response);
    }

    // ----- GetTokenRSA -----

    /// <summary>
    /// PayController.GetTokenRSA (any verb): CCAvenue's RSA public key for an order, as text. The old
    /// action forwarded any order id; here it must be a pending order this portal created.
    /// </summary>
    [AcceptVerbs("GET", "POST", Route = "/Pay/GetTokenRSA")]
    public Task<IActionResult> GetTokenRSA(string? orderId, CancellationToken ct) => GetRsaFor(Certification, orderId, ct);

    [AcceptVerbs("GET", "POST", Route = "/SurveillancePay/GetTokenRSA")]
    public Task<IActionResult> SurveillanceGetTokenRSA(string? orderId, CancellationToken ct) => GetRsaFor(Surveillance, orderId, ct);

    private async Task<IActionResult> GetRsaFor(MobileModule m, string? orderId, CancellationToken ct)
    {
        orderId = orderId?.Trim();
        if (string.IsNullOrEmpty(orderId))
        {
            // The CCAvenue kit posts order_id; the old action only read orderId.
            var values = await LegacyRequestValues.GetAsync(HttpContext);
            orderId = (values.Get("order_id") as System.Text.Json.Nodes.JsonValue)?.ToString().Trim();
        }
        if (string.IsNullOrEmpty(orderId) || !OrderIdPattern().IsMatch(orderId) || string.IsNullOrEmpty(ccavenue.Value.MobileAccessCode))
            return LegacyContent("!ERROR!Invalid order.");

        var order = (await db.QuerySqlAsync<OrderState>(
            $"SELECT TransactionId, PaymentStatus FROM {m.Orders} WHERE TransactionId = @TransactionId",
            new { TransactionId = new Dapper.DbString { Value = orderId, IsAnsi = true, Length = 50 } }, ct)).FirstOrDefault();
        if (order is null || string.Equals(order.PaymentStatus, "Success", StringComparison.OrdinalIgnoreCase))
        {
            log.LogWarning("Mobile {Module} RSA key refused for unknown or paid order {OrderId}", m.Name, orderId);
            return LegacyContent("!ERROR!Invalid order.");
        }

        try
        {
            return LegacyContent(await gateway.GetRsaKeyAsync(orderId, ct));
        }
        catch (Exception ex) when (ex is HttpRequestException || (ex is TaskCanceledException && !ct.IsCancellationRequested))
        {
            log.LogWarning(ex, "CCAvenue getRSAKey failed for order {OrderId}", orderId);
            return LegacyContent("!ERROR!Unable to reach the payment gateway.");
        }
    }

    // ----- SubmitZeroPaymentDetails -----

    /// <summary>
    /// PayController.SubmitZeroPaymentDetails as the app called it (no session, ZED ID in the body). Only
    /// when the fee row chosen here has nothing to pay (ApplicantContributionAfterSubsidy ≤ 0); the old
    /// action marked the level paid for whatever PaymentRefId was sent.
    /// </summary>
    [HttpPost("/Pay/SubmitZeroPaymentDetails")]
    [DeviceBound(MobileApps.Msme, "zedId")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public Task<IActionResult> SubmitZeroPaymentDetails(PaymentsViewModel model, CancellationToken ct) => ZeroFor(Certification, model, ct);

    [HttpPost("/SurveillancePay/SubmitZeroPaymentDetails")]
    [DeviceBound(MobileApps.Msme, "zedId")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public Task<IActionResult> SurveillanceSubmitZeroPaymentDetails(PaymentsViewModel model, CancellationToken ct) => ZeroFor(Surveillance, model, ct);

    private async Task<IActionResult> ZeroFor(MobileModule m, PaymentsViewModel model, CancellationToken ct)
    {
        var (p, error) = await PrepareAsync(m, model, ct);
        if (p is null) return Refuse(error!);
        if (p.Fee.Amount("ApplicantContributionAfterSubsidy") > 0)
        {
            log.LogWarning("Mobile {Module} zero payment refused for {ZedId}/{Certification}: fee row {FeeId} is not zero", m.Name, p.ZedId, p.Cert, p.Fee.Id);
            return Refuse("Payment is due for this certification. Please pay online.");
        }

        try
        {
            await db.ExecuteProcAsync(m.ZeroProc, p.Args(orderId: null, withOrderId: false), ct);
        }
        catch (DbException ex)
        {
            // The certification procedure raises an error when the level is already paid.
            log.LogWarning(ex, "{Procedure} refused {ZedId}/{Certification}", m.ZeroProc, p.ZedId, p.Cert);
            return Refuse("Payment is already done for this certification.");
        }

        // Confirm it was recorded: the surveillance procedure skips silently (it checks IsBronzePaymentDone
        // for every level), so do not report a payment that did not happen.
        var recorded = m.Surveillance
            ? !await SurveillancePaymentOpenAsync(p.ZedId, p.Cert, ct)
            : (await db.QuerySqlAsync<string>(
                $"SELECT ZedId FROM Msme WHERE ZedId = @ZedId AND Is{p.Cert}PaymentDone = 1",
                new { ZedId = new Dapper.DbString { Value = p.ZedId, IsAnsi = true, Length = 50 } }, ct)).Count > 0;
        if (!recorded)
        {
            log.LogError("Mobile {Module} zero payment for {ZedId}/{Certification} was not recorded by the procedure", m.Name, p.ZedId, p.Cert);
            return Refuse("The payment could not be recorded. Please contact zed.support@qcin.org.");
        }

        if (m.Surveillance) await surveillanceCompletion.CompleteAsync(p.ZedId, p.Cert, postToErp: false, ct);
        else await completion.CompleteAsync(p.ZedId, p.Cert, postToErp: false, ct);
        log.LogInformation("Mobile {Module} zero payment recorded for {ZedId}/{Certification}", m.Name, p.ZedId, p.Cert);
        return LegacyContent(Serialize(new ServiceResponse { status = "1" }));
    }

    // ----- fee lists -----

    /// <summary>
    /// MsmeController.GetPaymentDetailsByType (no session; called only by the app): the fee rows of
    /// SP_MSME_GET_PAYMENT_DETAILS as WithCoupon / WithOutCoupon / CouponStatus, Newtonsoft DataSet layout.
    /// </summary>
    [HttpPost("/Msme/GetPaymentDetailsByType")]
    [DeviceBound(MobileApps.Msme, "zedId")]
    public Task<IActionResult> GetPaymentDetailsByType(string? certification, string? zedId, CancellationToken ct) =>
        FeesFor(Certification, certification, zedId, ct);

    /// <summary>SurveillancePayController.GetSurveillancePaymentDetailsByType, the same for the surveillance fee.</summary>
    [HttpPost("/SurveillancePay/GetSurveillancePaymentDetailsByType")]
    [DeviceBound(MobileApps.Msme, "zedId")]
    public Task<IActionResult> GetSurveillancePaymentDetailsByType(string? certification, string? zedId, CancellationToken ct) =>
        FeesFor(Surveillance, certification, zedId, ct);

    private async Task<IActionResult> FeesFor(MobileModule m, string? certification, string? zedId, CancellationToken ct)
    {
        zedId = zedId?.Trim();
        if (string.IsNullOrEmpty(zedId) || Certifications.Canonical(certification) is not { } cert)
            return LegacyContent(LegacyResults.DataSetJson(NoFees, FeeSetNames));
        var sets = await db.QueryProcMultipleAsync(m.FeeProc, new { ZedId = zedId, Certification = cert }, ct);
        return LegacyContent(LegacyResults.DataSetJson(sets, FeeSetNames));
    }

    // ----- shared checks -----

    /// <summary>
    /// The unit, level and choices from the request, and the fee row chosen here (with or without the
    /// joining reward, from the module's fee procedure). Null with a message when anything is refused.
    /// </summary>
    private async Task<(Prepared? P, string? Error)> PrepareAsync(MobileModule m, PaymentsViewModel model, CancellationToken ct)
    {
        var zedId = model.ZedId?.Trim();
        if (string.IsNullOrEmpty(zedId) || zedId.Length > 50) return (null, InvalidDetails);
        if (Certifications.Canonical(model.Certification?.Trim()) is not { } cert) return (null, InvalidDetails);

        var (gstinApplicable, gstin, gstinError) = ReadGstin(model.UnitGstin, model.Gst);
        if (gstinError is not null) return (null, gstinError);

        string? tds = null, tan = null;
        var tdsDeductible = IsYes(model.TdsDeductible);
        if (tdsDeductible)
        {
            tds = model.Tds?.Trim() switch { "1.5" or "15" => "1.5", "7.5" or "75" => "7.5", _ => null };
            if (tds is null) return (null, "Please select the TDS amount.");
            tan = (model.Tan ?? "").Trim().ToUpperInvariant();
            if (!Certifications.Tan().IsMatch(tan)) return (null, "Please enter valid TAN Number.");
        }

        if (m.Surveillance)
        {
            var details = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId = zedId, CertificationType = (string?)null }, ct);
            if (details[0].FirstOrDefault()?.Text(cert + "DashboardSurStatus") != "1" || !await SurveillancePaymentOpenAsync(zedId, cert, ct))
                return (null, NotEligible);
        }

        var sets = await db.QueryProcMultipleAsync(m.FeeProc, new { ZedId = zedId, Certification = cert }, ct);
        var withReward = sets[0].FirstOrDefault() is { } a ? new FeeOption(a) : null;
        var withoutReward = sets[1].FirstOrDefault() is { } b ? new FeeOption(b) : null;
        var rewardAvailable = sets[2].FirstOrDefault()?.Text("IsCouponUsed") is "0" or "";
        var useReward = IsYes(model.UseCoupon);
        if (useReward && (!rewardAvailable || withReward is null)) return (null, "The joining reward is not available.");
        var fee = useReward ? withReward : withoutReward;
        if (fee is null) return (null, "Fee details are not available for this certification.");

        // What the app showed must be what is charged.
        if (!string.IsNullOrWhiteSpace(model.PaymentRefId) && model.PaymentRefId.Trim() != fee.Id)
        {
            log.LogWarning("Mobile {Module} for {ZedId}/{Certification}: fee row {Sent} sent, {Expected} expected", m.Name, zedId, cert, model.PaymentRefId, fee.Id);
            return (null, FeeChanged);
        }
        if (!string.IsNullOrWhiteSpace(model.Amount) &&
            (!decimal.TryParse(model.Amount.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var sentAmount) || sentAmount != fee.Payable(tds)))
        {
            log.LogWarning("Mobile {Module} for {ZedId}/{Certification}: amount {Sent} sent, {Expected} expected", m.Name, zedId, cert, model.Amount, fee.Payable(tds));
            return (null, FeeChanged);
        }

        var udyamPan = (withReward ?? withoutReward)?.Row.Text("UdyamPanNo");
        if (gstin is not null && !string.Equals(udyamPan, Certifications.PanOf(gstin), StringComparison.OrdinalIgnoreCase))
            return (null, "PAN registered in your Udyam portal is not matching with given GSTIN Number.");

        return (new Prepared(zedId, cert, fee, useReward, gstinApplicable, gstin, tdsDeductible, tds, tan), null);
    }

    /// <summary>
    /// The procedures accept the GSTIN two ways: UnitGstin "Yes"/"No" with the number in Gst (the web page),
    /// or Gst "Yes"/"No" with the number in UnitGstin (swapped inside the procedure).
    /// </summary>
    private static (bool Applicable, string? Gstin, string? Error) ReadGstin(string? unitGstin, string? gst)
    {
        var u = unitGstin?.Trim() ?? "";
        var g = gst?.Trim() ?? "";
        string number;
        if (IsYes(g)) number = u;
        else if (IsYes(u)) number = g;
        else if (IsNo(g) || IsNo(u) || (u.Length == 0 && g.Length == 0)) return (false, null, null);
        else number = u.Length > 0 ? u : g;

        number = number.ToUpperInvariant();
        return Certifications.Gstin().IsMatch(number) ? (true, number, null) : (false, null, "Please enter valid GSTIN.");
    }

    private static bool IsYes(string? s) => string.Equals(s?.Trim(), "Yes", StringComparison.OrdinalIgnoreCase);

    private static bool IsNo(string? s) => string.Equals(s?.Trim(), "No", StringComparison.OrdinalIgnoreCase);

    /// <summary>SP_SURVEILLANCE_MSME_GET_PAYMENT_STATUS: 1 while the level is certified and its surveillance fee is unpaid.</summary>
    private async Task<bool> SurveillancePaymentOpenAsync(string zedId, string cert, CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_SURVEILLANCE_MSME_GET_PAYMENT_STATUS", new { ZedId = zedId, Certification = cert }, ct))[0]
            .FirstOrDefault()?.Text("PaymentStatus") == "1";

    /// <summary>MVC <c>Content(JsonConvert.SerializeObject(new ServiceResponse { status = "0", ... }))</c>: text/html.</summary>
    private static ContentResult Refuse(string message) => LegacyContent(Serialize(ServiceResponse.Fail(message)));

    private static string Serialize(ServiceResponse r) => JsonSerializer.Serialize(r, Zed.Core.Mobile.LegacyJson.Write);

    [GeneratedRegex("^[A-Za-z0-9-]{1,50}$")]
    private static partial Regex OrderIdPattern();

    private sealed record MobileModule(string Name, string FeeProc, string BasicProc, string ZeroProc, string Orders, bool Surveillance);

    private sealed record OrderState(string TransactionId, string? PaymentStatus);

    private sealed record Prepared(
        string ZedId, string Cert, FeeOption Fee, bool UseReward, bool GstinApplicable, string? Gstin, bool TdsDeductible, string? Tds, string? Tan)
    {
        /// <summary>Arguments of the module's payment procedures, in the web page's convention.</summary>
        public object Args(string? orderId, bool withOrderId = true) => withOrderId
            ? new
            {
                ZedId, Certification = Cert, UseCoupon = UseReward ? "Yes" : "No", UnitGstin = GstinApplicable ? "Yes" : "No", Gstin,
                TdsDeductible = TdsDeductible ? "Yes" : "No", Tds, Tan, PaymentRefId = Fee.Id, TransactionId = orderId,
            }
            : new
            {
                ZedId, Certification = Cert, UseCoupon = UseReward ? "Yes" : "No", UnitGstin = GstinApplicable ? "Yes" : "No", Gstin,
                TdsDeductible = TdsDeductible ? "Yes" : "No", Tds, Tan, PaymentRefId = Fee.Id,
            };
    }
}
