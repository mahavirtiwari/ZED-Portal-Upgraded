using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MimeKit;
using Zed.Core.Email;

namespace Zed.Main.Api.Tests;

/// <summary>Email:RedirectAllTo and Email:AllowedRecipientDomains: staging on a copy of production data mails no real people.</summary>
public sealed class StagingMailTests : IDisposable
{
    private readonly string pickup = Directory.CreateTempSubdirectory("zed-mail-tests-").FullName;

    public void Dispose()
    {
        try { Directory.Delete(pickup, recursive: true); } catch (IOException) { }
    }

    private SmtpEmailSender Sender(string? redirect = null, string? domains = null, string? label = null) =>
        new(Options.Create(new EmailOptions { PickupDirectory = pickup, RedirectAllTo = redirect, AllowedRecipientDomains = domains }),
            NullLogger<SmtpEmailSender>.Instance,
            new ConfigurationBuilder().AddInMemoryCollection(new Dictionary<string, string?> { ["Portal:EnvironmentLabel"] = label }).Build());

    private MimeMessage[] Written() =>
        Directory.GetFiles(pickup, "*.eml").Select(f => MimeMessage.Load(f)).ToArray();

    private static EmailMessage Message() => new("unit@acme.example;owner@acme.example", "Allotment details", "<p>Hello</p>",
        Cc: ["agency@qcin.org"], Bcc: ["office@zed.org.in"]);

    [Fact]
    public async Task Without_the_settings_mail_is_unchanged()
    {
        await Sender().SendAsync(Message());
        var m = Assert.Single(Written());
        Assert.Equal(["unit@acme.example", "owner@acme.example"], m.To.Mailboxes.Select(a => a.Address));
        Assert.Equal("Allotment details", m.Subject);
        Assert.Null(m.Headers["X-Zed-Original-To"]);
        Assert.DoesNotContain("Test environment", m.HtmlBody);
    }

    [Fact]
    public async Task RedirectAllTo_sends_everything_to_the_testers_and_names_the_original_recipients()
    {
        await Sender(redirect: "testers@qcin.org; lead@qcin.org", label: "STAGING").SendAsync(Message());
        var m = Assert.Single(Written());
        Assert.Equal(["testers@qcin.org", "lead@qcin.org"], m.To.Mailboxes.Select(a => a.Address));
        Assert.Empty(m.Cc);
        Assert.Empty(m.Bcc);
        Assert.Equal("[STAGING] Allotment details", m.Subject);
        Assert.Equal("unit@acme.example, owner@acme.example", m.Headers["X-Zed-Original-To"]);
        Assert.Equal("agency@qcin.org", m.Headers["X-Zed-Original-Cc"]);
        Assert.Equal("office@zed.org.in", m.Headers["X-Zed-Original-Bcc"]);
        Assert.StartsWith("<div", m.HtmlBody);
        Assert.Contains("Original To: unit@acme.example, owner@acme.example", m.HtmlBody);
        Assert.Contains("<p>Hello</p>", m.HtmlBody);
    }

    [Fact]
    public async Task AllowedRecipientDomains_drops_outsiders_and_keeps_the_rest()
    {
        await Sender(domains: "qcin.org, zed.org.in").SendAsync(Message());
        var m = Assert.Single(Written());
        // No To left in the domains: the allowed Cc/Bcc recipients receive it.
        Assert.Equal(["agency@qcin.org", "office@zed.org.in"], m.To.Mailboxes.Select(a => a.Address));
        Assert.Equal("[STAGING] Allotment details", m.Subject);
        Assert.Contains("only to the allowed domains", m.HtmlBody);
        Assert.Contains("unit@acme.example", m.Headers["X-Zed-Original-To"]);
    }

    [Fact]
    public async Task Allowed_recipients_keep_their_places_and_subdomains_count()
    {
        await Sender(domains: "qcin.org").SendAsync(new EmailMessage("tester@mail.qcin.org;unit@acme.example", "S", "B", Cc: ["cc@qcin.org"]));
        var m = Assert.Single(Written());
        Assert.Equal(["tester@mail.qcin.org"], m.To.Mailboxes.Select(a => a.Address));
        Assert.Equal(["cc@qcin.org"], m.Cc.Mailboxes.Select(a => a.Address));
    }

    [Fact]
    public async Task Nobody_left_is_redirected_or_skipped()
    {
        await Sender(domains: "qcin.org").SendAsync(new EmailMessage("unit@acme.example", "S", "B"));
        Assert.Empty(Written());

        await Sender(redirect: "testers@qcin.org", domains: "qcin.org").SendAsync(new EmailMessage("unit@acme.example", "S", "B"));
        var m = Assert.Single(Written());
        Assert.Equal("testers@qcin.org", m.To.Mailboxes.Single().Address);
        Assert.Contains("redirected (no recipient in the allowed domains)", m.HtmlBody);
    }

    [Fact]
    public async Task The_subject_prefix_follows_the_label_and_is_not_doubled()
    {
        await Sender(redirect: "t@qcin.org", label: "UAT").SendAsync(new EmailMessage("u@acme.example", "[UAT] Again", "B"));
        Assert.Equal("[UAT] Again", Assert.Single(Written()).Subject);
    }
}
