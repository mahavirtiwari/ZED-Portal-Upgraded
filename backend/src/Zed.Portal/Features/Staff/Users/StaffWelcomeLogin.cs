using Zed.Core.Security;
using Zed.Portal.Features.Staff.PasswordReset;

namespace Zed.Portal.Features.Staff.Users;

/// <summary>
/// How a new staff account (agency, assessor, consultant, MSME DFO, Ministry, dashboard login, sub-user) learns to sign in
/// (audit M2, user's decision): a one-time link to set its password, valid 24 hours, and no password in the mail
/// (<see cref="StaffPasswordResets.NewSetPasswordUrlAsync"/>). Master Admin and Super Admin accounts still get the
/// generated password, as before. With the links switched off (StaffPasswordReset:Enabled = false) every welcome mail
/// carries the password, as before. When a link cannot be recorded, <see cref="SetPasswordUrl"/> is null and the mail asks
/// the user to use "Forgot password?" on the staff login page.
/// </summary>
/// <param name="Password">The generated password, only when the mail is to carry it.</param>
public sealed record StaffWelcomeLogin(string? Password, string? SetPasswordUrl)
{
    public const int ValidHours = StaffPasswordResets.SetPasswordValidMinutes / 60;

    /// <summary>The roles whose welcome mail keeps the password (2026-11-08: the Dashboard Admin gets a set-password link).</summary>
    public static bool KeepsPassword(int roleId) => roleId is (int)UserRole.MasterAdmin;

    public static async Task<StaffWelcomeLogin> ForAsync(HttpContext http, string userId, int roleId, string password, string createdBy, CancellationToken ct)
    {
        if (KeepsPassword(roleId)) return new(password, null);
        var resets = http.RequestServices.GetRequiredService<StaffPasswordResets>();
        if (!resets.SetPasswordLinksEnabled) return new(password, null);
        return new(null, await resets.NewSetPasswordUrlAsync(userId, createdBy, http.Connection.RemoteIpAddress?.ToString(), ct));
    }

    /// <summary>The welcome templates' parameters: Password, SetPasswordUrl and SetPasswordValidHours.</summary>
    public Dictionary<string, object?> AddTo(Dictionary<string, object?> parameters)
    {
        parameters["Password"] = Password;
        parameters["SetPasswordUrl"] = SetPasswordUrl;
        parameters["SetPasswordValidHours"] = ValidHours;
        return parameters;
    }
}
