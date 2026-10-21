using System.Collections.Concurrent;
using System.Data;
using System.Data.Common;
using System.Reflection;
using System.Text;
using System.Text.Json;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Core.Data;
using Zed.Main.MobileApi.Models.Assessor;

namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// <see cref="MobileTestHost"/> plus allotment rows for the assessor ownership query (FakeSql's
/// inline queries always return nothing) and procedures that fail like SQL Server does.
/// </summary>
public sealed class AssessorTestHost : IDisposable
{
    public MobileTestHost Host { get; } = new();
    public AllotmentSql Sql { get; }
    private WebApplicationFactory<Program>? _factory;
    private HttpClient? _client;

    public AssessorTestHost()
    {
        Sql = new AllotmentSql(Host.Sql);
    }

    public FakeSql Fake => Host.Sql;
    public FakeDevices Devices => Host.Devices;
    public string StorageRoot => Host.StorageRoot;
    public Dictionary<string, string?> Settings => Host.Settings;

    /// <summary>Created on first use, so tests can change <see cref="Settings"/> first.</summary>
    public HttpClient Client => _client ??= (_factory = Host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
    {
        s.RemoveAll<ISqlExecutor>();
        s.AddSingleton<ISqlExecutor>(Sql);
    }))).CreateClient();

    public async Task<(JsonElement Body, string ContentType, int Status)> Post(string path, object body)
    {
        var r = await Client.PostAsync(path, new StringContent(JsonSerializer.Serialize(body), Encoding.UTF8, "application/json"));
        var text = await r.Content.ReadAsStringAsync();
        return (JsonDocument.Parse(text).RootElement, r.Content.Headers.ContentType?.MediaType ?? "", (int)r.StatusCode);
    }

    public async Task<JsonElement> Json(string path, object body) => (await Post(path, body)).Body;

    public IEnumerable<(string Name, object? Args)> CallsTo(string name) =>
        Fake.Calls.Where(c => string.Equals(c.Name, name, StringComparison.OrdinalIgnoreCase));

    public object? LastArgs(string name) => CallsTo(name).Last().Args;

    public static string? Arg(object? args, string name) => FakeSql.Arg(args, name);

    /// <summary>Rows of a table-valued parameter passed through Dapper's DynamicParameters.</summary>
    public static DataTable? Tvp(object? args, string name)
    {
        if (args is not Dapper.DynamicParameters dp || !dp.ParameterNames.Contains(name)) return null;
        var tvp = dp.Get<object>(name);
        return tvp?.GetType().GetField("table", BindingFlags.NonPublic | BindingFlags.Instance)?.GetValue(tvp) as DataTable;
    }

    public string FileUnderRoot(params string[] parts) => Path.Combine([StorageRoot, .. parts]);

    public IEnumerable<string> AllFiles() =>
        Directory.Exists(StorageRoot) ? Directory.EnumerateFiles(StorageRoot, "*", SearchOption.AllDirectories) : [];

    public static string Base64(string text) => Convert.ToBase64String(Encoding.UTF8.GetBytes(text));

    public void Dispose()
    {
        _client?.Dispose();
        _factory?.Dispose();
        Host.Dispose();
    }
}

public sealed class FakeDbException(string message) : DbException(message);

/// <summary>FakeSql with answers for the assessor allotment query and procedures that throw.</summary>
public sealed class AllotmentSql(FakeSql inner) : ISqlExecutor
{
    /// <summary>(ZedId, Certification) to (lead, co).</summary>
    public ConcurrentDictionary<(string ZedId, string Cert), (string? Lead, string? Co)> Allotments { get; } = new();
    public ConcurrentDictionary<string, bool> Failing { get; } = new(StringComparer.OrdinalIgnoreCase);

    public void Allot(string zedId, string cert, string? lead, string? co = null) =>
        Allotments[(zedId.ToUpperInvariant(), cert.ToUpperInvariant())] = (lead, co);

    private void ThrowIfFailing(string name)
    {
        if (Failing.ContainsKey(name)) throw new FakeDbException("Could not find stored procedure '" + name + "'.");
    }

    public Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default) =>
        inner.QueryProcAsync<T>(procedure, parameters, ct);

    public Task<ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default)
    {
        ThrowIfFailing(procedure);
        return inner.QueryProcMultipleAsync(procedure, parameters, ct);
    }

    public Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default)
    {
        ThrowIfFailing(procedure);
        return inner.ExecuteProcAsync(procedure, parameters, ct);
    }

    public Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default) =>
        inner.ExecuteSqlAsync(sql, parameters, ct);

    public async Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default)
    {
        await inner.QuerySqlAsync<T>(sql, parameters, ct);
        if (typeof(T) != typeof(AssessorAllotment) || !sql.Contains("MsmeCertifications", StringComparison.Ordinal)) return [];
        var key = ((FakeSql.Arg(parameters, "ZedId") ?? "").ToUpperInvariant(), (FakeSql.Arg(parameters, "Certification") ?? "").ToUpperInvariant());
        if (!Allotments.TryGetValue(key, out var a)) return [];
        return (IReadOnlyList<T>)(object)new List<AssessorAllotment> { new() { SiteAssessorId = a.Lead, CoAssessorId = a.Co } };
    }
}
