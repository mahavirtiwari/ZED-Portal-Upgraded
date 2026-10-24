using System.Data.Common;
using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Microsoft.Extensions.Caching.Distributed;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Payments;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.Payments;

/// <summary>
/// Paying for a Bronze/Silver/Gold certification from the dashboard. Port of the payment step of
/// Views/Msme/Dashboard.cshtml with MsmeController.UpdateUdyamDetails / GetPaymentDetails /
/// ValidateGstinProtean / UpdatePan and PayController.Complete / SubmitZeroPaymentDetails.
/// <para>
/// Unlike the MVC code, the browser only sends choices (reward, GSTIN, TDS). The fee row, the amount,
/// whether it is a zero-amount payment, the enterprise type and the old PAN are all decided here.
/// The MVC actions accepted the fee row id, the enterprise type and even the ZED ID from the browser,
/// so a certification could be marked paid without paying (see docs/SECURITY-FINDINGS.md).
/// </para>
/// </summary>
[Route("api/msme/payments")]
public sealed class MsmePaymentController(
    ISqlExecutor db,
    IUdyamClient udyam,
    IGstinVerifier gstinVerifier,
    IDistributedCache cache,
    PaymentCompletion completion,
    IOptions<CcAvenueOptions> ccavenue,
    IOptions<PortalOptions> portal,
    ILogger<MsmePaymentController> log) : MsmeApiController
{
    public const string ResponsePath = "/api/payments/ccavenue/response";

    // ----- options -----

    public sealed record OptionsResponse(
        string Certification,
        Dictionary<string, object?>? WithReward,
        Dictionary<string, object?> WithoutReward,
        bool RewardAvailable,
        string? UdyamPan);

    private static readonly string[] FeeFields =
    [
        "Total", "Coupon", "TotalAfterCoupon", "SubsidyLabel", "Subsidy", "StateSubsidyLabel", "StateContributionAfterSubsidy",
        "ApplicantContributionAfterSubsidy", "SubsidyAmount", "GstAfterSubsidy", "Tds15", "Tds75", "NetPaybleTds15", "NetPaybleTds75",
        "IsEligibleStateSubsidy",
    ];

    /// <summary>
    /// Fee summary for the payment step. First refreshes the enterprise type from the Udyam service
    /// (the fee depends on it), as the old page did before showing the summary.
    /// </summary>
    [HttpGet("{certification}/options")]
    public async Task<ActionResult<OptionsResponse>> Options(string certification, CancellationToken ct)
    {
        if (Certifications.Canonical(certification) is not { } cert) return this.Problem400("Invalid certification.");
        await RefreshEnterpriseType(ct);

        var (withReward, withoutReward, rewardAvailable, udyamPan) = await LoadOptions(cert, ct);
        if (withoutReward is null) return this.Problem400("Fee details are not available for this certification.");
        return new OptionsResponse(cert, withReward is null ? null : Pick(withReward), Pick(withoutReward), rewardAvailable && withReward is not null, udyamPan);
    }

    // ----- GSTIN and PAN -----

    public sealed record GstinRequest(string Certification, string Gstin);

    public sealed record GstinResponse(string Message, bool PanMatches, string GstinPan, string? UdyamPan);

    /// <summary>Verifies the unit's GSTIN with Protean; the answer is remembered for 30 minutes for checkout.</summary>
    [HttpPost("gstin")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    [MsmeEditAudit("Certification payment: GSTIN entered")]
    public async Task<ActionResult<GstinResponse>> VerifyGstin(GstinRequest req, CancellationToken ct)
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
        return new GstinResponse(result.Message, string.Equals(udyamPan, gstinPan, StringComparison.OrdinalIgnoreCase), gstinPan, udyamPan);
    }

    public sealed record PanRequest(string Certification, string Gstin, string Pan);

    /// <summary>
    /// "PAN Mismatch Detected": replaces the Udyam PAN with the PAN of a verified GSTIN (SP_MESE_UPDATE_PAN).
    /// The old page only compared them in the browser; here the GSTIN must have been verified first.
    /// </summary>
    [HttpPost("pan")]
    [MsmeEditAudit("Certification payment: PAN corrected")]
    public async Task<ActionResult<MessageResponse>> CorrectPan(PanRequest req, CancellationToken ct)
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

    public sealed record CheckoutRequest(bool UseReward, bool GstinApplicable, string? Gstin, bool TdsDeductible, string? Tds, string? Tan);

    /// <summary>"paid" (nothing to pay; recorded) or "gateway" (post encRequest + access_code to GatewayUrl).</summary>
    public sealed record CheckoutResponse(string Status, string? GatewayUrl = null, string? EncRequest = null, string? AccessCode = null);

    [HttpPost("{certification}/checkout")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    [MsmeEditAudit("Certification payment: payment started")]
    public async Task<ActionResult<CheckoutResponse>> Checkout(string certification, CheckoutRequest req, CancellationToken ct)
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

        // Fee row and amount, from the database only
        var (withReward, withoutReward, rewardAvailable, udyamPan) = await LoadOptions(cert, ct);
        if (req.UseReward && (!rewardAvailable || withReward is null)) return this.Problem400("The joining reward is not available.");
        var fee = req.UseReward ? withReward : withoutReward;
        if (fee is null) return this.Problem400("Fee details are not available for this certification.");
        if (gstin is not null && !string.Equals(udyamPan, Certifications.PanOf(gstin), StringComparison.OrdinalIgnoreCase))
            return this.Problem400("PAN registered in your Udyam portal is not matching with given GSTIN Number.");

        var args = new
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
                await db.ExecuteProcAsync("SP_MSME_ZERO_PAYMENT_DETAILS", args, ct);
            }
            catch (DbException ex)
            {
                // The procedure raises an error when the level is already paid.
                log.LogWarning(ex, "SP_MSME_ZERO_PAYMENT_DETAILS refused {ZedId}/{Certification}", ZedId, cert);
                return this.Problem400("Payment is already done for this certification.");
            }
            await completion.CompleteAsync(ZedId, cert, postToErp: false, ct);
            return new CheckoutResponse("paid");
        }

        var expected = fee.Payable(tds);
        var row = (await db.QueryProcMultipleAsync("SP_MSME_PAYMENT_BASIC_DETAILS", args, ct))[0].FirstOrDefault();
        if (row is null) return this.Problem400("Payment is already done for this certification.");

        var amountText = row.Text("AmountToBePaid");
        if (!decimal.TryParse(amountText, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) || amount != expected)
        {
            // e.g. the hard-coded ₹1 "test the payment gateway" list in the procedure.
            log.LogError("Amount mismatch for {ZedId}/{Certification}: procedure {Amount}, fee row {Expected}", ZedId, cert, amountText, expected);
            return this.Problem400("The payment amount could not be confirmed. Please contact zed.support@qcin.org.");
        }

        var o = ccavenue.Value;
        var orderId = row.Text("TransactionId");
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

        log.LogInformation("CCAvenue order {OrderId} for {ZedId}/{Certification}, amount {Amount}", orderId, ZedId, cert, amountText);
        return new CheckoutResponse("gateway", o.GatewayUrl, CcAvenueCrypto.Encrypt(plain, o.WorkingKey), o.AccessCode);
    }

    // ----- helpers -----

    private string GstinKey(string gstin) => $"gstin-ok:{ZedId}:{gstin}";

    private async Task<(FeeOption? WithReward, FeeOption? WithoutReward, bool RewardAvailable, string? UdyamPan)> LoadOptions(string cert, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_PAYMENT_DETAILS", new { ZedId, Certification = cert }, ct);
        var withReward = sets[0].FirstOrDefault() is { } a ? new FeeOption(a) : null;
        var withoutReward = sets[1].FirstOrDefault() is { } b ? new FeeOption(b) : null;
        var rewardAvailable = sets[2].FirstOrDefault()?.Text("IsCouponUsed") is "0" or "";
        var pan = (withReward ?? withoutReward)?.Row.Text("UdyamPanNo");
        return (withReward, withoutReward, rewardAvailable, string.IsNullOrEmpty(pan) ? null : pan.ToUpperInvariant());
    }

    private static Dictionary<string, object?> Pick(FeeOption fee) =>
        FeeFields.ToDictionary(f => f, f => fee.Row.TryGetValue(f, out var v) && v is not DBNull ? v : null);

    /// <summary>
    /// MsmeController.UpdateUdyamDetails as the dashboard used it: when the Udyam service reports a
    /// different enterprise type, record it (SP_MSME_UPDATE_UDYAM_DETAILS). The type now comes from the
    /// service, not from the browser. Failures are ignored, as before: the payment step still opens.
    /// </summary>
    private async Task RefreshEnterpriseType(CancellationToken ct)
    {
        try
        {
            var sets = await db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId, CertificationType = (string?)null }, ct);
            var basic = sets[1].FirstOrDefault();
            var udyamNo = basic?.Text("UdyogAadharNo");
            var mobile = basic?.Text("MobileNo");
            if (string.IsNullOrEmpty(udyamNo) || string.IsNullOrEmpty(mobile)) return;

            var lookup = await udyam.GetUdyamAsync(udyamNo, mobile, ct);
            var current = lookup.BasicDetails.GetValueOrDefault("EnterpriseType");
            if (!string.IsNullOrEmpty(current) && !string.Equals(current, basic!.Text("EnterpriseTypee"), StringComparison.OrdinalIgnoreCase))
                await db.ExecuteProcAsync("SP_MSME_UPDATE_UDYAM_DETAILS", new
                {
                    UdyamNumber = udyamNo, EnterpriseType = current, PaymentModule = "ZED LIVE", ModifiedDataType = "EnterpriseType", ZedId,
                }, ct);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogWarning(ex, "Enterprise type refresh skipped for {ZedId}", ZedId);
        }
    }
}
