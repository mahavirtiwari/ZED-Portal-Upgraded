-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (where migration 0017 made dbo.V4AppFormFields). Additive and
-- safe to re-run. Admin → App Forms: a field of the apps' Basic Information forms can be limited to certification levels
-- and to NIC sectors (new columns of the existing table; NULL = all, as before):
--   Levels      the level codes it is asked for, comma-separated (Bronze, Silver, Gold, ZEDX, ...)
--   NicSectors  the NIC 2-digit sectors of the units it is asked of, comma-separated
-- A field that does not apply to a unit is neither shown to it nor required of it (Zed.Core/Forms/AppForms.cs).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4AppFormFields', 'U') IS NOT NULL AND COL_LENGTH('dbo.V4AppFormFields', 'Levels') IS NULL
    ALTER TABLE dbo.V4AppFormFields ADD Levels varchar(300) NULL;
IF OBJECT_ID('dbo.V4AppFormFields', 'U') IS NOT NULL AND COL_LENGTH('dbo.V4AppFormFields', 'NicSectors') IS NULL
    ALTER TABLE dbo.V4AppFormFields ADD NicSectors varchar(2000) NULL;
GO
