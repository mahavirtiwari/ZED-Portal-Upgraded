using System.Net;
using System.Net.Http.Json;
using Zed.Core.Forms;
using Zed.Core.Http;
using Zed.Portal.Features.Staff.Assessment;
using Zed.Portal.Features.Staff.Settings;

namespace Zed.Main.Api.Tests.Staff;

/// <summary>
/// V4 (migration 0080): Admin → App Forms → "Validation required", and the desktop assessor's check of such answers (Bronze:
/// its desktop final submit raises the NCs). The NC itself is raised by SP_ASSESSMENT_DA_FINAL_SUBMIT (tested on the
/// ZEDV4CHK_ databases); here: what the portal shows, stores and refuses.
/// </summary>
public sealed class AppFormValidationTests : IDisposable
{
    private const string Zed = "ZEDMSME000001";
    private const string Msme = AppFormCatalogue.MsmeBasicInfo;
    private const string Forms = "/api/staff/settings/app-forms";
    private const string Base = "/api/staff/assessment/da/ZEDMSME000001/Bronze";
    private readonly TestHost _host = new();
    private readonly List<AppFormFieldRow> _fields = [];
    private readonly List<AppFormCheckRow> _answers = [];
    private object _record = Record(status: 3);

    private static object Record(int status, int nc = 0, int nc1 = 0) => new
    {
        ZedId = Zed, Certification = "Bronze", CertificationStatus = status, NcCount = nc, NcStatus = 0, Nc1Status = nc1, Nc2Status = 0, Nc3Status = 0,
        Nc4Status = 0, Nc5Status = 0, DesktopAssessorId = "ASSESSOR1", DesktopAccepted = true, DesktopReasonForRejection = (string?)null,
        CertificationBodyUserId = "AGENCY1", SiteAssessorId = (string?)null, CoAssessorId = (string?)null,
    };

    public AppFormValidationTests()
    {
        DaTestUsers.Install(_host.Sql);
        UsersMastersLogin.Setup(_host);
        var q = _host.Sql.Queries;
        q[SqlAppFormStore.FieldsSql] = args => _fields.Where(r => r.FormKey == FakeSql.Arg(args, "FormKey")).ToList();
        q[AppFormChecks.RowsSql] = _ => _answers.ToList();
        q[AssessmentRecords.CertificationSql] = args => FakeSql.Arg(args, "ZedId") == Zed && FakeSql.Arg(args, "Certification") == "Bronze" ? [_record] : [];
        _host.Sql.Procs["SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = 1, ErrorMessage = "" }], [new { RaisedForNc = 0 }]);

        _fields.Add(new AppFormFieldRow(Msme, "cf_gst", true, "GST number", null, "text", true, true, 100, "basic", null, "ADMIN1", null, null, null, true));
        _fields.Add(new AppFormFieldRow(Msme, "cf_notes", true, "Notes", null, "text", false, true, 110, "basic", null, "ADMIN1", null));
        _answers.Add(new AppFormCheckRow { FormKey = Msme, FieldKey = "cf_gst", Value = "27AAACZ1234F1Z5" });
        _answers.Add(new AppFormCheckRow { FormKey = Msme, FieldKey = "cf_notes", Value = "none" });
    }

    public void Dispose() => _host.Dispose();

    private (string Name, object? Args) LastMerge() => _host.Sql.Calls.Last(c => c.Name.StartsWith("MERGE dbo.V4AppFormFields"));

    [Fact]
    public void Who_checks_is_where_the_NCs_are_raised()
    {
        Assert.Equal(AppFormStages.Desktop, AppFormStages.For("Bronze"));
        Assert.Equal(AppFormStages.Site, AppFormStages.For("Silver"));
        Assert.Equal(AppFormStages.Site, AppFormStages.For("Gold"));
        Assert.Equal(AppFormStages.Site, AppFormStages.For("ZEDX"));
        Assert.True(AppFormCatalogue.Find(PortalSystem.Main, Msme)!.CanValidate(PortalSystem.Main));
        Assert.False(AppFormCatalogue.Find(PortalSystem.Main, AppFormCatalogue.AssessorBasicInfo)!.CanValidate(PortalSystem.Main));
    }

    [Fact]
    public async Task The_Admin_marks_an_own_field_validation_required_and_sees_it()
    {
        var admin = await UsersMastersLogin.SignInAsync(_host, "ADMIN1");
        var form = (await admin.GetFromJsonAsync<AppFormsController.FormDetails>($"{Forms}/{Msme}"))!;
        Assert.True(form.CanValidate);
        Assert.True(form.Fields.Single(f => f.Key == "cf_gst").ValidationRequired);
        Assert.False(form.Fields.Single(f => f.Key == "cf_notes").ValidationRequired);

        var r = await admin.PutAsJsonAsync($"{Forms}/{Msme}/fields", new { key = "cf_notes", label = "Notes", type = "text", required = false, enabled = true, validationRequired = true });
        Assert.Equal(HttpStatusCode.OK, r.StatusCode);
        Assert.Equal("True", FakeSql.Arg(LastMerge().Args, "ValidationRequired"));

        // Standard fields: the assessor already checks them (Basic Info, products, site exterior).
        var standard = await admin.PutAsJsonAsync($"{Forms}/{Msme}/fields", new { key = "auditsConducted", label = "Audits?", required = true, enabled = true, validationRequired = true });
        Assert.Equal(HttpStatusCode.BadRequest, standard.StatusCode);

        // The site assessor's own form is not checked by anyone.
        var other = await admin.PostAsJsonAsync($"{Forms}/{AppFormCatalogue.AssessorBasicInfo}/fields", new { label = "X", type = "text", validationRequired = true });
        Assert.Equal(HttpStatusCode.BadRequest, other.StatusCode);
    }

    [Fact]
    public async Task The_desktop_assessor_sees_the_answers_to_check_and_final_submit_waits_for_them()
    {
        var client = await DaTestUsers.SignInAsync(_host, "ASSESSOR1");
        var checks = (await client.GetFromJsonAsync<DesktopAssessmentController.FormChecksResponse>(Base + "/form-checks"))!;
        Assert.True(checks.Applies);
        Assert.True(checks.CanCheck);
        var item = Assert.Single(checks.Items);
        Assert.Equal(("cf_gst", "27AAACZ1234F1Z5", (string?)null), (item.Key, item.Value, item.Status));

        var check = (await (await client.PostAsync(Base + "/final-submit/check", null)).Content.ReadFromJsonAsync<DesktopAssessmentController.FinalSubmitCheck>())!;
        Assert.False(check.Allowed);
        Assert.Contains("not checked 1 answer", check.Message);
    }

    [Fact]
    public async Task Not_valid_needs_a_remark_and_is_stored_for_this_round()
    {
        var client = await DaTestUsers.SignInAsync(_host, "ASSESSOR1");
        var bare = await client.PostAsJsonAsync(Base + "/form-checks", new { form = Msme, key = "cf_gst", status = "No" });
        Assert.Equal(HttpStatusCode.BadRequest, bare.StatusCode);
        Assert.DoesNotContain(_host.Sql.Calls, c => c.Name == AppFormChecks.CheckSql);

        var notMine = await client.PostAsJsonAsync(Base + "/form-checks", new { form = Msme, key = "cf_notes", status = "Yes" });
        Assert.Equal(HttpStatusCode.BadRequest, notMine.StatusCode);

        var ok = await client.PostAsJsonAsync(Base + "/form-checks", new { form = Msme, key = "cf_gst", status = "No", remarks = "Number does not match the certificate" });
        Assert.Equal(HttpStatusCode.OK, ok.StatusCode);
        var write = _host.Sql.Calls.Last(c => c.Name == AppFormChecks.CheckSql).Args;
        Assert.Equal(("No", "DA", "0", "cf_gst"), (FakeSql.Arg(write, "Status"), FakeSql.Arg(write, "Stage"), FakeSql.Arg(write, "Round"), FakeSql.Arg(write, "FieldKey")));
    }

    [Fact]
    public async Task A_not_valid_answer_lets_the_final_submit_raise_an_NC()
    {
        _answers[0] = _answers[0] with { ValidStatus = "No", ValidRemarks = "Wrong", ValidStage = "DA", ValidRound = 0 };
        var client = await DaTestUsers.SignInAsync(_host, "ASSESSOR1");
        var check = (await (await client.PostAsync(Base + "/final-submit/check", null)).Content.ReadFromJsonAsync<DesktopAssessmentController.FinalSubmitCheck>())!;
        Assert.True(check.Allowed);
        Assert.True(check.RaisesNc);
    }

    [Fact]
    public async Task In_an_NC_round_only_the_raised_answers_are_checked_again()
    {
        _record = Record(status: 4, nc: 1, nc1: 2);
        _answers[0] = _answers[0] with { Value = "27AAACZ9999F1Z5", NcRound = 1, NcValue = "27AAACZ1234F1Z5", NcRemarks = "Wrong", ValidStatus = "No", ValidStage = "DA", ValidRound = 0 };
        var client = await DaTestUsers.SignInAsync(_host, "ASSESSOR1");
        var checks = (await client.GetFromJsonAsync<DesktopAssessmentController.FormChecksResponse>(Base + "/form-checks"))!;
        Assert.True(checks.NcRound);
        var item = Assert.Single(checks.Items);
        Assert.Equal(("27AAACZ9999F1Z5", "27AAACZ1234F1Z5", "Wrong", (string?)null), (item.Value, item.PreviousValue, item.NcRemarks, item.Status));
    }

    [Fact]
    public async Task Other_users_cannot_check()
    {
        var agency = await DaTestUsers.SignInAsync(_host, "AGENCY1");
        var r = await agency.PostAsJsonAsync(Base + "/form-checks", new { form = Msme, key = "cf_gst", status = "Yes" });
        Assert.Equal(HttpStatusCode.Forbidden, r.StatusCode);
        var view = (await agency.GetFromJsonAsync<DesktopAssessmentController.FormChecksResponse>(Base + "/form-checks"))!;
        Assert.False(view.CanCheck);
    }
}
