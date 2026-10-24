using System.Data.Common;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.RateLimiting;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Core.Security;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// The signed-in MSME's profile. Port of Views/Msme/ViewProfile.cshtml and the MsmeController actions it
/// used: GetDetails (SP_MSME_GET_DETAILS), GetUdyam (Ministry Udyam service), ValidatePlantAndActivity
/// (SP_MSME_VALIDATE_UDYAM_DETAILS) and UpdateUdyamDetails (SP_MSME_UPDATE_UDYAM_DETAILS).
/// MsmeController.UpdateProfile / DisablePlant are super-admin features (their procedures only act for
/// RoleId 10) and move with the admin pages.
/// The ZED ID, Udyam number and mobile number always come from the sign-in cookie and the database;
/// the legacy actions took them (and the activity text) from the browser.
/// </summary>
[Route("api/msme/profile")]
public sealed class MsmeProfileController(ISqlExecutor db, IUdyamClient udyam, ILogger<MsmeProfileController> log) : MsmeApiController
{
    // Only the columns the page shows (the legacy action sent every result set, SELECT * on Msme etc.).
    private static readonly string[] MsmeFields =
    [
        "ZedId", "IncorporationDate", "WhetherProdCommenced",
        "PUnitName", "PAddress", "PDistrictName", "PStateName", "PPin",
        "Activity", "TwoDigitActivity", "FourDigitActivity", "FiveDigitActivity",
    ];

    private static readonly string[] BasicInfoFields =
    [
        "UdyogAadharNo", "OwnerName", "EnterpriseName", "OrganisationTypeName", "SocialCategoryName", "Gender",
        "EmailId", "MobileNo", "PH", "PanNo", "Address", "StateName", "DistrictName", "Pincode",
        "MajorActivityName", "EnterpriseTypee", "CommmenceDate", "TotalEmp", "DicName", "AppliedDate",
    ];

    private static readonly string[] ActivityFields = ["Activity", "Two_DigitActivity", "Four_DigitActivity", "Five_DigitActivity"];

    private const string UdyamUnavailable = "Unexpected error occured. Please try after some time.";

    private string? ClientIp => HttpContext.Connection.RemoteIpAddress?.ToString();

    public sealed record ProfileResponse(Dictionary<string, object?> Msme, Dictionary<string, object?> BasicInfo);

    /// <summary>Basic information, selected unit and unit activity (SP_MSME_GET_DETAILS sets 0 and 1).</summary>
    [HttpGet]
    public async Task<ActionResult<ProfileResponse>> Get(CancellationToken ct)
    {
        var sets = await GetDetails(ct);
        if (sets[0].FirstOrDefault() is not { } msme) return NotFound();
        return new ProfileResponse(Pick(msme, MsmeFields), Pick(sets[1].FirstOrDefault(), BasicInfoFields));
    }

    /// <summary>"Edit Activity": the activities of the MSME's own Udyam record, read from the Ministry service.</summary>
    [HttpGet("activities")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    public async Task<ActionResult<List<Dictionary<string, string>>>> Activities(CancellationToken ct)
    {
        var (lookup, error) = await LookupOwnUdyam(ct);
        if (error is not null) return error;
        return lookup!.Activities.Select(a => ActivityFields.ToDictionary(f => f, f => a.GetValueOrDefault(f) ?? "")).ToList();
    }

    public sealed record UpdateActivityRequest(string FiveDigitActivity);

    /// <summary>
    /// "Update": the chosen activity must be in the MSME's Udyam record and eligible for the scheme;
    /// then SP_MSME_UPDATE_UDYAM_DETAILS (ModifiedDataType 'Activity') updates it in all ZED databases.
    /// </summary>
    [HttpPost("activity")]
    [EnableRateLimiting(RateLimitPolicies.Sensitive)]
    [MsmeEditAudit("Profile: activity updated")]
    public async Task<ActionResult<MessageResponse>> UpdateActivity(UpdateActivityRequest req, CancellationToken ct)
    {
        var chosen = (req.FiveDigitActivity ?? "").Trim();
        if (chosen.Length == 0) return this.Problem400("Please select the activity.");

        var (lookup, error) = await LookupOwnUdyam(ct);
        if (error is not null) return error;
        var activity = lookup!.Activities.FirstOrDefault(a => a.GetValueOrDefault("Five_DigitActivity") == chosen);
        if (activity is null) return this.Problem400("The selected activity is not in your Udyam registration.");

        var udyamNumber = lookup.UdyamNumber;
        // The legacy page sent PlantIdNo '123' so the "plant already registered" check (set 0) never matched;
        // only the sector eligibility (set 1) applies when changing the activity of an existing unit.
        var check = await db.QueryProcMultipleAsync("SP_MSME_VALIDATE_UDYAM_DETAILS", new
        {
            UdyogAadharNo = udyamNumber,
            PlantIdNo = (string?)null,
            TwoDigitActivity = activity.GetValueOrDefault("Two_DigitActivity"),
            IpAddress = ClientIp,
        }, ct);
        if (check[1].Count == 0) return this.Problem400("Currently this scheme is not applicable for the selected plant activity.");

        static string? Value(Dictionary<string, string> row, string k) => row.GetValueOrDefault(k) is { Length: > 0 } v ? v : null;
        try
        {
            await db.ExecuteProcAsync("SP_MSME_UPDATE_UDYAM_DETAILS", new
            {
                UdyamNumber = udyamNumber,
                // The legacy action substituted this literal when no enterprise type was sent; unused for 'Activity'.
                EnterpriseType = "EnterpriseType",
                PaymentModule = "ZED LIVE",
                ModifiedDataType = "Activity",
                Activity = Value(activity, "Activity"),
                TwoDigitActivity = Value(activity, "Two_DigitActivity"),
                FourDigitActivity = Value(activity, "Four_DigitActivity"),
                FiveDigitActivity = Value(activity, "Five_DigitActivity"),
                // The legacy page sent activity.Id, which the Udyam rows do not have, so this was always cleared.
                // Registration stores ActivityDetail_Id; keep the column consistent with that.
                ActivityDetailId = Value(activity, "ActivityDetail_Id"),
                ZedId,
            }, ct);
        }
        catch (DbException ex)
        {
            log.LogError(ex, "SP_MSME_UPDATE_UDYAM_DETAILS failed for {ZedId}", ZedId);
            return this.Problem400("Unable to update the activity. Please try after some time.");
        }
        return new MessageResponse("Activity updated successfully.");
    }

    private Task<ResultSets> GetDetails(CancellationToken ct) =>
        db.QueryProcMultipleAsync("SP_MSME_GET_DETAILS", new { ZedId, CertificationType = (string?)null }, ct);

    private sealed record OwnUdyam(string UdyamNumber, List<Dictionary<string, string>> Activities);

    /// <summary>Udyam record for the signed-in MSME's own Udyam number and registered mobile.</summary>
    private async Task<(OwnUdyam? Lookup, ActionResult? Error)> LookupOwnUdyam(CancellationToken ct)
    {
        var sets = await GetDetails(ct);
        if (sets[0].FirstOrDefault() is not { } msme) return (null, NotFound());
        var basic = sets[1].FirstOrDefault();
        var udyamNumber = basic?.Text("UdyogAadharNo") ?? "";
        var mobile = msme.Text("MobileNo") is { Length: > 0 } m ? m : basic?.Text("MobileNo") ?? "";
        if (udyamNumber.Length == 0 || mobile.Length == 0)
            return (null, this.Problem400("Udyam details are not available for this unit."));

        UdyamLookup lookup;
        try
        {
            lookup = await udyam.GetUdyamAsync(udyamNumber, mobile, ct);
        }
        catch (Exception ex) when (ex is HttpRequestException or TaskCanceledException or System.Xml.XmlException or InvalidOperationException)
        {
            log.LogWarning(ex, "Udyam lookup failed for {ZedId}", ZedId);
            return (null, Problem(title: UdyamUnavailable, statusCode: StatusCodes.Status502BadGateway));
        }

        if (lookup.BasicDetails.Count == 0 || lookup.BasicDetails.GetValueOrDefault("UdyogAadharNo") == "NO")
            return (null, this.Problem400("It seems that the Registration Number provided is either not approved/verified OR does not exist in the UDYAM Database."));
        if (lookup.Activities.Count == 0)
            return (null, this.Problem400("It seems that the Activity Details are missing in your Udyam file, Please update the same on the Udyam portal and then try again here."));
        return (new OwnUdyam(udyamNumber, lookup.Activities), null);
    }

    /// <summary>Copies the listed columns (null when the procedure did not return them).</summary>
    private static Dictionary<string, object?> Pick(IDictionary<string, object?>? row, string[] fields) =>
        fields.ToDictionary(f => f, f => row is not null && row.TryGetValue(f, out var v) && v is not DBNull ? v : null);
}
