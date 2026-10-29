-- Run on ZEDCS_V2_LIVE and ZED_SURVEILLANCE (the systems with the questionnaire). Additive and safe to re-run.
-- The certification levels as settings the Admin manages (Administration → Certification Levels), the new level ZED-X,
-- NIC sector-wise questionnaires, and Manufacturing / Services on agencies and assessors. New columns of existing tables:
--
--   dbo.SectionTypes (the legacy list of questionnaire types; ZED code did not read it, only the old hotel
--   self-assessment procedures, which join on the hotel types and are not affected by the rows added here):
--     DisplayName      the name shown ("ZED-X"); SectionType keeps the code stored everywhere ("ZEDX", "Gold", ...)
--     Description, Comment   the text of the level's box on the MSME dashboard and its information pop-up
--     LogoPath         the box's logo (Uploads/Levels/{code}.png, or the built-in image)
--     IsEnabled        shown to MSMEs (a disabled level keeps its data; MSMEs cannot apply for it)
--     IsCertificationLevel   1 for the ZED levels (the hotel types keep NULL)
--     AssessmentMode   'Desktop' (Bronze: desktop assessment only) or 'Site' (desktop and site assessment)
--     ValidityMonths, SurveillanceEnabled, FirstSurveillanceMonths   the certificate's validity and surveillance
--     CertNoFormat, CertNoFormatManufacturing, CertNoFormatService   the certificate number; the two category
--                      formats apply once set (NULL = the general format), e.g. {DDMMYYYY}_{ZEDNO}
--     Fee              the fee shown on the box (the amounts charged stay in dbo.AssessmentFee)
--     UpdatedBy, UpdatedOn
--   dbo.Sections.NicSectors   the NIC 2-digit sector codes a parameter applies to, comma-separated; NULL = all sectors
--   dbo.Users.SectorActivity  'Manufacturing', 'Services' or 'Both': which MSMEs an agency / assessor may assess
--                             (ZEDCS_V2_LIVE only: agencies and assessors are created there)
--   dbo.AssessmentFee         the rows of ZED-X: Rs. 75,000 with the subsidy and joining reward rules of Gold
--                             (ZEDCS_V2_LIVE only; the Admin changes them on Masters → Payments like the others)
-- The levels' rows are added once; afterwards the Admin's changes are kept. The old sites are not affected: their
-- procedures insert with column lists and read the levels by name.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.SectionTypes', 'U') IS NULL
    CREATE TABLE dbo.SectionTypes (SectionType varchar(100) NULL, OrderNo int NULL);
IF COL_LENGTH('dbo.SectionTypes', 'DisplayName') IS NULL ALTER TABLE dbo.SectionTypes ADD DisplayName nvarchar(100) NULL;
IF COL_LENGTH('dbo.SectionTypes', 'Description') IS NULL ALTER TABLE dbo.SectionTypes ADD Description nvarchar(1000) NULL;
IF COL_LENGTH('dbo.SectionTypes', 'Comment') IS NULL ALTER TABLE dbo.SectionTypes ADD Comment nvarchar(2000) NULL;
IF COL_LENGTH('dbo.SectionTypes', 'LogoPath') IS NULL ALTER TABLE dbo.SectionTypes ADD LogoPath varchar(300) NULL;
IF COL_LENGTH('dbo.SectionTypes', 'IsEnabled') IS NULL ALTER TABLE dbo.SectionTypes ADD IsEnabled bit NULL;
IF COL_LENGTH('dbo.SectionTypes', 'IsCertificationLevel') IS NULL ALTER TABLE dbo.SectionTypes ADD IsCertificationLevel bit NULL;
IF COL_LENGTH('dbo.SectionTypes', 'AssessmentMode') IS NULL ALTER TABLE dbo.SectionTypes ADD AssessmentMode varchar(10) NULL;
IF COL_LENGTH('dbo.SectionTypes', 'ValidityMonths') IS NULL ALTER TABLE dbo.SectionTypes ADD ValidityMonths int NULL;
IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceEnabled') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceEnabled bit NULL;
IF COL_LENGTH('dbo.SectionTypes', 'FirstSurveillanceMonths') IS NULL ALTER TABLE dbo.SectionTypes ADD FirstSurveillanceMonths int NULL;
IF COL_LENGTH('dbo.SectionTypes', 'CertNoFormat') IS NULL ALTER TABLE dbo.SectionTypes ADD CertNoFormat varchar(100) NULL;
IF COL_LENGTH('dbo.SectionTypes', 'CertNoFormatManufacturing') IS NULL ALTER TABLE dbo.SectionTypes ADD CertNoFormatManufacturing varchar(100) NULL;
IF COL_LENGTH('dbo.SectionTypes', 'CertNoFormatService') IS NULL ALTER TABLE dbo.SectionTypes ADD CertNoFormatService varchar(100) NULL;
IF COL_LENGTH('dbo.SectionTypes', 'Fee') IS NULL ALTER TABLE dbo.SectionTypes ADD Fee decimal(10, 2) NULL;
IF COL_LENGTH('dbo.SectionTypes', 'UpdatedBy') IS NULL ALTER TABLE dbo.SectionTypes ADD UpdatedBy varchar(50) NULL;
IF COL_LENGTH('dbo.SectionTypes', 'UpdatedOn') IS NULL ALTER TABLE dbo.SectionTypes ADD UpdatedOn datetime2(0) NULL;

IF OBJECT_ID('dbo.Sections', 'U') IS NOT NULL AND COL_LENGTH('dbo.Sections', 'NicSectors') IS NULL
    ALTER TABLE dbo.Sections ADD NicSectors varchar(2000) NULL;
GO
IF OBJECT_ID('dbo.CK_SectionTypes_AssessmentMode', 'C') IS NULL
    ALTER TABLE dbo.SectionTypes WITH CHECK ADD CONSTRAINT CK_SectionTypes_AssessmentMode CHECK (AssessmentMode IS NULL OR AssessmentMode IN ('Desktop', 'Site'));
GO
-- The four levels, with what the procedures do today: the number ddMMyyyy_<ZED ID digits>, valid 3 years, first
-- surveillance after 450 days (Bronze, 15 months) or 365 days (the site levels, 12 months).
MERGE dbo.SectionTypes AS t
USING (VALUES
    ('Bronze', N'Bronze', 10, 'Desktop', 15, CAST(NULL AS decimal(10, 2)), N'Commitment towards quality, the first step of ZED: 5 parameters, desktop assessment.', 1),
    ('Silver', N'Silver', 20, 'Site',    12, NULL, N'Systems and processes: 14 parameters, desktop and site assessment.', 1),
    ('Gold',   N'Gold',   30, 'Site',    12, NULL, N'Excellence: 20 parameters, desktop and site assessment.', 1),
    ('ZEDX',   N'ZED-X',  40, 'Site',    12, 75000, N'ZED-X certification: open to every registered MSME, assessed on the parameters of its NIC sector.', 0)
) AS s (SectionType, DisplayName, OrderNo, AssessmentMode, FirstSurveillanceMonths, Fee, Description, IsEnabled)
ON t.SectionType = s.SectionType
-- A row of the level that was there before (no settings yet): filled once; the Admin's settings are never overwritten.
WHEN MATCHED AND t.IsCertificationLevel IS NULL THEN
    UPDATE SET OrderNo = s.OrderNo, DisplayName = s.DisplayName, Description = s.Description, IsEnabled = s.IsEnabled,
               IsCertificationLevel = 1, AssessmentMode = s.AssessmentMode, ValidityMonths = 36, SurveillanceEnabled = 1,
               FirstSurveillanceMonths = s.FirstSurveillanceMonths, CertNoFormat = '{DDMMYYYY}_{ZEDNO}', Fee = s.Fee,
               UpdatedBy = 'migration-0028', UpdatedOn = SYSUTCDATETIME()
WHEN NOT MATCHED THEN
    INSERT (SectionType, OrderNo, DisplayName, Description, IsEnabled, IsCertificationLevel, AssessmentMode, ValidityMonths,
            SurveillanceEnabled, FirstSurveillanceMonths, CertNoFormat, Fee, UpdatedBy, UpdatedOn)
    VALUES (s.SectionType, s.OrderNo, s.DisplayName, s.Description, s.IsEnabled, 1, s.AssessmentMode, 36,
            1, s.FirstSurveillanceMonths, '{DDMMYYYY}_{ZEDNO}', s.Fee, 'migration-0028', SYSUTCDATETIME());
GO
-- Agencies and assessors (ZEDCS_V2_LIVE: the database with the AssessmentFee master and the agencies).
IF OBJECT_ID('dbo.AssessmentFee', 'U') IS NOT NULL AND OBJECT_ID('dbo.Users', 'U') IS NOT NULL AND COL_LENGTH('dbo.Users', 'AllowBronzeAssessments') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.Users', 'SectorActivity') IS NULL EXEC (N'ALTER TABLE dbo.Users ADD SectorActivity varchar(20) NULL;');
END
GO
IF COL_LENGTH('dbo.Users', 'SectorActivity') IS NOT NULL AND OBJECT_ID('dbo.CK_Users_SectorActivity', 'C') IS NULL
    EXEC (N'ALTER TABLE dbo.Users WITH CHECK ADD CONSTRAINT CK_Users_SectorActivity CHECK (SectorActivity IS NULL OR SectorActivity IN (''Manufacturing'', ''Services'', ''Both''));');
GO
-- ZED-X fees: each Gold row (enterprise type, special category, with or without the joining reward) again for ZED-X,
-- at Rs. 75,000 with the row's own subsidy percentage and coupon, computed as Admin → Payments computes them
-- (FeeCalculator: GST 18 %, the coupon taken from the total, TDS 2 % and 10 % of the applicant's share).
IF OBJECT_ID('dbo.AssessmentFee', 'U') IS NOT NULL AND COL_LENGTH('dbo.Users', 'SectorActivity') IS NOT NULL
    -- Dynamic: ZED_SURVEILLANCE has no AssessmentFee, and the batch would not compile there.
    EXEC (N'
    IF NOT EXISTS (SELECT 1 FROM dbo.AssessmentFee WHERE Certification = ''ZEDX'')
    BEGIN
    INSERT INTO dbo.AssessmentFee (EnterpriseTypee, Certification, AssessmentFee, Gst, Total, Coupon, AssessmentFeeAfterCoupon, GstAfterCoupon,
        TotalAfterCoupon, SubsidyPer, SubsidyAmount, GstAfterSubsidy, ApplicantContributionAfterSubsidy, Tds15, Tds75, NetPaybleTds15, NetPaybleTds75,
        IsActive, SpecialCategory, SubsidyPercentage)
    SELECT g.EnterpriseTypee, ''ZEDX'', 75000, 13500, 88500, c.Coupon, ROUND(c.Base, 2), ROUND(c.TotalAfter - c.Base, 2), ROUND(c.TotalAfter, 2),
           ROUND(c.Base * s.Share, 2), ROUND(c.Base - c.Base * s.Share, 2), ROUND(c.Base * s.Share * 0.18, 2), ROUND(c.Base * s.Share * 1.18, 2),
           ROUND(c.Base * s.Share * 0.02, 2), ROUND(c.Base * s.Share * 0.10, 2),
           ROUND(c.Base * s.Share * 1.18, 2) - ROUND(c.Base * s.Share * 0.02, 2), ROUND(c.Base * s.Share * 1.18, 2) - ROUND(c.Base * s.Share * 0.10, 2),
           g.IsActive, g.SpecialCategory, g.SubsidyPercentage
    FROM dbo.AssessmentFee g
    CROSS APPLY (SELECT CASE WHEN g.EnterpriseTypee = ''REJECTED'' THEN 1.0
                             ELSE (100 - ISNULL(g.SubsidyPercentage, 0)) / 100.0 END AS Share) s
    -- With the joining reward: the coupon comes off the total (GST included), the base is the rest without GST.
    -- Without it (or a rejected unit): the whole fee.
    CROSS APPLY (SELECT g.Coupon AS Coupon,
                        CASE WHEN g.Coupon IS NULL OR g.EnterpriseTypee = ''REJECTED'' THEN 88500.0 ELSE 88500.0 - g.Coupon END AS TotalAfter) t
    CROSS APPLY (SELECT t.Coupon, t.TotalAfter, t.TotalAfter - t.TotalAfter * 18.0 / 118 AS Base) c
    WHERE g.Certification = ''Gold'';
    END');
GO
