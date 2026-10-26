using Microsoft.Extensions.Logging.Abstractions;
using Microsoft.Extensions.Options;
using MimeKit;
using Zed.Core.Email;

namespace Zed.Main.Api.Tests;

/// <summary>The Admin's mail servers per module (Email Settings, dbo.V4SmtpServers) as the sender uses them.</summary>
public sealed class SmtpServersTests : IDisposable
{
    private readonly string pickup = Directory.CreateTempSubdirectory("zed-smtp-tests-").FullName;

    public void Dispose()
    {
        try { Directory.Delete(pickup, recursive: true); } catch (IOException) { }
    }

    private sealed class Rows(params SmtpServerRow[] rows) : ISmtpServers
    {
        public Task<IReadOnlyList<SmtpServerRow>> ListAsync(CancellationToken ct = default) => Task.FromResult<IReadOnlyList<SmtpServerRow>>(rows);
        public Task<SmtpProfile?> FindAsync(string profile, CancellationToken ct = default) => Task.FromResult(SqlSmtpServers.Resolve(rows, profile));
        public Task SaveAsync(SmtpServerRow row, string? newPassword, string userId, CancellationToken ct = default) => throw new NotSupportedException();
        public Task DeleteAsync(string module, CancellationToken ct = default) => throw new NotSupportedException();
    }

    /// <summary>A pickup folder, so the chosen server shows as the From of the written mail.</summary>
    private SmtpEmailSender Sender(ISmtpServers? servers) =>
        new(Options.Create(new EmailOptions
        {
            PickupDirectory = pickup,
            Profiles = new(StringComparer.OrdinalIgnoreCase)
            {
                [EmailProfiles.Default] = new() { Host = "smtp.file.test", From = "file-default@zed.test" },
                [EmailProfiles.Otp] = new() { Host = "smtp.file.test", From = "file-otp@zed.test" },
            },
        }), NullLogger<SmtpEmailSender>.Instance, servers);

    private async Task<string> FromOf(SmtpEmailSender sender, string profile)
    {
        foreach (var f in Directory.GetFiles(pickup)) File.Delete(f);
        await sender.SendAsync(new EmailMessage("unit@acme.example", "Hello", "<p>Hello</p>", profile));
        return MimeMessage.Load(Assert.Single(Directory.GetFiles(pickup))).From.Mailboxes.Single().Address;
    }

    private static SmtpServerRow Row(string module, string from) => new(module, "smtp.page.test", 587, true, from, null, null);

    [Fact]
    public async Task A_module_uses_its_own_server_then_the_pages_Default_then_the_server_file()
    {
        // Nothing on the page: the server file (its profile, else its Default).
        Assert.Equal("file-otp@zed.test", await FromOf(Sender(new Rows()), EmailProfiles.Otp));
        Assert.Equal("file-default@zed.test", await FromOf(Sender(null), EmailProfiles.Payment));

        var sender = Sender(new Rows(Row("Default", "page-default@zed.test"), Row("Payment", "page-payment@zed.test")));
        Assert.Equal("page-payment@zed.test", await FromOf(sender, EmailProfiles.Payment));
        // The page's Default comes before the server file's own profile of the module.
        Assert.Equal("page-default@zed.test", await FromOf(sender, EmailProfiles.Otp));
    }

    [Fact]
    public async Task A_server_chosen_by_the_caller_comes_first()
    {
        var sender = Sender(new Rows(Row("Default", "page-default@zed.test")));
        foreach (var f in Directory.GetFiles(pickup)) File.Delete(f);
        await sender.SendAsync(new EmailMessage("unit@acme.example", "Hello", "<p>Hello</p>", Server: new SmtpProfile { Host = "smtp.jobs.test", From = "jobs@zed.test" }));
        Assert.Equal("jobs@zed.test", MimeMessage.Load(Assert.Single(Directory.GetFiles(pickup))).From.Mailboxes.Single().Address);
    }

    [Fact]
    public void Passwords_are_encrypted_for_the_machine_and_a_foreign_one_is_refused_clearly()
    {
        var stored = SmtpSecret.Protect("Pass#Word1");
        Assert.StartsWith("dpapi1:", stored);
        Assert.Equal("Pass#Word1", SqlSmtpServers.Resolve([new SmtpServerRow("Default", "h", 587, true, "a@zed.test", "a@zed.test", stored)], "Otp")!.Password);
        Assert.Null(SmtpSecret.Unprotect(null, "Default"));
        var e = Assert.Throws<InvalidOperationException>(() => SmtpSecret.Unprotect("dpapi1:" + Convert.ToBase64String(new byte[64]), "Payment"));
        Assert.Contains("The mail password of the module Payment cannot be read on this server", e.Message);
    }
}
