using Zed.Core.Data;

namespace Zed.Core.Finance;

/// <summary>
/// 2026-11-15 (the user): the invoice setup of Admin → Settings → Payment Gateway and Invoices → Invoices, what the
/// legacy procedures had fixed. Kept in dbo.V4Settings of the main database; a missing value keeps today's (the defaults
/// below), so nothing changes until the Admin saves another value.
/// <list type="bullet">
/// <item>The series text of each sector: read by SP_GENERATE_NEXT_ZED_INVOICE_NO (migration 0077). Each sector keeps its
/// own counter, back to 1 every 1 April.</item>
/// <item>Board, Portal, Location code, fee ledger and the item name of each certification level: replaced in what
/// <see cref="ErpFinanceService"/> posts (the procedures still give the defaults).</item>
/// <item>The test units (UDYAM numbers) whose payments are never posted: checked by <see cref="ErpFinanceService"/>
/// (migration 0077 took the list out of the SP_API_FINANCE_GET_* procedures).</item>
/// </list>
/// </summary>
public static class InvoiceSetup
{
    public const string SeriesManufacturing = "Invoices.SeriesManufacturing";
    public const string SeriesServices = "Invoices.SeriesServices";
    public const string Board = "Invoices.Board";
    public const string Portal = "Invoices.Portal";
    public const string LocationCode = "Invoices.LocationCode";
    public const string FeeLedger = "Invoices.FeeLedger";
    public const string ItemBronze = "Invoices.ItemBronze";
    public const string ItemSilver = "Invoices.ItemSilver";
    public const string ItemGold = "Invoices.ItemGold";
    public const string ExcludedUdyam = "Invoices.ExcludedUdyam";

    /// <summary>Saved for an empty test-unit list (a blank value means "the default list").</summary>
    public const string NoUnits = "none";

    public static readonly IReadOnlyDictionary<string, string> Defaults = new Dictionary<string, string>
    {
        [SeriesManufacturing] = "ZEDM",
        [SeriesServices] = "ZEDS",
        [Board] = "ZED",
        [Portal] = "NDIE",
        [LocationCode] = "NDIE",
        [FeeLedger] = "ASSESSMENT FEE",
        [ItemBronze] = "ZMS - ZED BRONZE CERTIFICATION",
        [ItemSilver] = "ZMS - ZED SILVER CERTIFICATION",
        [ItemGold] = "ZMS - ZED GOLD CERTIFICATION",
    };

    /// <summary>The test units the procedures left out (after migration 0055 counted UDYAM-UP-16-0001476).</summary>
    public static readonly IReadOnlyList<string> DefaultExcludedUdyam = ["UDYAM-GJ-01-0013310", "UDYAM-MH-23-0006117", "UDYAM-UP-29-0003915"];

    public sealed record Values(
        string SeriesManufacturing, string SeriesServices, string Board, string Portal, string LocationCode, string FeeLedger,
        string ItemBronze, string ItemSilver, string ItemGold, IReadOnlyList<string> ExcludedUdyam);

    public static async Task<Values> LoadAsync(IPortalSettings settings, CancellationToken ct)
    {
        async Task<string> V(string key) => (await settings.GetAsync(key, ct)) is { } v && !string.IsNullOrWhiteSpace(v) ? v.Trim() : Defaults[key];
        var excluded = await settings.GetAsync(ExcludedUdyam, ct);
        return new Values(await V(SeriesManufacturing), await V(SeriesServices), await V(Board), await V(Portal), await V(LocationCode),
            await V(FeeLedger), await V(ItemBronze), await V(ItemSilver), await V(ItemGold), ParseUdyam(excluded));
    }

    /// <summary>The saved list ("none" = no units; blank = the default list).</summary>
    public static IReadOnlyList<string> ParseUdyam(string? saved)
    {
        if (string.IsNullOrWhiteSpace(saved)) return DefaultExcludedUdyam;
        if (string.Equals(saved.Trim(), NoUnits, StringComparison.OrdinalIgnoreCase)) return [];
        return saved.Split([',', ';', '\n', '\r', ' '], StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries)
            .Select(u => u.ToUpperInvariant()).Distinct().ToList();
    }

    public static bool IsExcluded(Values v, string? udyam) =>
        !string.IsNullOrWhiteSpace(udyam) && v.ExcludedUdyam.Contains(udyam.Trim(), StringComparer.OrdinalIgnoreCase);

    /// <summary>
    /// The Admin's values over the procedure's row, before it is posted. Only fields the procedure filled are replaced (its
    /// "no data" row stays empty); the item name only for a certification invoice of Bronze, Silver or Gold.
    /// </summary>
    public static void Apply(IDictionary<string, object?> row, ErpDocument document, string module, string certification, Values v)
    {
        void Set(string column, string value)
        {
            if (row.TryGetValue(column, out var current) && current is string s && !string.IsNullOrEmpty(s)) row[column] = value;
        }

        Set("Board", v.Board);
        switch (document)
        {
            case ErpDocument.Customer:
                Set("Portal_Name", v.Portal);
                break;
            case ErpDocument.Receipt:
                Set("PortalName", v.Portal);
                break;
            case ErpDocument.Invoice:
                Set("Portal", v.Portal);
                Set("Location_Code", v.LocationCode);
                Set("TA_DA_LedgerName", v.FeeLedger);
                if (string.Equals(module, "ZED", StringComparison.OrdinalIgnoreCase))
                {
                    var item = certification.Trim().ToUpperInvariant() switch
                    {
                        "BRONZE" => v.ItemBronze,
                        "SILVER" => v.ItemSilver,
                        "GOLD" => v.ItemGold,
                        _ => null,
                    };
                    if (item is not null) Set("Sub_Discipline_Name", item);
                }
                break;
        }
    }
}
