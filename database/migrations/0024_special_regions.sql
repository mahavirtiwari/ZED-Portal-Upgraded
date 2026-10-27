-- New in V4 (not part of the legacy schema). Run on ZEDCS_V2_LIVE. Additive and safe to re-run: one new table, seeded
-- once (only while it is empty).
-- Admin → Masters → Subsidy Regions (Zed.Portal/Features/Staff/Masters/SpecialRegionsController.cs): the regions whose
-- MSMEs get the additional subsidy of the ZED scheme: aspirational districts, Left Wing Extremism (LWE) districts, the
-- Himalayan states / UTs, the island territories and the North Eastern Region, each entry switched on or off. A row is
-- a district (DistrictCode = LGD district code) or a whole state (DistrictCode = ''). StateCode is the LGD state code.
-- The payment procedures (SP_MSME_GET_PAYMENT_DETAILS ...) read Districts.IsAspirationalDt; V4 sets it to 1 for the
-- districts covered by an enabled row and to 0 for the others whenever the Admin changes the regions. This script does
-- not touch Districts: the seed keeps today's subsidy (the aspirational districts as flagged, enabled; the new
-- categories switched off until the Admin enables them).
-- Sources of the seed: aspirational districts as flagged in Districts before V4; Himalayan: Jammu and Kashmir, Ladakh,
-- Himachal Pradesh, Uttarakhand; islands: Andaman and Nicobar Islands, Lakshadweep; NER: the eight North Eastern states.
-- LWE: none - the Ministry of Home Affairs informed the states on 8 April 2026 that no district is classified as
-- LWE-affected any more (37 districts became "Legacy and Thrust" districts); the Admin adds districts if needed.
-- The V4 logins need SELECT, INSERT, UPDATE and DELETE on it, and UPDATE on dbo.Districts (zed_v4_app has them).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4SpecialRegions', 'U') IS NULL
CREATE TABLE dbo.V4SpecialRegions
(
    Category      varchar(20)    NOT NULL,
    StateCode     varchar(50)    NOT NULL,
    DistrictCode  varchar(50)    NOT NULL CONSTRAINT DF_V4SpecialRegions_DistrictCode DEFAULT '',
    Enabled       bit            NOT NULL CONSTRAINT DF_V4SpecialRegions_Enabled DEFAULT 0,
    Source        nvarchar(200)  NULL,
    UpdatedBy     varchar(50)    NULL,
    UpdatedOn     datetime2(0)   NOT NULL CONSTRAINT DF_V4SpecialRegions_UpdatedOn DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_V4SpecialRegions PRIMARY KEY (Category, StateCode, DistrictCode)
);
GO
IF NOT EXISTS (SELECT 1 FROM dbo.V4SpecialRegions)
BEGIN
    INSERT INTO dbo.V4SpecialRegions (Category, StateCode, DistrictCode, Enabled, Source, UpdatedBy)
    SELECT DISTINCT 'ASPIRATIONAL', LTRIM(RTRIM(StateCode)), LTRIM(RTRIM(DistrictCode)), 1, N'Districts.IsAspirationalDt before V4', 'migration-0024'
    FROM dbo.Districts
    WHERE IsAspirationalDt = 1 AND StateCode IS NOT NULL AND DistrictCode IS NOT NULL;

    INSERT INTO dbo.V4SpecialRegions (Category, StateCode, DistrictCode, Enabled, Source, UpdatedBy)
    VALUES
        ('HIMALAYAN', '1', '', 0, N'Himalayan state / UT', 'migration-0024'),
        ('HIMALAYAN', '37', '', 0, N'Himalayan state / UT', 'migration-0024'),
        ('HIMALAYAN', '2', '', 0, N'Himalayan state / UT', 'migration-0024'),
        ('HIMALAYAN', '5', '', 0, N'Himalayan state / UT', 'migration-0024'),
        ('ISLAND', '35', '', 0, N'Island territory', 'migration-0024'),
        ('ISLAND', '31', '', 0, N'Island territory', 'migration-0024'),
        ('NER', '12', '', 0, N'North Eastern Region', 'migration-0024'),
        ('NER', '18', '', 0, N'North Eastern Region', 'migration-0024'),
        ('NER', '14', '', 0, N'North Eastern Region', 'migration-0024'),
        ('NER', '17', '', 0, N'North Eastern Region', 'migration-0024'),
        ('NER', '15', '', 0, N'North Eastern Region', 'migration-0024'),
        ('NER', '13', '', 0, N'North Eastern Region', 'migration-0024'),
        ('NER', '11', '', 0, N'North Eastern Region', 'migration-0024'),
        ('NER', '16', '', 0, N'North Eastern Region', 'migration-0024');
END
GO
