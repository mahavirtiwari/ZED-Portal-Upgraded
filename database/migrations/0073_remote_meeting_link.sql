-- Run on ZEDCS_V2_LIVE. Additive and safe to re-run.
-- 2026-11-14 (Desktop + Remote, Remote only): a remote site assessment on main carries the meeting link the agency enters
-- when allotting it (as surveillance does), in a new column of the existing table:
--   dbo.MsmeCertifications.MeetingLink   varchar(5000) NULL, as ZED_SURVEILLANCE's (http/https only, checked by the portal)
-- The legacy procedures are not changed: SP_ASSESSMENT_ACCEPT_UNIT_FOR_SA (remote branch) runs as before and the portal
-- writes the link after it (SiteAssessmentController).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.MsmeCertifications', 'MeetingLink') IS NULL
    ALTER TABLE dbo.MsmeCertifications ADD MeetingLink varchar(5000) NULL;
GO
PRINT '0073: remote assessment meeting links ready on ' + DB_NAME() + '.';
GO
