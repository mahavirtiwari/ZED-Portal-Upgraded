using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Mobile;
using Zed.Core.Payments;
using Zed.Portal.Features.Msme.Handholding;
using Zed.Portal.Features.Payments.Mobile;

namespace Zed.Portal.Features.Payments.Consultancy;

/// <summary>
/// The MSME app's handholding payment actions on the portal, at their old addresses
/// (ConsultancyPayController.GetToken / GetTokenRSA / SubmitZeroPaymentDetails and
/// MsmeController.GetConsultancyPaymentDetailsByType). The gateway's answers come back to
/// <see cref="MobilePaymentResultController"/> (ConsultancyPay/successtransmobile, failuretransmobile).
/// Same model as <see cref="MobilePaymentController"/>: the app has no session, so the ZED ID comes from
/// the request and every unit action is <see cref="DeviceBoundAttribute">device-bound</see>; the milestone,
/// fee row, amount, order id and zero-amount decision are made here, and PaymentRefId / Amount from the
/// app are only compared. Request bodies are not written to disk (the old GetToken appended them to
/// App_Data\Json\CCAVENUE_CONSULTANCY\{ZedId}.json, a path built from the request). A GSTIN must pass the Protean
/// verification of the web checkout (<see cref="AppGstin"/>).
/// </summary>
public sealed partial class ConsultancyMobilePaymentController(
    ISqlExecutor db,
    ICcAvenueMobileClient gateway,
    IGstinVerifier gstinVerifier,
    IDistributedCache cache,
    IOptions<CcAvenueOptions> ccavenue,
    ILogger<ConsultancyMobilePaymentController> log) : LegacyMobileController
{
    private static readonly string[] FeeSetNames = ["WithCoupon", "WithOutCoupon", "CouponStatus"];
    private static readonly ResultSets NoFees = new(FeeSetNames.Select(_ => (IReadOnlyList<IDictionary<string, object?>>)[]).ToList());

    private const string InvalidDetails = "Invalid details.";
    private const string FeeChanged = "The fee details have changed. Please open the payment screen again.";

    // ----- GetToken -----

    /// <summary>
    /// ConsultancyPayController.GetToken: creates the order (SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS) and
    /// returns what the CCAvenue mobile SDK needs (as Pay/GetToken). The old action called the procedure
    /// without an order id, which the procedure answers with a forced error, so it always failed; here the
    /// order id is a GUID, as in the web checkout (ConsultancyPayController.Complete).
    /// </summary>
    [HttpPost("/ConsultancyPay/GetToken")]
    [DeviceBound(MobileApps.Msme, "zedId")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> GetToken(PaymentsViewModel model, CancellationToken ct)
    {
        var o = ccavenue.Value;
        // Admin → Settings → Payment Gateway and Invoices: online payments switched off.
        if (!await PaymentSwitch.IsOnAsync(HttpContext.RequestServices.GetRequiredService<Zed.Core.Data.IPortalSettings>(), ct))
            return Refuse(PaymentSwitch.OffMessage);
        if (string.IsNullOrEmpty(o.MerchantId) || string.IsNullOrEmpty(o.MobileAccessCode) || string.IsNullOrEmpty(o.MobileWorkingKey))
        {
            log.LogError("CCAvenue mobile access code or working key is not configured");
            return Refuse("Payment gateway is not available. Please try again later.");
        }

        var (p, error) = await PrepareAsync(model, ct);
        if (p is null) return Refuse(error!);
        if (p.Choices.Fee.Due is not > 0m) return Refuse("No payment is due for this milestone.");

        var expected = p.Choices.Fee.Payable(p.Choices.Tds);
        var orderId = Guid.NewGuid().ToString();
        var row = (await db.QueryProcMultipleAsync("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS", p.Choices.Args(orderId), ct))[0].FirstOrDefault();
        if (row is null) return Refuse("Payment is already done for this milestone.");
        if (await HandholdingCoChoice.KeepOnOrderAsync(p.Consultancy, p.Assisted, p.Choices.ZedId, orderId, log, ct) is { } notSaved) return Refuse(notSaved);

        var amountText = row.Text("AmountToBePaid");
        if (!decimal.TryParse(amountText, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) || amount != expected ||
            row.Text("MerchantParam3") != $"Milestone {p.Milestone}" || row.Text("TransactionId") != orderId)
        {
            log.LogError("Mobile handholding amount/milestone mismatch for {ZedId}/{Level}: procedure {Amount} {Param3}, fee row {Expected} milestone {Milestone}",
                p.Choices.ZedId, p.Choices.Level, amountText, row.Text("MerchantParam3"), expected, p.Milestone);
            return Refuse("The payment amount could not be confirmed. Please contact zed.support@qcin.org.");
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
            log.LogInformation("Mobile handholding order {OrderId} for {ZedId}/{Level} milestone {Milestone}, amount {Amount}", orderId, p.Choices.ZedId, p.Choices.Level, p.Milestone, amountText);
        }
        else
        {
            response.status = "0";
            response.errorMessage = token?.responseStatus is { Length: > 0 } s ? s : "Unable to reach the payment gateway. Please try again later.";
        }
        return LegacyJson(response);
    }

    // ----- GetTokenRSA -----

    /// <summary>
    /// ConsultancyPayController.GetTokenRSA (any verb): CCAvenue's RSA key for an order, as text. The old
    /// action forwarded any order id with no sign-in; here it must be a pending handholding order of this portal.
    /// </summary>
    [AcceptVerbs("GET", "POST", Route = "/ConsultancyPay/GetTokenRSA")]
    public async Task<IActionResult> GetTokenRSA(string? orderId, CancellationToken ct)
    {
        orderId = orderId?.Trim();
        if (string.IsNullOrEmpty(orderId))
        {
            var values = await LegacyRequestValues.GetAsync(HttpContext);
            orderId = (values.Get("order_id") as System.Text.Json.Nodes.JsonValue)?.ToString().Trim();
        }
        if (string.IsNullOrEmpty(orderId) || !OrderIdPattern().IsMatch(orderId) || string.IsNullOrEmpty(ccavenue.Value.MobileAccessCode))
            return LegacyContent("!ERROR!Invalid order.");

        var order = (await db.QuerySqlAsync<OrderState>(
            $"SELECT TransactionId, PaymentStatus FROM {ConsultancyGateway.Orders} WHERE TransactionId = @TransactionId",
            new { TransactionId = new Dapper.DbString { Value = orderId, IsAnsi = true, Length = 50 } }, ct)).FirstOrDefault();
        if (order is null || string.Equals(order.PaymentStatus, "Success", StringComparison.OrdinalIgnoreCase))
        {
            log.LogWarning("Mobile handholding RSA key refused for unknown or paid order {OrderId}", orderId);
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
    /// ConsultancyPayController.SubmitZeroPaymentDetails as the app called it (no session, ZED ID in the
    /// body). Only for a fee row chosen here with nothing to pay: a state-subsidy row (the web page's condition) or a
    /// milestone paid at milestone 1 (migration 0044) through the zero procedure, and since 2026-11-17 (the user) any other
    /// row with nothing to pay (a 100% subsidy) as a paid order of Rs 0 (<see cref="ZeroAmountPayment"/>); the old action
    /// recorded whatever PaymentRefId was sent, for any unit and level.
    /// </summary>
    [HttpPost("/ConsultancyPay/SubmitZeroPaymentDetails")]
    [DeviceBound(MobileApps.Msme, "zedId")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> SubmitZeroPaymentDetails(PaymentsViewModel model, CancellationToken ct)
    {
        var (p, error) = await PrepareAsync(model, ct);
        if (p is null) return Refuse(error!);
        if (p.Choices.Fee.Due is not <= 0m)
        {
            log.LogWarning("Mobile handholding zero payment refused for {ZedId}/{Level}: fee row {FeeId} is not zero", p.Choices.ZedId, p.Choices.Level, p.Choices.Fee.Id);
            return Refuse("Payment is due for this milestone. Please pay online.");
        }

        var withoutOrder = ConsultancyFees.IsStateRow(p.Choices.Fee) || ConsultancyFees.IsPaidAtMilestone1(p.Choices.Fee);
        var refusal = withoutOrder
            ? await ConsultancyZeroPayment.RecordAsync(db, p.Choices, p.Milestone, log, ct)
            : await ZeroAmountPayment.RecordAsync(db, ZeroAmountPayment.Handholding, p.Choices.ZedId, p.Choices.Level, p.Choices.Args,
                HttpContext.Connection.RemoteIpAddress?.ToString(), log, ct, p.Milestone,
                orderId => HandholdingCoChoice.KeepOnOrderAsync(p.Consultancy, p.Assisted, p.Choices.ZedId, orderId, log, ct));
        if (refusal is not null) return Refuse(refusal);
        if (withoutOrder) await HandholdingCoChoice.KeepOnPaymentAsync(p.Consultancy, p.Assisted, p.Choices.ZedId, p.Choices.Level, log, ct);
        await ConsultancyPaymentCompletion.Create(HttpContext.RequestServices).CompleteAsync(p.Choices.ZedId, p.Choices.Level, gateway: false, ct);
        return LegacyContent(Serialize(new ServiceResponse { status = "1" }));
    }

    // ----- status -----

    /// <summary>
    /// 2026-11-21 (the user: "add handholding payment screens" to the ZED MSME app), new: the unit's handholding levels as the web
    /// page evaluates them (<see cref="HandholdingEligibility"/>): every level open to it or already started, with the milestones
    /// started, the milestone the next payment is for, whether it can be paid now (else why not) and a milestone waiting for the
    /// unit's acceptance. The payment itself checks the same again.
    /// </summary>
    [HttpPost("/ConsultancyPay/GetHandholdingStatus")]
    [DeviceBound(MobileApps.Msme, "zedId")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> GetHandholdingStatus(string? zedId, CancellationToken ct)
    {
        zedId = zedId?.Trim();
        if (string.IsNullOrEmpty(zedId) || zedId.Length > 50) return Refuse(InvalidDetails);
        var row = await ConsultancyPaymentController.StatusRowAsync(db, zedId, ct);
        var levels = HandholdingEligibility.Levels
            .Select(l => HandholdingEligibility.Evaluate(row, l))
            .Where(s => s.Enabled || s.MilestonesStarted > 0)
            .Select(s => new
            {
                certification = s.Certification,
                name = HandholdingEligibility.Display(s.Certification),
                milestonesStarted = s.MilestonesStarted,
                nextMilestone = s.NextMilestone,
                canPay = s.CanPay,
                refusal = s.Refusal,
                awaitingAcceptance = s.AwaitingAcceptance,
            })
            .ToList();
        return LegacyJson(new { status = "1", errorMessage = (string?)null, levels });
    }

    /// <summary>
    /// 2026-11-21, new for the ZED MSME app: "Accept Milestone n" as the web page's (<see cref="HandholdingAcceptance"/>). Next "Started":
    /// one payment for all milestones, the next milestone has started; "Pay": the app opens the next milestone's payment
    /// (NextMilestone); "Completed": the level's three milestones are done.
    /// </summary>
    [HttpPost("/ConsultancyPay/AcceptMilestone")]
    [DeviceBound(MobileApps.Msme, "zedId")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> AcceptMilestone(string? certification, int? milestone, string? zedId, CancellationToken ct)
    {
        zedId = zedId?.Trim();
        if (string.IsNullOrEmpty(zedId) || zedId.Length > 50 || HandholdingEligibility.Canonical(certification) is not { } level ||
            milestone is not (>= 1 and <= HandholdingEligibility.Milestones))
            return Refuse("Invalid milestone.");
        var r = await HandholdingAcceptance.AcceptAsync(db, HttpContext.RequestServices, zedId, level, milestone.Value, log, ct);
        if (r.Error is not null) return Refuse(r.Error);
        return LegacyJson(new { status = "1", errorMessage = (string?)null, message = r.Message, next = r.Next.ToString(), nextMilestone = r.NextMilestone });
    }

    // ----- Consultant Organisation (milestone 1) -----

    /// <summary>
    /// 2026-11-21 (the product owner's rule), new for the ZED MSME app: the organisations the unit may name at the milestone 1
    /// payment ("Did any Consultant Organisation assist you?" Yes), as the web page's list: every active one whose purchase order
    /// for the level is not used up, by name. Only while milestone 1 is the milestone due.
    /// </summary>
    [HttpPost("/ConsultancyPay/GetConsultantOrganisations")]
    [DeviceBound(MobileApps.Msme, "zedId")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> GetConsultantOrganisations(string? certification, string? zedId, CancellationToken ct)
    {
        zedId = zedId?.Trim();
        if (string.IsNullOrEmpty(zedId) || zedId.Length > 50 || HandholdingEligibility.Canonical(certification) is not { } level) return Refuse(InvalidDetails);
        var state = HandholdingEligibility.Evaluate(await ConsultancyPaymentController.StatusRowAsync(db, zedId, ct), level);
        if (!state.CanPay) return Refuse(state.Refusal!);
        if (state.NextMilestone != 1) return Refuse(ConsultancyPaymentController.NotMilestone1);
        if (ConsultancyDatabase.Open(HttpContext.RequestServices) is not { } consultancy) return Refuse("The Consultant Organisations could not be loaded. Please try again later.");
        var organisations = (await HandholdingCoChoice.ListAsync(consultancy, level, log, ct)).Select(o => new { userId = o.UserId, userName = o.Name }).ToList();
        return LegacyJson(new { status = "1", errorMessage = (string?)null, organisations });
    }

    // ----- fee list -----

    /// <summary>
    /// MsmeController.GetConsultancyPaymentDetailsByType (no session; called only by the app): the fee rows of
    /// SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS as WithCoupon / WithOutCoupon / CouponStatus. While a milestone
    /// is in progress the procedure returns no result sets and the old action failed; here the sets are empty.
    /// </summary>
    [HttpPost("/Msme/GetConsultancyPaymentDetailsByType")]
    [DeviceBound(MobileApps.Msme, "zedId")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<IActionResult> GetConsultancyPaymentDetailsByType(string? certification, string? zedId, CancellationToken ct)
    {
        zedId = zedId?.Trim();
        if (string.IsNullOrEmpty(zedId) || zedId.Length > 50 || HandholdingEligibility.Canonical(certification) is not { } level)
            return LegacyContent(LegacyResults.DataSetJson(NoFees, FeeSetNames));
        var sets = await db.QueryProcMultipleAsync("SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS", new { ZedId = zedId, Certification = level }, ct);
        return LegacyContent(LegacyResults.DataSetJson(sets.Count >= FeeSetNames.Length ? sets : NoFees, FeeSetNames));
    }

    // ----- shared checks -----

    private async Task<(Prepared? P, string? Error)> PrepareAsync(PaymentsViewModel model, CancellationToken ct)
    {
        var zedId = model.ZedId?.Trim();
        if (string.IsNullOrEmpty(zedId) || zedId.Length > 50) return (null, InvalidDetails);
        if (HandholdingEligibility.Canonical(model.Certification) is not { } level) return (null, InvalidDetails);

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

        var state = HandholdingEligibility.Evaluate(await ConsultancyPaymentController.StatusRowAsync(db, zedId, ct), level);
        if (!state.CanPay) return (null, state.Refusal);

        var fees = await ConsultancyFees.LoadAsync(db, zedId, level, ct);
        var useReward = IsYes(model.UseCoupon);
        if (useReward && !fees.RewardAvailable) return (null, "The joining reward is not available.");
        var fee = useReward ? fees.WithReward : fees.WithoutReward;
        if (fee is null) return (null, "Fee details are not available for this milestone.");
        if (fee.Due is null)
        {
            // A missing or unreadable amount is refused, never taken as nothing to pay.
            log.LogError("Mobile handholding fee row {FeeId} for {ZedId}/{Level} has no readable ApplicantContributionAfterSubsidy", fee.Id, zedId, level);
            return (null, FeeOption.Unreadable);
        }

        // What the app showed must be what is charged.
        if (!string.IsNullOrWhiteSpace(model.PaymentRefId) && model.PaymentRefId.Trim() != fee.Id)
        {
            log.LogWarning("Mobile handholding for {ZedId}/{Level}: fee row {Sent} sent, {Expected} expected", zedId, level, model.PaymentRefId, fee.Id);
            return (null, FeeChanged);
        }
        if (!string.IsNullOrWhiteSpace(model.Amount) &&
            (!decimal.TryParse(model.Amount.Trim(), NumberStyles.Number, CultureInfo.InvariantCulture, out var sent) || sent != fee.Payable(tds)))
        {
            log.LogWarning("Mobile handholding for {ZedId}/{Level}: amount {Sent} sent, {Expected} expected", zedId, level, model.Amount, fee.Payable(tds));
            return (null, FeeChanged);
        }

        if (gstin is not null && !string.Equals(fees.UdyamPan, Certifications.PanOf(gstin), StringComparison.OrdinalIgnoreCase))
            return (null, "PAN registered in your Udyam portal is not matching with given GSTIN Number.");

        // 2026-11-21: milestone 1's answer about the Consultant Organisation, checked as the web checkout's (active, PO not used up).
        var consultancy = state.NextMilestone == 1 ? ConsultancyDatabase.Open(HttpContext.RequestServices) : null;
        var assistedByCo = IsYes(model.AssistedByCo) ? true : IsNo(model.AssistedByCo) ? false : (bool?)null;
        var (assisted, coRefusal) = await HandholdingCoChoice.CheckAsync(consultancy, level, state.NextMilestone, assistedByCo, model.AssistedCoId, log, ct);
        if (coRefusal is not null) return (null, coRefusal);

        // Last, as it asks Protean: the GSTIN must be verified, as in the web checkout's GSTIN step.
        if (gstin is not null && await AppGstin.VerifyAsync(gstinVerifier, cache, zedId, level, gstin, log, ct) is { } gstinRefusal)
            return (null, gstinRefusal);

        return (new Prepared(new ConsultancyChoices(zedId, level, fee, useReward, gstinApplicable, gstin, tdsDeductible, tds, tan), state.NextMilestone,
            consultancy, assisted), null);
    }

    /// <summary>UnitGstin "Yes"/"No" with the number in Gst (web page), or the number in UnitGstin with Gst "Yes"/"No".</summary>
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

    /// <summary>MVC <c>Content(JsonConvert.SerializeObject(new ServiceResponse { status = "0", ... }))</c>.</summary>
    private static ContentResult Refuse(string message) => LegacyContent(Serialize(ServiceResponse.Fail(message)));

    private static string Serialize(ServiceResponse r) => JsonSerializer.Serialize(r, Zed.Core.Mobile.LegacyJson.Write);

    [GeneratedRegex("^[A-Za-z0-9-]{1,50}$")]
    private static partial Regex OrderIdPattern();

    /// <param name="Consultancy">ZED_CONSULTANT (milestone 1 only), where the answer is kept.</param>
    /// <param name="Assisted">Milestone 1's answer about the Consultant Organisation (null for milestones 2 and 3).</param>
    private sealed record Prepared(ConsultancyChoices Choices, int Milestone, ISqlExecutor? Consultancy, HandholdingCoChoice.Answer? Assisted);

    private sealed record OrderState(string TransactionId, string? PaymentStatus);
}
