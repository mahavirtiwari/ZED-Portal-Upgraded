-- database\migrations\0120_remote_site_photo.sql  (ZEDCS_V2_LIVE only). Additive, safe to re-run.
--
-- 2026-11-28 (the owner: the MSME representative selfie belongs to Admin -> App Forms): the ZED MSME app's Remote Assessment
-- screen is now the App Forms form "msme.remoteAssessment" (representative name, designation, selfie, site exterior photo, and
-- the Admin's own fields). The screen always took a site exterior photo, but RA/SubmitSelfie dropped it. It is now saved next
-- to the selfie (Photos/{ZedId}/{level}/RA/SiteExterior.jpg) and recorded on the unit's selfie row, in a new column of the
-- legacy table, shown to the remote assessor with the selfie.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50120, '0120 runs on ZEDCS_V2_LIVE.', 1;
IF OBJECT_ID(N'dbo.MsmeSelfies', N'U') IS NULL
    THROW 50120, 'dbo.MsmeSelfies is missing.', 1;
GO
IF COL_LENGTH('dbo.MsmeSelfies', 'SitePhotoPath') IS NULL
    ALTER TABLE dbo.MsmeSelfies ADD SitePhotoPath varchar(2000) NULL;
GO
PRINT '0120: dbo.MsmeSelfies.SitePhotoPath in place.';
GO
