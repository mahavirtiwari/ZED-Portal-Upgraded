using System.Globalization;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;
using Microsoft.Extensions.Logging;
using Microsoft.Extensions.Options;
using Zed.Core.Data;

namespace Zed.Core.Finance;

/// <summary>
/// QCI's Microsoft Dynamics 365 Business Central (ERP). After a payment the portal posts the customer,
/// invoice and receipt there. Port of Helpers/ErpIntegrationService.cs, whose tenant, client id and
/// client secret were hard-coded; they are configuration here.
/// </summary>
public sealed class ErpOptions
{
    public const string Section = "Erp";

    /// <summary>Off by default so development and test environments never post to the ERP.</summary>
    public bool Enabled { get; set; }
    public string TenantId { get; set; } = "";
    public string ClientId { get; set; } = "";
    /// <summary>Secret. The value in the old source code must be rotated.</summary>
    public string ClientSecret { get; set; } = "";
    public string Scope { get; set; } = "https://api.businesscentral.dynamics.com/.default";
    /// <summary>e.g. https://api.businesscentral.dynamics.com/v2.0/{tenant}/Production/ODataV4/Company('Quality%20Council%20of%20India.')/</summary>
    public string CompanyBaseUrl { get; set; } = "";
    public string CustomerEndpoint { get; set; } = "Import_Customer_Data_Excel";
    public string InvoiceEndpoint { get; set; } = "Import_Invoice_Data_Excel";
    public string ReceiptEndpoint { get; set; } = "Import_Receipt_Data_Excel";
}

public enum ErpDocument { Customer, Invoice, Receipt }

public sealed record ErpPush(string ZedId, string Certification, ErpDocument Document, string ModuleName = "ZED", string? MileStoneNo = null);

public interface IErpFinanceService
{
    /// <summary>Loads the data with the module's SP_API_FINANCE_* procedure (ModuleName ZED, SURVEILLANCE or CONSULTANCY),
    /// posts it, and logs the outcome in SP_API_FINANCE_UNIT_DETAILS_RESPONSE (as the old code did).
    /// Never throws for ERP failures.</summary>
    Task PushAsync(ErpPush push, CancellationToken ct = default);
}

public sealed class ErpFinanceService(
    HttpClient http, ISqlExecutor db, IOptions<ErpOptions> options, ILogger<ErpFinanceService> log) : IErpFinanceService
{
    private static readonly JsonSerializerOptions Json = new() { WriteIndented = true };

    public async Task PushAsync(ErpPush push, CancellationToken ct = default)
    {
        var o = options.Value;
        if (!o.Enabled)
        {
            log.LogInformation("ERP disabled; skipped {Document} for {ZedId}/{Certification}", push.Document, push.ZedId, push.Certification);
            return;
        }

        var (apiType, endpoint) = push.Document switch
        {
            ErpDocument.Customer => ("CustomerData", o.CustomerEndpoint),
            ErpDocument.Invoice => ("InvoiceData", o.InvoiceEndpoint),
            _ => ("ReceiptData", o.ReceiptEndpoint),
        };
        if (Procedure(push.ModuleName, push.Document) is not { } procedure)
        {
            log.LogWarning("No ERP {Document} procedure for module {Module}; skipped {ZedId}/{Certification}", push.Document, push.ModuleName, push.ZedId, push.Certification);
            return;
        }

        try
        {
            // The consultancy procedures also take the handholding milestone (LatestMileStoneNo; the latest
            // paid one when empty), as ConsultancyPayController.SubmiXxxDataToApi passed it when it had one.
            object args = push.Document == ErpDocument.Customer
                ? new { push.ZedId }
                : string.IsNullOrEmpty(push.MileStoneNo)
                    ? new { push.ZedId, push.Certification }
                    : new { push.ZedId, push.Certification, LatestMileStoneNo = push.MileStoneNo };
            var row = (await db.QueryProcMultipleAsync(procedure, args, ct))[0].LastOrDefault();
            if (row is null)
            {
                log.LogInformation("No {Document} data for {ZedId}/{Certification}", push.Document, push.ZedId, push.Certification);
                return;
            }

            var body = push.Document switch
            {
                ErpDocument.Customer => JsonSerializer.Serialize(ErpPayloads.Customer(row), Json),
                ErpDocument.Invoice => JsonSerializer.Serialize(ErpPayloads.Invoice(row), Json),
                _ => JsonSerializer.Serialize(ErpPayloads.Receipt(row), Json),
            };

            using var request = new HttpRequestMessage(HttpMethod.Post, new Uri(new Uri(o.CompanyBaseUrl.TrimEnd('/') + "/"), endpoint))
            {
                Content = new StringContent(body, Encoding.UTF8, "application/json"),
            };
            request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", await GetTokenAsync(o, ct));
            using var response = await http.SendAsync(request, ct);
            var content = await response.Content.ReadAsStringAsync(ct);

            await Log(push, apiType, response.StatusCode.ToString(), success: content, error: response.ReasonPhrase, ct);
            if (!response.IsSuccessStatusCode)
                log.LogWarning("ERP {Document} for {ZedId}/{Certification} failed: {Status}", push.Document, push.ZedId, push.Certification, response.StatusCode);
        }
        catch (Exception ex) when (ex is not OperationCanceledException)
        {
            log.LogError(ex, "ERP {Document} for {ZedId}/{Certification} failed", push.Document, push.ZedId, push.Certification);
            try { await Log(push, apiType, statusCode: null, success: null, error: ex.Message, ct); }
            catch (Exception logEx) { log.LogError(logEx, "Could not record the ERP failure"); }
        }
    }

    /// <summary>
    /// The SP_API_FINANCE_* procedure that loads the data, per module (legacy PayController and
    /// SurveillancePayController / ConsultancyPayController.SubmiXxxDataToApi). The surveillance and
    /// consultancy modules never posted a customer (it exists from the certification payment).
    /// </summary>
    private static string? Procedure(string moduleName, ErpDocument document) => (moduleName.ToUpperInvariant(), document) switch
    {
        ("ZED", ErpDocument.Customer) => "SP_API_FINANCE_GET_UNIT_DETAILS",
        ("ZED", ErpDocument.Invoice) => "SP_API_FINANCE_GET_INVOICE_DETAILS",
        ("ZED", ErpDocument.Receipt) => "SP_API_FINANCE_GET_RECEIPT_DETAILS",
        ("SURVEILLANCE", ErpDocument.Invoice) => "SP_API_FINANCE_SURVEILLANCE_GET_INVOICE_DETAILS",
        ("SURVEILLANCE", ErpDocument.Receipt) => "SP_API_FINANCE_SURVEILLANCE_GET_RECEIPT_DETAILS",
        ("CONSULTANCY", ErpDocument.Invoice) => "SP_API_FINANCE_CONSULTANCY_GET_INVOICE_DETAILS",
        ("CONSULTANCY", ErpDocument.Receipt) => "SP_API_FINANCE_CONSULTANCY_GET_RECEIPT_DETAILS",
        _ => null,
    };

    private Task Log(ErpPush push, string apiType, string? statusCode, string? success, string? error, CancellationToken ct)
    {
        // SP_API_FINANCE_UNIT_DETAILS_RESPONSE: SuccessResponse varchar(5000), ErrorResponse varchar(2000).
        static string? Cut(string? s, int max) => s is null || s.Length <= max ? s : s[..max];
        var args = new Dictionary<string, object?>
        {
            ["ZedId"] = push.ZedId, ["Certification"] = push.Certification, ["ApiType"] = apiType,
            ["ModuleName"] = push.ModuleName, ["StatusCode"] = statusCode,
            ["SuccessResponse"] = Cut(success, 5000), ["ErrorResponse"] = Cut(error, 2000),
        };
        if (!string.IsNullOrEmpty(push.MileStoneNo)) args["LatestMileStoneNo"] = push.MileStoneNo;
        return db.ExecuteProcAsync("SP_API_FINANCE_UNIT_DETAILS_RESPONSE", new Dapper.DynamicParameters(args), ct);
    }

    private async Task<string> GetTokenAsync(ErpOptions o, CancellationToken ct)
    {
        using var response = await http.PostAsync($"https://login.microsoftonline.com/{o.TenantId}/oauth2/v2.0/token",
            new FormUrlEncodedContent(new Dictionary<string, string>
            {
                ["grant_type"] = "client_credentials", ["client_id"] = o.ClientId, ["client_secret"] = o.ClientSecret, ["scope"] = o.Scope,
            }), ct);
        if (!response.IsSuccessStatusCode) throw new HttpRequestException($"Failed to retrieve access token: {response.StatusCode}");
        var token = await response.Content.ReadFromJsonAsync<TokenResponse>(ct);
        return token?.AccessToken ?? throw new HttpRequestException("Token response had no access_token.");
    }

    private sealed record TokenResponse([property: JsonPropertyName("access_token")] string? AccessToken);
}

/// <summary>
/// JSON bodies exactly as ErpIntegrationService produced them: every property present, PascalCase
/// names, and text columns read like <c>row["X"] as string</c> (a non-text value becomes null).
/// </summary>
public static class ErpPayloads
{
    private static string? S(IDictionary<string, object?> r, string c) => r.TryGetValue(c, out var v) ? v as string : null;

    private static DateTime Date(IDictionary<string, object?> r, string c) =>
        r.TryGetValue(c, out var v) && v is not null and not DBNull ? Convert.ToDateTime(v, CultureInfo.InvariantCulture) : default;

    private static decimal Dec(IDictionary<string, object?> r, string c) =>
        r.TryGetValue(c, out var v) && v is not null and not DBNull ? Convert.ToDecimal(v, CultureInfo.InvariantCulture) : 0m;

    public static object Customer(IDictionary<string, object?> r) => new Dictionary<string, object?>
    {
        ["Created_At"] = Date(r, "Created_At"),
        ["Error_Text"] = S(r, "Error_Text"), ["Customer_Exist"] = S(r, "Customer_Exist"), ["Board"] = S(r, "Board"),
        ["Portal_Name"] = S(r, "Portal_Name"), ["Reference_No"] = S(r, "Reference_No"), ["Lab_ID"] = S(r, "Lab_ID"),
        ["Client_Name_1"] = S(r, "Client_Name_1"), ["Client_Name_2"] = S(r, "Client_Name_2"),
        ["Address_1"] = S(r, "Address_1"), ["Address_2"] = S(r, "Address_2"), ["Address_3"] = S(r, "Address_3"),
        ["City"] = S(r, "City"), ["District"] = S(r, "District"), ["State"] = S(r, "State"), ["Country"] = S(r, "Country"),
        ["Pincode"] = S(r, "Pincode"), ["SPOC_Name"] = S(r, "SPOC_Name"), ["Mobile"] = S(r, "Mobile"), ["Email"] = S(r, "Email"),
        ["Head_Phone_No"] = S(r, "Head_Phone_No"), ["Organisation_Head_Email"] = S(r, "Organisation_Head_Email"),
        ["PAN"] = S(r, "PAN"), ["TAN"] = S(r, "TAN"), ["TAN_Based_GST"] = S(r, "TAN_Based_GST"),
        ["GST_Customer_Type"] = S(r, "GST_Customer_Type"), ["GSTIN"] = S(r, "GSTIN"), ["HOD_Name"] = S(r, "HOD_Name"),
        ["Trade_Name"] = S(r, "Trade_Name"), ["Legal_Name"] = S(r, "Legal_Name"), ["Certificate_No"] = S(r, "Certificate_No"),
        ["MSME_Type"] = S(r, "MSME_Type"), ["MSME_Registration_No"] = S(r, "MSME_Registration_No"),
    };

    public static object Invoice(IDictionary<string, object?> r) => new Dictionary<string, object?>
    {
        ["@odata.etag"] = S(r, "Etag"), ["Entry_No"] = S(r, "Entry_No"), ["Posting_Date"] = S(r, "Posting_Date"),
        ["Error_Text"] = S(r, "Error_Text"), ["Board"] = S(r, "Board"), ["Portal"] = S(r, "Portal"), ["Login_Name"] = S(r, "Login_Name"),
        ["Voucher_Date"] = S(r, "Voucher_Date"), ["Location_Code"] = S(r, "Location_Code"), ["Line_Comments"] = S(r, "Line_Comments"),
        ["NABL4"] = S(r, "NABL4"),
        ["Quantity"] = r.TryGetValue("Quantity", out var q) && q is not null and not DBNull ? Convert.ToInt32(q, CultureInfo.InvariantCulture) : 0,
        ["Ledger_Name"] = S(r, "Ledger_Name"), ["Ledger_Amount"] = S(r, "Ledger_Amount"), ["TA_DA_LedgerName"] = S(r, "TA_DA_LedgerName"),
        ["Assessor_Name"] = S(r, "Assessor_Name"), ["Assessor_ID"] = S(r, "Assessor_ID"), ["Assessor_Type"] = S(r, "Assessor_Type"),
        ["Discipline_Name"] = S(r, "Discipline_Name"), ["Sub_Discipline_Name"] = S(r, "Sub_Discipline_Name"),
        ["Other_Discipline"] = S(r, "Other_Discipline"), ["Assessment_Period_From"] = S(r, "Assessment_Period_From"),
        ["Assessment_Period_To"] = S(r, "Assessment_Period_To"), ["Due_Period_Start_From"] = S(r, "Due_Period_Start_From"),
        ["Due_Period_Period_To"] = S(r, "Due_Period_Period_To"), ["TADA_Amount"] = S(r, "TADA_Amount"),
        ["Other_Amount"] = Dec(r, "Other_Amount"), ["Overhead_Charges"] = S(r, "Overhead_Charges"), ["Invoice_No"] = S(r, "Invoice_No"),
        ["TADA_Invoice_No"] = S(r, "TADA_Invoice_No"), ["Assessment_Type"] = S(r, "Assessment_Type"),
        ["HONORARIUM_Yes_No"] = r.TryGetValue("HONORARIUM_Yes_No", out var h) && h is not null and not DBNull && Convert.ToBoolean(h, CultureInfo.InvariantCulture),
    };

    public static object Receipt(IDictionary<string, object?> r) => new Dictionary<string, object?>
    {
        ["@odata.etag"] = S(r, "Etag"), ["Entry_No"] = S(r, "Entry_No"), ["Posting_Date"] = S(r, "Posting_Date"),
        ["Error_Text"] = S(r, "Error_Text"), ["Order_ID"] = S(r, "Order_ID"), ["Reference_ID"] = S(r, "Reference_ID"), ["Board"] = S(r, "Board"),
        ["TDS_Deducted"] = r.TryGetValue("TDS_Deducted", out var t) && t is not null and not DBNull && Convert.ToBoolean(t, CultureInfo.InvariantCulture),
        ["Payment_Mode"] = S(r, "Payment_Mode"), ["TAN"] = S(r, "TAN"),
        ["Amount_Received"] = Dec(r, "Amount_Received"), ["Invoice_1_Amount"] = Dec(r, "Invoice_1_Amount"),
        ["Invoice_2_Amount"] = Dec(r, "Invoice_2_Amount"), ["TDS_Amount"] = Dec(r, "TDS_Amount"),
        ["Payment_Date"] = S(r, "Payment_Date"), ["UTR_No"] = S(r, "UTR_No"), ["Created_At"] = Date(r, "Created_At"),
        ["Applied_to_invoice"] = S(r, "Applied_to_invoice"), ["Applied_to_invoice2"] = S(r, "Applied_to_invoice2"),
        ["NABL4"] = S(r, "NABL4"), ["Sub_Discipline_Name"] = S(r, "Sub_Discipline_Name"), ["PortalName"] = S(r, "PortalName"),
    };
}
