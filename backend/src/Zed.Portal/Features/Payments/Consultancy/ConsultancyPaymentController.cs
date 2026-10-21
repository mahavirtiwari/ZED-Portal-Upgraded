using System.Data.Common;
using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Payments;
using Zed.Portal.Features.Msme;
using Zed.Portal.Features.Msme.Handholding;

namespace Zed.Portal.Features.Payments.Consultancy;

/// <summary>
/// Paying for the next Handholding Support milestone of Silver or Gold. Port of the payment steps of
/// Frontend/Msme/HandholdingSupport.cshtml (disclaimer, instructions, options, summary, PAN pop-up) with
/// MsmeController.GetConsultancyPaymentDetails / GetUdyam / UpdateUdyamDetails / ValidateGstinProtean /
/// UpdatePan and ConsultancyPayController.Complete / SubmitZeroPaymentDetails. Same model as
/// <see cref="SurveillancePaymentController"/>.
/// <para>
/// The browser only sends choices (GSTIN, TDS, reward). The milestone, the fee row, the amount, the order
/// id, the zero-amount decision and the ZED ID are decided here. The MVC actions took the fee row id
/// (PaymentRefId) from the browser (Complete used it to look up the amount), never checked that the
/// previous milestone was accepted, and SubmitZeroPaymentDetails took the ZED ID from the body when there
/// was no session (only a Referer check otherwise).
/// </para>
/// <para>
/// Eligibility (every call): <see cref="HandholdingEligibility"/> from SP_CONSULTANCY_APP_MSME_STATUS, and
/// SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS must return a fee row for the milestone due (it returns nothing
/// while a milestone is in progress).
/// </para>
/// </summary>
[Route("api/msme/consultancy-payments")]
public sealed class ConsultancyPaymentController(
    ISqlExecutor db,
    IUdyamClient udyam,
    IGstinVerifier gstinVerifier,
    IDistributedCache cache,
    IOptions<CcAvenueOptions> ccavenue,
    IOptions<PortalOptions> portal,
    ILogger<ConsultancyPaymentController> log) : MsmeApiController
{
    public const string ResponsePath = "/api/payments/ccavenue/consultancy-response";
    private const string NoFees = "Fee details are not available for this milestone.";

    // ----- status -----

    [HttpGet("{certification}/status")]
    public async Task<ActionResult<HandholdingEligibility.LevelState>> Status(string certification, CancellationToken ct)
    {
        if (HandholdingEligibility.Canonical(certification) is not { } level) return this.Problem400("Invalid certification.");
        return HandholdingEligibility.Evaluate(await StatusRowAsync(db, ZedId, ct), level);
    }

    // ----- options -----

    public sealed record OptionsResponse(
        string Certification,
        int Milestone,
        Dictionary<string, object?>? WithReward,
        Dictionary<string, object?> WithoutReward,
        bool RewardAvailable,
        string? UdyamPan,
        bool StateSubsidy);

    private static readonly string[] FeeFields =
    [
        "Total", "Coupon", "TotalAfterCoupon", "SubsidyLabel", "Subsidy", "StateSubsidyLabel", "StateContributionAfterSubsidy",
        "ApplicantContributionAfterSubsidy", "SubsidyAmount", "GstAfterSubsidy", "Tds15", "Tds75", "NetPaybleTds15", "NetPaybleTds75",
    ];

    /// <summary>
    /// Fee summary for the milestone due. First refreshes the enterprise type from the Udyam service
    /// (the fee depends on it), as the old page did after the instructions step (PaymentModule "ZED CONSULTANCY").
    /// </summary>
    [HttpGet("{certification}/options")]
    public async Task<ActionResult<OptionsResponse>> Options(string certification, CancellationToken ct)
    {
        if (HandholdingEligibility.Canonical(certification) is not { } level) return this.Problem400("Invalid certification.");
        var state = HandholdingEligibility.Evaluate(await StatusRowAsync(db, ZedId, ct), level);
        if (!state.CanPay) return this.Problem400(state.Refusal!);
        await RefreshEnterpriseType(ct);

        var fees = await ConsultancyFees.LoadAsync(db, ZedId, level, ct);
        if (fees.WithoutReward is null) return this.Problem400(NoFees);
        return new OptionsResponse(level, state.NextMilestone, fees.RewardAvailable ? Pick(fees.WithReward!) : null, Pick(fees.WithoutReward),
            fees.RewardAvailable, fees.UdyamPan, ConsultancyFees.IsStateRow(fees.WithoutReward));
    }

    // ----- GSTIN and PAN -----

    /// <summary>Verifies the unit's GSTIN with Protean (as Msme/ValidateGstinProtean); remembered for 30 minutes for checkout.</summary>
    [HttpPost("gstin")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MsmePaymentController.GstinResponse>> VerifyGstin(MsmePaymentController.GstinRequest req, CancellationToken ct)
    {
        if (HandholdingEligibility.Canonical(req.Certification) is not { } level) return this.Problem400("Invalid certification.");
        var gstin = (req.Gstin ?? "").Trim().ToUpperInvariant();
        if (!Certifications.Gstin().IsMatch(gstin)) return this.Problem400("Please enter valid GSTIN.");

        GstinResult result;
        try { result = await gstinVerifier.VerifyAsync(ZedId, level, gstin, ct); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            log.LogWarning(ex, "GSTIN verification unavailable");
            return Problem(title: "Unexpected error occurred. Please try after some time.", statusCode: StatusCodes.Status502BadGateway);
        }
        if (!result.Valid) return this.Problem400(result.Message);

        await cache.SetStringAsync(GstinKey(gstin), "1", new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30) }, ct);
        var udyamPan = (await ConsultancyFees.LoadAsync(db, ZedId, level, ct)).UdyamPan;
        var gstinPan = Certifications.PanOf(gstin);
        return new MsmePaymentController.GstinResponse(result.Message, string.Equals(udyamPan, gstinPan, StringComparison.OrdinalIgnoreCase), gstinPan, udyamPan);
    }

    /// <summary>
    /// "PAN Mismatch Detected" (Msme/UpdatePan, SP_MESE_UPDATE_PAN). The old page sent the ZED ID and the
    /// old PAN from the browser; here both come from the server and the GSTIN must have been verified first.
    /// </summary>
    [HttpPost("pan")]
    public async Task<ActionResult<MessageResponse>> CorrectPan(MsmePaymentController.PanRequest req, CancellationToken ct)
    {
        if (HandholdingEligibility.Canonical(req.Certification) is not { } level) return this.Problem400("Invalid certification.");
        var gstin = (req.Gstin ?? "").Trim().ToUpperInvariant();
        var pan = (req.Pan ?? "").Trim().ToUpperInvariant();
        if (!Certifications.Pan().IsMatch(pan)) return this.Problem400("Please enter a valid 10-character PAN.");
        if (!Certifications.Gstin().IsMatch(gstin) || await cache.GetStringAsync(GstinKey(gstin), ct) is null)
            return this.Problem400("Please verify the GSTIN first.");
        if (pan != Certifications.PanOf(gstin)) return this.Problem400("Please enter the correct PAN associated with that GSTIN.");

        var oldPan = (await ConsultancyFees.LoadAsync(db, ZedId, level, ct)).UdyamPan;
        try
        {
            await db.ExecuteProcAsync("SP_MESE_UPDATE_PAN", new { ZedId, PanNo = oldPan, UpdatedPanNo = pan }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "SP_MESE_UPDATE_PAN failed for {ZedId}", ZedId);
            return this.Problem400("Failed to update PAN. Please try again.");
        }
        return new MessageResponse("PAN updated successfully.");
    }

    // ----- checkout -----

    /// <param name="Milestone">The milestone the page showed; refused when another one is due now.</param>
    public sealed record CheckoutRequest(bool UseReward, bool GstinApplicable, string? Gstin, bool TdsDeductible, string? Tds, string? Tan, int? Milestone);

    [HttpPost("{certification}/checkout")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MsmePaymentController.CheckoutResponse>> Checkout(string certification, CheckoutRequest req, CancellationToken ct)
    {
        if (HandholdingEligibility.Canonical(certification) is not { } level) return this.Problem400("Invalid certification.");

        // Choices
        string? gstin = null;
        if (req.GstinApplicable)
        {
            gstin = (req.Gstin ?? "").Trim().ToUpperInvariant();
            if (!Certifications.Gstin().IsMatch(gstin)) return this.Problem400("Please enter valid GSTIN.");
            if (await cache.GetStringAsync(GstinKey(gstin), ct) is null) return this.Problem400("Please verify the GSTIN first.");
        }
        string? tds = null, tan = null;
        if (req.TdsDeductible)
        {
            tds = req.Tds is "1.5" or "7.5" ? req.Tds : null;
            if (tds is null) return this.Problem400("Please select the TDS amount.");
            tan = (req.Tan ?? "").Trim().ToUpperInvariant();
            if (!Certifications.Tan().IsMatch(tan)) return this.Problem400("Please enter valid TAN Number.");
        }

        // Milestone, fee row and amount: from the database only
        var state = HandholdingEligibility.Evaluate(await StatusRowAsync(db, ZedId, ct), level);
        if (!state.CanPay) return this.Problem400(state.Refusal!);
        if (req.Milestone is { } shown && shown != state.NextMilestone)
            return this.Problem400("The milestone due has changed. Please open the payment page again.");

        var fees = await ConsultancyFees.LoadAsync(db, ZedId, level, ct);
        if (req.UseReward && !fees.RewardAvailable) return this.Problem400("The joining reward is not available.");
        var fee = req.UseReward ? fees.WithReward : fees.WithoutReward;
        if (fee is null) return this.Problem400(NoFees);
        if (gstin is not null && !string.Equals(fees.UdyamPan, Certifications.PanOf(gstin), StringComparison.OrdinalIgnoreCase))
            return this.Problem400("PAN registered in your Udyam portal is not matching with given GSTIN Number.");

        var choices = new ConsultancyChoices(ZedId, level, fee, req.UseReward, req.GstinApplicable, gstin, req.TdsDeductible, tds, tan);

        // Nothing to pay after subsidy (the old page's condition: a state-subsidy row with nothing left to pay).
        if (fee.Amount("ApplicantContributionAfterSubsidy") <= 0)
        {
            if (!ConsultancyFees.IsStateRow(fee))
            {
                // The old page sent this to the gateway with amount 0; the zero procedure only records state-subsidy rows.
                log.LogError("Handholding fee row {FeeId} for {ZedId}/{Level} has nothing to pay but no state subsidy", fee.Id, ZedId, level);
                return this.Problem400("The payment amount could not be confirmed. Please contact zed.support@qcin.org.");
            }
            return await RecordZeroAsync(choices, state.NextMilestone, ct) is { } error
                ? this.Problem400(error)
                : new MsmePaymentController.CheckoutResponse("paid");
        }

        var expected = fee.Payable(tds);
        var orderId = Guid.NewGuid().ToString();   // ConsultancyPayController.Complete used a GUID too
        var row = (await db.QueryProcMultipleAsync("SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS", choices.Args(orderId), ct))[0].FirstOrDefault();
        if (row is null) return this.Problem400("Payment is already done for this milestone.");

        var amountText = row.Text("AmountToBePaid");
        if (!decimal.TryParse(amountText, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) || amount != expected ||
            row.Text("MerchantParam3") != $"Milestone {state.NextMilestone}")
        {
            // e.g. the hard-coded ₹1 "test the payment gateway" list in the procedure, or a state fee row id
            // that the procedure looks up in AssessmentFee.
            log.LogError("Handholding amount/milestone mismatch for {ZedId}/{Level}: procedure {Amount} {Param3}, fee row {Expected} milestone {Milestone}",
                ZedId, level, amountText, row.Text("MerchantParam3"), expected, state.NextMilestone);
            return this.Problem400("The payment amount could not be confirmed. Please contact zed.support@qcin.org.");
        }

        var o = ccavenue.Value;
        var responseUrl = portal.Value.PublicBaseUrl.TrimEnd('/') + ResponsePath;
        string R(string c) => row.Text(c);
        var plain = CcAvenueCrypto.BuildRequest(
        [
            new("order_id", orderId), new("amount", amountText), new("currency", "INR"), new("merchant_id", o.MerchantId),
            new("redirect_url", responseUrl), new("cancel_url", responseUrl),
            new("checksum", CcAvenueCrypto.Checksum(o.MerchantId, orderId, amountText, o.GatewayUrl, o.WorkingKey)),
            new("billing_name", R("EnterpriseName")), new("billing_address", R("PAddress")), new("billing_country", "India"),
            new("billing_tel", R("MobileNo")), new("billing_email", R("PledgeEmailId")), new("billing_state", R("PStateName")),
            new("billing_city", R("PDistrictName")), new("billing_zip", R("PPin")),
            new("delivery_name", R("EnterpriseName")), new("delivery_address", R("PAddress")), new("delivery_country", "India"),
            new("delivery_tel", R("MobileNo")), new("delivery_state", R("PStateName")), new("delivery_city", R("PDistrictName")),
            new("delivery_zip", R("PPin")),
            new("merchant_param1", ZedId), new("merchant_param2", level), new("merchant_param3", R("MerchantParam3")),
        ]);

        log.LogInformation("CCAvenue handholding order {OrderId} for {ZedId}/{Level} milestone {Milestone}, amount {Amount}", orderId, ZedId, level, state.NextMilestone, amountText);
        return new MsmePaymentController.CheckoutResponse("gateway", o.GatewayUrl, CcAvenueCrypto.Encrypt(plain, o.WorkingKey), o.AccessCode);
    }

    // ----- helpers -----

    private string GstinKey(string gstin) => $"consultancy-gstin-ok:{ZedId}:{gstin}";

    /// <summary>SP_CONSULTANCY_APP_MSME_STATUS for a unit.</summary>
    internal static async Task<IDictionary<string, object?>?> StatusRowAsync(ISqlExecutor db, string zedId, CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_CONSULTANCY_APP_MSME_STATUS", new { ZedId = zedId, CertificationType = (string?)null }, ct))[0].FirstOrDefault();

    /// <summary>
    /// SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS (ZED_CONSULTANT SP_MSME_ZERO_PAYMENT_DETAILS) for a state-subsidy
    /// row with nothing to pay, then confirm the milestone was opened. Null when recorded, else the message.
    /// </summary>
    private async Task<string?> RecordZeroAsync(ConsultancyChoices c, int milestone, CancellationToken ct)
    {
        var refusal = await ConsultancyZeroPayment.RecordAsync(db, c, milestone, log, ct);
        if (refusal is null)
            await ConsultancyPaymentCompletion.Create(HttpContext.RequestServices).CompleteAsync(c.ZedId, c.Level, gateway: false, ct);
        return refusal;
    }

    private static Dictionary<string, object?> Pick(FeeOption fee) =>
        FeeFields.ToDictionary(f => f, f => fee.Row.TryGetValue(f, out var v) && v is not DBNull ? v : null);

    /// <summary>
    /// Msme/GetUdyam + Msme/UpdateUdyamDetails as the handholding page used them: when the Udyam service
    /// reports a different enterprise type than ZED_CONSULTANT's MsmeBasicInformation, record it
    /// (SP_MSME_UPDATE_UDYAM_DETAILS, PaymentModule "ZED CONSULTANCY"; it updates all three databases).
    /// The type comes from the service, not from the browser. Failures are ignored, as before.
    /// </summary>
    private async Task RefreshEnterpriseType(CancellationToken ct)
    {
        try
        {
            var sets = await db.QueryProcMultipleAsync("SP_CONSULTANCY_MSME_GET_DETAILS", new { ZedId, CertificationType = (string?)null }, ct);
            var basic = sets[1].FirstOrDefault();
            var udyamNo = basic?.Text("UdyogAadharNo");
            var mobile = basic?.Text("MobileNo");
            if (string.IsNullOrEmpty(udyamNo) || string.IsNullOrEmpty(mobile)) return;

            var lookup = await udyam.GetUdyamAsync(udyamNo, mobile, ct);
            var current = lookup.BasicDetails.GetValueOrDefault("EnterpriseType");
            if (!string.IsNullOrEmpty(current) && !string.Equals(current, basic!.Text("EnterpriseTypee"), StringComparison.OrdinalIgnoreCase))
                await db.ExecuteProcAsync("SP_MSME_UPDATE_UDYAM_DETAILS", new
                {
                    UdyamNumber = udyamNo, EnterpriseType = current, PaymentModule = "ZED CONSULTANCY", ModifiedDataType = "EnterpriseType", ZedId,
                }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Enterprise type refresh skipped for {ZedId}", ZedId);
        }
    }
}

/// <summary>The fee rows of SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS for the milestone due.</summary>
public sealed record ConsultancyFees(FeeOption? WithReward, FeeOption? WithoutReward, bool RewardAvailable, string? UdyamPan)
{
    public static async Task<ConsultancyFees> LoadAsync(ISqlExecutor db, string zedId, string level, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS", new { ZedId = zedId, Certification = level }, ct);
        var withReward = sets[0].FirstOrDefault() is { } a ? new FeeOption(a) : null;
        var withoutReward = sets[1].FirstOrDefault() is { } b ? new FeeOption(b) : null;
        // The procedure's two rows are the same (Coupon IS NULL): there is no handholding reward row. The old
        // page still offered "APPLY REWARD", which changed nothing in the amount but used up the reward
        // (IsCouponUsed). Offer it only when the reward row really carries a reward.
        var rewardAvailable = sets[2].FirstOrDefault()?.Text("IsCouponUsed") is "0" or "" && withReward is not null && withReward.Amount("Coupon") > 0;
        var pan = (withReward ?? withoutReward)?.Row.Text("UdyamPanNo");
        return new(withReward, withoutReward, rewardAvailable, string.IsNullOrEmpty(pan) ? null : pan.ToUpperInvariant());
    }

    /// <summary>A StateAssessmentFee row (Andhra Pradesh state subsidy): it has a StateSubsidyLabel.</summary>
    public static bool IsStateRow(FeeOption fee) => fee.Row.Text("StateSubsidyLabel").Length > 0;
}

/// <summary>A unit's payment choices with the fee row chosen on the server.</summary>
public sealed record ConsultancyChoices(
    string ZedId, string Level, FeeOption Fee, bool UseReward, bool GstinApplicable, string? Gstin, bool TdsDeductible, string? Tds, string? Tan)
{
    /// <summary>Arguments of the consultancy payment procedures, in the web page's convention.</summary>
    public object Args(string? orderId) => orderId is null
        ? new
        {
            ZedId, Certification = Level, UseCoupon = UseReward ? "Yes" : "No", UnitGstin = GstinApplicable ? "Yes" : "No", Gstin,
            TdsDeductible = TdsDeductible ? "Yes" : "No", Tds, Tan, PaymentRefId = Fee.Id,
        }
        : new
        {
            ZedId, Certification = Level, UseCoupon = UseReward ? "Yes" : "No", UnitGstin = GstinApplicable ? "Yes" : "No", Gstin,
            TdsDeductible = TdsDeductible ? "Yes" : "No", Tds, Tan, PaymentRefId = Fee.Id, TransactionId = orderId,
        };
}

/// <summary>The zero-amount handholding payment, shared by the web checkout and the app.</summary>
public static class ConsultancyZeroPayment
{
    /// <returns>Null when recorded; otherwise the message for the user.</returns>
    public static async Task<string?> RecordAsync(ISqlExecutor db, ConsultancyChoices c, int milestone, ILogger log, CancellationToken ct)
    {
        try
        {
            await db.ExecuteProcAsync("SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS", c.Args(orderId: null), ct);
        }
        catch (DbException ex)
        {
            log.LogWarning(ex, "SP_CONSULTANCY_MSME_ZERO_PAYMENT_DETAILS refused {ZedId}/{Level}", c.ZedId, c.Level);
            return "Payment is already done for this milestone.";
        }

        // The procedure raises no error and only opens the milestone when it finds the payment row it
        // inserted; confirm the milestone was started before reporting a payment.
        var after = await ConsultancyPaymentController.StatusRowAsync(db, c.ZedId, ct);
        if (HandholdingEligibility.Int(after, c.Level + "StatusOfNc") < milestone)
        {
            log.LogError("Zero handholding payment for {ZedId}/{Level} milestone {Milestone} was not recorded by the procedure", c.ZedId, c.Level, milestone);
            return "The payment could not be recorded. Please contact zed.support@qcin.org.";
        }
        log.LogInformation("Zero handholding payment recorded for {ZedId}/{Level} milestone {Milestone}", c.ZedId, c.Level, milestone);
        return null;
    }
}
