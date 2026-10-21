using System.Text.Json;
using System.Text.RegularExpressions;
using Zed.Core.Data;
using Zed.Core.Security;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// Validation, scoping and projection rules shared by the agency and assessor endpoints
/// (port of the UserController / UserHelper user-management code).
/// </summary>
public static partial class StaffUserRules
{
    /// <summary>"Applicable States" list of CertificationBodies.cshtml / Assessor.cshtml (AgencyUserStates.States).</summary>
    public static readonly string[] States =
    [
        "ANDAMAN AND NICOBAR ISLANDS", "ANDHRA PRADESH", "ARUNACHAL PRADESH", "ASSAM", "BIHAR", "CHANDIGARH",
        "CHHATTISGARH", "DELHI", "GOA", "GUJARAT", "HARYANA", "HIMACHAL PRADESH", "JAMMU AND KASHMIR", "JHARKHAND",
        "KARNATAKA", "KERALA", "LADAKH", "LAKSHADWEEP", "MADHYA PRADESH", "MAHARASHTRA", "MANIPUR", "MEGHALAYA",
        "MIZORAM", "NAGALAND", "ODISHA", "PUDUCHERRY", "PUNJAB", "RAJASTHAN", "SIKKIM", "TAMIL NADU", "TELANGANA",
        "THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU", "TRIPURA", "UTTAR PRADESH", "UTTARAKHAND", "WEST BENGAL",
    ];

    public const string AssessorTypeAssessor = "Assessor";
    public const string AssessorTypeBronze = "BronzeAssessor";
    public static readonly string[] AssessorTypes = [AssessorTypeAssessor, AssessorTypeBronze];
    public const string IdProofAadhaar = "Aadhaar Card";
    public const string IdProofPan = "PAN Card";

    /// <summary>Photos of professionals come from the ZED training portal (SP_GET_USERS_BY_ROLE / professional lookup).</summary>
    public const string ProfessionalPhotoPrefix = "https://training.zed.org.in/";

    [GeneratedRegex(@"^[A-Za-z0-9]{1,50}$")] public static partial Regex UserIdPattern();
    [GeneratedRegex(@"^\d{10}$")] public static partial Regex MobilePattern();
    [GeneratedRegex(@"^\d{6}$")] public static partial Regex PinCodePattern();
    [GeneratedRegex(@"^[0-9A-Za-z]{1,20}$")] private static partial Regex GstPattern();
    [GeneratedRegex(@"^\d{12}$")] private static partial Regex AadhaarPattern();
    [GeneratedRegex(@"^[A-Z]{5}\d{4}[A-Z]$")] private static partial Regex PanPattern();
    [GeneratedRegex(@"^[A-Za-z0-9/_\-]{1,50}$")] public static partial Regex CertificateNoPattern();

    public static bool IsUserId(string? id) => id is not null && UserIdPattern().IsMatch(id);

    /// <summary>
    /// Trims free text and checks its length. Control characters (other than line breaks and tabs in
    /// multi-line fields) are refused. Values are stored as typed; every page and e-mail encodes them on output.
    /// </summary>
    public static bool TryText(string? value, int max, bool required, bool multiline, out string? result)
    {
        result = string.IsNullOrWhiteSpace(value) ? null : value.Trim();
        if (result is null) return !required;
        if (result.Length > max) return false;
        foreach (var c in result)
            if (char.IsControl(c) && !(multiline && c is '\r' or '\n' or '\t')) return false;
        return true;
    }

    public static bool IsEmail(string? value) =>
        value is { Length: > 3 and <= 100 } && System.Net.Mail.MailAddress.TryCreate(value, out var a) &&
        a.Address == value && value.Contains('.', StringComparison.Ordinal);

    public static bool IsGst(string? value) => value is null || GstPattern().IsMatch(value);

    public static string? IdProofError(string? type, string? number) => type switch
    {
        IdProofAadhaar when number is not null && AadhaarPattern().IsMatch(number) => null,
        IdProofAadhaar => "Please enter a valid 12 digit Aadhaar number.",
        IdProofPan when number is not null && PanPattern().IsMatch(number) => null,
        IdProofPan => "Please enter a valid PAN (e.g. ABCDE1234F).",
        _ => "Please select the ID proof.",
    };

    /// <summary>Last four characters only; Aadhaar numbers must not be displayed in full.</summary>
    public static string? MaskIdProof(string? number) =>
        string.IsNullOrEmpty(number) ? null : number.Length <= 4 ? new string('X', number.Length) : new string('X', number.Length - 4) + number[^4..];

    /// <summary>Distinct values that are all in the allowed set (case-insensitive), or null when one is not.</summary>
    public static List<string>? OnlyAllowed(IEnumerable<string>? values, IEnumerable<string> allowed)
    {
        var set = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        foreach (var a in allowed) set.TryAdd(a, a);
        var result = new List<string>();
        foreach (var v in values ?? [])
        {
            if (string.IsNullOrWhiteSpace(v)) continue;
            if (!set.TryGetValue(v.Trim(), out var canonical)) return null;
            if (!result.Contains(canonical)) result.Add(canonical);
        }
        return result;
    }

    /// <summary>Comma list for the procedures' string_split parameters, or null when empty (legacy only sent them when filled).</summary>
    public static string? Csv(IReadOnlyCollection<string> values) => values.Count == 0 ? null : string.Join(",", values);

    public static bool Bool(IDictionary<string, object?> row, string column) =>
        row.TryGetValue(column, out var v) && v switch
        {
            bool b => b,
            null or DBNull => false,
            var o => o.ToString() is "1" or "True" or "true",
        };

    public static string? PhotoUrl(string? url) =>
        !string.IsNullOrWhiteSpace(url) && url.StartsWith(ProfessionalPhotoPrefix, StringComparison.OrdinalIgnoreCase) &&
        Uri.TryCreate(url, UriKind.Absolute, out var u) && u.Scheme == Uri.UriSchemeHttps && !url.EndsWith('/')
            ? url : null;

    /// <summary>Whitelisted columns of a procedure row (the procedures SELECT * on Users, including Password).</summary>
    public static Dictionary<string, object?> Pick(IDictionary<string, object?> row, params string[] columns)
    {
        var result = new Dictionary<string, object?>();
        foreach (var c in columns)
            result[c] = row.TryGetValue(c, out var v) && v is not DBNull ? v : null;
        return result;
    }

    /// <summary>A user with the given role, read with SP_GET_USER_DETAILS_BY_USER_ID (users, states, NIC sectors, areas).</summary>
    public static Task<ManagedUser?> LoadAsync(ISqlExecutor db, string userId, UserRole role, CancellationToken ct) =>
        LoadAnyAsync(db, userId, [(int)role], ct);

    /// <summary>
    /// As <see cref="LoadAsync"/>, for a user with any of the given Users.RoleId values (Consultancy keeps consultants as
    /// RoleId 3 and technical experts as RoleId 33).
    /// </summary>
    public static async Task<ManagedUser?> LoadAnyAsync(ISqlExecutor db, string userId, IReadOnlyCollection<int> roleIds, CancellationToken ct)
    {
        if (!IsUserId(userId)) return null;
        var sets = await db.QueryProcMultipleAsync("SP_GET_USER_DETAILS_BY_USER_ID", new { UserId = userId }, ct);
        var row = sets[0].FirstOrDefault();
        if (row is null || !roleIds.Any(r => row.Text("RoleId") == r.ToString())) return null;
        static List<string> Values(IReadOnlyList<IDictionary<string, object?>> set) =>
            set.Select(r => r.Text("States")).Where(s => s.Length > 0).ToList();
        return new ManagedUser(row, Values(sets[1]), Values(sets[2]), Values(sets[3]));
    }

    /// <summary>
    /// Who may manage whom: a MasterAdmin any agency or assessor; an agency only the assessors it created
    /// (Users.CreatedBy). The legacy Block / UnBlock / ResetMobileNo / Assessor actions did not check this.
    /// </summary>
    public static bool CanManage(ZedUser caller, ManagedUser target, UserRole targetRole) => (UserRole)caller.RoleId switch
    {
        UserRole.MasterAdmin => true,
        UserRole.Agency => targetRole == UserRole.DesktopAssessor &&
                           string.Equals(target.Row.Text("CreatedBy"), caller.UserId, StringComparison.OrdinalIgnoreCase),
        _ => false,
    };

    /// <summary>Name, e-mail, mobile and address of a certified professional (SP_GET_PROFESSIONAL_DETAILS_BY_CERT_NO_duplicatetest).</summary>
    public sealed record Professional(string Name, string Email, string MobileNo, string? Address, string? PinCode, string? SelfieUrl);

    public const string ProfessionalProcedure = "SP_GET_PROFESSIONAL_DETAILS_BY_CERT_NO_duplicatetest";

    /// <summary>
    /// Looks up a professional for the signed-in agency. The procedure itself checks that the caller is an
    /// active agency and that the certificate is not attached to an active Bronze Assessor of another agency.
    /// Returns the professional or the procedure's message.
    /// </summary>
    public static async Task<(Professional? Found, string? Error)> LookupProfessionalAsync(
        ISqlExecutor db, ZedUser agency, string assessorType, string certificateNo, string email, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync(ProfessionalProcedure, new
        {
            UserId = agency.UserId,
            RoleId = agency.RoleId.ToString(),
            CertificationNo = certificateNo,
            EmailId = email,
            AssessorType = assessorType,
        }, ct);
        var status = sets[1].FirstOrDefault();
        var row = sets[0].FirstOrDefault();
        if (status is null || status.Text("Status") != "1" || row is null)
        {
            var message = status?.Text("ErrorMessage");
            return (null, string.IsNullOrEmpty(message) ? "Failed to retrieve assessor details." : message);
        }

        string? address = null, pin = null;
        try
        {
            // Registrations.data is the registration form as JSON; the old page read Address.{Street,City,District,State,PinCode}.
            using var doc = JsonDocument.Parse(row.Text("CertificateNo"));
            if (doc.RootElement.TryGetProperty("Address", out var a) && a.ValueKind == JsonValueKind.Object)
            {
                string Part(string name) => a.TryGetProperty(name, out var p) && p.ValueKind == JsonValueKind.String ? p.GetString()!.Trim() : "";
                address = string.Join(", ", new[] { Part("Street"), Part("City"), Part("District"), Part("State") }.Where(s => s.Length > 0));
                pin = Part("PinCode");
            }
        }
        catch (JsonException)
        {
            // Address stays empty; the agency types it.
        }

        var professional = new Professional(row.Text("Name").Trim(), row.Text("Email").Trim(), row.Text("ContactNumber").Trim(),
            string.IsNullOrEmpty(address) ? null : address, PinCodePattern().IsMatch(pin ?? "") ? pin : null, PhotoUrl(row.Text("SelfiePath")));
        if (professional.Name.Length == 0 || !IsEmail(professional.Email))
            return (null, "Failed to retrieve assessor details.");
        return (professional, null);
    }
}

/// <summary>A row of SP_GET_USER_DETAILS_BY_USER_ID with its states, NIC sectors and areas of knowledge.</summary>
public sealed record ManagedUser(IDictionary<string, object?> Row, List<string> States, List<string> NicSectors, List<string> AreasOfKnowledge)
{
    public string UserId => Row.Text("UserId");
    public bool IsActive => StaffUserRules.Bool(Row, "IsActive");
}
