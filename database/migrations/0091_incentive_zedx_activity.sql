-- Run on ZEDCS_V2_LIVE (dbo.Incentives). Additive and safe to re-run.
-- 2026-11-16 (the user, approved): Incentives → an incentive applies to ZED-X (Export) certified units too, and to
-- Manufacturing, Services or both kinds of MSME (their Udyam major activity). Two new columns of the existing table:
--   dbo.Incentives.ApplicableForZEDX   bit         1 = ZED-X certified units (as ApplicableForBronze / Silver / Gold)
--   dbo.Incentives.ApplicableActivity  varchar(20) 'Manufacturing' or 'Services'; NULL = both (every incentive so far)
-- The legacy procedures are not changed: SP_MASTER_GET_INCENTIVES and SP_GET_INCENTIVES read SELECT *, so V4 sees the
-- columns and the old sites ignore them. V4 saves them (and the levels of a saved incentive) with its own UPDATE.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Incentives', 'ApplicableForZEDX') IS NULL
    ALTER TABLE dbo.Incentives ADD ApplicableForZEDX bit NULL;
GO
IF COL_LENGTH('dbo.Incentives', 'ApplicableActivity') IS NULL
    ALTER TABLE dbo.Incentives ADD ApplicableActivity varchar(20) NULL;
GO
