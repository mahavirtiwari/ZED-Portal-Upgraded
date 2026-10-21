using Zed.Core.Data;
using Zed.Core.Security;
using Zed.Portal.Features.Msme;

namespace Zed.Portal.Features.Staff.Schemes;

/// <summary>FinancialAssistance.VerificationStatus values (from the procedures and the legacy pages).</summary>
public static class FaStatus
{
    /// <summary>Submitted by the MSME; the master admin allots an agency, which accepts (assigning an assessor) or rejects.</summary>
    public const int New = 1;
    /// <summary>With the financial assessor (desktop assessor with FinancialVerification).</summary>
    public const int InProgress = 2;
    /// <summary>Assessor approved; the agency does the QC.</summary>
    public const int Qc = 3;
    /// <summary>Agency approved; waiting for the NEFT reimbursement (Neft/NewTransactions).</summary>
    public const int Approved = 4;
    public const int Rejected = 5;
    /// <summary>Reimbursement paid (NEFT approved).</summary>
    public const int Reimbursed = 6;
}

/// <summary>The latest FA application of one MSME for one certification, with its documents.</summary>
public sealed class FaApplication(string certification, IDictionary<string, object?> row,
    IReadOnlyList<IDictionary<string, object?>> photos, IReadOnlyList<IDictionary<string, object?>> screenshots)
{
    public string Certification { get; } = certification;
    public IDictionary<string, object?> Row { get; } = row;
    public IReadOnlyList<IDictionary<string, object?>> Photos { get; } = photos;
    public IReadOnlyList<IDictionary<string, object?>> Screenshots { get; } = screenshots;

    public int Id => SchemeRows.Int(Row, "Id") ?? 0;
    public string ZedId => Row.Text("ZedId");
    public int? Status => SchemeRows.Int(Row, "VerificationStatus");
    public int? IsApproved => SchemeRows.Int(Row, "IsApproved");
    public string AgencyUserId => Row.Text("CertificationBodyUserId");
    public string AssessorUserId => Row.Text("FinancialAssessorId");
    public bool RejectedByAgency => !string.IsNullOrWhiteSpace(Row.Text("ReasonForRejection")) && Status == FaStatus.New;

    public IDictionary<string, object?>? Photo(int photoId) => Photos.FirstOrDefault(p => SchemeRows.Int(p, "Id") == photoId);

    public IEnumerable<IDictionary<string, object?>> ScreenshotsOf(int photoId) =>
        Screenshots.Where(s => SchemeRows.Int(s, "PhotoId") == photoId);

    public bool AllVerified => Photos.Count > 0 && Photos.All(p => !string.IsNullOrWhiteSpace(p.Text("IsVerified")));

    /// <summary>Who may open the application: the master admin, the allotted agency, the assigned assessor.</summary>
    public bool CanView(ZedUser user) => user.RoleId switch
    {
        (int)UserRole.MasterAdmin => true,
        (int)UserRole.Agency => SchemeRows.Same(AgencyUserId, user.UserId),
        (int)UserRole.DesktopAssessor => SchemeRows.Same(AssessorUserId, user.UserId),
        _ => false,
    };

    /// <summary>The assigned assessor validates documents while the application is with them.</summary>
    public bool CanValidate(ZedUser user) =>
        user.RoleId == (int)UserRole.DesktopAssessor && SchemeRows.Same(AssessorUserId, user.UserId) && Status == FaStatus.InProgress;

    /// <summary>
    /// Final decision (SP_FINANCIAL_ASSISTANCE_FINAL_AUBMIT): the assessor at status 2 once every document is
    /// validated (the legacy page meant to require this but tested a function, which is always true);
    /// the agency at status 3 after the assessor approved.
    /// </summary>
    public bool CanDecide(ZedUser user) => user.RoleId switch
    {
        (int)UserRole.DesktopAssessor => CanValidate(user) && AllVerified,
        (int)UserRole.Agency => SchemeRows.Same(AgencyUserId, user.UserId) && Status == FaStatus.Qc && IsApproved == 1,
        _ => false,
    };

    /// <summary>Bank details of the reimbursement: the master admin once approved, the assessor while verifying (as the legacy page).</summary>
    public bool CanEditAccount(ZedUser user) => user.RoleId switch
    {
        (int)UserRole.MasterAdmin => Status is FaStatus.Approved or FaStatus.Reimbursed,
        (int)UserRole.DesktopAssessor => CanValidate(user),
        _ => false,
    };
}

public static class FaApplications
{
    public static readonly string[] Certifications = ["Bronze", "Silver", "Gold"];

    public static string? Canonical(string? value) =>
        Certifications.FirstOrDefault(c => string.Equals(c, value?.Trim(), StringComparison.OrdinalIgnoreCase));

    /// <summary>
    /// SP_FINANCIAL_ASSISTANCE_GET_DETAILS: sets 0–2 are the Bronze/Silver/Gold applications (latest first,
    /// rejected ones excluded), 3–5 their documents, 6–8 the assessor's validation screenshots.
    /// </summary>
    public static async Task<List<FaApplication>> LoadAsync(ISqlExecutor db, string zedId, CancellationToken ct)
    {
        var sets = await db.QueryProcMultipleAsync("SP_FINANCIAL_ASSISTANCE_GET_DETAILS", new { ZedId = zedId }, ct);
        var result = new List<FaApplication>();
        for (var i = 0; i < Certifications.Length; i++)
        {
            var row = sets[i].FirstOrDefault();
            if (row is null) continue;
            // Documents of this application only (the set holds those of every non-rejected application of the level).
            var faId = row.Text("FinancialAssistanceId");
            var photos = sets[3 + i].Where(p => string.IsNullOrEmpty(faId) || p.Text("FinancialAssistanceId") == faId).ToList();
            var photoIds = photos.Select(p => p.Text("Id")).ToHashSet();
            var screenshots = sets[6 + i].Where(s => photoIds.Contains(s.Text("PhotoId"))).ToList();
            result.Add(new FaApplication(Certifications[i], row, photos, screenshots));
        }
        return result;
    }

    public static async Task<FaApplication?> FindAsync(ISqlExecutor db, string zedId, string certification, CancellationToken ct) =>
        (await LoadAsync(db, zedId, ct)).FirstOrDefault(a => a.Certification == certification);
}

/// <summary>
/// Where the FA files are kept, relative to <see cref="Zed.Core.Http.PortalOptions.StorageRoot"/> (the old site root):
/// the MSME's documents were saved by the mobile API under <c>mobileapi/Photos/{ZedId}/FinancialAssistance/{PhotoId}</c>
/// (served publicly by the old site; moved copies under <c>CertifiedPhotos</c>), and the assessor's
/// validation screenshots under <c>Uploads/FinancialAssistance/{ZedId}/{Certification}/{FileName}</c>.
/// </summary>
public static class FaFilePaths
{
    private static readonly HashSet<string> Extensions = new(StringComparer.OrdinalIgnoreCase) { ".jpg", ".jpeg", ".png", ".pdf" };

    /// <summary>A single, safe file name of an allowed type, or null.</summary>
    public static string? FileName(string? value) =>
        MsmeFilePaths.Normalise(value?.Trim()) is { } n && !n.Contains('/') && Extensions.Contains(Path.GetExtension(n)) ? n : null;

    public static IEnumerable<string> DocumentCandidates(string zedId, string photoFile)
    {
        yield return $"mobileapi/Photos/{zedId}/FinancialAssistance/{photoFile}";
        yield return $"mobileapi/CertifiedPhotos/{zedId}/FinancialAssistance/{photoFile}";
    }

    public static string ScreenshotFolder(string zedId, string certification) => $"Uploads/FinancialAssistance/{zedId}/{certification}";
}
