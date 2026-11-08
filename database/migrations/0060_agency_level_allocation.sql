-- Run on ZEDCS_V2_LIVE. Safe to re-run.
--
-- Agency level allocation (2026-11-08, at the Master Admin's request; Agencies -> Agency level allocation): the Master Admin
-- can disable Silver, Gold and ZED-X allotment for an assessment agency, as it could for Bronze (Users.AllowBronzeAssessments,
-- SP_BLOCK_UNBLOCK_BRONZE_AGENCY). New columns of the legacy table:
--   dbo.Users.AllowSilverAssessments / AllowGoldAssessments / AllowZedxAssessments   bit; NULL or 1 = may be allotted that level
--   dbo.Users.ReasonForBlockSilver / ReasonForBlockGold / ReasonForBlockZedx        why it was disabled
-- Every agency keeps every level (NULL); work already allotted is not changed.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50060, '0060 runs on ZEDCS_V2_LIVE.', 1;
GO
IF COL_LENGTH('dbo.Users', 'AllowSilverAssessments') IS NULL ALTER TABLE dbo.Users ADD AllowSilverAssessments bit NULL;
IF COL_LENGTH('dbo.Users', 'AllowGoldAssessments') IS NULL ALTER TABLE dbo.Users ADD AllowGoldAssessments bit NULL;
IF COL_LENGTH('dbo.Users', 'AllowZedxAssessments') IS NULL ALTER TABLE dbo.Users ADD AllowZedxAssessments bit NULL;
IF COL_LENGTH('dbo.Users', 'ReasonForBlockSilver') IS NULL ALTER TABLE dbo.Users ADD ReasonForBlockSilver nvarchar(2000) NULL;
IF COL_LENGTH('dbo.Users', 'ReasonForBlockGold') IS NULL ALTER TABLE dbo.Users ADD ReasonForBlockGold nvarchar(2000) NULL;
IF COL_LENGTH('dbo.Users', 'ReasonForBlockZedx') IS NULL ALTER TABLE dbo.Users ADD ReasonForBlockZedx nvarchar(2000) NULL;
GO
