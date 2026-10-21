-- LOCAL DEVELOPMENT ONLY. Lets the MSME registration flow run end to end on the empty schema.
-- Never run this against production.
--
-- 1. One eligible sector, so SP_MSME_VALIDATE_UDYAM_DETAILS accepts NIC 2-digit code 24.
-- 2. Empty stand-ins for databases the procedures query but that were not part of the exported
--    scripts (ZED_CENTER_AUDIT_V2, ZED_CENTER_AUDIT_PROFESSIONAL, KAWACH), with only the tables and
--    columns the migrated pages touch. Replace them with the real schemas when available; drop with
--    DROP DATABASE ZED_CENTER_AUDIT_V2; DROP DATABASE ZED_CENTER_AUDIT_PROFESSIONAL; DROP DATABASE KAWACH;
USE [ZEDCS_V2_LIVE];
IF NOT EXISTS (SELECT 1 FROM Sectors WHERE SectorCode = '24')
    INSERT INTO Sectors (SectorCode, SectorName, OrderNo, SchemeId, SchemeName)
    VALUES ('24', 'Manufacture of basic metals (DEV SEED)', 1, 1, 'ZED');
GO
IF DB_ID('ZED_CENTER_AUDIT_V2') IS NULL CREATE DATABASE [ZED_CENTER_AUDIT_V2];
GO
IF DB_ID('ZED_CENTER_AUDIT_PROFESSIONAL') IS NULL CREATE DATABASE [ZED_CENTER_AUDIT_PROFESSIONAL];
GO
USE [ZED_CENTER_AUDIT_V2];
IF OBJECT_ID('dbo.candidates') IS NULL CREATE TABLE dbo.candidates (Id bigint IDENTITY PRIMARY KEY, EmailId varchar(200) NULL);
GO
USE [ZED_CENTER_AUDIT_PROFESSIONAL];
IF OBJECT_ID('dbo.candidates') IS NULL CREATE TABLE dbo.candidates (Id bigint IDENTITY PRIMARY KEY, EmailId varchar(200) NULL);
GO
IF DB_ID('KAWACH') IS NULL CREATE DATABASE [KAWACH];
GO
USE [KAWACH];
IF OBJECT_ID('dbo.MsmeCertifications') IS NULL
    CREATE TABLE dbo.MsmeCertifications (Id bigint IDENTITY PRIMARY KEY, ZedId varchar(50) NULL, DaCertificateNo varchar(100) NULL);
IF OBJECT_ID('dbo.WebinarRegistrations') IS NULL
    CREATE TABLE dbo.WebinarRegistrations (Id bigint IDENTITY PRIMARY KEY, WebinarCertificateNo varchar(100) NULL);
GO
-- 3. Site address the procedures prefix to document paths (production has the live portal URL here).
USE [ZEDCS_V2_LIVE];
IF NOT EXISTS (SELECT 1 FROM UrlsMasterData)
    INSERT INTO UrlsMasterData (UrlName, IsActive) VALUES ('http://localhost:4200', 1);
GO
-- 4. Bronze fees for a Micro unit (general category), with and without the joining reward,
--    so the payment step has something to show. Illustrative amounts only.
USE [ZEDCS_V2_LIVE];
IF NOT EXISTS (SELECT 1 FROM AssessmentFee WHERE EnterpriseTypee = 'Micro' AND Certification = 'Bronze' AND SpecialCategory = 0)
BEGIN
    INSERT INTO AssessmentFee (EnterpriseTypee, Certification, AssessmentFee, Gst, Total, Coupon, AssessmentFeeAfterCoupon, GstAfterCoupon, TotalAfterCoupon,
        SubsidyPer, SubsidyAmount, GstAfterSubsidy, ApplicantContributionAfterSubsidy, Tds15, Tds75, NetPaybleTds15, NetPaybleTds75, IsActive, SpecialCategory, SubsidyPercentage)
    VALUES ('Micro', 'Bronze', 10000, 1800, 11800, 10000, 0, 0, 0, 80, 0, 0, 0, 0, 0, 0, 0, 1, 0, 80),
           ('Micro', 'Bronze', 10000, 1800, 11800, NULL, 10000, 1800, 11800, 80, 2000, 360, 2360, 40, 200, 2320, 2160, 1, 0, 80);
END
GO
