-- V4 0097 (2026-11-17): the applicant's notification bell (the user: "Notification bell: yes, build it").
-- Run on ZEDCS_V2_LIVE (deploy\Invoke-ZedDatabaseScripts.ps1 does). Safe to re-run.
--
-- The bell lists the unit's history lines (MsmeHistory of the three databases); the ones after the unit last opened
-- the bell are unread. When that was is a column of the unit's legacy record (dbo.Msme), not a V4 side table.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50097, '0097 runs on ZEDCS_V2_LIVE.', 1;
GO
IF COL_LENGTH('dbo.Msme', 'NotificationsSeenOn') IS NULL
    ALTER TABLE dbo.Msme ADD NotificationsSeenOn datetime NULL;
GO
