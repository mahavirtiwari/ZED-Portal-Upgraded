using Zed.Core.Mobile;

namespace Zed.Portal.Features.Payments.Mobile;

// Request and response classes of the old portal's mobile payment actions, field for field
// (SwatchSarvekshan/Models/PaymentsMasterModel.cs and DataModels/Responses.cs).

/// <summary>
/// PaymentsViewModel, as the app posts it to Pay/GetToken and Pay/SubmitZeroPaymentDetails (and the
/// SurveillancePay equivalents). Only <see cref="ZedId"/>, <see cref="Certification"/> and the choices
/// (UseCoupon, GSTIN, TDS, TAN) are used; PaymentRefId and Amount are only compared with what the server
/// decides, never used.
/// </summary>
public sealed class PaymentsViewModel
{
    public string? Id { get; set; }
    public string? Certification { get; set; }
    public string? UseCoupon { get; set; }
    /// <summary>"Yes"/"No" with the number in <see cref="Gst"/> (web page), or the number with Gst = "Yes"/"No"; the procedures accepted both.</summary>
    public string? UnitGstin { get; set; }
    public string? Gst { get; set; }
    public string? TdsDeductible { get; set; }
    public string? Tds { get; set; }
    public string? Tan { get; set; }
    public string? PaymentRefId { get; set; }
    public string? UtrNumber { get; set; }
    public string? Amount { get; set; }
    public string? ZedId { get; set; }
}

/// <summary>DataModels.RequestHashResponse: what Pay/GetToken returns (MVC Json(), so application/json).</summary>
public sealed class RequestHashResponse : ServiceResponse
{
    public string? requestHash { get; set; }
    public string? orderId { get; set; }
    public string? merchantId { get; set; }
    public string? accessCode { get; set; }
    public string? amount { get; set; }
}

/// <summary>CCAvenue's getSecureToken answer (SwatchSarvekshan/Models/Common.cs SecureTokenResponse).</summary>
public sealed class SecureTokenResponse
{
    public string? responseCode { get; set; }
    public string? responseStatus { get; set; }
    public string? responseMessage { get; set; }
    public string? secureToken { get; set; }
    public string? creationTimestamp { get; set; }
    public string? secureTokenExpiry { get; set; }
    public string? responseHash { get; set; }
}
