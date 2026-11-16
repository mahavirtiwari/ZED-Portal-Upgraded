-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (each has its own dbo.Sectors). Additive and safe to re-run.
-- 2026-11-16 (the user, approved): Admin → Masters → Sectors can disable a sector. A disabled sector is left out of the
-- pick-lists (technologies, user / agency sectors, the MSME profile's sector change); the units and records that already
-- have it keep it, and registration is not blocked. A new column of the existing table: dbo.Sectors.IsDisabled (1 =
-- disabled, NULL or 0 = in use). The legacy procedures are not changed (SP_MASTER_GET_SECTORS reads SELECT *, so V4
-- sees the column; the old sites ignore it). V4 sets it with its own UPDATE.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Sectors', 'IsDisabled') IS NULL
    ALTER TABLE dbo.Sectors ADD IsDisabled bit NULL;
GO
