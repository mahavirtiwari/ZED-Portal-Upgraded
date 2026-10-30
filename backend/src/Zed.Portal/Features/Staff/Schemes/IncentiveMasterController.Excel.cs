using System.Globalization;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Portal.Features.Staff.Masters;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Portal.Features.Staff.Schemes;

/// <summary>
/// Excel export, template and upload of the incentive catalogue, every group in one sheet (V4; see <see cref="MasterSheet"/>).
/// Rows are saved through the page's own Create and Update, so they follow the same rules. The legacy update procedure
/// keeps an incentive's levels, so the levels of an existing incentive are left as they are (the check says so).
/// Documents are attached on the page.
/// </summary>
public sealed partial class IncentiveMasterController
{
    private const string StakeholderCard = "Stakeholder card";

    // A property: Types is a static field of the other part of the class, initialised in an unspecified order.
    internal static SheetSpec Sheet => new("Incentives", "incentives",
    [
        new("Type", "Common (Ministry of MSME), Financial, Other, or the state's name in capitals, e.g. UTTAR PRADESH. Required."),
        new("Title", "The incentive's title (up to 4000 characters). Required."),
        new("Details", "Up to 4000 characters. Required."),
        new("Ministry / Department", "Up to 4000 characters. Required."),
        new("Contact person", "Up to 2000 characters. Required."),
        new("Email", "A valid e-mail address. Required."),
        new("Mobile / Phone", "Digits, + - and spaces (up to 15). Required."),
        new("Web link", "A full http(s):// address, or --- for none. Required."),
        new("Video link", "A full http(s):// address. Optional."),
        new("Bronze", "Yes if it applies to Bronze-certified units (a new incentive needs at least one level)."),
        new("Silver", "Yes if it applies to Silver-certified units."),
        new("Gold", "Yes if it applies to Gold-certified units."),
        new("Status", "Active or Inactive (empty = Active)."),
        new("Appears on", $"Dashboard (its own card on the MSME dashboard) or {StakeholderCard} (inside its group's card). Empty = {StakeholderCard}."),
        new("Card highlight", "The coloured line of its dashboard card (up to 300 characters). Optional."),
    ], 2, "Rows are matched by Type + Title: a new title is added to its type, an existing one is updated. Nothing is deleted; to hide an " +
        "incentive, set Status to Inactive. The levels of an existing incentive stay as they are.",
        (column, value) => column == 0 ? CanonicalType(value) ?? value : value);

    [HttpGet("excel")]
    public async Task<FileContentResult> Excel(CancellationToken ct) => MasterSheet.Export(Sheet, (await AllAsync(ct)).Select(i => (string?[])i.Cells));

    [HttpGet("excel/template")]
    public FileContentResult Template() => MasterSheet.Template(Sheet);

    [HttpPost("excel/check")]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public Task<ActionResult<SheetCheck>> ExcelCheck(IFormFile? file, CancellationToken ct) =>
        MasterSheet.CheckAsync(this, Sheet, file, async () => Rules(await AllAsync(ct)), ct);

    [HttpPost("excel/apply")]
    [RequestSizeLimit(MasterSheet.MaxFileBytes + 64 * 1024)]
    [RequestFormLimits(MultipartBodyLengthLimit = MasterSheet.MaxFileBytes + 64 * 1024)]
    public async Task<ActionResult<SheetApplied>> ExcelApply(IFormFile? file, CancellationToken ct)
    {
        List<SheetIncentive> all = [];
        return await MasterSheet.ApplyAsync(this, Sheet, file, async () => Rules(all = await AllAsync(ct)), async row =>
        {
            var req = SheetRequest(row.Cells);
            if (row.Current is null) return MasterSheet.Refusal((await Create(req, ct)).Result);
            var id = all.First(i => i.Cells[0] == row.Cell(0) && string.Equals(i.Cells[1], row.Cell(1), StringComparison.OrdinalIgnoreCase)).Id;
            return MasterSheet.Refusal((await Update(id, req, ct)).Result);
        }, ct);
    }

    private sealed record SheetIncentive(long Id, string[] Cells);

    /// <summary>Every incentive of every type, as the page lists them (SP_MASTER_GET_INCENTIVES per type), in the sheet's columns.</summary>
    private async Task<List<SheetIncentive>> AllAsync(CancellationToken ct)
    {
        var all = new List<SheetIncentive>();
        foreach (var type in Types)
            foreach (var r in await Load(type, ct))
            {
                if (!long.TryParse(r.Text("Id"), NumberStyles.None, CultureInfo.InvariantCulture, out var id)) continue;
                all.Add(new SheetIncentive(id,
                [
                    type, r.Text("Incentive").Trim(), r.Text("Details").Trim(), r.Text("MinistryOrDepartment").Trim(), r.Text("ContactPerson").Trim(),
                    r.Text("Email").Trim(), r.Text("MobileNo").Trim(), r.Text("WebLink").Trim(), r.Text("VideoLink").Trim(),
                    YesNo(r, "ApplicableForBronze"), YesNo(r, "ApplicableForSilver"), YesNo(r, "ApplicableForGold"),
                    StaffUserRules.Bool(r, "ActiveStatus") ? "Active" : "Inactive",
                    string.Equals(r.Text("DisplayOn"), OnDashboard, StringComparison.OrdinalIgnoreCase) ? OnDashboard : StakeholderCard,
                    r.Text("CardHighlight").Trim(),
                ]));
            }
        return all;
    }

    private static string YesNo(IDictionary<string, object?> r, string column) => StaffUserRules.Bool(r, column) ? "Yes" : "No";

    private static (IEnumerable<string?[]>, Action<SheetRowContext>) Rules(List<SheetIncentive> all) =>
        (all.Select(i => (string?[])i.Cells), row =>
        {
            if (CanonicalType(row.Cell(0)) is null) { row.Errors.Add("Type must be Common, Financial, Other or a state's name, e.g. UTTAR PRADESH."); return; }
            string[] levels = ["Bronze", "Silver", "Gold"];
            for (var c = 9; c <= 11; c++)
            {
                if (MasterSheet.YesNo(row.Cell(c)) is { } yes) row.Cells[c] = yes;
                else row.Errors.Add($"{levels[c - 9]} must be Yes or No.");
            }
            if (MasterSheet.Status(row.Cell(12)) is { } status) row.Cells[12] = status;
            else row.Errors.Add("Status must be Active or Inactive.");
            row.Cells[13] = row.Cell(13).ToLowerInvariant() switch
            {
                "dashboard" => OnDashboard,
                "" or "card" or "stakeholder card" => StakeholderCard,
                _ => "",
            };
            if (row.Cell(13).Length == 0) row.Errors.Add($"Appears on must be Dashboard or {StakeholderCard}.");
            if (row.Errors.Count > 0) return;
            if (row.Current is not null && !row.Cells[9..12].SequenceEqual(row.Current[9..12]))
            {
                row.Notes.Add("The levels of an existing incentive stay as they are (Bronze, Silver and Gold of this row are not applied).");
                Array.Copy(row.Current, 9, row.Cells, 9, 3);
            }
            if (Check(SheetRequest(row.Cells)) is { } error) row.Errors.Add(error);
            else if (row.Current is null && row.Cells[9..12].All(v => v == "No")) row.Errors.Add("A new incentive needs at least one level: Bronze, Silver or Gold.");
        });

    private static IncentiveRequest SheetRequest(string[] c) => new(
        c[0], c[1], c[2], c[3], c[4], c[7], c[5], c[6], c[8], c[9] == "Yes", c[10] == "Yes", c[11] == "Yes", c[12] == "Active",
        c[13] == OnDashboard ? OnDashboard : InStakeholderCard, c[14]);
}
