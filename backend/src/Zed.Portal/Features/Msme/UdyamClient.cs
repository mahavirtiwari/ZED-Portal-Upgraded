using System.Data;
using System.Xml;
using Microsoft.Extensions.Options;

namespace Zed.Portal.Features.Msme;

public sealed class UdyamOptions
{
    public const string Section = "Udyam";

    public string BaseUrl { get; set; } = "https://udyogaadhaar.gov.in/sv/UAMRestServiceAssist.svc/";
    /// <summary>Access key appended to each call (was hard-coded in MsmeController). Keep out of source control.</summary>
    public string AccessKey { get; set; } = "";
    /// <summary>The legacy code turned TLS certificate checks off for this service. Leave false unless the service's certificate is broken.</summary>
    public bool AllowInvalidCertificate { get; set; }
    /// <summary>Development only: return a fixed sample record instead of calling the Ministry service.</summary>
    public bool UseSampleData { get; set; }
}

/// <summary>Udyam record as returned by the Ministry service: BasicDetail (one row), Plant rows, Activities rows.</summary>
public sealed record UdyamLookup(
    Dictionary<string, string> BasicDetails,
    List<Dictionary<string, string>> Plants,
    List<Dictionary<string, string>> Activities);

public interface IUdyamClient
{
    Task<UdyamLookup> GetUdyamAsync(string registrationNo, string mobileNo, CancellationToken ct = default);
}

public sealed class UdyamClient(HttpClient http, IOptions<UdyamOptions> options) : IUdyamClient
{
    public async Task<UdyamLookup> GetUdyamAsync(string registrationNo, string mobileNo, CancellationToken ct = default)
    {
        var o = options.Value;
        if (string.IsNullOrEmpty(o.AccessKey))
            throw new InvalidOperationException("Udyam:AccessKey is not configured.");

        await using var stream = await http.GetStreamAsync(new Uri(new Uri(o.BaseUrl), BuildPath(registrationNo, mobileNo, o.AccessKey)), ct);
        return Parse(stream);
    }

    /// <summary>
    /// GetUdyam/{registration},{mobile},{key}, as the legacy MsmeController built it. The typed values are escaped; the
    /// configured key is sent as it is (its base64 '=' and '+' unescaped, as the service has always received them), with
    /// only the characters that would break the path escaped.
    /// </summary>
    public static string BuildPath(string registrationNo, string mobileNo, string accessKey)
    {
        var key = accessKey.Replace("%", "%25").Replace("/", "%2F").Replace("?", "%3F").Replace("#", "%23").Replace(" ", "%20");
        return "GetUdyam/" + Uri.EscapeDataString(registrationNo) + "," + Uri.EscapeDataString(mobileNo) + "," + key;
    }

    /// <summary>
    /// Same interpretation as the legacy code (DataSet.ReadXml with schema inference), so the
    /// table and column names the front end relies on are unchanged.
    /// </summary>
    public static UdyamLookup Parse(Stream xml)
    {
        var ds = new DataSet();
        using (var reader = XmlReader.Create(xml, new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null }))
            ds.ReadXml(reader);

        List<Dictionary<string, string>> Table(string name) =>
            ds.Tables.Contains(name)
                ? ds.Tables[name]!.Rows.Cast<DataRow>().Select(r => r.Table.Columns.Cast<DataColumn>()
                    .ToDictionary(c => c.ColumnName, c => r[c] is DBNull ? "" : r[c].ToString() ?? "")).ToList()
                : [];

        return new UdyamLookup(Table("BasicDetail").FirstOrDefault() ?? [], Table("Plant"), Table("Activities"));
    }
}

/// <summary>Fixed Udyam record for local development, where the Ministry service is not reachable.</summary>
public sealed class SampleUdyamClient : IUdyamClient
{
    public Task<UdyamLookup> GetUdyamAsync(string registrationNo, string mobileNo, CancellationToken ct = default) =>
        Task.FromResult(new UdyamLookup(
            new()
            {
                ["UdyogAadharNo"] = registrationNo, ["EnterpriseName"] = "SAMPLE PRECISION CASTINGS PVT LTD", ["OwnerName"] = "SAMPLE OWNER",
                ["EnterpriseType"] = "Micro", ["Gender"] = "Male", ["SocialCategory"] = "General", ["MobileNo"] = mobileNo,
                ["EmailId"] = "sample@example.test", ["State_Id"] = "9", ["state_name"] = "UTTAR PRADESH", ["District_Id"] = "160", ["DISTRICT_NAME"] = "KANPUR NAGAR",
            },
            [
                new() { ["PlantIdNo"] = "1", ["UnitName"] = "SAMPLE UNIT 1", ["PAddress"] = "Plot 4, Sector 7, Industrial Area Phase II", ["DISTRICT_NAME"] = "KANPUR NAGAR", ["state_name"] = "UTTAR PRADESH", ["PPin"] = "208022" },
                new() { ["PlantIdNo"] = "2", ["UnitName"] = "SAMPLE UNIT 2", ["PFlat"] = "12", ["PBuilding"] = "Udyog Bhawan", ["PRoad"] = "GT Road", ["PCity"] = "Kanpur", ["DISTRICT_NAME"] = "KANPUR NAGAR", ["state_name"] = "UTTAR PRADESH", ["PPin"] = "208001" },
            ],
            [
                new() { ["Activity"] = "Manufacturing", ["Two_DigitActivity"] = "24 - Manufacture of basic metals", ["Four_DigitActivity"] = "2431 - Casting of iron and steel", ["Five_DigitActivity"] = "24311 - Casting of iron" },
            ]));
}
