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

namespace Zed.Portal.Features.Payments;

/// <summary>
/// Paying for the surveillance assessment of a Bronze/Silver/Gold certificate. Port of
/// Frontend/SurveillancePay/Index.cshtml with SurveillancePayController.Index /
/// GetSurveillancePaymentDetails / Complete / SubmitZeroPaymentDetails (and the GSTIN, PAN and Udyam
/// calls that page made to MsmeController). Same model as <see cref="MsmePaymentController"/>.
/// <para>
/// The browser only sends choices (reward, GSTIN, TDS). The fee row, the amount, the order id, the
/// zero-amount decision and the ZED ID are decided here. The MVC actions took the fee row id
/// (PaymentRefId) from the browser, checked eligibility only when the page was opened, and the
/// zero-payment action took the ZED ID from the body when there was no session.
/// </para>
/// <para>
/// Eligibility (checked on every call): the dashboard condition <c>{Level}DashboardSurStatus = 1</c>
/// of SP_MSME_GET_DETAILS (certificate issued, EnableSurveillance1 = 1 or 2, not expired/withdrawn)
/// and the old page's gate SP_SURVEILLANCE_MSME_GET_PAYMENT_STATUS = 1 (certified level whose
/// surveillance fee — Msme.IsSur{Level}PaymentDone — is not paid yet).
/// </para>
/// </summary>
[Route("api/msme/surveillance-payments")]
public sealed class SurveillancePaymentController(
    ISqlExecutor db,
    IUdyamClient udyam,
    IGstinVerifier gstinVerifier,
    IDistributedCache cache,
    SurveillancePaymentCompletion completion,
    IOptions<CcAvenueOptions> ccavenue,
    IOptions<PortalOptions> portal,
    ILogger<SurveillancePaymentController> log) : MsmeApiController
{
    public const string ResponsePath = "/api/payments/ccavenue/surveillance-response";
    private const string NotEligible = "Surveillance payment is not available for this certification.";

    // ----- status -----

    public sealed record StatusResponse(string Certification, bool Eligible);

    /// <summary>SurveillancePay/Index: the page is only for a level whose surveillance can be paid now.</summary>
    [HttpGet("{certification}/status")]
    public async Task<ActionResult<StatusResponse>> Status(string certification, CancellationToken ct)
    {
        if (Certifications.Canonical(certification) is not { } cert) return this.Problem400("Invalid certification.");
        var details = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId, CertificationType = (string?)null }, ct);
        return new StatusResponse(cert, await EligibleAsync(details, cert, ct));
    }

    // ----- options -----

    /// <summary>Values the unit gave when it paid for the certification; the old page filled the form with them.</summary>
    public sealed record Prefill(string? UnitGstin, string? Gstin, string? TdsDeductible, string? Tds, string? Tan);

    public sealed record OptionsResponse(
        string Certification,
        Dictionary<string, object?>? WithReward,
        Dictionary<string, object?> WithoutReward,
        bool RewardAvailable,
        string? UdyamPan,
        Prefill Prefill);

    private static readonly string[] FeeFields =
    [
        "Total", "Coupon", "TotalAfterCoupon", "SubsidyLabel", "Subsidy", "ApplicantContributionAfterSubsidy", "SubsidyAmount",
        "GstAfterSubsidy", "Tds15", "Tds75", "NetPaybleTds15", "NetPaybleTds75",
    ];

    /// <summary>
    /// Fee summary. First refreshes the enterprise type from the Udyam service (the fee depends on it),
    /// as the old page did after the instructions step (PaymentModule "SURVEILLANCE").
    /// </summary>
    [HttpGet("{certification}/options")]
    public async Task<ActionResult<OptionsResponse>> Options(string certification, CancellationToken ct)
    {
        if (Certifications.Canonical(certification) is not { } cert) return this.Problem400("Invalid certification.");
        var details = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId, CertificationType = (string?)null }, ct);
        if (!await EligibleAsync(details, cert, ct)) return this.Problem400(NotEligible);
        await RefreshEnterpriseType(details, ct);

        var fees = await LoadOptions(cert, ct);
        if (fees.WithoutReward is null) return this.Problem400("Fee details are not available for this certification.");
        var r = fees.WithoutReward.Row;
        string? P(string c) => r.Text(c) is { Length: > 0 } v ? v : null;
        var prefill = new Prefill(
            P("CertUnitGstin") is "Yes" or "No" ? P("CertUnitGstin") : null,
            P("CertGstNo")?.ToUpperInvariant(),
            P("CertTdsDeductable") is "Yes" or "No" ? P("CertTdsDeductable") : null,
            P("CertTds") is "1.5" or "7.5" ? P("CertTds") : null,
            P("CertTanNo")?.ToUpperInvariant());
        return new OptionsResponse(cert, fees.WithReward is null ? null : Pick(fees.WithReward), Pick(fees.WithoutReward),
            fees.RewardAvailable && fees.WithReward is not null, fees.UdyamPan, prefill);
    }

    // ----- GSTIN and PAN -----

    /// <summary>Verifies the unit's GSTIN with Protean (as Msme/ValidateGstinProtean); remembered for 30 minutes for checkout.</summary>
    [HttpPost("gstin")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MsmePaymentController.GstinResponse>> VerifyGstin(MsmePaymentController.GstinRequest req, CancellationToken ct)
    {
        if (Certifications.Canonical(req.Certification) is not { } cert) return this.Problem400("Invalid certification.");
        var gstin = (req.Gstin ?? "").Trim().ToUpperInvariant();
        if (!Certifications.Gstin().IsMatch(gstin)) return this.Problem400("Please enter valid GSTIN.");

        GstinResult result;
        try { result = await gstinVerifier.VerifyAsync(ZedId, cert, gstin, ct); }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or InvalidOperationException)
        {
            log.LogWarning(ex, "GSTIN verification unavailable");
            return Problem(title: "Unexpected error occurred. Please try after some time.", statusCode: StatusCodes.Status502BadGateway);
        }
        if (!result.Valid) return this.Problem400(result.Message);

        await cache.SetStringAsync(GstinKey(gstin), "1", new DistributedCacheEntryOptions { AbsoluteExpirationRelativeToNow = TimeSpan.FromMinutes(30) }, ct);
        var udyamPan = (await LoadOptions(cert, ct)).UdyamPan;
        var gstinPan = Certifications.PanOf(gstin);
        return new MsmePaymentController.GstinResponse(result.Message, string.Equals(udyamPan, gstinPan, StringComparison.OrdinalIgnoreCase), gstinPan, udyamPan);
    }

    /// <summary>
    /// "PAN Mismatch Detected" (Msme/UpdatePan, SP_MESE_UPDATE_PAN, which updates all three databases).
    /// The old page sent the ZED ID and the old PAN from the browser; here both come from the server
    /// and the GSTIN must have been verified first.
    /// </summary>
    [HttpPost("pan")]
    public async Task<ActionResult<MessageResponse>> CorrectPan(MsmePaymentController.PanRequest req, CancellationToken ct)
    {
        if (Certifications.Canonical(req.Certification) is not { } cert) return this.Problem400("Invalid certification.");
        var gstin = (req.Gstin ?? "").Trim().ToUpperInvariant();
        var pan = (req.Pan ?? "").Trim().ToUpperInvariant();
        if (!Certifications.Pan().IsMatch(pan)) return this.Problem400("Please enter a valid 10-character PAN.");
        if (!Certifications.Gstin().IsMatch(gstin) || await cache.GetStringAsync(GstinKey(gstin), ct) is null)
            return this.Problem400("Please verify the GSTIN first.");
        if (pan != Certifications.PanOf(gstin)) return this.Problem400("Please enter the correct PAN associated with that GSTIN.");

        var oldPan = (await LoadOptions(cert, ct)).UdyamPan;
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

    [HttpPost("{certification}/checkout")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<MsmePaymentController.CheckoutResponse>> Checkout(
        string certification, MsmePaymentController.CheckoutRequest req, CancellationToken ct)
    {
        if (Certifications.Canonical(certification) is not { } cert) return this.Problem400("Invalid certification.");

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

        // Eligibility, fee row and amount: from the database only
        var details = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId, CertificationType = (string?)null }, ct);
        if (!await EligibleAsync(details, cert, ct)) return this.Problem400(NotEligible);

        var (withReward, withoutReward, rewardAvailable, udyamPan) = await LoadOptions(cert, ct);
        if (req.UseReward && (!rewardAvailable || withReward is null)) return this.Problem400("The joining reward is not available.");
        var fee = req.UseReward ? withReward : withoutReward;
        if (fee is null) return this.Problem400("Fee details are not available for this certification.");
        if (gstin is not null && !string.Equals(udyamPan, Certifications.PanOf(gstin), StringComparison.OrdinalIgnoreCase))
            return this.Problem400("PAN registered in your Udyam portal is not matching with given GSTIN Number.");

        var choices = new
        {
            ZedId,
            Certification = cert,
            UseCoupon = req.UseReward ? "Yes" : "No",
            UnitGstin = req.GstinApplicable ? "Yes" : "No",
            Gstin = gstin,
            TdsDeductible = req.TdsDeductible ? "Yes" : "No",
            Tds = tds,
            Tan = tan,
            PaymentRefId = fee.Id,
        };

        // Nothing to pay after subsidy/reward (the old page's condition).
        if (fee.Amount("ApplicantContributionAfterSubsidy") <= 0)
        {
            try
            {
                await db.ExecuteProcAsync("SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS", choices, ct);
            }
            catch (DbException ex)
            {
                log.LogWarning(ex, "SP_SURVEILLANCE_MSME_ZERO_PAYMENT_DETAILS refused {ZedId}/{Certification}", ZedId, cert);
                return this.Problem400("Payment is already done for this certification.");
            }
            // The procedure raises no error when it skips: it only records anything while
            // ZED_SURVEILLANCE.Msme.IsBronzePaymentDone is not set, whatever the level. Confirm it was recorded.
            if (await PaymentOpenAsync(cert, ct))
            {
                log.LogError("Zero surveillance payment for {ZedId}/{Certification} was not recorded by the procedure", ZedId, cert);
                return this.Problem400("The payment could not be recorded. Please contact zed.support@qcin.org.");
            }
            await completion.CompleteAsync(ZedId, cert, postToErp: false, ct);
            return new MsmePaymentController.CheckoutResponse("paid");
        }

        var expected = fee.Payable(tds);
        // The procedure needs the order id from the caller (SurveillancePayController.Complete used a GUID).
        var orderId = Guid.NewGuid().ToString();
        var args = new
        {
            choices.ZedId, choices.Certification, choices.UseCoupon, choices.UnitGstin, choices.Gstin, choices.TdsDeductible,
            choices.Tds, choices.Tan, choices.PaymentRefId, TransactionId = orderId,
        };
        var row = (await db.QueryProcMultipleAsync("SP_SURVEILLANCE_MSME_PAYMENT_BASIC_DETAILS", args, ct))[0].FirstOrDefault();
        if (row is null) return this.Problem400("Payment is already done for this certification.");

        var amountText = row.Text("AmountToBePaid");
        if (!decimal.TryParse(amountText, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) || amount != expected)
        {
            // e.g. the hard-coded ₹1 "test the payment gateway" list in ZED_SURVEILLANCE SP_MSME_PAYMENT_BASIC_DETAILS.
            log.LogError("Surveillance amount mismatch for {ZedId}/{Certification}: procedure {Amount}, fee row {Expected}", ZedId, cert, amountText, expected);
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
            new("merchant_param1", ZedId), new("merchant_param2", cert), new("merchant_param3", R("MerchantParam3")),
        ]);

        log.LogInformation("CCAvenue surveillance order {OrderId} for {ZedId}/{Certification}, amount {Amount}", orderId, ZedId, cert, amountText);
        return new MsmePaymentController.CheckoutResponse("gateway", o.GatewayUrl, CcAvenueCrypto.Encrypt(plain, o.WorkingKey), o.AccessCode);
    }

    // ----- helpers -----

    private string GstinKey(string gstin) => $"surveillance-gstin-ok:{ZedId}:{gstin}";

    private async Task<bool> EligibleAsync(ResultSets zedDetails, string cert, CancellationToken ct) =>
        zedDetails[0].FirstOrDefault()?.Text(cert + "DashboardSurStatus") == "1" && await PaymentOpenAsync(cert, ct);

    /// <summary>SP_SURVEILLANCE_MSME_GET_PAYMENT_STATUS: 1 while the level is certified and its surveillance fee is unpaid.</summary>
    private async Task<bool> PaymentOpenAsync(string cert, CancellationToken ct) =>
        (await db.QueryProcMultipleAsync("SP_SURVEILLANCE_MSME_GET_PAYMENT_STATUS", new { ZedId, Certification = cert }, ct))[0]
            .FirstOrDefault()?.Text("PaymentStatus") == "1";

    private async Task<(FeeOption? WithReward, FeeOption? WithoutReward, bool RewardAvailable, string? UdyamPan)> LoadOptions(string cert, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_SURVEILLANCE_MSME_GET_PAYMENT_DETAILS", new { ZedId, Certification = cert }, ct);
        var withReward = sets[0].FirstOrDefault() is { } a ? new FeeOption(a) : null;
        var withoutReward = sets[1].FirstOrDefault() is { } b ? new FeeOption(b) : null;
        var rewardAvailable = sets[2].FirstOrDefault()?.Text("IsCouponUsed") is "0" or "";
        var pan = (withReward ?? withoutReward)?.Row.Text("UdyamPanNo");
        return (withReward, withoutReward, rewardAvailable, string.IsNullOrEmpty(pan) ? null : pan.ToUpperInvariant());
    }

    private static Dictionary<string, object?> Pick(FeeOption fee) =>
        FeeFields.ToDictionary(f => f, f => fee.Row.TryGetValue(f, out var v) && v is not DBNull ? v : null);

    /// <summary>
    /// Msme/GetUdyam + Msme/UpdateUdyamDetails as the surveillance page used them: when the Udyam service
    /// reports a different enterprise type, record it (SP_MSME_UPDATE_UDYAM_DETAILS, PaymentModule
    /// "SURVEILLANCE"; it updates all three databases). Failures are ignored, as before.
    /// </summary>
    private async Task RefreshEnterpriseType(ResultSets zedDetails, CancellationToken ct)
    {
        try
        {
            var basic = zedDetails[1].FirstOrDefault();
            var udyamNo = basic?.Text("UdyogAadharNo");
            var mobile = basic?.Text("MobileNo");
            if (string.IsNullOrEmpty(udyamNo) || string.IsNullOrEmpty(mobile)) return;

            var lookup = await udyam.GetUdyamAsync(udyamNo, mobile, ct);
            var current = lookup.BasicDetails.GetValueOrDefault("EnterpriseType");
            if (!string.IsNullOrEmpty(current) && !string.Equals(current, basic!.Text("EnterpriseTypee"), StringComparison.OrdinalIgnoreCase))
                await db.ExecuteProcAsync("SP_MSME_UPDATE_UDYAM_DETAILS", new
                {
                    UdyamNumber = udyamNo, EnterpriseType = current, PaymentModule = "SURVEILLANCE", ModifiedDataType = "EnterpriseType", ZedId,
                }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Enterprise type refresh skipped for {ZedId}", ZedId);
        }
    }
}
