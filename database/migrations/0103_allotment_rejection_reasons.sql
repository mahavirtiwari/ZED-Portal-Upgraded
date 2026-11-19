-- Run on ZEDCS_V2_LIVE and ZED_SURVEILLANCE. Additive and safe to re-run.
--
-- 2026-11-19 (the user, approved design): an assessment agency rejects a desktop or site allotment by picking a reason the
-- Admin lists (Admin -> Rejection Reasons, kept in dbo.V4Settings 'Allotment.RejectionReasons') with optional remarks; the
-- reason decides whether the unit is re-allotted at once by round robin (never to an agency that rejected it) or waits for
-- the Master Admin. Columns of the unit's level row (the legacy table):
--   dbo.MsmeCertifications.RejectionReasonId  the key of the reason picked at the last rejection
--   dbo.MsmeCertifications.RejectionRemarks   the agency's remarks (ReasonForRejection keeps "reason - remarks", 100 characters)
--   dbo.MsmeCertifications.RejectedAgencies   the agencies that rejected the unit, comma-separated (left out of the re-allotment)
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_SURVEILLANCE')
    THROW 50103, '0103 runs on ZEDCS_V2_LIVE and ZED_SURVEILLANCE.', 1;
GO
IF COL_LENGTH('dbo.MsmeCertifications', 'RejectionReasonId') IS NULL
    ALTER TABLE dbo.MsmeCertifications ADD RejectionReasonId varchar(40) NULL;
IF COL_LENGTH('dbo.MsmeCertifications', 'RejectionRemarks') IS NULL
    ALTER TABLE dbo.MsmeCertifications ADD RejectionRemarks nvarchar(1000) NULL;
IF COL_LENGTH('dbo.MsmeCertifications', 'RejectedAgencies') IS NULL
    ALTER TABLE dbo.MsmeCertifications ADD RejectedAgencies varchar(2000) NULL;
GO
