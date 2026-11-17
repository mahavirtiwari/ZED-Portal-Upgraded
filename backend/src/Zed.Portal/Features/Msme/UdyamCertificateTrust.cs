using System.Net.Security;
using System.Security.Cryptography.X509Certificates;

namespace Zed.Portal.Features.Msme;

/// <summary>
/// 2026-11-17 (the user could not register: "Unexpected error occured" at the Udyam check): the Ministry's Udyam service
/// (udyogaadhaar.gov.in) now presents an eMudhra certificate that chains to "emSign Root CA - G1", a root Windows Server
/// does not have unless it downloads it, so every lookup failed the TLS check. The legacy code switched certificate
/// checks off; instead, the Udyam call trusts this one root as well as the machine's roots. The name on the
/// certificate and its dates are still checked, and nothing else is trusted.
/// </summary>
public static class UdyamCertificateTrust
{
    /// <summary>emSign Root CA - G1 (eMudhra), SHA-256 40F6AF0346A99AA1CD1D555A4E9CCE62C7F9634603EE406615833DC8C8D00367, as in the Mozilla root list.</summary>
    public const string EmSignRootG1Pem = """
        -----BEGIN CERTIFICATE-----
        MIIDlDCCAnygAwIBAgIKMfXkYgxsWO3W2DANBgkqhkiG9w0BAQsFADBnMQswCQYD
        VQQGEwJJTjETMBEGA1UECxMKZW1TaWduIFBLSTElMCMGA1UEChMcZU11ZGhyYSBU
        ZWNobm9sb2dpZXMgTGltaXRlZDEcMBoGA1UEAxMTZW1TaWduIFJvb3QgQ0EgLSBH
        MTAeFw0xODAyMTgxODMwMDBaFw00MzAyMTgxODMwMDBaMGcxCzAJBgNVBAYTAklO
        MRMwEQYDVQQLEwplbVNpZ24gUEtJMSUwIwYDVQQKExxlTXVkaHJhIFRlY2hub2xv
        Z2llcyBMaW1pdGVkMRwwGgYDVQQDExNlbVNpZ24gUm9vdCBDQSAtIEcxMIIBIjAN
        BgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAk0u76WaK7p1b1TST0Bsew+eeuGQz
        f2N4aLTNLnF115sgxk0pvLZoYIr3IZpWNVrzdr3YzZr/k1ZLpVkGoZM0Kd0WNHVO
        8oG0x5ZOrRkVUkr+PHB1cM2vK6sVmjM8qrOLqs1D/fXqcP/tzxE7lM5OMhbTI0Aq
        d7OvPAEsbO2ZLIvZTmmYsvePQbAyeGHWDV/D+qJAkh1cF+ZwPjXnorfCYuKrpDhM
        tTk1b+oDafo6VGiFbdbyL0NVHpENDtjVaqSW0RM8LHhQ6DqS0hdW5TUaQBw+jSzt
        Od9C4INBdN+jzcKGYEho42kLVACL5HZpIQ15TjQIXhTCzLG3rdd8cIrHhQIDAQAB
        o0IwQDAdBgNVHQ4EFgQU++8Nhp6w492pufEhF38+/PB3KxowDgYDVR0PAQH/BAQD
        AgEGMA8GA1UdEwEB/wQFMAMBAf8wDQYJKoZIhvcNAQELBQADggEBAFn/8oz1h31x
        PaOfG1vR2vjTnGs2vZupYeveFix0PZ7mddrXuqe8QhfnPZHr5X3dPpzxz5KsbEjM
        wiI/aTvFthUvozXGaCocV685743QNcMYDHsAVhzNixl03r4PEuDQqqE/AjSxcM6d
        GNYIAwlG7mDgfrbESQRRfXBgvKqy/3lyeqYdPV8q+Mri/Tm3R7nrft8EI6/6nAYH
        6ftjk4BAtcZsCjEozgyfz7MjNYBBjWzEN3uBL4ChQEKF6dk4jeihU80Bv2noWgby
        RQuQ+q7hv53yrlc8pa6yVvSLZUDp/TGBLPQ5Cdjua6e0ph0VpZj3AYHYhX3zUVxx
        iN66zB+Afko=
        -----END CERTIFICATE-----
        """;

    private static readonly Lazy<X509Certificate2> Root = new(() => X509Certificate2.CreateFromPem(EmSignRootG1Pem));

    /// <summary>The HttpClientHandler callback: the machine's own check, or else the chain to the emSign root.</summary>
    public static bool Validate(HttpRequestMessage _, X509Certificate2? certificate, X509Chain? chain, SslPolicyErrors errors) =>
        Validate(certificate, chain, errors, DateTime.Now);

    public static bool Validate(X509Certificate2? certificate, X509Chain? chain, SslPolicyErrors errors, DateTime at)
    {
        if (errors == SslPolicyErrors.None) return true;
        // A wrong name or no certificate is never accepted; only an unknown root is looked at again.
        if (certificate is null || errors != SslPolicyErrors.RemoteCertificateChainErrors) return false;

        using var custom = new X509Chain();
        custom.ChainPolicy.TrustMode = X509ChainTrustMode.CustomRootTrust;
        custom.ChainPolicy.CustomTrustStore.Add(Root.Value);
        custom.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        custom.ChainPolicy.VerificationTime = at;
        // The intermediates the service sent.
        if (chain is not null)
            foreach (var e in chain.ChainElements)
                if (!e.Certificate.RawData.AsSpan().SequenceEqual(certificate.RawData))
                    custom.ChainPolicy.ExtraStore.Add(e.Certificate);
        return custom.Build(certificate);
    }
}
