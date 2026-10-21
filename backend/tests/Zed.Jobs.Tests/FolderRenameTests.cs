using System.Collections.Concurrent;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using Zed.Core.Data;
using Zed.Jobs;

namespace Zed.Jobs.Tests;

public sealed class FolderRenameTests : IDisposable
{
    private readonly string temp = Path.Combine(Path.GetTempPath(), "zed-folder-rename-" + Guid.NewGuid().ToString("N"));
    private readonly string pdfs;
    private readonly string photos;
    private readonly FakeDb db = new();

    public FolderRenameTests()
    {
        pdfs = Directory.CreateDirectory(Path.Combine(temp, "site", "PDFs", "SA")).FullName;
        photos = Directory.CreateDirectory(Path.Combine(temp, "services", "Photos")).FullName;
    }

    public void Dispose()
    {
        try { Directory.Delete(temp, recursive: true); } catch (IOException) { }
    }

    private sealed class FakeDb : ISqlExecutor
    {
        public List<PendingRename> Pending { get; } = [];
        public ConcurrentQueue<(string Name, object? Args)> Calls { get; } = new();

        public Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default)
        {
            Calls.Enqueue((procedure, parameters));
            return Task.FromResult<IReadOnlyList<T>>(Pending.Cast<T>().ToList());
        }

        public Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default)
        {
            Calls.Enqueue((procedure, parameters));
            return Task.FromResult(1);
        }

        public Task<ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default) => throw new NotSupportedException();
        public Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default) => throw new NotSupportedException();

        public List<object?> Records => Calls.Where(c => c.Name == FolderRenameOptions.RecordProcedure).Select(c => c.Args).ToList();
    }

    private sealed class Dbs(ISqlExecutor main) : IJobDatabases
    {
        public IReadOnlyList<string> Names => ["Main"];
        public ISqlExecutor this[string name] => name == "Main" ? main : throw new KeyNotFoundException(name);
    }

    private sealed class Catalog(params string[] existing) : IProcedureCatalog
    {
        public Task<ProcedureInfo?> GetAsync(string database, string procedure, CancellationToken ct) =>
            Task.FromResult(existing.Contains(procedure) ? new ProcedureInfo([], true) : null);
    }

    private static object? Arg(object? args, string name) => args?.GetType().GetProperty(name)?.GetValue(args);

    private FolderRenameOptions Options(FolderRenameMode mode = FolderRenameMode.Apply, bool photosPerLevel = false) => new()
    {
        Enabled = true,
        Mode = mode,
        DailyAt = ["01:30"],
        Roots =
        [
            new() { Name = "SA PDFs", Path = pdfs },
            new() { Name = "App photos", Path = photos, PerLevel = photosPerLevel },
        ],
    };

    private FolderRenamer Renamer(FolderRenameOptions o) =>
        new(new Dbs(db), Microsoft.Extensions.Options.Options.Create(new JobsOptions { FolderRename = o }), TimeProvider.System, NullLogger<FolderRenamer>.Instance);

    private PendingRename Row(string? zedId, int id = 1, int? minutesAgo = 300, string level = "Bronze") =>
        new() { Id = id, ZedId = zedId, CertificationType = level, InTable = true, MinutesSinceRejection = minutesAgo };

    /// <summary>A file written <paramref name="hoursAgo"/> hours ago.</summary>
    private static string OldFile(string folder, string name, double hoursAgo = 24)
    {
        Directory.CreateDirectory(folder);
        var path = Path.Combine(folder, name);
        File.WriteAllText(path, "x");
        File.SetLastWriteTimeUtc(path, DateTime.UtcNow.AddHours(-hoursAgo));
        return path;
    }

    [Fact]
    public async Task Apply_moves_both_folders_to_the_archived_id_and_marks_the_row_done()
    {
        OldFile(Path.Combine(pdfs, "ZEDMSME000123"), "Bronze_Milestone0_Payment_Receipt.pdf");
        OldFile(Path.Combine(photos, "ZEDMSME000123", "Bronze", "Selfie"), "1.jpg");
        db.Pending.Add(Row("ZEDMSME000123_D_45"));

        var r = Assert.Single(await Renamer(Options()).RunAsync(default));

        Assert.Equal(RenameOutcome.Moved, r.Outcome);
        Assert.True(r.Done);
        Assert.True(File.Exists(Path.Combine(pdfs, "ZEDMSME000123_D_45", "Bronze_Milestone0_Payment_Receipt.pdf")));
        Assert.True(File.Exists(Path.Combine(photos, "ZEDMSME000123_D_45", "Bronze", "Selfie", "1.jpg")));
        Assert.False(Directory.Exists(Path.Combine(pdfs, "ZEDMSME000123")));
        var record = Assert.Single(db.Records);
        Assert.Equal("Moved", Arg(record, "Outcome"));
        Assert.Equal(true, Arg(record, "Done"));
        Assert.Equal("ZEDMSME000123_D_45", Arg(record, "ZedId"));
        var query = db.Calls.First();
        Assert.Equal(FolderRenameOptions.PendingProcedure, query.Name);
        Assert.Equal(true, Arg(query.Args, "Collect"));
        Assert.Equal("Bronze", Arg(query.Args, "CertificationTypes"));
        Assert.Equal(2, Arg(query.Args, "DelayHours"));
    }

    [Fact]
    public async Task Per_level_root_moves_only_the_rejected_level_and_removes_an_empty_unit_folder()
    {
        OldFile(Path.Combine(photos, "ZEDMSME000124", "Bronze"), "a.jpg");
        OldFile(Path.Combine(photos, "ZEDMSME000125", "Bronze"), "b.jpg");
        OldFile(Path.Combine(photos, "ZEDMSME000125", "Silver"), "c.jpg");
        db.Pending.Add(Row("ZEDMSME000124_D_1", id: 1));
        db.Pending.Add(Row("ZEDMSME000125_D", id: 2));

        var results = await Renamer(Options(photosPerLevel: true)).RunAsync(default);

        Assert.All(results, r => Assert.Equal(RenameOutcome.Moved, r.Outcome));
        Assert.True(File.Exists(Path.Combine(photos, "ZEDMSME000124_D_1", "Bronze", "a.jpg")));
        Assert.False(Directory.Exists(Path.Combine(photos, "ZEDMSME000124")));
        Assert.True(File.Exists(Path.Combine(photos, "ZEDMSME000125_D", "Bronze", "b.jpg")));
        Assert.True(File.Exists(Path.Combine(photos, "ZEDMSME000125", "Silver", "c.jpg")));
    }

    [Fact]
    public async Task Nothing_to_move_already_archived_and_not_archived_rows_are_done()
    {
        Directory.CreateDirectory(Path.Combine(pdfs, "ZEDMSME000127_D_2"));
        db.Pending.Add(Row("ZEDMSME000126_D_1", id: 1));
        db.Pending.Add(Row("ZEDMSME000127_D_2", id: 2));
        db.Pending.Add(Row("ZEDMSME000128", id: 3));

        var results = await Renamer(Options()).RunAsync(default);

        Assert.Equal([RenameOutcome.NothingToMove, RenameOutcome.AlreadyArchived, RenameOutcome.NotArchived], results.Select(r => r.Outcome));
        Assert.All(results, r => Assert.True(r.Done));
        Assert.All(db.Records, a => Assert.Equal(true, Arg(a, "Done")));
    }

    [Fact]
    public async Task Conflict_is_not_merged_and_the_row_stays_waiting()
    {
        OldFile(Path.Combine(pdfs, "ZEDMSME000130"), "new.pdf");
        OldFile(Path.Combine(pdfs, "ZEDMSME000130_D"), "old.pdf");
        OldFile(Path.Combine(photos, "ZEDMSME000130"), "p.jpg");
        db.Pending.Add(Row("ZEDMSME000130_D"));

        var r = Assert.Single(await Renamer(Options()).RunAsync(default));

        Assert.Equal(RenameOutcome.Conflict, r.Outcome);
        Assert.False(r.Done);
        // Nothing moved anywhere, not even the folder of the root without a conflict.
        Assert.True(File.Exists(Path.Combine(pdfs, "ZEDMSME000130", "new.pdf")));
        Assert.True(File.Exists(Path.Combine(photos, "ZEDMSME000130", "p.jpg")));
        Assert.False(Directory.Exists(Path.Combine(photos, "ZEDMSME000130_D")));
        Assert.Equal(false, Arg(Assert.Single(db.Records), "Done"));
    }

    [Theory]
    [InlineData(@"..\..\evil_D_1")]
    [InlineData(@"ZEDMSME000131_D_1\..\..")]
    [InlineData("ZEDMSME000131_D_1/../x")]
    [InlineData("C:\\Windows_D_1")]
    [InlineData("ZEDMSME000131_X_1")]
    [InlineData("")]
    [InlineData(null)]
    public async Task Ids_that_are_not_zed_ids_touch_nothing_and_stay_waiting(string? zedId)
    {
        OldFile(Path.Combine(pdfs, "ZEDMSME000131"), "keep.pdf");
        var before = Directory.GetFileSystemEntries(temp, "*", SearchOption.AllDirectories).Order().ToList();
        db.Pending.Add(Row(zedId));

        var r = Assert.Single(await Renamer(Options()).RunAsync(default));

        Assert.Equal(RenameOutcome.InvalidId, r.Outcome);
        Assert.False(r.Done);
        Assert.Equal(before, Directory.GetFileSystemEntries(temp, "*", SearchOption.AllDirectories).Order().ToList());
    }

    [Fact]
    public async Task A_level_that_is_not_a_name_is_refused_for_per_level_roots()
    {
        OldFile(Path.Combine(photos, "ZEDMSME000132", "Bronze"), "a.jpg");
        db.Pending.Add(Row("ZEDMSME000132_D_1", level: @"..\.."));

        var r = Assert.Single(await Renamer(Options(photosPerLevel: true)).RunAsync(default));

        Assert.Equal(RenameOutcome.InvalidId, r.Outcome);
        Assert.True(File.Exists(Path.Combine(photos, "ZEDMSME000132", "Bronze", "a.jpg")));
    }

    [Fact]
    public async Task Report_mode_changes_nothing_and_says_what_apply_would_do()
    {
        OldFile(Path.Combine(pdfs, "ZEDMSME000133"), "r.pdf");
        db.Pending.Add(Row("ZEDMSME000133_D_7"));

        var r = Assert.Single(await Renamer(Options(FolderRenameMode.Report)).RunAsync(default));

        Assert.Equal(RenameOutcome.WouldMove, r.Outcome);
        Assert.Contains("would move ZEDMSME000133 -> ZEDMSME000133_D_7", r.Detail);
        Assert.True(File.Exists(Path.Combine(pdfs, "ZEDMSME000133", "r.pdf")));
        Assert.False(Directory.Exists(Path.Combine(pdfs, "ZEDMSME000133_D_7")));
        Assert.Empty(db.Records);
        Assert.Equal(false, Arg(db.Calls.Single().Args, "Collect"));
    }

    [Fact]
    public async Task Files_written_after_the_rejection_mean_a_new_application_and_block_the_move()
    {
        // Rejected 5 hours ago; a receipt of the new application was written 1 hour ago.
        OldFile(Path.Combine(pdfs, "ZEDMSME000134"), "old.pdf", hoursAgo: 30);
        OldFile(Path.Combine(pdfs, "ZEDMSME000134"), "Bronze_Milestone0_Payment_Receipt.pdf", hoursAgo: 1);
        db.Pending.Add(Row("ZEDMSME000134_D_8", minutesAgo: 300) is var row ? Fill(row, "Bronze:1") : null!);

        var r = Assert.Single(await Renamer(Options()).RunAsync(default));

        Assert.Equal(RenameOutcome.NewerFiles, r.Outcome);
        Assert.False(r.Done);
        Assert.Contains("in use again (Bronze:1)", r.Detail);
        Assert.True(File.Exists(Path.Combine(pdfs, "ZEDMSME000134", "old.pdf")));
        Assert.False(Directory.Exists(Path.Combine(pdfs, "ZEDMSME000134_D_8")));

        static PendingRename Fill(PendingRename p, string inUse) { p.BaseCertifications = inUse; return p; }
    }

    [Fact]
    public async Task Files_written_within_the_grace_period_belong_to_the_rejection()
    {
        // Rejected 5 hours ago; the reject report written 5 minutes later (grace 10 minutes) still moves.
        OldFile(Path.Combine(pdfs, "ZEDMSME000135"), "Bronze_Report.pdf", hoursAgo: 5 - 5 / 60.0);
        db.Pending.Add(Row("ZEDMSME000135_D_9", minutesAgo: 300));

        var r = Assert.Single(await Renamer(Options()).RunAsync(default));

        Assert.Equal(RenameOutcome.Moved, r.Outcome);
    }

    [Fact]
    public async Task An_io_error_leaves_the_row_waiting_and_the_next_run_finishes_it()
    {
        if (!OperatingSystem.IsWindows()) return; // an open file blocks a folder move on Windows only
        var locked = OldFile(Path.Combine(photos, "ZEDMSME000136", "Bronze"), "busy.jpg");
        OldFile(Path.Combine(pdfs, "ZEDMSME000136"), "r.pdf");
        db.Pending.Add(Row("ZEDMSME000136_D_3"));
        var renamer = Renamer(Options());

        RenameResult first;
        using (new FileStream(locked, FileMode.Open, FileAccess.Read, FileShare.None))
            first = Assert.Single(await renamer.RunAsync(default));

        Assert.Equal(RenameOutcome.Error, first.Outcome);
        Assert.False(first.Done);
        Assert.True(Directory.Exists(Path.Combine(pdfs, "ZEDMSME000136_D_3")));   // the first root had moved

        var second = Assert.Single(await renamer.RunAsync(default));
        Assert.Equal(RenameOutcome.Moved, second.Outcome);
        Assert.True(second.Done);
        Assert.Contains("SA PDFs: ZEDMSME000136_D_3 already there", second.Detail);
        Assert.True(File.Exists(Path.Combine(photos, "ZEDMSME000136_D_3", "Bronze", "busy.jpg")));
    }

    [Fact]
    public async Task Several_history_rows_of_one_rejection_are_handled_once_and_all_marked()
    {
        OldFile(Path.Combine(pdfs, "ZEDMSME000137"), "r.pdf");
        db.Pending.Add(Row("ZEDMSME000137_D_4", id: 10));
        db.Pending.Add(Row("ZEDMSME000137_D_4", id: 11));

        var results = await Renamer(Options()).RunAsync(default);

        Assert.All(results, r => Assert.Equal(RenameOutcome.Moved, r.Outcome));
        Assert.Equal([10, 11], db.Records.Select(a => (int)Arg(a, "Id")!));
    }

    [Fact]
    public async Task Rows_report_mode_found_but_did_not_collect_are_never_recorded()
    {
        OldFile(Path.Combine(pdfs, "ZEDMSME000138"), "r.pdf");
        var row = Row("ZEDMSME000138_D_5");
        row.InTable = false;
        db.Pending.Add(row);
        await Renamer(Options()).RunAsync(default);
        Assert.Empty(db.Records);
    }

    [Fact]
    public async Task Bad_settings_stop_the_run_before_anything_is_read()
    {
        var o = Options();
        o.Roots.Add(new() { Name = "relative", Path = @"PDFs\SA" });
        var ex = await Assert.ThrowsAsync<InvalidOperationException>(() => Renamer(o).RunAsync(default));
        Assert.Contains("absolute folder path", ex.Message);
        Assert.Empty(db.Calls);
    }

    [Fact]
    public async Task Check_reports_missing_folders_settings_and_procedures()
    {
        var checker = new FolderRenameChecker(new Catalog(FolderRenameOptions.PendingProcedure), new Dbs(db));
        var o = Options();
        o.Roots.Add(new() { Name = "gone", Path = Path.Combine(temp, "missing") });
        o.Roots.Add(new() { Name = "SA PDFs", Path = pdfs });
        o.CertificationTypes = ["Bronze", "Gold;DROP"];

        var (errors, _) = await checker.CheckAsync(o, includeSchedule: true, default);

        Assert.Contains(errors, e => e.Contains("does not exist"));
        Assert.Contains(errors, e => e.Contains("used twice"));
        Assert.Contains(errors, e => e.Contains("'Gold;DROP' is not a certification type"));
        Assert.Contains(errors, e => e.Contains(FolderRenameOptions.RecordProcedure) && e.Contains("0007_folder_rename.sql"));
        Assert.DoesNotContain(errors, e => e.Contains(FolderRenameOptions.PendingProcedure));
        // The write check leaves nothing behind.
        Assert.Empty(Directory.GetFiles(pdfs));
    }

    [Fact]
    public async Task Check_report_passes_a_good_configuration_and_fails_an_enabled_bad_one()
    {
        var checker = new FolderRenameChecker(new Catalog(FolderRenameOptions.PendingProcedure, FolderRenameOptions.RecordProcedure), new Dbs(db));
        var output = new StringWriter();
        Assert.Equal(0, await checker.ReportAsync(Options(), output, default));
        Assert.StartsWith("OK", output.ToString());

        var bad = Options();
        bad.DailyAt = [];
        Assert.Equal(1, await checker.ReportAsync(bad, new StringWriter(), default));
        bad.Enabled = false;
        Assert.Equal(0, await checker.ReportAsync(bad, new StringWriter(), default));   // disabled: reported, not counted
        Assert.Equal(0, await checker.ReportAsync(new FolderRenameOptions(), output, default));
        Assert.Contains("not configured", output.ToString());
    }

    [Fact]
    public void Settings_bind_from_configuration()
    {
        var config = new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?>
        {
            ["Jobs:FolderRename:Enabled"] = "true",
            ["Jobs:FolderRename:Mode"] = "Apply",
            ["Jobs:FolderRename:CertificationTypes:0"] = "Silver",
            ["Jobs:FolderRename:Roots:0:Name"] = "SA PDFs",
            ["Jobs:FolderRename:Roots:0:Path"] = pdfs,
            ["Jobs:FolderRename:Roots:0:PerLevel"] = "true",
        }).Build();
        var o = new JobsOptions();
        config.GetSection("Jobs").Bind(o);
        Assert.Equal(FolderRenameMode.Apply, o.FolderRename.Mode);
        Assert.Equal(["Silver"], o.FolderRename.Types);
        Assert.True(Assert.Single(o.FolderRename.Roots).PerLevel);
        Assert.Equal(["Bronze"], new FolderRenameOptions().Types);
    }
}
