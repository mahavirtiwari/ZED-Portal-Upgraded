using Zed.Core.Forms;

namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// V4 (migration 0080): NCs on the Admin's "Validation required" Basic Information fields: listed with the NC details,
/// answered with SubmitNcFormField while the NC is open, and the NC is not closed while one is unanswered.
/// </summary>
public sealed class MsmeAppNcFormFieldTests : MsmeAppTestBase
{
    private const string Form = AppFormCatalogue.MsmeBasicInfo;
    private readonly List<AppFormCheckRow> _answers = [];

    public MsmeAppNcFormFieldTests()
    {
        Host.Sql.Queries[SqlAppFormStore.FieldsSql] = _ =>
            [new AppFormFieldRow(Form, "cf_staff", true, "Number of staff", null, "number", true, true, 100, "basic", null, "ADMIN1", null, null, null, true),
             new AppFormFieldRow(Form, "cf_sources", true, "Sources", null, "checkboxes", true, true, 110, "basic", """["Solar","Wind"]""", "ADMIN1", null)];
        Host.Sql.Queries[AppFormChecks.RowsSql] = _ => _answers.Cast<object?>().ToList();
        Host.Sql.Procs["SP_APP_MSME_GET_NC_DETAILS_BY_TYPE"] = _ => FakeSql.Sets([], [], [], [], [], []);
        _answers.Add(new AppFormCheckRow { FormKey = Form, FieldKey = "cf_staff", Value = "12", NcRound = 1, NcValue = "12", NcRemarks = "Register shows 40" });
    }

    private static string Body(string key, string value) =>
        $$"""{"userName":"{{ZedId}}","certificationType":"Bronze","form":"msme.basicInfo","key":"{{key}}","value":{{value}}}""";

    [Fact]
    public async Task The_nc_details_list_the_fields_found_not_valid_in_that_round()
    {
        var e = await Post("/Msme/GetNcDetailsByType", Json($$"""{"userName":"{{ZedId}}","certificationType":"Bronze","ncCount":"1"}"""));
        var f = e.GetProperty("formFields")[0];
        Assert.Equal(("cf_staff", "Number of staff", "number"), (f.GetProperty("key").GetString(), f.GetProperty("label").GetString(), f.GetProperty("type").GetString()));
        Assert.Equal(("Register shows 40", "12"), (f.GetProperty("assessorRemarks").GetString(), f.GetProperty("previousValue").GetString()));
        Assert.False(f.GetProperty("answered").GetBoolean());

        var other = await Post("/Msme/GetNcDetailsByType", Json($$"""{"userName":"{{ZedId}}","certificationType":"Bronze","ncCount":"2"}"""));
        Assert.Equal(0, other.GetProperty("formFields").GetArrayLength());
    }

    [Fact]
    public async Task The_answer_is_checked_and_stored_while_the_nc_is_open()
    {
        await UseAppTokenAsync();   // 2026-11-27: a call new in V4 (TokenRequired)
        Stage("Bronze", 2, ncCount: 1, ncStatus: 1);
        AssertFail(await Post("/Msme/SubmitNcFormField", Json(Body("cf_staff", "\"forty\""))), "Number of staff: please enter a whole number.");
        AssertOk(await Post("/Msme/SubmitNcFormField", Json(Body("cf_staff", "40"))));
        var write = Host.Sql.Calls.Last(c => c.Name == AppFormChecks.AnswerSql).Args;
        Assert.Equal(("40", "cf_staff", "1"), (FakeSql.Arg(write, "Value"), FakeSql.Arg(write, "FieldKey"), FakeSql.Arg(write, "NcRound")));

        // Not an NC of this round.
        AssertFail(await Post("/Msme/SubmitNcFormField", Json(Body("cf_sources", "[\"Solar\"]"))), "This non-conformance is not open. Please refresh.");
    }

    [Fact]
    public async Task The_answer_is_refused_when_the_nc_is_not_open()
    {
        await UseAppTokenAsync();   // 2026-11-27: a call new in V4 (TokenRequired)
        Stage("Bronze", 2, ncCount: 1, ncStatus: 2);
        AssertFail(await Post("/Msme/SubmitNcFormField", Json(Body("cf_staff", "40"))), "Invalid Details.");
        Assert.DoesNotContain(Host.Sql.Calls, c => c.Name == AppFormChecks.AnswerSql);
    }

    [Fact]
    public async Task The_nc_is_not_closed_while_a_field_is_unanswered()
    {
        Stage("Bronze", 2, ncCount: 1, ncStatus: 1);
        Host.Sql.Procs["SP_APP_CHECK_DATA_SYNC_FINAL_SUBMIT"] = _ => FakeSql.Sets([new { AllowFinalSubmit = "1", ErrorMessage = "" }]);
        var e = await Post("/Msme/FinalSubmit", Json($$"""{"userName":"{{ZedId}}","certificationType":"Bronze"}"""));
        AssertFail(e, "Please answer the non-conformance under Basic Information before you close the non-conformances.");
        Assert.Empty(CallsTo("SP_APP_MSME_FINAL_SUBMIT"));
    }
}
