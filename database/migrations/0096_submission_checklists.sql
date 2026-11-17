-- 2026-11-17 (approved): Admin → Submission checklists and Admin → Observation reasons.
-- Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT, ZED_SURVEILLANCE), after 0088. Additive and safe to re-run;
-- no new table: the lists are JSON in each system's dbo.V4Settings (0011; keys Checklist.AgencyQc, Checklist.AssessorSubmit,
-- Checklist.CoQc, Checklist.ConsultantSubmit, Quality.Reasons), the ticks rows of the legacy dbo.AssessorComments (as 0088):
--   AssessmentType 'SubmitChk'   the checklist ticked with one submission (assessor / consultant final submit, agency /
--                                consultant organisation quality check): AssessorRemarks = the items as ticked ("1. ...", one
--                                per line), CertificationStatusDate = when, QoCategory = the checklist (agency-qc,
--                                assessor-submit, co-qc, consultant-submit), QoStage = Desktop / Site / Remote / Onsite /
--                                Milestone n, QoRound = the NC round (the milestone in handholding), QoRefLabel = who ticked
--                                as shown (Agency, Lead assessor, ...), QoAgencyId = the agency when known, QoBy / QoByName.
-- NcCount stays NULL on these rows, so the legacy procedures (which read AssessorComments by NcCount = n) never see them.
-- QoCategory is widened for the reasons the Admin words (up to 150 characters, any script): varchar(60) → nvarchar(150).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.AssessorComments', 'QoCategory') IS NOT NULL AND COL_LENGTH('dbo.AssessorComments', 'QoCategory') < 300
    ALTER TABLE dbo.AssessorComments ALTER COLUMN QoCategory nvarchar(150) NULL;
GO
IF OBJECT_ID(N'dbo.AssessorComments', N'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND minor_id = 0
                   AND major_id = OBJECT_ID(N'dbo.AssessorComments') AND name = N'V4_0096_SubmitChecklist')
    EXEC sys.sp_addextendedproperty @name = N'V4_0096_SubmitChecklist', @value = N'2026-11-17: SubmitChk rows (submission checklists)',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'AssessorComments';
GO
