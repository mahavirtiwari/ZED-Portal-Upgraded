-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (each portal has its own logins). Safe to re-run.
--
-- The scope of a Master Admin or Ministry login (2026-11-07, at the Admin's request; Admin → User Management):
-- the MSMEs and applications the login works with, and the most the users it creates can be given. New columns of the
-- legacy table (0028 already added SectorActivity on ZEDCS_V2_LIVE for agencies and assessors; it is reused):
--   dbo.Users.SectorActivity  'Manufacturing', 'Services' or 'Both'; NULL = both
--   dbo.Users.ScopeLevels     the certification levels, comma-separated codes ('Bronze,Silver'); NULL = every level
--   dbo.Users.ScopeStates     the plant states, comma-separated state codes (Master Admin only); NULL = every state
-- Today's logins keep NULL: no limit.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50057, '0057 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
GO
IF COL_LENGTH('dbo.Users', 'SectorActivity') IS NULL ALTER TABLE dbo.Users ADD SectorActivity varchar(20) NULL;
IF COL_LENGTH('dbo.Users', 'ScopeLevels') IS NULL ALTER TABLE dbo.Users ADD ScopeLevels varchar(200) NULL;
IF COL_LENGTH('dbo.Users', 'ScopeStates') IS NULL ALTER TABLE dbo.Users ADD ScopeStates varchar(1000) NULL;
GO
