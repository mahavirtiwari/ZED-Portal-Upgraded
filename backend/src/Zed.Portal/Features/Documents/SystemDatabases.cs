using Microsoft.Data.SqlClient;
using Zed.Core.Data;
using Zed.Core.Http;

namespace Zed.Portal.Features.Documents;

/// <summary>
/// The databases of the other systems, for documents that main serves to its MSMEs (surveillance reports and
/// certificates from ZED_SURVEILLANCE, handholding milestone reports from ZED_CONSULTANT). The old Certification
/// details page linked to those applications' public pages; V4 reads their procedures through a second,
/// read-only connection (<c>ConnectionStrings:Surveillance</c> / <c>ConnectionStrings:Consultancy</c> on the main host).
/// <para>
/// A keyed <see cref="ISqlExecutor"/> registered under the database name ("Surveillance", "Consultancy") wins over the
/// connection string (tests, or a host that wants to configure its own). On the system's own host its default
/// executor is used. Null when the database is not configured: the documents are then not available.
/// </para>
/// </summary>
public static class SystemDatabases
{
    public static ISqlExecutor? Open(IServiceProvider services, PortalSystem system)
    {
        var host = services.GetRequiredService<PortalHost>();
        if (host.System == system) return services.GetRequiredService<ISqlExecutor>();

        var name = new PortalHost(system).Database;
        if (services.GetKeyedService<ISqlExecutor>(name) is { } keyed) return new ReadOnlySqlExecutor(keyed);

        var cs = services.GetRequiredService<IConfiguration>().GetConnectionString(name);
        if (string.IsNullOrWhiteSpace(cs)) return null;
        // Read intent: the procedures used here only read; the login should only be granted EXECUTE on them.
        var builder = new SqlConnectionStringBuilder(cs) { ApplicationIntent = ApplicationIntent.ReadOnly };
        return new ReadOnlySqlExecutor(new SqlExecutor(builder.ConnectionString));
    }
}

/// <summary>An executor that refuses the write methods, so a document path can never change another system's data.</summary>
public sealed class ReadOnlySqlExecutor(ISqlExecutor inner) : ISqlExecutor
{
    public Task<IReadOnlyList<T>> QueryProcAsync<T>(string procedure, object? parameters = null, CancellationToken ct = default) =>
        inner.QueryProcAsync<T>(procedure, parameters, ct);

    public Task<ResultSets> QueryProcMultipleAsync(string procedure, object? parameters = null, CancellationToken ct = default) =>
        inner.QueryProcMultipleAsync(procedure, parameters, ct);

    public Task<IReadOnlyList<T>> QuerySqlAsync<T>(string sql, object? parameters = null, CancellationToken ct = default) =>
        inner.QuerySqlAsync<T>(sql, parameters, ct);

    public Task<int> ExecuteProcAsync(string procedure, object? parameters = null, CancellationToken ct = default) =>
        throw new InvalidOperationException($"{procedure} cannot run on a read-only connection.");

    public Task<int> ExecuteSqlAsync(string sql, object? parameters = null, CancellationToken ct = default) =>
        throw new InvalidOperationException("Statements cannot run on a read-only connection.");
}
