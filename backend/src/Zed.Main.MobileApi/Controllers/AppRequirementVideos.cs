using Microsoft.Extensions.Logging;
using Zed.Core.Assessment;
using Zed.Core.Data;
using AssessorModels = Zed.Main.MobileApi.Models.Assessor;
using ConsultancyModels = Zed.Main.MobileApi.Models.Consultancy;
using MsmeModels = Zed.Main.MobileApi.Models;

namespace Zed.Main.MobileApi.Controllers;

/// <summary>
/// The Admin's requirement videos (Questionnaire → Requirements, 2026-11-08) on the apps' requirement lists: the ZED MSME and
/// surveillance MSME apps (videoUrl on each requirement of GetParametersByType / GetNcDetailsByType), the assessor app and
/// the consultant app (SA/Login). Apps that do not know the field ignore it.
/// </summary>
internal static class AppRequirementVideos
{
    /// <summary>"BronzeSurveillance" and the like: the level's own questionnaire.</summary>
    public static string? Level(string? certification) =>
        certification?.Replace("Surveillance", "", StringComparison.OrdinalIgnoreCase).Trim();

    public static async Task FillAsync(ISqlExecutor db, string master, string? certification, IEnumerable<MsmeModels.ParameterDetails>? parameters, ILogger? log, CancellationToken ct)
    {
        if (parameters is null) return;
        var videos = await RequirementVideos.LoadAsync(db, master, Level(certification), log, ct);
        if (videos.Count == 0) return;
        foreach (var p in parameters)
            foreach (var r in p.requirements ?? [])
                r.videoUrl = videos.For(p.code, r.code);
    }

    public static async Task FillAsync(ISqlExecutor db, string master, string? certification, IEnumerable<AssessorModels.AllottedParameters>? parameters, ILogger? log, CancellationToken ct)
    {
        if (parameters is null) return;
        var videos = await RequirementVideos.LoadAsync(db, master, Level(certification), log, ct);
        if (videos.Count == 0) return;
        foreach (var p in parameters)
            foreach (var r in p.requirements ?? [])
                r.videoUrl = videos.For(p.parameterCode, r.code);
    }

    public static async Task FillAsync(ISqlExecutor db, string master, string? certification, IEnumerable<ConsultancyModels.AllottedParameters>? parameters, ILogger? log, CancellationToken ct)
    {
        if (parameters is null) return;
        var videos = await RequirementVideos.LoadAsync(db, master, Level(certification), log, ct);
        if (videos.Count == 0) return;
        foreach (var p in parameters)
            foreach (var r in p.requirements ?? [])
                r.videoUrl = videos.For(p.parameterCode, r.code);
    }
}
