using System.Data.Common;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Runtime.CompilerServices;
using System.Text.Json;
using SkiaSharp;
using Zed.Core.Data;
using Zed.Portal.Features.CertLevels;
using Zed.Portal.Features.Documents;
using Zed.Portal.Features.Payments;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Fees;
using Zed.Portal.Features.Staff.Users;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// The level the Admin added in these tests: TITANIUM, a site level (registered for the whole test run, so every test sees
/// the same level list; "Platinum" stays the unknown level of the other tests).
/// </summary>
internal static class AddedLevel
{
    public const string Code = "TITANIUM";

    [ModuleInitializer]
    internal static void Register() => LevelRegistry.Register(new LevelRegistry.Entry(Code, "Titanium", false, "Site", 50, "6"));
}

/// <summary>Generic certification levels (2026-11-08): a level the Admin adds works as ZED-X does.</summary>
public sealed class GenericLevelsTests : IDisposable
{
    private const string Url = "/api/staff/settings/levels";
    private readonly TestHost _host = new();

    private static readonly CertificationLevel[] Stored =
    [
        new("Bronze", "Bronze", 10, null, null, null, true, "Desktop", 36, true, 15, "{DDMMYYYY}_{ZEDNO}", null, null, null),
        new("Silver", "Silver", 20, null, null, null, true, "Site", 36, true, 12, "{DDMMYYYY}_{ZEDNO}", null, null, null),
        new("Gold", "Gold", 30, null, null, null, true, "Site", 36, true, 12, "{DDMMYYYY}_{ZEDNO}", null, null, null),
        new("ZEDX", "ZED-X", 40, null, null, null, true, "Site", 36, true, 12, "{DDMMYYYY}_{ZEDNO}", null, null, null),
        new(AddedLevel.Code, "Titanium", 50, null, null, null, false, "Site", 36, true, 12, "{DDMMYYYY}_{ZEDNO}", null, null, null),
    ];

    public GenericLevelsTests()
    {
        UsersMastersLogin.Setup(_host);
        _host.Sql.Queries[CertificationLevels.Sql] = _ => Stored.Cast<object>().ToList();
    }

    public void Dispose() => _host.Dispose();

    private sealed class DdlRefused() : DbException("ALTER TABLE permission denied (229)");

    [Fact]
    public void A_new_level_is_accepted_where_the_fixed_lists_refused_it()
    {
        Assert.Equal(AddedLevel.Code, Certifications.CanonicalApplicable("TITANIUM"));
        Assert.Null(Certifications.CanonicalApplicable("Platinum"));
        Assert.True(Certifications.IsV4(AddedLevel.Code));
        Assert.False(Certifications.IsV4("Gold"));
        Assert.Equal(AddedLevel.Code, AssessmentInput.Level("titanium"));
        Assert.Equal(AddedLevel.Code, DocumentLevels.Level("Titanium"));
        Assert.Equal(AddedLevel.Code, DocumentLevels.SurveillanceLevel("TITANIUMSurveillance"));
        Assert.False(DocumentLevels.IsDesktop(AddedLevel.Code));
        Assert.Contains(AddedLevel.Code, AssessmentFeesController.Levels);
        Assert.Contains(AgencyLevels.All, l => l.Code == AddedLevel.Code && l.Column == "AllowTITANIUMAssessments" && l.ReasonColumn == "ReasonForBlockTITANIUM");
        Assert.Equal("AllowZedxAssessments", LevelRegistry.AgencyColumn("ZEDX"));

        // Paid / applied: as ZED-X, a recorded payment or a certification row of the level.
        Assert.Contains("Certification = 'TITANIUM'", Certifications.PaidSql(AddedLevel.Code));
        Assert.Contains("IsGoldPaymentDone", Certifications.PaidSql("Gold"));

        // The verification address names the level, and resolves it back.
        Assert.Equal("XC", VerifyController.CodeOf("ZEDX"));
        Assert.Equal("TITANIUM", VerifyController.CodeOf(AddedLevel.Code));
        Assert.Equal(AddedLevel.Code, VerifyController.TypeOf("titanium"));
        Assert.Equal("Gold", VerifyController.TypeOf("gc"));
        Assert.Null(VerifyController.TypeOf("Platinum"));
    }

    [Fact]
    public void Two_certifications_never_run_at_once_with_a_new_level_either()
    {
        Dictionary<string, int> S(params (string, int)[] s) => s.ToDictionary(x => x.Item1, x => x.Item2);
        Assert.Equal("Bronze", Certifications.BlockedBy(AddedLevel.Code, S(("Bronze", 3), ("Silver", 0), ("Gold", 0), ("ZEDX", 0), (AddedLevel.Code, 0))));
        Assert.Equal("ZEDX", Certifications.BlockedBy(AddedLevel.Code, S(("Bronze", 0), ("Silver", 0), ("Gold", 0), ("ZEDX", 9), (AddedLevel.Code, 0))));
        Assert.Equal(AddedLevel.Code, Certifications.BlockedBy("Silver", S(("Bronze", 0), ("Silver", 0), ("Gold", 0), ("ZEDX", 0), (AddedLevel.Code, 2))));
        Assert.Null(Certifications.BlockedBy(AddedLevel.Code, S(("Bronze", 6), ("Silver", 0), ("Gold", 0), ("ZEDX", 0), (AddedLevel.Code, 0))));
        // ZED-X as before.
        Assert.Equal("ZEDX", Certifications.BlockedBy("Gold", S(("Bronze", 0), ("Silver", 0), ("Gold", 0), ("ZEDX", 16))));
        Assert.Equal("Silver", Certifications.BlockedBy("ZEDX", S(("Bronze", 0), ("Silver", 12), ("Gold", 0), ("ZEDX", 0))));
    }

    [Fact]
    public void The_portal_adds_the_columns_of_a_new_level_on_both_databases()
    {
        var main = CertificationLevelsController.ColumnsDdl(AddedLevel.Code, Zed.Core.Http.PortalSystem.Main);
        Assert.Contains("ALTER TABLE dbo.Msme ADD [IsTITANIUMPaymentDone] bit NULL", main[0]);
        Assert.Contains("ALTER TABLE dbo.Msme ADD [IsSurTITANIUMPaymentDone] bit NULL", main[0]);
        Assert.Contains("ALTER TABLE dbo.Users ADD [AllowTITANIUMAssessments] bit NULL", main[0]);
        Assert.Contains("ALTER TABLE dbo.Users ADD [ReasonForBlockTITANIUM] nvarchar(2000) NULL", main[0]);
        Assert.Contains("ALTER TABLE ZED_SURVEILLANCE.dbo.Msme ADD [IsTITANIUMPaymentDone] bit NULL", main[1]);
        Assert.Throws<ArgumentException>(() => CertificationLevelsController.ColumnsDdl("X]; DROP TABLE Msme;--", Zed.Core.Http.PortalSystem.Main));
    }

    [Fact]
    public async Task The_checklist_shows_what_a_new_level_needs_and_enabling_waits_for_it()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        _host.Sql.Queries[CertificationLevelsController.ColumnsSql] = _ => [1];
        _host.Sql.Queries[CertificationLevelsController.AgenciesSql(AddedLevel.Code)] = _ => [2];

        var list = await admin.GetFromJsonAsync<JsonElement>(Url);
        var items = list.GetProperty("levels").EnumerateArray().ToList();
        var zedx = items.Single(i => i.GetProperty("level").GetProperty("code").GetString() == "ZEDX").GetProperty("readiness");
        Assert.True(zedx.GetProperty("questionnaire").GetBoolean() && zedx.GetProperty("fees").GetBoolean() && zedx.GetProperty("artwork").GetBoolean()
            && zedx.GetProperty("agencies").GetBoolean() && zedx.GetProperty("columns").GetBoolean());
        var titanium = items.Single(i => i.GetProperty("level").GetProperty("code").GetString() == AddedLevel.Code).GetProperty("readiness");
        Assert.False(titanium.GetProperty("questionnaire").GetBoolean());
        Assert.Equal(0, titanium.GetProperty("parameterCount").GetInt32());
        Assert.False(titanium.GetProperty("fees").GetBoolean());
        Assert.False(titanium.GetProperty("artwork").GetBoolean());
        Assert.True(titanium.GetProperty("agencies").GetBoolean());
        Assert.True(titanium.GetProperty("columns").GetBoolean());
        Assert.Equal(JsonValueKind.Null, titanium.GetProperty("columnsMessage").ValueKind);

        var refused = await admin.PutAsJsonAsync($"{Url}/{AddedLevel.Code}/enabled", new { enabled = true });
        Assert.Equal(HttpStatusCode.BadRequest, refused.StatusCode);
        var why = await refused.ProblemTitle();
        Assert.Contains("cannot be enabled yet", why);
        Assert.Contains("questionnaire", why);
        Assert.Contains("artwork", why);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == CertificationLevelsController.SwitchSql);

        // Questionnaire, fees and artwork in place: it can be enabled.
        _host.Sql.Queries[CertificationLevelsController.ParameterCountsSql] = _ => [new { Code = AddedLevel.Code, Count = 12 }];
        _host.Sql.Queries[CertificationLevelsController.FeesSql] = _ => new[] { "Micro", "Small", "Medium" }
            .Select(t => (object)new { Certification = AddedLevel.Code, Type = t, Total = 50000m }).ToList();
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"{Url}/{AddedLevel.Code}/artwork?kind=certificate", Png(CertificateSize()))).StatusCode);
        Assert.Equal(HttpStatusCode.OK, (await admin.PostAsync($"{Url}/{AddedLevel.Code}/artwork?kind=report", Png((400, 400)))).StatusCode);
        Assert.True(File.Exists(Path.Combine(_host.StorageRoot, "Uploads", "Levels", "Artwork", "TITANIUM_certificate.png")));
        Assert.Equal("image/png", (await admin.GetAsync($"{Url}/{AddedLevel.Code}/artwork?kind=report")).Content.Headers.ContentType?.MediaType);

        list = await admin.GetFromJsonAsync<JsonElement>(Url);
        titanium = list.GetProperty("levels").EnumerateArray().Single(i => i.GetProperty("level").GetProperty("code").GetString() == AddedLevel.Code).GetProperty("readiness");
        Assert.True(titanium.GetProperty("questionnaire").GetBoolean() && titanium.GetProperty("fees").GetBoolean() && titanium.GetProperty("artwork").GetBoolean());
        Assert.Equal(12, titanium.GetProperty("parameterCount").GetInt32());
        Assert.Equal(HttpStatusCode.OK, (await admin.PutAsJsonAsync($"{Url}/{AddedLevel.Code}/enabled", new { enabled = true })).StatusCode);
        Assert.Equal("True", FakeSql.Arg(Assert.Single(_host.Sql.Calls, c => c.Name == CertificationLevelsController.SwitchSql).Args, "Enabled"));
    }

    [Fact]
    public async Task A_certificate_background_must_have_the_size_of_the_built_in_ones()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var wrong = await admin.PostAsync($"{Url}/{AddedLevel.Code}/artwork?kind=certificate", Png((300, 400)));
        Assert.Equal(HttpStatusCode.BadRequest, wrong.StatusCode);
        Assert.Contains("pixels", await wrong.ProblemTitle());
        Assert.Contains("certificate or the report", await (await admin.PostAsync($"{Url}/{AddedLevel.Code}/artwork?kind=logo", Png((40, 40)))).ProblemTitle());
        // Bronze, Silver and Gold keep the portal's own artwork.
        Assert.Contains("own artwork", await (await admin.PostAsync($"{Url}/Gold/artwork?kind=report", Png((40, 40)))).ProblemTitle());
    }

    [Fact]
    public async Task A_level_is_added_disabled_even_when_the_portal_may_not_add_its_columns()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var ddl = CertificationLevelsController.ColumnsDdl("Copper2", Zed.Core.Http.PortalSystem.Main);
        foreach (var statement in ddl) _host.Sql.Procs[statement] = _ => throw new DdlRefused();
        var body = new
        {
            code = "Copper2", name = "Copper", description = "", comment = "", isEnabled = true, assessmentMode = "Desktop", validityMonths = 36,
            surveillanceEnabled = false, certNoFormat = "{DDMMYYYY}_{ZEDNO}", fee = 0,
        };
        var added = await admin.PostAsJsonAsync(Url, body);
        Assert.Equal(HttpStatusCode.OK, added.StatusCode);
        var message = await added.Content.ReadAsStringAsync();
        Assert.Contains("added (disabled)", message);
        Assert.Contains("ready after the next update", message);
        var insert = Assert.Single(_host.Sql.Calls, c => c.Name == CertificationLevelsController.InsertSql).Args;
        Assert.Equal(("Copper2", "False"), (FakeSql.Arg(insert, "Code"), FakeSql.Arg(insert, "IsEnabled")));
        Assert.Single(_host.Sql.Calls, c => c.Name == CertificationLevelsController.QrDigitSql);

        // The columns' check reads "not there": the checklist says when they come.
        var list = await admin.GetFromJsonAsync<JsonElement>(Url);
        var titanium = list.GetProperty("levels").EnumerateArray().Single(i => i.GetProperty("level").GetProperty("code").GetString() == AddedLevel.Code).GetProperty("readiness");
        Assert.False(titanium.GetProperty("columns").GetBoolean());
        Assert.False(titanium.GetProperty("agencies").GetBoolean());
        Assert.Equal(CertificationLevelsController.ColumnsPending, titanium.GetProperty("columnsMessage").GetString());
    }

    [Fact]
    public async Task Every_level_is_listed_for_the_staff_pages_disabled_ones_too()
    {
        var all = await (await _host.CreateBrowserAsync()).GetFromJsonAsync<JsonElement>("/api/public/levels/all");
        var codes = all.EnumerateArray().Select(l => l.GetProperty("code").GetString()).ToList();
        Assert.Equal(["Bronze", "Silver", "Gold", "ZEDX", AddedLevel.Code], codes);
        var titanium = all.EnumerateArray().Last();
        Assert.False(titanium.GetProperty("isEnabled").GetBoolean());
        Assert.Equal("Site", titanium.GetProperty("assessmentMode").GetString());
        Assert.Equal(50, titanium.GetProperty("orderNo").GetInt32());
        // The MSME list keeps the enabled levels only.
        var enabled = await (await _host.CreateBrowserAsync()).GetFromJsonAsync<JsonElement>("/api/public/levels");
        Assert.DoesNotContain(enabled.EnumerateArray(), l => l.GetProperty("code").GetString() == AddedLevel.Code);
    }

    private static (int Width, int Height) CertificateSize()
    {
        using var codec = SKCodec.Create(LevelArtwork.SizeReference(CertificationLevelsController.DocumentAssets, desktop: false));
        return (codec.Info.Width, codec.Info.Height);
    }

    private static MultipartFormDataContent Png((int Width, int Height) size)
    {
        using var bitmap = new SKBitmap(size.Width, size.Height);
        using (var canvas = new SKCanvas(bitmap)) canvas.Clear(SKColors.White);
        using var data = bitmap.Encode(SKEncodedImageFormat.Png, 100);
        return new MultipartFormDataContent
        {
            { new ByteArrayContent(data.ToArray()) { Headers = { ContentType = new MediaTypeHeaderValue("image/png") } }, "file", "artwork.png" },
        };
    }
}
