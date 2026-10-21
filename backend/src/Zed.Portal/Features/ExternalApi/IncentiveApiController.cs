using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;

namespace Zed.Portal.Features.ExternalApi;

/// <summary>
/// Msme/SubmitIncentive and Msme/SubmitIncentiveV2: incentives disbursed by other schemes (state
/// single-window / incentive portals) to ZED-certified units, stored in ApiIncentives (SubmittedFrom 'API')
/// and listed to staff on the incentive submissions page. The procedures check the token, the unit
/// (Udyam + certificate number) and, for V1, the required fields, and answer {StatusCode, StatusMessage}.
/// <para>
/// Added here: the token is checked first (configured lifetime, client name in the log, never the token);
/// every text field must pass dbo.fn_IsSafeInput's rules and fit its column, also for V2 (whose procedure
/// checked nothing); the amount must be a number (the old code failed with a 500); dates are passed in an
/// unambiguous format.
/// </para>
/// </summary>
[ExternalApiErrors(ExternalApiErrorsAttribute.Plain500)]
public sealed class IncentiveApiController(ISqlExecutor db, ILogger<IncentiveApiController> log) : ExternalApiController
{
    [HttpPost("/Msme/SubmitIncentive")]
    public Task<IActionResult> SubmitIncentive(SubmitIncentiveRequest request, string? token, CancellationToken ct) =>
        Submit("SP_API_SUBMIT_INCENTIVE_DETAILS", request, token, acceptsStaticToken: true, ct);

    [HttpPost("/Msme/SubmitIncentiveV2")]
    public Task<IActionResult> SubmitIncentiveV2(SubmitIncentiveRequest request, string? token, CancellationToken ct) =>
        Submit("SP_API_SUBMIT_INCENTIVE_DETAILS_ALL_OPTIONAL", request, token, acceptsStaticToken: false, ct);

    private async Task<IActionResult> Submit(string procedure, SubmitIncentiveRequest r, string? token, bool acceptsStaticToken, CancellationToken ct)
    {
        var clients = new ApiClients(db, Options);
        // V1's procedure also accepts a static token with ReverseToken = 1; V2 only tokens from GenerateToken.
        var caller = acceptsStaticToken
            ? await clients.DynamicOrStaticAsync(token, StaticTokenScope.ReverseToken, ct)
            : await clients.DynamicAsync(token, ct);
        if (caller is null)
        {
            log.LogWarning("{Procedure} refused from {Ip}: invalid or expired token", procedure, ClientIp);
            return LegacyJson(new ApiServiceResponse4 { StatusCode = "401", StatusMessage = "Unauthorized User" });
        }

        var valid =
            SafeInput.Ok(r.UdyamNo, 50) && SafeInput.Ok(r.Certificateno, 50) && SafeInput.Ok(r.Pin, 50) &&
            SafeInput.Ok(r.ApplicationId, 50) && SafeInput.Ok(r.UnitName, 200) && SafeInput.Ok(r.District, 50) &&
            SafeInput.Ok(r.FCI, 50) && SafeInput.Ok(r.ServiceName, 200) && SafeInput.Ok(r.ApprovalId, 50) &&
            SafeInput.Ok(r.IncentiveName, 2000) && SafeInput.Ok(r.DisbursedAmount, 50) &&
            (string.IsNullOrWhiteSpace(r.DisbursedAmount) ||
             decimal.TryParse(r.DisbursedAmount, NumberStyles.Number, CultureInfo.InvariantCulture, out var amount) && amount >= 0);
        if (!valid)
        {
            log.LogWarning("{Procedure} from {Client}: refused input for {Udyam}", procedure, caller.Client, Shorten(r.UdyamNo));
            return LegacyJson(new ApiServiceResponse4 { StatusCode = "400", StatusMessage = "Bad Request" });
        }

        var row = (await db.QueryProcMultipleAsync(procedure, new
        {
            Token = token,
            r.UdyamNo, r.Certificateno, r.Pin, r.ApplicationId, r.UnitName, r.District, r.FCI, r.ServiceName,
            r.ApprovalId, r.IncentiveName,
            DisbursedAmount = string.IsNullOrWhiteSpace(r.DisbursedAmount) ? null : r.DisbursedAmount.Trim(),
            DisbursedDate = Date(r.DisbursedDate),
            DateOfProduction = Date(r.DateOfProduction),
            AppliedDate = Date(r.AppliedDate),
            ApprovedDate = Date(r.ApprovedDate),
        }, ct))[0].FirstOrDefault();

        var status = row?.Text("StatusCode") ?? "500";
        log.LogInformation("{Procedure} by {Client}: {Udyam} application {ApplicationId} → {Status}",
            procedure, caller.Client, Shorten(r.UdyamNo), Shorten(r.ApplicationId), status);
        return row is null
            ? LegacyJson(new ApiServiceResponse { StatusCode = "500" })
            : LegacyJson(new ApiServiceResponse4 { StatusCode = status, StatusMessage = row.Text("StatusMessage") });
    }

    /// <summary>The procedures take varchar dates and store them in datetime columns; ISO 8601 parses the same under any DATEFORMAT.</summary>
    private static string? Date(DateTime? d) => d?.ToString("yyyy-MM-dd'T'HH:mm:ss", CultureInfo.InvariantCulture);

    private static string? Shorten(string? value) => TokenController.Shorten(value);
}
