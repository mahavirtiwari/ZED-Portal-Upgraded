-- Run on ZEDCS_V2_LIVE and ZED_SURVEILLANCE (site assessments). Additive and safe to re-run.
-- The site assessor's check of each evidence the Admin lists for a requirement (V4, redesigned SA app): the units' evidences
-- are their rows of dbo.MsmeEvidences (copied from dbo.Evidences); at the site the assessor answers whether each is
-- available (Yes / No) and, when it is, photographs it (1 to 3 photos, taken or picked from the site tour). Kept in new
-- columns of that existing table:
--   SaAvailable    'Yes' or 'No'
--   SaPhotoIds     its photos, comma-separated (SaPhotos.PhotoId, sent with the parameter by SA/SubmitParameter)
--   SaAnsweredBy   the site assessor
--   SaAnsweredOn   when
-- A No keeps the requirement from conforming (Zed.Core.Assessment.SiteEvidenceChecks). The desktop assessor's IsVerified,
-- the MSME screens, the legacy procedures and the installed apps are not changed (their inserts name their columns).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.MsmeEvidences', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.MsmeEvidences', 'SaAvailable') IS NULL ALTER TABLE dbo.MsmeEvidences ADD SaAvailable varchar(10) NULL;
    IF COL_LENGTH('dbo.MsmeEvidences', 'SaPhotoIds') IS NULL ALTER TABLE dbo.MsmeEvidences ADD SaPhotoIds varchar(200) NULL;
    IF COL_LENGTH('dbo.MsmeEvidences', 'SaAnsweredBy') IS NULL ALTER TABLE dbo.MsmeEvidences ADD SaAnsweredBy varchar(50) NULL;
    IF COL_LENGTH('dbo.MsmeEvidences', 'SaAnsweredOn') IS NULL ALTER TABLE dbo.MsmeEvidences ADD SaAnsweredOn datetime NULL;
END
GO
