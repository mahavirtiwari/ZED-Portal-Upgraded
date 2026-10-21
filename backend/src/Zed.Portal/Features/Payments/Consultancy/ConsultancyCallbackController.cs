using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Payments;

namespace Zed.Portal.Features.Payments.Consultancy;

/// <summary>
/// redirect_url and cancel_url of the handholding checkout (ConsultancyPayController.successtrans /
/// failuretrans). Same verified handling as the certification and surveillance callbacks
/// (<see cref="CcAvenueResponseProcessor"/>, web working key), plus the milestone check of
/// <see cref="ConsultancyGateway"/>; then the browser goes to the Angular result page.
/// <para>
/// The old successtrans appended the raw response to App_Data\Json\CCAVENUE, recorded whatever the
/// decrypted response said (no order, unit or amount check) and showed <c>ex.Message</c> with the
/// decrypted response on errors; failuretrans did the same without the file.
/// </para>
/// </summary>
[ApiController]
[AllowAnonymous]
[IgnoreAntiforgeryToken]
public sealed class ConsultancyCallbackController(
    ISqlExecutor db,
    IOptions<CcAvenueOptions> options,
    ILogger<ConsultancyCallbackController> log) : ControllerBase
{
    public const string ResultPage = "/msme/payment/consultancy-result";

    [HttpPost(ConsultancyPaymentController.ResponsePath)]
    [Consumes("application/x-www-form-urlencoded")]
    public async Task<IActionResult> GatewayResponse([FromForm(Name = "encResp")] string? encResp, CancellationToken ct)
    {
        var module = ConsultancyGateway.Module(ConsultancyPaymentCompletion.Create(HttpContext.RequestServices), db);
        var outcome = await new CcAvenueResponseProcessor(db, log)
            .ProcessAsync(encResp, options.Value.WorkingKey, module, HttpContext.Connection.RemoteIpAddress?.ToString(), ct);

        var paid = outcome.Result is CcAvenueResult.Paid or CcAvenueResult.AlreadyPaid;
        var query = $"?status={(paid ? "success" : "failure")}&certification={Uri.EscapeDataString(outcome.Certification ?? "")}";
        if (outcome.Result != CcAvenueResult.Invalid && Milestone(outcome.Fields.GetValueOrDefault("merchant_param3")) is { } milestone)
            query += "&milestone=" + milestone;
        var message = outcome.Result == CcAvenueResult.Failed && outcome.Fields.GetValueOrDefault("order_status") is "Success"
            ? "The payment could not be matched to the milestone due. Please contact zed.support@qcin.org."
            : outcome.Message;
        if (!paid && !string.IsNullOrEmpty(message)) query += "&message=" + Uri.EscapeDataString(message.Length > 300 ? message[..300] : message);

        // 303 See Other: the browser follows the gateway's POST with a GET of the result page.
        Response.Headers.Location = ResultPage + query;
        return StatusCode(StatusCodes.Status303SeeOther);
    }

    /// <summary>"Milestone 2" → 2 (merchant_param3 of the checkout).</summary>
    private static int? Milestone(string? param3) =>
        param3?.Trim() is { } p && p.StartsWith("Milestone ", StringComparison.OrdinalIgnoreCase) &&
        int.TryParse(p["Milestone ".Length..], out var n) && n is >= 1 and <= 3 ? n : null;
}
