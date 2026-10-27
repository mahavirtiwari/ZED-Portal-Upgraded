using System.Text.Json;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Zed.Core.Forms;

namespace Zed.Main.MobileApi.Tests;

/// <summary>The Admin's ESG checklist (dbo.V4EsgChecklist), in memory.</summary>
public sealed class FakeEsgChecklistStore : IEsgChecklistStore
{
    public EsgChecklistRow? Row { get; set; }
    public Task<EsgChecklistRow?> GetAsync(CancellationToken ct = default) => Task.FromResult(Row);
    public Task SaveAsync(string checklistJson, string userId, CancellationToken ct = default) => throw new NotSupportedException();
    public Task ResetAsync(CancellationToken ct = default) => throw new NotSupportedException();
}

/// <summary>GetEsgChecklist serves the Admin's checklist (Admin → ESG Checklist) ahead of the old file and the standard one.</summary>
public sealed class EsgChecklistAppTests : IDisposable
{
    private readonly MobileTestHost _host = new();
    private readonly FakeEsgChecklistStore _store = new();

    public void Dispose() => _host.Dispose();

    private HttpClient Client() => _host.WithWebHostBuilder(b => b.ConfigureTestServices(s =>
    {
        s.RemoveAll<IEsgChecklistStore>();
        s.AddSingleton<IEsgChecklistStore>(_store);
    })).CreateClient();

    [Fact]
    public async Task The_msme_app_gets_the_admins_checklist_in_the_old_format()
    {
        var own = new EsgChecklistDefinition([
            new EsgSection("Environment", [new EsgQuestion(1, "Do you treat effluents?", ["Yes", "No"], [new EsgFollowUp(23, "No", "Why not?", "text_box", [])])]),
            EsgChecklistFormat.Standard.Sections[1],
        ]);
        _store.Row = new EsgChecklistRow(2, EsgChecklistFormat.ToStore(own), "ADMIN1", null);
        var client = Client();

        var e = JsonDocument.Parse(await (await client.GetAsync("/Msme/GetEsgChecklist")).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("1.7.2", e.GetProperty("version").GetString());
        var section = e.GetProperty("sections")[0];
        Assert.Equal("Environment", section.GetProperty("section_title").GetString());
        var field = section.GetProperty("fields")[0];
        Assert.Equal(("1", "Do you treat effluents?"), (field.GetProperty("id").GetString(), field.GetProperty("question").GetString()));
        var dep = field.GetProperty("dependent_fields")[0];
        Assert.Equal(("23", "No", "text_box"), (dep.GetProperty("id").GetString(), dep.GetProperty("selected_option").GetString(), dep.GetProperty("type").GetString()));
    }

    [Fact]
    public async Task Without_one_the_standard_checklist_is_served()
    {
        var e = JsonDocument.Parse(await (await Client().GetAsync("/Msme/GetEsgChecklist")).Content.ReadAsStringAsync()).RootElement;
        Assert.Equal("1.7", e.GetProperty("version").GetString());
        Assert.Equal("ESG check list", e.GetProperty("sections")[0].GetProperty("section_title").GetString());
    }
}
