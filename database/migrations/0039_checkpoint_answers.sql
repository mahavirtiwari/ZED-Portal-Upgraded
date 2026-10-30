-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (each keeps the units' copy of the questionnaire). Additive and
-- safe to re-run. Needs 0034 (the checkpoints' actions and evidence links on ZEDCS_V2_LIVE and ZED_SURVEILLANCE).
-- Yes / Partial / No for each checkpoint of a requirement (V4): the units' checkpoints are their rows of dbo.MsmeOptions
-- (copied from dbo.Options at payment; handholding copies main's). The assessor or the handholding consultant answers each
-- one; for No / Partial they tick the Admin's actions needed (Options.ActionsNeeded) that apply. Kept in new columns of
-- that existing table:
--   DaAnswer, DaActions, DaRemarks   desktop assessment (Staff/Assessment/DesktopAssessmentController.cs)
--   SaAnswer, SaActions, SaRemarks   site / remote assessment, lead assessor (Remote/RemoteAssessmentController.cs)
--   HhAnswer, HhActions, HhRemarks   handholding baseline, milestone 1 (Consultancy/Milestones/MilestoneReviewController.cs)
--   HhReview1, HhReview2             handholding progress reviews 1 and 2 (milestones 2 and 3)
--   AnsweredBy, AnsweredOn           who answered last, and when
-- Answers are 'Yes', 'Partial' or 'No'; the actions are the ticked ones, one per line. The requirement's existing
-- conformance (MsmeRequirements.Conformance / SaConformance) is still set through the legacy procedures: Yes when every
-- checkpoint is Yes, otherwise No (a Partial counts as not conforming). The MSME screens, the apps and the legacy
-- procedures are not changed (their inserts name their columns).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.MsmeOptions', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.MsmeOptions', 'DaAnswer') IS NULL ALTER TABLE dbo.MsmeOptions ADD DaAnswer varchar(10) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'DaActions') IS NULL ALTER TABLE dbo.MsmeOptions ADD DaActions nvarchar(2000) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'DaRemarks') IS NULL ALTER TABLE dbo.MsmeOptions ADD DaRemarks nvarchar(1000) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'SaAnswer') IS NULL ALTER TABLE dbo.MsmeOptions ADD SaAnswer varchar(10) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'SaActions') IS NULL ALTER TABLE dbo.MsmeOptions ADD SaActions nvarchar(2000) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'SaRemarks') IS NULL ALTER TABLE dbo.MsmeOptions ADD SaRemarks nvarchar(1000) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'HhAnswer') IS NULL ALTER TABLE dbo.MsmeOptions ADD HhAnswer varchar(10) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'HhActions') IS NULL ALTER TABLE dbo.MsmeOptions ADD HhActions nvarchar(2000) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'HhRemarks') IS NULL ALTER TABLE dbo.MsmeOptions ADD HhRemarks nvarchar(1000) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'HhReview1') IS NULL ALTER TABLE dbo.MsmeOptions ADD HhReview1 varchar(10) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'HhReview2') IS NULL ALTER TABLE dbo.MsmeOptions ADD HhReview2 varchar(10) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'AnsweredBy') IS NULL ALTER TABLE dbo.MsmeOptions ADD AnsweredBy varchar(50) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'AnsweredOn') IS NULL ALTER TABLE dbo.MsmeOptions ADD AnsweredOn datetime NULL;
END
GO
