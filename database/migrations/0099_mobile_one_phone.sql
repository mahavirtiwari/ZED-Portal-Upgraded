-- V4 0099 (2026-11-18): one phone per staff user in every ZED mobile app except the ZED MSME app (the user: "Master admin
-- will release the mobile then assessor can use new one"; record IP address, make, model).
-- Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT, ZED_SURVEILLANCE): each mobile host writes its own
-- dbo.MobileDeviceBindings / dbo.MobileDeviceEvents (migration 0001). Additive and safe to re-run.
--
-- dbo.MobileDeviceBindings (V4 table, one row per app, user and phone) gets what the apps send at sign-in:
--   Make        the phone's manufacturer (deviceInfo.manufacturer; Model keeps "manufacturer model" as before)
--   ApiLevel    the Android API level (deviceInfo.apiLevel)
--   AppVersion  the app's version (the sign-in's "version")
--   FirstIp     the IP address of the first sign-in on this phone (LastIp stays the latest)
-- dbo.MobileDeviceEvents gets the release history (Outcome 'Released': the old phone's DeviceId and Model, who released it
-- and why; Ip is the releasing user's address):
--   Model       the released phone's make and model
--   ReleasedBy  the Admin / Master Admin user id
--   Reason      the reason typed in the release pop-up (required by the portal)
-- and an index for the "refused sign-in today" and release-history reads by user.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50099, '0099 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
GO
IF OBJECT_ID('dbo.MobileDeviceBindings', 'U') IS NULL OR OBJECT_ID('dbo.MobileDeviceEvents', 'U') IS NULL
    THROW 50099, '0099 needs 0001 (dbo.MobileDeviceBindings, dbo.MobileDeviceEvents).', 1;
GO
IF COL_LENGTH('dbo.MobileDeviceBindings', 'Make') IS NULL
    ALTER TABLE dbo.MobileDeviceBindings ADD Make varchar(100) NULL;
GO
IF COL_LENGTH('dbo.MobileDeviceBindings', 'ApiLevel') IS NULL
    ALTER TABLE dbo.MobileDeviceBindings ADD ApiLevel int NULL;
GO
IF COL_LENGTH('dbo.MobileDeviceBindings', 'AppVersion') IS NULL
    ALTER TABLE dbo.MobileDeviceBindings ADD AppVersion varchar(50) NULL;
GO
IF COL_LENGTH('dbo.MobileDeviceBindings', 'FirstIp') IS NULL
    ALTER TABLE dbo.MobileDeviceBindings ADD FirstIp varchar(50) NULL;
GO
IF COL_LENGTH('dbo.MobileDeviceEvents', 'Model') IS NULL
    ALTER TABLE dbo.MobileDeviceEvents ADD Model varchar(100) NULL;
GO
IF COL_LENGTH('dbo.MobileDeviceEvents', 'ReleasedBy') IS NULL
    ALTER TABLE dbo.MobileDeviceEvents ADD ReleasedBy varchar(50) NULL;
GO
IF COL_LENGTH('dbo.MobileDeviceEvents', 'Reason') IS NULL
    ALTER TABLE dbo.MobileDeviceEvents ADD Reason nvarchar(500) NULL;
GO
-- Phones recorded before 0099: the first IP is not known any more; the latest one is the best there is.
UPDATE dbo.MobileDeviceBindings SET FirstIp = LastIp WHERE FirstIp IS NULL AND LastIp IS NOT NULL;
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MobileDeviceEvents_User' AND object_id = OBJECT_ID('dbo.MobileDeviceEvents'))
    CREATE INDEX IX_MobileDeviceEvents_User ON dbo.MobileDeviceEvents (UserKey, AppKind, At) INCLUDE (Outcome, Refused);
GO
