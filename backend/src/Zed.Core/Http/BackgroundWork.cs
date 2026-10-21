using System.Threading.Channels;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace Zed.Core.Http;

/// <summary>
/// Work that must not delay the user's response (e.g. ERP postings after a payment). Items run one at a
/// time in a hosted service with their own DI scope; failures are logged. Work still queued when the
/// process stops is lost, so queued work must be re-runnable from the database (the ERP postings are:
/// SP_API_FINANCE_GET_ZEDIDS_PENDING lists what is missing).
/// </summary>
public interface IBackgroundWork
{
    void Enqueue(string name, Func<IServiceProvider, CancellationToken, Task> work);
}

public sealed class BackgroundWorkQueue(ILogger<BackgroundWorkQueue> log, IServiceScopeFactory scopes)
    : BackgroundService, IBackgroundWork
{
    private readonly Channel<(string Name, Func<IServiceProvider, CancellationToken, Task> Work)> _channel =
        Channel.CreateBounded<(string, Func<IServiceProvider, CancellationToken, Task>)>(new BoundedChannelOptions(1000) { FullMode = BoundedChannelFullMode.DropWrite });

    public void Enqueue(string name, Func<IServiceProvider, CancellationToken, Task> work)
    {
        if (!_channel.Writer.TryWrite((name, work)))
            log.LogError("Background queue full; dropped {Work}", name);
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        await foreach (var (name, work) in _channel.Reader.ReadAllAsync(stoppingToken))
        {
            try
            {
                await using var scope = scopes.CreateAsyncScope();
                await work(scope.ServiceProvider, stoppingToken);
            }
            catch (Exception ex) when (ex is not OperationCanceledException)
            {
                log.LogError(ex, "Background work {Work} failed", name);
            }
        }
    }
}
