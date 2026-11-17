using System.Net.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using Zed.Portal.Features.Msme;

namespace Zed.Main.Api.Tests;

/// <summary>
/// 2026-11-17 (the user could not register): the certificates udyogaadhaar.gov.in sent on 17 Nov 2026 (its own, the
/// eMudhra intermediate and the emSign TLS root cross-signed by emSign Root CA - G1), checked as on that day.
/// </summary>
public sealed class UdyamCertificateTrustTests
{
    private static readonly DateTime OnTheDay = new(2026, 11, 17, 12, 0, 0, DateTimeKind.Utc);

    private static (X509Certificate2 Leaf, X509Chain Sent) ServiceChain()
    {
        var all = new X509Certificate2Collection();
        all.ImportFromPemFile(Path.Combine(AppContext.BaseDirectory, "TestData", "udyam-chain-2026-11.pem"));
        var chain = new X509Chain();
        chain.ChainPolicy.ExtraStore.AddRange(all);
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        chain.ChainPolicy.VerificationTime = OnTheDay;
        chain.Build(all[0]);
        return (all[0], chain);
    }

    [Fact]
    public void The_embedded_root_is_emSign_Root_CA_G1()
    {
        using var root = X509Certificate2.CreateFromPem(UdyamCertificateTrust.EmSignRootG1Pem);
        Assert.Equal("40F6AF0346A99AA1CD1D555A4E9CCE62C7F9634603EE406615833DC8C8D00367", root.GetCertHashString(HashAlgorithmName.SHA256));
    }

    [Fact]
    public void The_Udyam_service_chain_is_accepted_when_the_machine_does_not_know_the_root()
    {
        var (leaf, sent) = ServiceChain();
        Assert.Contains("udyogaadhaar.gov.in", leaf.GetNameInfo(X509NameType.DnsName, false) + " " + string.Join(" ", leaf.Extensions.OfType<X509SubjectAlternativeNameExtension>().SelectMany(e => e.EnumerateDnsNames())));
        Assert.True(UdyamCertificateTrust.Validate(leaf, sent, SslPolicyErrors.RemoteCertificateChainErrors, OnTheDay));
    }

    [Fact]
    public void A_wrong_name_is_refused_even_with_a_good_chain()
    {
        var (leaf, sent) = ServiceChain();
        Assert.False(UdyamCertificateTrust.Validate(leaf, sent, SslPolicyErrors.RemoteCertificateNameMismatch | SslPolicyErrors.RemoteCertificateChainErrors, OnTheDay));
    }

    [Fact]
    public void An_expired_certificate_is_refused()
    {
        var (leaf, sent) = ServiceChain();
        Assert.False(UdyamCertificateTrust.Validate(leaf, sent, SslPolicyErrors.RemoteCertificateChainErrors, new DateTime(2027, 2, 1)));
    }

    [Fact]
    public void A_certificate_from_any_other_root_is_refused()
    {
        using var key = RSA.Create(2048);
        var req = new CertificateRequest("CN=udyogaadhaar.gov.in", key, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        using var self = req.CreateSelfSigned(OnTheDay.AddDays(-1), OnTheDay.AddDays(30));
        using var chain = new X509Chain();
        Assert.False(UdyamCertificateTrust.Validate(self, chain, SslPolicyErrors.RemoteCertificateChainErrors, OnTheDay));
    }

    [Fact]
    public void A_certificate_the_machine_already_trusts_is_accepted_as_before()
    {
        var (leaf, sent) = ServiceChain();
        Assert.True(UdyamCertificateTrust.Validate(leaf, sent, SslPolicyErrors.None, OnTheDay));
    }
}
