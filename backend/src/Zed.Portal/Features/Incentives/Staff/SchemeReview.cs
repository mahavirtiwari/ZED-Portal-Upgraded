using System.Globalization;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc;
using Zed.Core.Data;
using Zed.Core.Http;
using Zed.Portal.Features.Msme.Schemes;
using static Zed.Portal.Features.Incentives.SchemeApplications;

namespace Zed.Portal.Features.Incentives.Staff;

/// <summary>What the staff pages show of a scheme application: the list rows, the detail (answers by section and item, documents,
/// checks, totals, history) and the documents themselves.</summary>
public static class SchemeReview
{
    /// <summary>The unit's upload folder of scheme documents (SchemeUploads, under mobileapi/Photos/{ZedId}).</summary>
    public const string UploadFolder = "Schemes";
    public const string Yes = "Yes";
    public const string No = "No";
    public const int MaxRemarks = 1000;

    /// <summary>The statuses of the counts tiles, in the flow's order.</summary>
    public static readonly IReadOnlyList<string> Statuses =
        [Submitted, WithAgency, WithAssessor, Verifying, Correction, Qc, Approved, Paid, Rejected, OnHold];

    // ----- list -----

    private const string ListSelect = """
        SELECT F.Id, F.ZedId, F.SchemeCode, F.SchemeLevel, F.SchemeStatus, F.VerificationStatus, F.ClaimAmount, F.EligibleAmount, F.ApprovedAmount,
            F.SubmittedOn, F.DecidedOn, F.CorrectionRound, F.CorrectionDueOn, F.HoldReason, F.CertificationBodyUserId, F.FinancialAssessorId,
            F.AllotmentType, F.ReasonForRejection, F.ReasonForRejectionAgency, F.AssessorAcceptedOn,
            M.EnterpriseName, M.PStateName, A.UserName AS AgencyName, S.UserName AS AssessorName
        FROM dbo.FinancialAssistance F
        OUTER APPLY (SELECT TOP 1 X.EnterpriseName, X.PStateName FROM dbo.Msme X WHERE X.ZedId = F.ZedId) M
        LEFT JOIN dbo.Users A ON A.UserId = F.CertificationBodyUserId AND A.RoleId = 2
        LEFT JOIN dbo.Users S ON S.UserId = F.FinancialAssessorId AND S.RoleId = 3
        WHERE F.SchemeCode IS NOT NULL AND ISNULL(F.SchemeStatus, 'Draft') <> 'Draft'
        """;

    internal const string ListAllSql = ListSelect + " ORDER BY F.Id DESC;";
    internal const string ListAgencySql = ListSelect + " AND F.CertificationBodyUserId = @UserId ORDER BY F.Id DESC;";
    internal const string ListAssessorSql = ListSelect + " AND F.FinancialAssessorId = @UserId ORDER BY F.Id DESC;";

    public sealed class ListRow
    {
        public int Id { get; init; }
        public string? ZedId { get; init; }
        public string? SchemeCode { get; init; }
        public string? SchemeLevel { get; init; }
        public string? SchemeStatus { get; init; }
        public int? VerificationStatus { get; init; }
        public decimal? ClaimAmount { get; init; }
        public string? EligibleAmount { get; init; }
        public decimal? ApprovedAmount { get; init; }
        public DateTime? SubmittedOn { get; init; }
        public DateTime? DecidedOn { get; init; }
        public int? CorrectionRound { get; init; }
        public DateTime? CorrectionDueOn { get; init; }
        public string? HoldReason { get; init; }
        public string? CertificationBodyUserId { get; init; }
        public string? FinancialAssessorId { get; init; }
        public string? AllotmentType { get; init; }
        public string? ReasonForRejection { get; init; }
        public string? ReasonForRejectionAgency { get; init; }
        public DateTime? AssessorAcceptedOn { get; init; }
        public string? EnterpriseName { get; init; }
        public string? PStateName { get; init; }
        public string? AgencyName { get; init; }
        public string? AssessorName { get; init; }

        public string Status => VerificationStatus == 6 ? Paid : SchemeStatus ?? Draft;
    }

    public sealed record ListItem(
        int Id, string ZedId, string? UnitName, string? State, string SchemeCode, string SchemeName, string? Level, string? LevelName, string Status,
        decimal? ClaimAmount, decimal? EligibleAmount, decimal? ApprovedAmount, DateTime? SubmittedOn, DateTime? DecidedOn, int CorrectionRound,
        DateTime? CorrectionDueOn, string? HoldReason, string? Agency, string? AgencyName, string? Assessor, string? AssessorName, string? AllotmentType,
        string? ReasonForRejection, string? AgencyRemarks, DateTime? AssessorAcceptedOn);

    public sealed record Option(string Code, string Name);

    public sealed record ListResponse(IReadOnlyList<ListItem> Rows, IReadOnlyDictionary<string, int> Counts, IReadOnlyList<Option> Schemes, IReadOnlyList<string> States);

    public sealed record ListFilter(string? Scheme, string? Status, string? State, DateOnly? From, DateOnly? To)
    {
        /// <summary>The filters other than the status (the counts tiles follow them).</summary>
        public bool MatchesBase(ListItem r) =>
            (Scheme is null || string.Equals(r.SchemeCode, Scheme, StringComparison.OrdinalIgnoreCase))
            && (State is null || string.Equals(r.State, State, StringComparison.OrdinalIgnoreCase))
            && (From is null || (r.SubmittedOn is { } s && DateOnly.FromDateTime(s) >= From))
            && (To is null || (r.SubmittedOn is { } t && DateOnly.FromDateTime(t) <= To));
    }

    /// <param name="scope">2026-11-20: the Master Admin's login scope (states / levels / category), applied before the counts.</param>
    public static async Task<ListResponse> ListAsync(ISqlExecutor db, SchemeStore store, string sql, string? userId, ListFilter filter, CancellationToken ct,
        Func<List<ListItem>, Task<List<ListItem>>>? scope = null)
    {
        var schemes = await store.AllAsync(ct);
        var names = schemes.ToDictionary(s => s.Code, s => s.Name, StringComparer.OrdinalIgnoreCase);
        var rows = (await db.QuerySqlAsync<ListRow>(sql, new { UserId = userId is null ? null : Ansi(userId, 50) }, ct))
            .Select(r => new ListItem(r.Id, r.ZedId?.Trim() ?? "", r.EnterpriseName?.Trim(), r.PStateName?.Trim(), r.SchemeCode?.Trim() ?? "",
                names.GetValueOrDefault(r.SchemeCode?.Trim() ?? "") ?? r.SchemeCode?.Trim() ?? "", r.SchemeLevel, LevelName(r.SchemeLevel), r.Status,
                r.ClaimAmount, SchemeCases.ParseMoney(r.EligibleAmount), r.ApprovedAmount, r.SubmittedOn, r.DecidedOn, r.CorrectionRound ?? 0, r.CorrectionDueOn,
                r.HoldReason, SchemeCase.Blank(r.CertificationBodyUserId), r.AgencyName?.Trim(), SchemeCase.Blank(r.FinancialAssessorId), r.AssessorName?.Trim(),
                r.AllotmentType, r.ReasonForRejection, r.ReasonForRejectionAgency, r.AssessorAcceptedOn))
            .ToList();
        if (scope is not null) rows = await scope(rows);
        var states = rows.Select(r => r.State).Where(s => !string.IsNullOrWhiteSpace(s)).Select(s => s!).Distinct(StringComparer.OrdinalIgnoreCase).Order().ToList();
        var basic = rows.Where(filter.MatchesBase).ToList();
        var counts = Statuses.ToDictionary(s => s, s => basic.Count(r => r.Status == s));
        var shown = filter.Status is null ? basic : basic.Where(r => r.Status == filter.Status).ToList();
        var options = schemes.Select(s => new Option(s.Code, s.Name))
            .Concat(rows.Select(r => r.SchemeCode).Distinct(StringComparer.OrdinalIgnoreCase).Where(c => !names.ContainsKey(c)).Select(c => new Option(c, c)))
            .ToList();
        return new ListResponse(shown, counts, options, states);
    }

    /// <summary>The list's query filters checked; null with a problem text when one is invalid.</summary>
    public static ListFilter? Filter(string? scheme, string? status, string? state, DateOnly? from, DateOnly? to, out string? problem)
    {
        problem = null;
        var st = string.IsNullOrWhiteSpace(status) ? null : Statuses.FirstOrDefault(s => string.Equals(s, status.Trim(), StringComparison.OrdinalIgnoreCase));
        if (!string.IsNullOrWhiteSpace(status) && st is null) { problem = "Invalid status."; return null; }
        if (from is not null && to is not null && from > to) { problem = "The 'from' date is after the 'to' date."; return null; }
        var sc = string.IsNullOrWhiteSpace(scheme) || scheme.Trim().Length > 40 ? null : scheme.Trim();
        var sn = string.IsNullOrWhiteSpace(state) || state.Trim().Length > 100 ? null : state.Trim();
        return new ListFilter(sc, st, sn, from, to);
    }

    public static string? LevelName(string? level) =>
        string.IsNullOrWhiteSpace(level) ? null : LevelRegistry.Find(level) is { } e ? e.Name : level;

    // ----- detail -----

    public sealed record Person(string UserId, string? Name);
    public sealed record FileItem(string Name, string Url, bool IsPdf);
    public sealed record Check(string Status, string? Remarks, int Round, string? By, DateTime? On);
    public sealed record Field(string Key, string Label, string Type, string? Value, IReadOnlyList<FileItem> Files, string? Path, bool IsClaim, Check? Check);
    public sealed record Item(int Index, string? Pick, string? PickName, IReadOnlyList<Field> Fields);
    public sealed record Section(string Key, string Title, bool Repeating, IReadOnlyList<Item> Items);
    public sealed record Totals(decimal Claimed, decimal Verified, decimal Eligible, decimal? SharePercent, decimal? MaxAmount);
    public sealed record HistoryItem(DateTime? On, string Text);

    public sealed record Application(
        int Id, string ZedId, string? UnitName, string? UnitAddress, string SchemeCode, string SchemeName, string? Level, string? LevelName, string? CertNo,
        string Status, decimal? ClaimAmount, decimal? EligibleAmount, decimal? ApprovedAmount, int CorrectionRound, int CorrectionRounds, int CorrectionDays,
        DateTime? CorrectionDueOn, DateTime? SubmittedOn, DateTime? DecidedOn, string? HoldReason, Person? Agency, Person? Assessor,
        DateTime? AssessorAcceptedOn, string? AllotmentType, string? ReasonForRejection, string? AgencyRemarks, string? AccountNo, string? IfscCode,
        string? BranchAddress, string? BankName);

    /// <summary>What the signed-in user may do now (the API checks each action again).</summary>
    public sealed record Actions(
        bool Allot = false, bool Hold = false, bool Respond = false, bool Qc = false, bool Accept = false, bool Check = false,
        bool Correction = false, bool Reject = false, bool Recommend = false, int RoundsLeft = 0, int Checked = 0, int Checkable = 0, int NotValid = 0);

    public sealed record Detail(Application Application, IReadOnlyList<Section> Sections, Totals Totals, IReadOnlyList<HistoryItem> History, Actions Actions);

    /// <summary>A place in the form the assessor checks: a field with AssessorChecks, or a document / photo with files.</summary>
    public sealed record Checkable(string Path, string Label, string Section, int Index, string Field);

    private static bool IsFile(string type) => type is "document" or "photo";

    /// <summary>The stored file names of a document / photo value (a JSON list of names).</summary>
    public static IReadOnlyList<string> FilesOf(string? value)
    {
        if (string.IsNullOrWhiteSpace(value) || !value.TrimStart().StartsWith('[')) return [];
        try
        {
            return (JsonSerializer.Deserialize<List<string?>>(value) ?? []).Where(n => !string.IsNullOrWhiteSpace(n)).Select(n => n!.Trim()).ToList();
        }
        catch (JsonException) { return []; }
    }

    private static bool Counted(FormSection s, FormItem item) => item.Saved || !s.Repeating;

    /// <summary>Every place the assessor checks (in the form's order), extra answer sections' documents included.</summary>
    public static IReadOnlyList<Checkable> CheckablesOf(SchemeDefinition? def, FormAnswers answers)
    {
        var list = new List<Checkable>();
        var known = new HashSet<string>(StringComparer.Ordinal);
        foreach (var s in def?.Form.Sections ?? [])
        {
            known.Add(s.Key);
            var items = answers.Sections.GetValueOrDefault(s.Key) ?? [];
            for (var i = 0; i < items.Count; i++)
            {
                if (!Counted(s, items[i])) continue;
                foreach (var f in s.Fields)
                {
                    var value = items[i].Values.GetValueOrDefault(f.Key);
                    if (IsFile(f.Type) ? FilesOf(value).Count > 0 : f.AssessorChecks && (!string.IsNullOrWhiteSpace(value) || f.Required))
                        list.Add(new(PathOf(s.Key, i, f.Key), f.Label, s.Key, i, f.Key));
                }
            }
        }
        foreach (var (key, items) in answers.Sections.Where(kv => !known.Contains(kv.Key)))
            for (var i = 0; i < items.Count; i++)
                foreach (var (field, value) in items[i].Values)
                    if (FilesOf(value).Count > 0) list.Add(new(PathOf(key, i, field), Words(field), key, i, field));
        return list;
    }

    /// <summary>Every stored file name the application refers to (the only files the staff file endpoint serves).</summary>
    public static HashSet<string> AllFiles(FormAnswers answers) =>
        answers.Sections.Values.SelectMany(items => items).SelectMany(i => i.Values.Values).SelectMany(FilesOf).ToHashSet(StringComparer.OrdinalIgnoreCase);

    /// <summary>The verified claim: the claim amounts of the counted items, without an amount the assessor marked not valid.</summary>
    public static decimal Verified(SchemeForm form, FormAnswers answers, IReadOnlyDictionary<string, FieldCheck> checks)
    {
        decimal total = 0;
        foreach (var s in form.Sections)
        {
            var claimKeys = s.Fields.Where(f => f.IsClaim).Select(f => f.Key).ToList();
            if (claimKeys.Count == 0 || !answers.Sections.TryGetValue(s.Key, out var items)) continue;
            for (var i = 0; i < items.Count; i++)
            {
                if (!Counted(s, items[i])) continue;
                foreach (var k in claimKeys)
                {
                    if (checks.TryGetValue(PathOf(s.Key, i, k), out var c) && c.Status == No) continue;
                    if (decimal.TryParse(items[i].Values.GetValueOrDefault(k), NumberStyles.Number, CultureInfo.InvariantCulture, out var v)) total += v;
                }
            }
        }
        return total;
    }

    /// <summary>The grade of the application: the share and cap saved with it, else the scheme's grading for its level / the unit's size.</summary>
    public static async Task<SchemeGrade?> GradeAsync(ISqlExecutor db, SchemeDefinition? def, Row row, ILogger log, CancellationToken ct)
    {
        if (row.SharePercent is { } share && row.MaxAmount is { } max) return new SchemeGrade(row.SchemeLevel ?? "", share, max);
        if (def is null) return null;
        var facts = await SchemeEligibility.FactsAsync(db, row.ZedId?.Trim() ?? "", true, log, ct);
        return SchemeEligibility.Grade(def.Grading, row.SchemeLevel ?? "", facts);
    }

    internal static async Task<Detail> DetailAsync(ISqlExecutor db, SchemeStore store, SchemeCase c, string fileBase, Actions actions, ILogger log, CancellationToken ct)
    {
        var row = c.Row;
        var def = await store.FindAsync(c.Code, ct);
        var answers = row.Answers;
        var checks = c.Checks;
        var unit = await SchemeCases.UnitAsync(db, c.ZedId, ct);
        var agency = c.Agency is null ? null : new Person(c.Agency, (await SchemeCases.UserAsync(db, c.Agency, ct))?.UserName);
        var assessor = c.Assessor is null ? null : new Person(c.Assessor, (await SchemeCases.UserAsync(db, c.Assessor, ct))?.UserName);
        var checkable = CheckablesOf(def, answers).Select(x => x.Path).ToHashSet(StringComparer.Ordinal);

        FileItem File(string name) => new(name, $"{fileBase}/{c.Id}/files/{Uri.EscapeDataString(name)}", SchemeUploads.IsPdf(name));
        Check? CheckOf(string path) => checks.TryGetValue(path, out var x) ? new Check(x.Status, x.Remarks, x.Round, x.By, x.On) : null;

        var sections = new List<Section>();
        var known = new HashSet<string>(StringComparer.Ordinal);
        foreach (var s in def?.Form.Sections ?? [])
        {
            known.Add(s.Key);
            var items = answers.Sections.GetValueOrDefault(s.Key) ?? [];
            var shown = new List<Item>();
            for (var i = 0; i < items.Count; i++)
            {
                if (!Counted(s, items[i])) continue;
                var fields = s.Fields.Select(f =>
                {
                    var value = items[i].Values.GetValueOrDefault(f.Key);
                    var path = PathOf(s.Key, i, f.Key);
                    var files = IsFile(f.Type) ? FilesOf(value).Select(File).ToList() : [];
                    return new Field(f.Key, f.Label, f.Type, IsFile(f.Type) ? null : Display(value), files,
                        checkable.Contains(path) ? path : null, f.IsClaim, CheckOf(path));
                }).ToList();
                shown.Add(new Item(i, items[i].Pick, items[i].PickName, fields));
            }
            sections.Add(new Section(s.Key, s.Title, s.Repeating, shown));
        }
        foreach (var (key, items) in answers.Sections.Where(kv => !known.Contains(kv.Key)))
        {
            var shown = items.Select((item, i) => new Item(i, item.Pick, item.PickName, item.Values.Select(kv =>
            {
                var files = FilesOf(kv.Value);
                var path = PathOf(key, i, kv.Key);
                return new Field(kv.Key, Words(kv.Key), files.Count > 0 ? "document" : "text", files.Count > 0 ? null : Display(kv.Value),
                    files.Select(File).ToList(), checkable.Contains(path) ? path : null, false, CheckOf(path));
            }).ToList())).ToList();
            sections.Add(new Section(key, Words(key), items.Count > 1, shown));
        }

        var claimed = def is null ? row.ClaimAmount ?? 0 : answers.Claim(def.Form);
        var verified = def is null ? claimed : Verified(def.Form, answers, checks);
        var grade = await GradeAsync(db, def, row, log, ct);
        var totals = new Totals(claimed, verified, SchemeEligibility.Eligible(verified, grade), grade?.SharePercent, grade?.MaxAmount);

        IReadOnlyList<HistoryItem> history = [];
        try
        {
            history = (await db.QuerySqlAsync<SchemeCases.HistoryRow>(SchemeCases.HistorySql, new { ZedId = Ansi(c.ZedId, 50), Code = Ansi(c.Code, 50) }, ct))
                .Select(h => new HistoryItem(h.CreatedDate, h.Descrip ?? "")).ToList();
        }
        catch (System.Data.Common.DbException ex)
        {
            log.LogWarning(ex, "History of scheme application {Id} not read", c.Id);
        }

        var app = new Application(c.Id, c.ZedId, unit?.Name, unit?.Address, c.Code, def?.Name ?? c.Code, row.SchemeLevel, LevelName(row.SchemeLevel), row.SchemeCertNo,
            row.Status, row.ClaimAmount, SchemeCases.ParseMoney(c.EligibleAmount), c.ApprovedAmount, c.CorrectionRound ?? 0,
            def?.Verification.CorrectionRounds ?? 0, def?.Verification.CorrectionDays ?? 0, c.CorrectionDueOn, row.SubmittedOn, c.DecidedOn, c.HoldReason,
            agency, assessor, c.AssessorAcceptedOn, c.AllotmentType, c.ReasonForRejection, c.ReasonForRejectionAgency,
            row.AccountNo, row.IfscCode, row.BranchAddress, row.BankName);
        return new Detail(app, sections, totals, history, actions);
    }

    private static string? Display(string? value)
    {
        if (string.IsNullOrWhiteSpace(value)) return value;
        var v = value.Trim();
        if (v.StartsWith('['))
        {
            try { return string.Join(", ", JsonSerializer.Deserialize<List<string?>>(v)?.Where(x => !string.IsNullOrWhiteSpace(x)) ?? []); }
            catch (JsonException) { /* plain text */ }
        }
        return value;
    }

    private static string Words(string key)
    {
        var s = key.Replace('_', ' ').Trim();
        return s.Length == 0 ? key : char.ToUpperInvariant(s[0]) + s[1..];
    }

    /// <summary>One of the application's documents, from the unit's scheme upload folder (only names the answers list).</summary>
    internal static IActionResult File(ControllerBase controller, SchemeCase c, string name, IWebHostEnvironment env, PortalOptions portal)
    {
        if (!AllFiles(c.Row.Answers).Contains(name)) return controller.NotFound();
        var full = SchemeUploads.Find(SchemeUploads.StorageRoot(env, portal), c.ZedId, UploadFolder, name);
        return full is null ? controller.NotFound() : SchemeUploads.Serve(controller, full);
    }

    /// <summary>A reviewer's text: trimmed, at most <paramref name="max"/> characters, no control characters but new lines.</summary>
    public static string? Text(string? value, int max) => Zed.Portal.Features.Staff.Schemes.SchemeRows.CleanText(value, max);
}
