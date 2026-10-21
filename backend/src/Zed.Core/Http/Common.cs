using Microsoft.AspNetCore.Http;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Security;

namespace Zed.Core.Http;

public sealed class PortalOptions
{
    public const string Section = "Portal";

    /// <summary>Public address of the portal, used in e-mail links (legacy BaseUrl setting).</summary>
    public string PublicBaseUrl { get; set; } = "https://loginzed.msme.gov.in";

    /// <summary>
    /// Folder that holds generated files in the legacy layout (Certificates/{ZedId}/Pledge.pdf, ...).
    /// Point it at the old site's root to keep using existing files.
    /// </summary>
    public string StorageRoot { get; set; } = "App_Data/storage";

    /// <summary>
    /// Address of the old MVC portal. Links to modules that are not migrated yet (payments,
    /// incentives, financial assistance, ...) open there until those modules move.
    /// </summary>
    public string LegacyBaseUrl { get; set; } = "https://loginzed.msme.gov.in";
}

public sealed record MessageResponse(string Message);

public sealed record CurrentUserResponse(
    string UserId, string UserName, int RoleId, string Role, string? Email, string? MobileNo, string? UnitName,
    IReadOnlyList<string> SubRoles)
{
    public static CurrentUserResponse From(ZedUser u) =>
        new(u.UserId, u.UserName, u.RoleId, u.RoleName, u.Email, u.MobileNo, u.UnitName, u.SubRoles ?? []);
}

public static class PasswordPolicy
{
    /// <summary>Users.Password is varchar(50).</summary>
    public static string? Validate(string? password)
    {
        if (string.IsNullOrEmpty(password) || password.Length < 8 || password.Length > 50)
            return "Password must be 8 to 50 characters long.";
        if (!password.Any(char.IsUpper) || !password.Any(char.IsLower) || !password.Any(char.IsDigit) ||
            password.All(char.IsLetterOrDigit))
            return "Password must contain an uppercase letter, a lowercase letter, a number and a special character.";
        return null;
    }
}

public static class ControllerProblemExtensions
{
    /// <summary>400 with the message in ProblemDetails.title, which the Angular app shows to the user.</summary>
    public static ObjectResult Problem400(this ControllerBase c, string message) =>
        c.Problem(title: message, statusCode: StatusCodes.Status400BadRequest);
}
