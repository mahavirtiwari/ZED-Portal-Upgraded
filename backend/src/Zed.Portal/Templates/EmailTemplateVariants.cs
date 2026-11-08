namespace Zed.Portal.Templates;

/// <summary>
/// Template keys of the e-mails that one Razor template sends in several cases (2026-11-08): each case is its own entry in
/// Admin → Email Templates, so the Admin can word or switch off one without the others. Migration 0064 copied an existing
/// edit of the shared key to each new key, so nothing changed for the recipients at the split.
/// </summary>
public static class EmailTemplateVariants
{
    /// <summary>StaffLoginDetailsEmail when the Admin (or the owner) sends a new password or set-password link.</summary>
    public const string LoginDetailsReset = nameof(StaffLoginDetailsEmail) + ".Reset";

    /// <summary>StaffLoginDetailsEmail of a new sub-user (works for its owner).</summary>
    public const string LoginDetailsSubUser = nameof(StaffLoginDetailsEmail) + ".SubUser";

    /// <summary>PasswordChangedEmail to an MSME (the staff one keeps the class name).</summary>
    public const string PasswordChangedMsme = nameof(PasswordChangedEmail) + ".Msme";

    /// <summary>The key of a login-details mail: a reset first, then a sub-user, else a new login.</summary>
    public static string LoginDetails(bool reset, bool subUser) =>
        reset ? LoginDetailsReset : subUser ? LoginDetailsSubUser : nameof(StaffLoginDetailsEmail);

    public static string PasswordChanged(bool msme) => msme ? PasswordChangedMsme : nameof(PasswordChangedEmail);
}
