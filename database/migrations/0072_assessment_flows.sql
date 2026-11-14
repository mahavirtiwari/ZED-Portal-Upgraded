-- Run on ZEDCS_V2_LIVE and ZED_SURVEILLANCE (after 0028). Additive and safe to re-run.
-- 2026-11-14 (approved): how a certification level is assessed and which assessments an assessor may do. Kept in new
-- columns of the existing legacy tables:
--   dbo.SectionTypes.AssessmentFlow    Desktop | Remote | Onsite | DesktopRemote | DesktopOnsite (Administration →
--                                      Certification Levels → Certificate → Assessment); NULL = as before (Desktop only for
--                                      a desktop level, Desktop + Onsite for the others). The old AssessmentMode column
--                                      stays in step ('Desktop' / 'Site'), so the procedures and the apps are unchanged.
--   dbo.SectionTypes.SurveillanceMode  Remote | Onsite (Surveillance → Mode of assessment); NULL = Remote (today's flow).
--   dbo.Users.AssessmentModes          an assessor's levels and modes, e.g. 'Bronze=D;Silver=D,O' (D desktop, R remote,
--                                      O onsite); NULL = from the old AssessorType (Bronze Assessor: Bronze desktop;
--                                      Assessor: every other level, all its modes).
-- Nothing else changes: the legacy procedures insert with column lists and read by column name.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.SectionTypes', 'U') IS NOT NULL AND COL_LENGTH('dbo.SectionTypes', 'AssessmentFlow') IS NULL
    ALTER TABLE dbo.SectionTypes ADD AssessmentFlow varchar(20) NULL;
GO
IF OBJECT_ID('dbo.SectionTypes', 'U') IS NOT NULL AND COL_LENGTH('dbo.SectionTypes', 'SurveillanceMode') IS NULL
    ALTER TABLE dbo.SectionTypes ADD SurveillanceMode varchar(10) NULL;
GO
IF OBJECT_ID('dbo.SectionTypes', 'U') IS NOT NULL AND OBJECT_ID('dbo.CK_SectionTypes_AssessmentFlow', 'C') IS NULL
    ALTER TABLE dbo.SectionTypes WITH CHECK ADD CONSTRAINT CK_SectionTypes_AssessmentFlow
        CHECK (AssessmentFlow IS NULL OR AssessmentFlow IN ('Desktop', 'Remote', 'Onsite', 'DesktopRemote', 'DesktopOnsite'));
GO
IF OBJECT_ID('dbo.SectionTypes', 'U') IS NOT NULL AND OBJECT_ID('dbo.CK_SectionTypes_SurveillanceMode', 'C') IS NULL
    ALTER TABLE dbo.SectionTypes WITH CHECK ADD CONSTRAINT CK_SectionTypes_SurveillanceMode
        CHECK (SurveillanceMode IS NULL OR SurveillanceMode IN ('Remote', 'Onsite'));
GO
IF COL_LENGTH('dbo.Users', 'AssessmentModes') IS NULL
    ALTER TABLE dbo.Users ADD AssessmentModes nvarchar(1000) NULL;
GO
PRINT '0072: assessment flows and assessor modes ready on ' + DB_NAME() + '.';
GO
