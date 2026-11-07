using System.ComponentModel.DataAnnotations;
using System.Text.RegularExpressions;
using Microsoft.AspNetCore.DataProtection;
using Zed.Core.Data;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// New in V4 (2026-11-07): "Forgot password" for an applicant who no longer knows the ZED ID. The units of a ZED ID, a PAN
/// or an e-mail address are listed (SP_V4_MSME_FIND_ACCOUNTS, migration 0053) with the unit name, district, state and a
/// partly hidden ZED ID; the applicant picks one and <see cref="MsmePasswordResets.SendForChosenUnitAsync"/> mails the
/// link (with the full ZED ID) to that unit's registered e-mail, whose partly hidden address is shown. The list never
/// carries an e-mail address or a full ZED ID: each unit is named by an opaque reference that works for 15 minutes.
/// Used by the web login (MsmeAuthController) and the ZED MSME app (MsmeAppRegistrationController).
/// </summary>
public sealed partial class MsmeAccountFinder(ISqlExecutor db, IDataProtectionProvider protection)
{
    public const string NotFound = "No registered unit was found for these details.";
    public const string NotSent = "The reset link could not be sent. Please search again.";
    public const string NoEmail = "No e-mail address is registered for this unit. Please contact the ZED team.";
    public const string InvalidZedId = "Please enter a valid ZED ID.";
    public const string InvalidPan = "Please enter a valid PAN (for example ABCDE1234F).";
    public const string InvalidEmail = "Please enter a valid e-mail address.";
    public static readonly TimeSpan ReferenceLifetime = TimeSpan.FromMinutes(15);

    public sealed record FoundUnit(string Ref, string UnitName, string District, string State, string ZedId);

    [GeneratedRegex("^[A-Z]{5}[0-9]{4}[A-Z]$")] private static partial Regex PanPattern();
    [GeneratedRegex("^[A-Za-z0-9]{1,50}$")] private static partial Regex ZedIdPattern();

    private ITimeLimitedDataProtector Protector => protection.CreateProtector("Zed.MsmeAccountFinder.v1").ToTimeLimitedDataProtector();

    /// <summary>The units found (at most 20), or the message to show when the input is not valid or nothing is found.</summary>
    public async Task<(IReadOnlyList<FoundUnit> Units, string? Error)> FindAsync(string? by, string? value, CancellationToken ct)
    {
        var v = (value ?? "").Trim();
        object args;
        switch ((by ?? "").Trim().ToLowerInvariant())
        {
            case "zedid":
                if (!ZedIdPattern().IsMatch(v)) return ([], InvalidZedId);
                args = new { ZedId = v.ToUpperInvariant(), PanNo = (string?)null, Email = (string?)null };
                break;
            case "pan":
                v = v.ToUpperInvariant();
                if (!PanPattern().IsMatch(v)) return ([], InvalidPan);
                args = new { ZedId = (string?)null, PanNo = v, Email = (string?)null };
                break;
            case "email":
                if (v.Length > 100 || !new EmailAddressAttribute().IsValid(v)) return ([], InvalidEmail);
                args = new { ZedId = (string?)null, PanNo = (string?)null, Email = v };
                break;
            default:
                return ([], "Please choose ZED ID, PAN or e-mail.");
        }

        var rows = (await db.QueryProcMultipleAsync("SP_V4_MSME_FIND_ACCOUNTS", args, ct))[0];
        var units = rows
            .Where(r => r.Text("ZedId").Length > 0)
            .Take(20)
            .Select(r => new FoundUnit(Protector.Protect(r.Text("ZedId"), ReferenceLifetime), r.Text("UnitName").Trim(),
                r.Text("DistrictName").Trim(), r.Text("StateName").Trim(), MaskZedId(r.Text("ZedId"))))
            .ToList();
        return units.Count == 0 ? ([], NotFound) : (units, null);
    }

    /// <summary>The ZED ID behind a reference from <see cref="FindAsync"/>, or null when it is not valid or has expired.</summary>
    public string? ZedIdOf(string? reference)
    {
        if (string.IsNullOrWhiteSpace(reference) || reference.Length > 2000) return null;
        try
        {
            return Protector.Unprotect(reference.Trim());
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return null;
        }
    }

    /// <summary>ZEDM000123 → ZEDM•••123: the first four and the last three characters.</summary>
    public static string MaskZedId(string zedId)
    {
        var id = zedId.Trim();
        if (id.Length <= 7) return id.Length <= 2 ? new string('•', id.Length) : id[..1] + new string('•', id.Length - 2) + id[^1..];
        return id[..4] + new string('•', id.Length - 7) + id[^3..];
    }

    /// <summary>rakesh@gmail.com → ra•••••@gm•••.com: two characters of the name and of the domain, the ending kept.</summary>
    public static string MaskEmail(string email)
    {
        var e = email.Trim();
        var at = e.LastIndexOf('@');
        if (at <= 0 || at == e.Length - 1) return "•••••";
        var name = e[..at];
        var domain = e[(at + 1)..];
        var dot = domain.IndexOf('.');
        var host = dot > 0 ? domain[..dot] : domain;
        var ending = dot > 0 ? domain[dot..] : "";
        static string Keep(string s, int n) => s.Length <= n ? s[..1] : s[..n];
        return Keep(name, 2) + "•••••@" + Keep(host, 2) + "•••" + ending;
    }
}
