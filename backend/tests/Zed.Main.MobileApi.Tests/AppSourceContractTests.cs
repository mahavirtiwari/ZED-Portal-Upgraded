using System.Net;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Zed.Core.Data;

namespace Zed.Main.MobileApi.Tests;

/// <summary>Contract points found in the apps' source (2026-10-22): docs/mobile/CONSULTANT-SA-IMPACT-APPS.md.</summary>
public sealed class AppSourceContractTests : IDisposable
{
    private const string Zed = "ZEDMSME000800";
    private const string Lead = "ZEDSA0001";
    private readonly AssessorTestHost _t = new();

    public void Dispose() => _t.Dispose();

    [Fact]
    public async Task Double_slashes_from_the_consultant_app_reach_the_action()
    {
        // The consultant app joins ".../SA/" with "/SubmitAllocation"; the old IIS/MVC 5 site routed that.
        var single = await _t.Json("/SA/SubmitAllocation", new { saId = "NOBODY", zedId = Zed, certificationType = "Silver" });
        var r = await _t.Client.PostAsync("/SA//SubmitAllocation",
            new StringContent(JsonSerializer.Serialize(new { saId = "NOBODY", zedId = Zed, certificationType = "Silver" }), Encoding.UTF8, "application/json"));
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        var doubled = JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
        Assert.Equal(single.GetProperty("errorMessage").GetString(), doubled.GetProperty("errorMessage").GetString());
    }

    private static MultipartFormDataContent Attendance(string saId, string? metadata = """{"photoId":"att1","latitude":"28.6","longitude":"77.2","timeStamp":"2026-10-22 09:00"}""")
    {
        var form = new MultipartFormDataContent
        {
            { new StringContent(saId), "saId" }, { new StringContent(Zed), "zedId" }, { new StringContent("Silver"), "certificationType" },
            { new StringContent("PunchIn"), "attendanceType" }, { new StringContent("on site"), "comments" },
        };
        if (metadata is not null) form.Add(new StringContent(metadata), "selfieMetadata");
        var file = new ByteArrayContent([0xFF, 0xD8, 0xFF, 0xE0, 0, 0x10]);
        file.Headers.ContentType = new MediaTypeHeaderValue("image/*");
        form.Add(file, "files", "att1.jpg");
        return form;
    }

    private async Task<JsonElement> PostAttendance(MultipartFormDataContent form)
    {
        var r = await _t.Client.PostAsync("/SA/SubmitAttendance", form);
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        return JsonDocument.Parse(await r.Content.ReadAsStringAsync()).RootElement;
    }

    [Fact]
    public async Task SubmitAttendance_of_the_site_assessor_app_is_served_on_main_for_the_allotted_assessor()
    {
        _t.Sql.Allot(Zed, "Silver", Lead);
        _t.Fake.Procs["SP_APP_SA_INSERT_DAILY_ATTENDANCE"] = _ => FakeSql.Sets([new { Status = 1, Message = "PunchIn ATTENDANCE SUBMITTED SUCCESSFULLY" }]);

        var refused = await PostAttendance(Attendance("ZEDSA9999"));
        Assert.Equal("0", refused.GetProperty("status").GetString());
        Assert.Empty(_t.CallsTo("SP_APP_SA_INSERT_DAILY_ATTENDANCE"));
        Assert.Equal("0", (await PostAttendance(Attendance(Lead, metadata: null))).GetProperty("status").GetString());

        var ok = await PostAttendance(Attendance(Lead));
        Assert.Equal("1", ok.GetProperty("status").GetString());
        Assert.Equal("PunchIn ATTENDANCE SUBMITTED SUCCESSFULLY", ok.GetProperty("errorMessage").GetString());
        var args = _t.LastArgs("SP_APP_SA_INSERT_DAILY_ATTENDANCE");
        Assert.Equal(Lead, AssessorTestHost.Arg(args, "AssessorId"));
        Assert.Equal("att1", AssessorTestHost.Arg(args, "PhotoId"));
        Assert.True(File.Exists(_t.FileUnderRoot("Attendance", Zed, "Silver", "att1.jpg")));
    }
}

/// <summary>GET photos/{zedId}/TechnologyUpgradation/{photoId}: the consultant app's TU document viewer.</summary>
public sealed class TuPhotosTests : IDisposable
{
    private const string Zed = "ZEDMSME000900";
    private readonly MobileTestHost _host = new();
    private readonly TuConsultancySql _consultancy = new();
    private HttpClient? _client;

    private HttpClient Client => _client ??= _host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
        s.AddKeyedSingleton<ISqlExecutor>(Controllers.TuPhotosController.ConsultancyKey, _consultancy))).CreateClient();

    public TuPhotosTests()
    {
        _consultancy.Status = 2;
        _consultancy.SignedIn = "DFO1";
        var folder = Path.Combine(_host.StorageRoot, "Photos", Zed, "TechnologyUpgradation");
        Directory.CreateDirectory(folder);
        File.WriteAllBytes(Path.Combine(folder, "doc1.pdf"), "%PDF-1.4"u8.ToArray());
        File.WriteAllBytes(Path.Combine(folder, "other.pdf"), "%PDF-1.4"u8.ToArray());
    }

    public void Dispose()
    {
        _client?.Dispose();
        _host.Dispose();
    }

    private Task<HttpResponseMessage> Get(string file, string zedId = Zed) => Client.GetAsync($"/photos/{zedId}/TechnologyUpgradation/{file}");

    [Fact]
    public async Task A_listed_document_is_served_while_the_signed_in_dfo_verifies()
    {
        var r = await Get("doc1.pdf");
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("application/pdf", r.Content.Headers.ContentType?.MediaType);

        Assert.Equal(HttpStatusCode.NotFound, (await Get("other.pdf")).StatusCode);       // in the folder, not a document of the application
        Assert.Equal(HttpStatusCode.NotFound, (await Get("..%2F..%2Fweb.config")).StatusCode);
        Assert.Equal(HttpStatusCode.NotFound, (await Get("doc1.pdf", "..")).StatusCode);

        _consultancy.SignedIn = "DFO2";                                                    // not the allotted DFO
        Assert.Equal(HttpStatusCode.NotFound, (await Get("doc1.pdf")).StatusCode);
        _consultancy.SignedIn = "DFO1";
        _consultancy.Status = 1;                                                           // not yet with the DFO
        Assert.Equal(HttpStatusCode.NotFound, (await Get("doc1.pdf")).StatusCode);
    }

    [Fact]
    public async Task The_consultancy_deployment_does_not_serve_it()
    {
        _host.Settings["Mobile:System"] = "Consultancy";
        Assert.Equal(HttpStatusCode.NotFound, (await Get("doc1.pdf")).StatusCode);
    }
}

/// <summary>ZED_CONSULTANT for <see cref="TuPhotosTests"/>: one Silver application with one document, and the DFO's app sign-in.</summary>
public sealed class TuConsultancySql : ISqlExecutor
{
    public int Status { get; set; }
    public string? SignedIn { get; set; }

    public Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default) => throw new NotSupportedException();

    public Task<ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default)
    {
        if (procedure != "SP_FINANCIAL_ASSISTANCE_GET_DETAILS" || FakeSql.Arg(parameters, "ZedId") != "ZEDMSME000900") return Task.FromResult(FakeSql.Sets());
        return Task.FromResult(FakeSql.Sets(
            [], [new { Id = 41, ZedId = "ZEDMSME000900", CertificationType = "Silver", VerificationStatus = Status, FinancialAssessorId = "DFO1" }], [],
            [], [new { Id = 7001, PhotoId = "doc1.pdf", PhotoType = "Copy of Invoice" }], []));
    }

    public Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default) => Task.FromResult(0);
    public Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default) => Task.FromResult(0);

    public Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default)
    {
        IReadOnlyList<T> none = [];
        if (!sql.Contains("dbo.V4AppSessions", StringComparison.Ordinal) || typeof(T) != typeof(DateTime)) return Task.FromResult(none);
        var ok = SignedIn is not null && FakeSql.Arg(parameters, "UserId") == SignedIn && FakeSql.Arg(parameters, "ZedId") == "ZEDMSME000900";
        return Task.FromResult<IReadOnlyList<T>>(ok ? [(T)(object)DateTime.UtcNow] : none);
    }
}
