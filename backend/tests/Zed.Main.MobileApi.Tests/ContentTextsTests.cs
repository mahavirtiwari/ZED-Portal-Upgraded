using System.Text.Json;
using Zed.Core.Content;
using Zed.Core.Http;

namespace Zed.Main.MobileApi.Tests;

/// <summary>Content/Texts (new in V4): the apps' texts of the host's system, as the Admin set them.</summary>
public sealed class ContentTextsTests
{
    private static async Task<JsonElement> TextsAsync(string? system, HttpMethod method)
    {
        using var host = new MobileTestHost();
        if (system is not null) host.Settings["Mobile:System"] = system;
        var response = await host.CreateClient().SendAsync(new HttpRequestMessage(method, "/Content/Texts"));
        response.EnsureSuccessStatusCode();
        return JsonDocument.Parse(await response.Content.ReadAsStringAsync()).RootElement;
    }

    private static List<string> Keys(JsonElement body) => body.GetProperty("texts").EnumerateArray().Select(t => t.GetProperty("key").GetString()!).ToList();

    private static IEnumerable<string> AppKeys(PortalSystem system) =>
        ContentCatalogue.For(system).Where(b => b.Channel == ContentChannel.App).Select(b => b.Key);

    [Fact]
    public async Task The_main_host_returns_the_app_texts_of_main_with_the_standard_wording()
    {
        var body = await TextsAsync(null, HttpMethod.Get);
        Assert.Equal("1", body.GetProperty("status").GetString());
        Assert.Equal(AppKeys(PortalSystem.Main), Keys(body));
        Assert.DoesNotContain(Keys(body), k => !k.StartsWith("app.") || k.StartsWith("app.consultant."));

        var success = body.GetProperty("texts").EnumerateArray().Single(t => t.GetProperty("key").GetString() == "app.msme.payment.success");
        Assert.True(success.GetProperty("enabled").GetBoolean());
        Assert.Contains("{{Certification}}", success.GetProperty("html").GetString());
    }

    [Fact]
    public async Task The_consultancy_and_surveillance_hosts_return_their_own_app_texts()
    {
        var consultancy = Keys(await TextsAsync("Consultancy", HttpMethod.Post));
        Assert.Equal(AppKeys(PortalSystem.Consultancy), consultancy);
        Assert.NotEmpty(consultancy);
        Assert.All(consultancy, k => Assert.StartsWith("app.consultant.", k));

        var surveillance = Keys(await TextsAsync("Surveillance", HttpMethod.Get));
        Assert.Equal(AppKeys(PortalSystem.Surveillance), surveillance);
        Assert.Contains("app.msme.certification.payment.disclaimer", surveillance);
        Assert.DoesNotContain("app.msme.registration.pledge", surveillance);
    }
}
