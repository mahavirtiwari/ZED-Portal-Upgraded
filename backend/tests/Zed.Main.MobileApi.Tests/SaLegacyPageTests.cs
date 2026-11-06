namespace Zed.Main.MobileApi.Tests;

/// <summary>
/// The four hotel self-assessment actions (registration number, no identity) were removed before go-live
/// (SECURITY-FINDINGS #49): their addresses answer 404 and touch no procedure.
/// </summary>
public sealed class SaLegacyPageTests : IDisposable
{
    private readonly AssessorTestHost _t = new();

    public void Dispose() => _t.Dispose();

    [Theory]
    [InlineData("/SA/GetSiteAssessmentDetails")]
    [InlineData("/SA/UpdateSaDeclaration")]
    [InlineData("/SA/SubmitSaReg")]
    [InlineData("/SA/GetAmounts")]
    public async Task The_hotel_actions_are_gone(string path)
    {
        var r = await _t.Client.PostAsync(path, new StringContent("{\"registrationNo\":\"UC1\"}", System.Text.Encoding.UTF8, "application/json"));
        Assert.Equal(System.Net.HttpStatusCode.NotFound, r.StatusCode);
        Assert.DoesNotContain(_t.Host.Sql.Calls, c => c.Name.StartsWith("SP_SA_", StringComparison.Ordinal));
    }
}
