-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE. Additive and safe to re-run (needs 0034 and 0039).
-- 2026-11-13: an action needed of a checkpoint can be up to 500 characters (was 100), still at most 20 per checkpoint.
-- Twenty actions of 500 characters, one per line, no longer fit nvarchar(4000), so the columns that keep them become
-- nvarchar(max) (same legacy tables, no data changed):
--   dbo.Options.ActionsNeeded                     the Admin's actions of each checkpoint (ZEDCS_V2_LIVE, ZED_SURVEILLANCE)
--   dbo.MsmeOptions.DaActions, SaActions, HhActions  the actions the assessor / consultant ticked (all three)
-- A column that is already nvarchar(max) is left alone. The legacy procedures, the MSME screens and the apps are not
-- affected (they do not use these columns).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Options', 'ActionsNeeded') IS NOT NULL AND COL_LENGTH('dbo.Options', 'ActionsNeeded') <> -1
    ALTER TABLE dbo.Options ALTER COLUMN ActionsNeeded nvarchar(max) NULL;
GO
IF OBJECT_ID('dbo.MsmeOptions', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.MsmeOptions', 'DaActions') IS NOT NULL AND COL_LENGTH('dbo.MsmeOptions', 'DaActions') <> -1
        ALTER TABLE dbo.MsmeOptions ALTER COLUMN DaActions nvarchar(max) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'SaActions') IS NOT NULL AND COL_LENGTH('dbo.MsmeOptions', 'SaActions') <> -1
        ALTER TABLE dbo.MsmeOptions ALTER COLUMN SaActions nvarchar(max) NULL;
    IF COL_LENGTH('dbo.MsmeOptions', 'HhActions') IS NOT NULL AND COL_LENGTH('dbo.MsmeOptions', 'HhActions') <> -1
        ALTER TABLE dbo.MsmeOptions ALTER COLUMN HhActions nvarchar(max) NULL;
END
GO
-- Main and surveillance keep the questionnaire: their ActionsNeeded must now be nvarchar(max) (the runner's markers check
-- only the MsmeOptions columns, which every database has).
IF COL_LENGTH('dbo.Options', 'ActionsNeeded') IS NOT NULL AND COL_LENGTH('dbo.Options', 'ActionsNeeded') <> -1
    THROW 50071, 'dbo.Options.ActionsNeeded is still not nvarchar(max).', 1;
PRINT '0071: the checkpoints'' actions can be up to 500 characters each on ' + DB_NAME() + '.';
GO
