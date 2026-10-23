using Zed.Core.Data;
using Zed.Portal.Features.Payments;
using Zed.Portal.Features.Payments.Consultancy;

namespace Zed.Main.Api.Tests;

/// <summary>
/// Database:Prefix (a second, prefixed set of databases on one instance, docs/STAGING.md 3.0): the database names in
/// inline SQL are mapped, everything else is left as it is. Same rules as database\ZedDatabaseNames.ps1.
/// </summary>
public sealed class DatabasePrefixTests
{
    [Theory]
    [InlineData("SELECT * FROM ZED_CONSULTANT.dbo.MsmeCertifications C", "SELECT * FROM ZEDV4_ZED_CONSULTANT.dbo.MsmeCertifications C")]
    [InlineData("SELECT * FROM [ZED_SURVEILLANCE].[dbo].[Users]", "SELECT * FROM [ZEDV4_ZED_SURVEILLANCE].[dbo].[Users]")]
    [InlineData("SELECT 1 FROM kawach.dbo.Users u JOIN ZEDCS_V2_LIVE..Msme m ON 1 = 1", "SELECT 1 FROM ZEDV4_KAWACH.dbo.Users u JOIN ZEDV4_ZEDCS_V2_LIVE..Msme m ON 1 = 1")]
    [InlineData("USE [ZED_CENTER_AUDIT_V2]; SELECT DB_ID(N'ZED_IMPACT_ASSESSMENT')", "USE [ZEDV4_ZED_CENTER_AUDIT_V2]; SELECT DB_ID(N'ZEDV4_ZED_IMPACT_ASSESSMENT')")]
    [InlineData("EXEC [ZED_CENTER_AUDIT_PROFESSIONAL].sys.sp_executesql @q", "EXEC [ZEDV4_ZED_CENTER_AUDIT_PROFESSIONAL].sys.sp_executesql @q")]
    public void Database_names_get_the_prefix(string sql, string expected)
    {
        Assert.Equal(expected, ZedDatabaseNames.Map(sql, "ZEDV4_"));
        // Mapping twice changes nothing more.
        Assert.Equal(expected, ZedDatabaseNames.Map(expected, "ZEDV4_"));
    }

    [Theory]
    [InlineData("EXEC SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME_KAWACH")]
    [InlineData("SELECT ZED_SURVEILLANCE_SERVICES.Id FROM T ZED_SURVEILLANCE_SERVICES")]
    [InlineData(@"SELECT CONCAT('E:\Publish\ZEDCS_LIVE\ZEDCS_V2_LIVE\Uploads\', Id), 'D:\Publish\KAWACH\Certificates\'")]
    [InlineData("SELECT @ZED_CONSULTANT.x, #KAWACH.y FROM PaymentGatewayTransactions")]
    public void Other_text_is_left_as_it_is(string sql)
    {
        Assert.Equal(sql, ZedDatabaseNames.Map(sql, "ZEDV4_"));
    }

    [Fact]
    public void Without_a_prefix_nothing_changes_and_the_portal_queries_map_to_the_prefixed_set()
    {
        Assert.Equal(ConsultancyGateway.MilestoneQuery, ZedDatabaseNames.Map(ConsultancyGateway.MilestoneQuery, ""));
        var mapped = ZedDatabaseNames.Map(ConsultancyGateway.MilestoneQuery, "ZEDV4_");
        Assert.Equal(3, mapped.Split("ZEDV4_ZED_CONSULTANT.dbo.").Length - 1);
        Assert.DoesNotContain(" ZED_CONSULTANT.", mapped);
        Assert.Equal("ZEDV4_ZED_SURVEILLANCE.dbo.PaymentGatewayTransactions", ZedDatabaseNames.Map(CcAvenueGatewayModule.SurveillanceOrders, "ZEDV4_"));
        Assert.Equal("ZEDV4_ZED_CONSULTANT.dbo.PaymentGatewayTransactions", ZedDatabaseNames.Map(ConsultancyGateway.Orders, "ZEDV4_"));
    }

    [Theory]
    [InlineData("ZED V4")]
    [InlineData("4ZED")]
    [InlineData("ZED;DROP")]
    public void A_prefix_must_be_a_plain_name(string prefix)
    {
        Assert.Throws<InvalidOperationException>(() => ZedDatabaseNames.UsePrefix(prefix));
        Assert.Equal("", ZedDatabaseNames.Prefix);
    }
}
