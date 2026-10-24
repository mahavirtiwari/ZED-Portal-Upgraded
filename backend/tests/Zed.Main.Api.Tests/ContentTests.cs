using System.Net.Http.Json;
using System.Text.RegularExpressions;
using Zed.Core.Content;
using Zed.Core.Email;
using Zed.Core.Http;

namespace Zed.Main.Api.Tests;

/// <summary>The catalogue of the Admin's Texts and api/content (the web pages' texts).</summary>
public sealed partial class ContentTests : IDisposable
{
    private readonly TestHost _host = new();

    public void Dispose() => _host.Dispose();

    private void Stored(params ContentBlockOverride[] rows) =>
        _host.Sql.Queries["SELECT BlockKey, Enabled, BodyHtml, UpdatedBy, UpdatedOn FROM dbo.V4ContentBlocks"] = _ => rows;

    [Fact]
    public void Every_key_is_unique_and_every_field_of_a_standard_text_is_declared()
    {
        var blocks = ContentCatalogue.Blocks;
        Assert.NotEmpty(blocks);
        Assert.Empty(blocks.GroupBy(b => b.Key, StringComparer.OrdinalIgnoreCase).Where(g => g.Count() > 1).Select(g => g.Key));
        foreach (var b in blocks)
        {
            Assert.Matches(KeyPattern(), b.Key);
            Assert.False(string.IsNullOrWhiteSpace(b.Name), b.Key);
            Assert.False(string.IsNullOrWhiteSpace(b.Group), b.Key);
            Assert.NotEmpty(b.Systems);
            Assert.False(string.IsNullOrWhiteSpace(b.DefaultHtml), b.Key);
            Assert.True(b.Key.StartsWith("app.") == (b.Channel == ContentChannel.App), b.Key);
            Assert.Empty(ContentTexts.UnknownPlaceholders(b, b.DefaultHtml));
            // A declared field is used by the standard text (the page or the app fills it in).
            Assert.All(b.Placeholders, p => Assert.Contains(p, EmailPlaceholders.Used(b.DefaultHtml), StringComparer.OrdinalIgnoreCase));
            Assert.DoesNotMatch(ScriptPattern(), b.DefaultHtml);
        }
    }

    [Fact]
    public void The_msme_pages_are_texts_of_the_main_build_only()
    {
        // The consultancy and surveillance builds are staff-only.
        Assert.All(ContentCatalogue.Blocks.Where(b => b.Channel == ContentChannel.Web && !b.Key.StartsWith("staff.")),
            b => Assert.Equal(new[] { PortalSystem.Main }, b.Systems));
    }

    [Fact]
    public async Task Api_content_returns_the_web_texts_of_this_portal_for_everyone()
    {
        var texts = (await (await _host.CreateBrowserAsync()).GetFromJsonAsync<List<ContentText>>("/api/content"))!;

        Assert.Equal(ContentCatalogue.For(PortalSystem.Main).Where(b => b.Channel == ContentChannel.Web).Select(b => b.Key), texts.Select(t => t.Key));
        Assert.DoesNotContain(texts, t => t.Key.StartsWith("app."));
        Assert.DoesNotContain(texts, t => t.Key is "staff.surveillance.remote.instructions" or "staff.consultancy.milestone.review.checkbox");
        Assert.Contains(texts, t => t.Key == "staff.assessment.desktop.fairConfirm.checkbox");
        var pledge = texts.Single(t => t.Key == "msme.registration.pledge");
        Assert.True(pledge.Enabled);
        Assert.Contains("<p>every way we can, to our people, our community and to our planet.</p>", pledge.Html);
    }

    [Fact]
    public async Task Api_content_shows_the_Admins_text_and_switches_a_hidden_one_off()
    {
        var updated = new DateTime(2026, 10, 1);
        Stored(new ContentBlockOverride("msme.registration.pledge", true, "<p>Our pledge</p>", "ADMIN1", updated),
            new ContentBlockOverride("msme.login.newUserEligibility", false, "<p>Not shown</p>", "ADMIN1", updated),
            new ContentBlockOverride("msme.registration.welcome", true, null, "ADMIN1", updated));
        var texts = (await (await _host.CreateBrowserAsync()).GetFromJsonAsync<List<ContentText>>("/api/content"))!.ToDictionary(t => t.Key);

        Assert.Equal("<p>Our pledge</p>", texts["msme.registration.pledge"].Html);
        Assert.False(texts["msme.login.newUserEligibility"].Enabled);
        Assert.Equal(ContentCatalogue.Find(PortalSystem.Main, "msme.registration.welcome")!.DefaultHtml, texts["msme.registration.welcome"].Html);
    }

    [GeneratedRegex(@"^(msme|public|staff|app)\.[A-Za-z0-9.]+$")] private static partial Regex KeyPattern();

    [GeneratedRegex(@"<\s*(script|iframe|object|embed)|javascript:|\son[a-z]+\s*=", RegexOptions.IgnoreCase)] private static partial Regex ScriptPattern();
}
