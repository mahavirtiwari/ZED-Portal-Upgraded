using System.Data.Common;
using System.Security.Cryptography;
using Zed.Core.Data;
using Zed.Portal.Features.Payments;
using Zed.Portal.Features.Staff.Masters;

namespace Zed.Portal.Features.Staff.Expenditure;

/// <summary>
/// 2026-11-18 (the user: "Before uploading any invoices, assessment agency has to provide their GSTIN number, PAN number, and
/// also upload the same. This should be for one time only and cannot be updated."): the agency's (consultant
/// organisation's) tax details, columns of its legacy dbo.Users row (migration 0100): GSTIN, PAN, the GST registration
/// certificate and the PAN card (PDF / JPG / PNG), when and by whom they were submitted.
/// <para>
/// The lock: they are written once, by <see cref="SubmitSql"/>, only WHERE TaxSubmittedOn IS NULL; a second submission is
/// refused (409) before any file is stored, and the conditional UPDATE refuses a race. There is no edit endpoint and no edit
/// screen. A correction by the Admin is not part of this change (it would be a new, audited Admin action).
/// </para>
/// The managers who see the agency (<see cref="ExpenditureParties"/>) read them, with the files, on the Expenditure tab, the
/// purchase-order card and every invoice review; invoices can be uploaded only after they were submitted.
/// </summary>
public static class ExpenditureTax
{
    public const long MaxBytes = 5 * 1024 * 1024;
    public const string Folder = "Uploads/ExpenditureTax";
    public const string GstFile = "gst";
    public const string PanFile = "pan";

    public sealed class Row
    {
        public string? UserId { get; init; }
        public string? AgencyGstNumber { get; init; }
        public string? TaxGstin { get; init; }
        public string? TaxPan { get; init; }
        public string? TaxGstFile { get; init; }
        public string? TaxPanFile { get; init; }
        public DateTime? TaxSubmittedOn { get; init; }
        public string? TaxSubmittedBy { get; init; }
    }

    internal const string ReadSql =
        "SELECT TOP (1) UserId, AgencyGstNumber, TaxGstin, TaxPan, TaxGstFile, TaxPanFile, TaxSubmittedOn, TaxSubmittedBy FROM dbo.Users " +
        "WHERE RoleId = 2 AND UserId = @PartyId;";

    /// <summary>Once only: nothing changes when the details were submitted already.</summary>
    internal const string SubmitSql =
        "UPDATE dbo.Users SET TaxGstin = @Gstin, TaxPan = @Pan, TaxGstFile = @GstFile, TaxPanFile = @PanFile, TaxSubmittedOn = SYSUTCDATETIME(), " +
        "TaxSubmittedBy = @By WHERE RoleId = 2 AND UserId = @PartyId AND TaxSubmittedOn IS NULL;";

    /// <param name="Available">False until migration 0100 is applied (the page says so; uploads wait).</param>
    /// <param name="SuggestedGstin">Before submission: the GSTIN of the agency form (Add agency), to pre-fill the field.</param>
    public sealed record View(bool Available, bool Submitted, string? Gstin, string? Pan, bool HasGstFile, bool HasPanFile, DateTime? SubmittedOn,
        string? SubmittedBy, string? SuggestedGstin);

    public static readonly View Unavailable = new(false, false, null, null, false, false, null, null, null);

    public static async Task<(Row? Row, bool Available)> ReadAsync(ISqlExecutor db, string partyId, ILogger log, CancellationToken ct)
    {
        try { return ((await db.QuerySqlAsync<Row>(ReadSql, new { PartyId = partyId }, ct)).FirstOrDefault(), true); }
        catch (DbException ex)
        {
            log.LogWarning(ex, "Tax details of {Party} not read (is migration 0100 applied?)", partyId);
            return (null, false);
        }
    }

    public static async Task<View> ViewAsync(ISqlExecutor db, string partyId, ILogger log, CancellationToken ct)
    {
        var (row, available) = await ReadAsync(db, partyId, log, ct);
        return ToView(row, available);
    }

    public static View ToView(Row? r, bool available)
    {
        if (!available) return Unavailable;
        if (r?.TaxSubmittedOn is null)
        {
            var suggested = r?.AgencyGstNumber?.Trim().ToUpperInvariant();
            return new View(true, false, null, null, false, false, null, null, suggested is { Length: 15 } ? suggested : null);
        }
        // Stored in UTC; shown as the Indian date and time.
        return new View(true, true, r.TaxGstin?.Trim(), r.TaxPan?.Trim(), !string.IsNullOrWhiteSpace(r.TaxGstFile), !string.IsNullOrWhiteSpace(r.TaxPanFile),
            r.TaxSubmittedOn.Value.AddMinutes(330), r.TaxSubmittedBy?.Trim(), null);
    }

    // ------------------------------------------------------------------ GSTIN / PAN

    private const string Base36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

    /// <summary>The GSTIN's 15th character from its first 14 (the GSTN's modulus-36 check digit).</summary>
    public static char CheckDigit(string first14)
    {
        var sum = 0;
        for (var i = 0; i < 14; i++)
        {
            var product = Base36.IndexOf(first14[i]) * (i % 2 == 0 ? 1 : 2);
            sum += product / 36 + product % 36;
        }
        return Base36[(36 - sum % 36) % 36];
    }

    /// <summary>
    /// Null when the GSTIN is valid: the app's GSTIN format (<see cref="Certifications.Gstin"/>: state code 01-38, the PAN,
    /// the entity number, "Z") and the check digit; otherwise why not.
    /// </summary>
    public static string? GstinProblem(string? gstin)
    {
        if (gstin is null || !Certifications.Gstin().IsMatch(gstin))
            return "Please enter a valid GSTIN: 15 characters (state code, PAN, entity number, Z and check digit), e.g. 27AAPFU0939F1ZV.";
        return CheckDigit(gstin) == gstin[14] ? null : "The GSTIN's last character (its check digit) does not match. Please check the GSTIN.";
    }

    /// <summary>Null when the PAN is valid and is characters 3-12 of the GSTIN; otherwise why not.</summary>
    public static string? PanProblem(string? pan, string gstin)
    {
        if (pan is null || !Certifications.Pan().IsMatch(pan)) return "Please enter a valid PAN: 10 characters, e.g. AAPFU0939F.";
        var ofGstin = Certifications.PanOf(gstin);
        return pan == ofGstin ? null : $"The PAN does not match the GSTIN: characters 3 to 12 of the GSTIN are the PAN ({ofGstin}).";
    }

    // ------------------------------------------------------------------ the two documents

    private static readonly MasterUploads.FileType[] Types =
    [
        new(".pdf", ["application/pdf"], h => h.Length >= 5 && h[0] == '%' && h[1] == 'P' && h[2] == 'D' && h[3] == 'F' && h[4] == '-'),
        new(".jpg", ["image/jpeg", "image/pjpeg"], h => h.Length >= 3 && h[0] == 0xFF && h[1] == 0xD8 && h[2] == 0xFF),
        new(".png", ["image/png"], h => h.Length >= 8 && h[0] == 0x89 && h[1] == 0x50 && h[2] == 0x4E && h[3] == 0x47 && h[4] == 0x0D && h[5] == 0x0A && h[6] == 0x1A && h[7] == 0x0A),
    ];

    /// <summary>The file's type when it is a PDF (complete), JPG or PNG of at most 5 MB (extension, declared type, content).</summary>
    public static async Task<(MasterUploads.FileType? Type, string? Error)> CheckAsync(IFormFile? file, string what, CancellationToken ct)
    {
        if (file is null || file.Length == 0) return (null, $"Please upload the {what} (PDF, JPG or PNG, up to 5 MB).");
        var (type, error) = await MasterUploads.CheckAsync(file, Types, MaxBytes, ct);
        if (error is not null) return (null, $"The {what}: {char.ToLowerInvariant(error[0])}{error[1..]}");
        if (type!.Extension == ".pdf" && !await ExpenditureInvoices.PdfCompleteAsync(file, ct))
            return (null, $"The {what} is not a complete PDF. Please upload it again.");
        return (type, null);
    }

    /// <summary>Saves the document as Uploads/ExpenditureTax/{party}/{prefix}_{time}_{random}{ext}; returns that relative path.</summary>
    public static async Task<string> SaveAsync(IFormFile file, string root, string partyId, string prefix, string extension, CancellationToken ct)
    {
        var party = new string(partyId.Where(char.IsAsciiLetterOrDigit).ToArray());
        if (party.Length == 0) throw new InvalidOperationException("No party folder.");
        var folder = $"{Folder}/{party}";
        var name = $"{prefix}_{DateTime.Now:yyyyMMddHHmmss}_{Convert.ToHexString(RandomNumberGenerator.GetBytes(4)).ToLowerInvariant()}{extension}";
        await MasterUploads.SaveAsync(file, root, folder, name, ct);
        return $"{folder}/{name}";
    }

    /// <summary>The stored document, only inside the tax folder of the storage root; null otherwise.</summary>
    public static string? Resolve(string root, string? relative)
    {
        if (string.IsNullOrWhiteSpace(relative)) return null;
        var baseDir = Path.GetFullPath(Path.Combine(root, Folder.Replace('/', Path.DirectorySeparatorChar))) + Path.DirectorySeparatorChar;
        var full = Path.GetFullPath(Path.Combine(root, relative.Replace('/', Path.DirectorySeparatorChar)));
        return full.StartsWith(baseDir, StringComparison.OrdinalIgnoreCase) && File.Exists(full) ? full : null;
    }

    public static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".pdf" => "application/pdf",
        ".png" => "image/png",
        _ => "image/jpeg",
    };

    /// <summary>Removes documents stored for a submission that was then refused (best effort).</summary>
    public static void Discard(string root, params string?[] relatives)
    {
        foreach (var r in relatives)
        {
            if (Resolve(root, r) is not { } full) continue;
            try { File.Delete(full); }
            catch (IOException) { }
            catch (UnauthorizedAccessException) { }
        }
    }
}
