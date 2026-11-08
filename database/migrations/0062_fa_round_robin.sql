-- Run on ZEDCS_V2_LIVE. Safe to re-run.
--
-- Financial assistance allotted by round robin (2026-11-08, at the Master Admin's request; before, the Master Admin allotted
-- each application by hand): when the MSME submits, and again when the allotted agency rejects it, the application goes to
-- the next eligible agency (Zed.Portal FaAutoAllotment). New columns of the legacy table:
--   dbo.FinancialAssistance.AllotmentType      'RoundRobin' or 'Manual' (NULL: allotted before this change)
--   dbo.FinancialAssistance.AllotmentDate      when the current agency was allotted (the rotation continues after the last one)
--   dbo.FinancialAssistance.RejectedAgencies   the agencies that returned it, comma-separated (not offered it again)
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50062, '0062 runs on ZEDCS_V2_LIVE.', 1;
GO
IF COL_LENGTH('dbo.FinancialAssistance', 'AllotmentType') IS NULL
    ALTER TABLE dbo.FinancialAssistance ADD AllotmentType varchar(20) NULL
        CONSTRAINT CK_FinancialAssistance_AllotmentType CHECK (AllotmentType IN ('RoundRobin', 'Manual'));
IF COL_LENGTH('dbo.FinancialAssistance', 'AllotmentDate') IS NULL ALTER TABLE dbo.FinancialAssistance ADD AllotmentDate datetime NULL;
IF COL_LENGTH('dbo.FinancialAssistance', 'RejectedAgencies') IS NULL ALTER TABLE dbo.FinancialAssistance ADD RejectedAgencies varchar(2000) NULL;
GO
