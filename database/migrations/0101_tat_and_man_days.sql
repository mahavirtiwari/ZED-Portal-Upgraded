-- V4 0101 (2026-11-18, the user's decisions "TAT and monitoring"): turnaround times (TAT) and man-days per level.
-- Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT, ZED_SURVEILLANCE). Additive and safe to re-run.
--
-- New tables (a new entity, the Admin's turnaround rules; each portal keeps its own, edited from the main portal through the
-- portal switch of Administration → TAT):
--   dbo.TatStatusDays   the days a case may stay in one status, per certification level (no row = no TAT for that status).
--                       StatusCode is the portal's status code (MsmeCertifications.CertificationStatus, e.g. '15') as listed
--                       by the portal (Zed.Portal TatCatalog).
--   dbo.TatRelations    named rules "from status (or milestone of the case history) to status, in N days", per level or for
--                       every level (Certification NULL), active or not, in the Admin's order.
-- The portal decides from these which case is delayed (TatEvaluator); nothing else reads them.
--
-- Columns on the legacy levels table dbo.SectionTypes (new fields about an existing record; ZEDCS_V2_LIVE and its copy in
-- ZED_SURVEILLANCE, as NcRounds / NcDays of 0086; ZED_CONSULTANT has no site assessment by man-days):
--   ManDays              the days a site assessment of the level takes (Administration → Certification Levels). A site
--                        assessment whose start (opening meeting, else the assessment date) + ManDays has passed without the
--                        app's final submission is "Submission pending through mobile app" in Assessment Monitoring.
--   SurveillanceManDays  the same for the level's surveillance visit (Surveillance Monitoring reads its own database's copy).
-- NULL = not set (no "submission pending" for the level). The portal saves main's row and the surveillance database's copy.
-- Legacy INSERTs into dbo.SectionTypes name their columns (0028, 0065, 0086 added columns before).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET ANSI_PADDING ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50101, '0101 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
GO

-- ---------------------------------------------------------------- days per status and level
IF OBJECT_ID(N'dbo.TatStatusDays', N'U') IS NULL
    CREATE TABLE dbo.TatStatusDays (
        Certification varchar(50) NOT NULL,                                  -- SectionTypes.SectionType (Bronze, Silver, ...)
        StatusCode    varchar(30) NOT NULL,                                  -- the portal's status code ('2', '15', ...)
        Days          int         NOT NULL CONSTRAINT CK_TatStatusDays_Days CHECK (Days BETWEEN 1 AND 365),
        UpdatedBy     varchar(50) NULL,
        UpdatedOn     datetime    NOT NULL CONSTRAINT DF_TatStatusDays_UpdatedOn DEFAULT (GETDATE()),
        CONSTRAINT PK_TatStatusDays PRIMARY KEY CLUSTERED (Certification, StatusCode)
    );
GO

-- ---------------------------------------------------------------- relations between statuses
IF OBJECT_ID(N'dbo.TatRelations', N'U') IS NULL
    CREATE TABLE dbo.TatRelations (
        Id            int IDENTITY(1, 1) NOT NULL CONSTRAINT PK_TatRelations PRIMARY KEY CLUSTERED,
        Name          nvarchar(100) NOT NULL,
        Certification varchar(50)   NULL,                                    -- NULL = every level
        FromStatus    varchar(30)   NOT NULL,
        ToStatus      varchar(30)   NOT NULL,
        Days          int           NOT NULL CONSTRAINT CK_TatRelations_Days CHECK (Days BETWEEN 1 AND 999),
        IsActive      bit           NOT NULL CONSTRAINT DF_TatRelations_IsActive DEFAULT (1),
        SortOrder     int           NOT NULL CONSTRAINT DF_TatRelations_SortOrder DEFAULT (0),
        UpdatedBy     varchar(50)   NULL,
        UpdatedOn     datetime      NOT NULL CONSTRAINT DF_TatRelations_UpdatedOn DEFAULT (GETDATE()),
        CONSTRAINT CK_TatRelations_FromTo CHECK (FromStatus <> ToStatus)
    );
GO

-- ---------------------------------------------------------------- man-days per level (legacy levels table)
IF DB_NAME() IN (N'ZEDCS_V2_LIVE', N'ZED_SURVEILLANCE') AND OBJECT_ID(N'dbo.SectionTypes', N'U') IS NOT NULL
   AND COL_LENGTH('dbo.SectionTypes', 'ManDays') IS NULL
    ALTER TABLE dbo.SectionTypes ADD ManDays int NULL CONSTRAINT CK_SectionTypes_ManDays CHECK (ManDays BETWEEN 1 AND 30);
GO
IF DB_NAME() IN (N'ZEDCS_V2_LIVE', N'ZED_SURVEILLANCE') AND OBJECT_ID(N'dbo.SectionTypes', N'U') IS NOT NULL
   AND COL_LENGTH('dbo.SectionTypes', 'SurveillanceManDays') IS NULL
    ALTER TABLE dbo.SectionTypes ADD SurveillanceManDays int NULL
        CONSTRAINT CK_SectionTypes_SurveillanceManDays CHECK (SurveillanceManDays BETWEEN 1 AND 30);
GO
PRINT CONCAT(DB_NAME(), N': 0101 TAT tables and man-days ready.');
GO
