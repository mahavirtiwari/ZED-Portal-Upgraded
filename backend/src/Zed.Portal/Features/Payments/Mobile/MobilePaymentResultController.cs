using System.Net;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Core.Payments;

namespace Zed.Portal.Features.Payments.Mobile;

/// <summary>
/// redirect_url and cancel_url of the app's CCAvenue payments (PayController and
/// SurveillancePayController successtransmobile / failuretransmobile). The response is encrypted with
/// the mobile working key and goes through the same verified handling as the web callbacks
/// (<see cref="CcAvenueResponseProcessor"/>: known order, same unit, level and amount, repeats ignored).
/// <para>
/// The answer is the old successmobile / failuremobile page. The CCAvenue SDK in the app reads the
/// result from the page's table (<c>&lt;td&gt;tracking_id&lt;/td&gt;&lt;td&gt;…&lt;/td&gt;</c> and
/// <c>&lt;td&gt;order_status&lt;/td&gt;&lt;td&gt;…&lt;/td&gt;</c>), so that markup is kept exactly. A response
/// the server refuses (undecryptable, unknown order, other unit, different amount) shows order_status
/// "Failure", whatever the response claimed; the old pages echoed CCAvenue's status even when nothing was
/// recorded.
/// </para>
/// </summary>
[AllowAnonymous]
[IgnoreAntiforgeryToken]
[ApiExplorerSettings(GroupName = "mobile-legacy")]
public sealed class MobilePaymentResultController(
    ISqlExecutor db,
    PaymentCompletion completion,
    SurveillancePaymentCompletion surveillance,
    IOptions<CcAvenueOptions> options,
    ILogger<MobilePaymentResultController> log) : ControllerBase
{
    [HttpPost("/Pay/successtransmobile")]
    [HttpPost("/Pay/failuretransmobile")]
    public async Task<ContentResult> CertificationResult(CancellationToken ct) =>
        Page(await ProcessAsync(CcAvenueGatewayModule.Certification(completion), ct));

    [HttpPost("/SurveillancePay/successtransmobile")]
    [HttpPost("/SurveillancePay/failuretransmobile")]
    public async Task<ContentResult> SurveillanceResult(CancellationToken ct) =>
        Page(await ProcessAsync(CcAvenueGatewayModule.Surveillance(surveillance), ct));

    /// <summary>
    /// ConsultancyPayController successtransmobile / failuretransmobile (handholding milestones), with the
    /// milestone check of <see cref="Consultancy.ConsultancyGateway"/>. The old failuretransmobile recorded
    /// the response with SP_SA_PAYMENT_UPDATE_RESPONSE (the main database's certification orders), so
    /// failures never reached the consultancy order; the old success page sent no agency mail and posted nothing to the ERP.
    /// </summary>
    [HttpPost("/ConsultancyPay/successtransmobile")]
    [HttpPost("/ConsultancyPay/failuretransmobile")]
    public async Task<ContentResult> ConsultancyResult(CancellationToken ct) =>
        Page(await ProcessAsync(Consultancy.ConsultancyGateway.Module(Consultancy.ConsultancyPaymentCompletion.Create(HttpContext.RequestServices), db), ct));

    private async Task<CcAvenueOutcome> ProcessAsync(CcAvenueGatewayModule module, CancellationToken ct)
    {
        string? encResp = null;
        if (Request.HasFormContentType) encResp = (await Request.ReadFormAsync(ct))["encResp"].FirstOrDefault();
        var outcome = await new CcAvenueResponseProcessor(db, log)
            .ProcessAsync(encResp, options.Value.MobileWorkingKey, module, HttpContext.Connection.RemoteIpAddress?.ToString(), ct);
        log.LogInformation("Mobile CCAvenue response {Path}: order {OrderId}, {ZedId}/{Certification}, {Outcome}", Request.Path,
            outcome.Fields.GetValueOrDefault("order_id"), outcome.Fields.GetValueOrDefault("merchant_param1"), outcome.Certification, outcome.Result);
        return outcome;
    }

    private static ContentResult Page(CcAvenueOutcome outcome)
    {
        var paid = outcome.Result is CcAvenueResult.Paid or CcAvenueResult.AlreadyPaid;
        var trackingId = outcome.Fields.GetValueOrDefault("tracking_id") ?? "";
        var reported = outcome.Fields.GetValueOrDefault("order_status");
        var orderStatus = paid
            ? "Success"
            : outcome.Result == CcAvenueResult.Failed && reported is { Length: > 0 } && !string.Equals(reported, "Success", StringComparison.OrdinalIgnoreCase)
                ? reported
                : "Failure";
        return new ContentResult
        {
            Content = paid ? SuccessPage(trackingId, orderStatus) : FailurePage(trackingId, orderStatus, outcome.Message),
            ContentType = "text/html; charset=utf-8",
            StatusCode = StatusCodes.Status200OK,
        };
    }

    private static string E(string? s) => WebUtility.HtmlEncode(s ?? "");

    // Views/Pay/successmobile.cshtml (the same as Views/SurveillancePay/successmobile.cshtml) without the
    // site layout and images.
    private static string SuccessPage(string trackingId, string orderStatus) => $$"""
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>Payment Success - ZED Certification</title>
        {{Style}}
        </head>
        <body>
        <div class="container">
            <div class="row">
                <div class="col-sm-offset-3 col-sm-18 Dashboard zed-payment-success">
                    <div class="jumbotron text-center">
                        <h2>Registration Successful!</h2>
        				<table>
        					<tr>
        						<td>tracking_id</td>
        						<td>{{E(trackingId)}}</td>
        					</tr>
        					<tr>
        						<td>order_status</td>
        						<td>{{E(orderStatus)}}</td>
        					</tr>
        				</table>
                        <p>Your payment towards ZED Certification has been successful.</p>
                        <p>Please download the ZED MSME Mobile Application to proceed to the next step, i.e. Basic Information and Document Upload</p>
                    </div>
                </div>
            </div>
        </div>
        </body>
        </html>
        """;

    // Views/Pay/failuremobile.cshtml (the same as Views/SurveillancePay/failuremobile.cshtml).
    private static string FailurePage(string trackingId, string orderStatus, string? message) => $$"""
        <!DOCTYPE html>
        <html>
        <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
        <title>failure</title>
        {{Style}}
        </head>
        <body>
            <div class="container">
                <div class="row">
                    <div class="col-sm-offset-3 col-sm-18 Dashboard zed-payment-success">
                        <div class="jumbotron text-center">
                            <h2>Payment Failed</h2>
                            <p>There seems to be a problem with the payment, please try again and if this issue repeats, contact us at zed@qcin.org</p>
                            <p><b>Error Message </b>: <span>{{E(message)}}</span></p>
                        </div>
        				<table>
        					<tr>
        						<td>tracking_id</td>
        						<td>{{E(trackingId)}}</td>
        					</tr>
        					<tr>
        						<td>order_status</td>
        						<td>{{E(orderStatus)}}</td>
        					</tr>
        				</table>
                    </div>
                </div>
            </div>
        </body>
        </html>
        """;

    private const string Style = """
        <style>
            body { font-family: Arial, Helvetica, sans-serif; margin: 0; padding: 24px 16px; color: #222; background: #fff; }
            .jumbotron { text-align: center; }
            h2 { font-size: 22px; }
            table { margin: 16px auto; border-collapse: collapse; }
            td { padding: 4px 12px; border: 1px solid #ddd; }
        </style>
        """;
}
