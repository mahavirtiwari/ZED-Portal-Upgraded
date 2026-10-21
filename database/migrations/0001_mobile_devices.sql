-- New in V4 (not part of the legacy schema). Run on ZEDCS_V2_LIVE before the mobile API goes live.
-- Devices that have signed in to a mobile app as a user, and calls from other devices.
-- Used by Zed.Core.Mobile.SqlDeviceBindings; see docs/MOBILE-API.md.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.MobileDeviceBindings', 'U') IS NULL
CREATE TABLE dbo.MobileDeviceBindings
(
    AppKind      varchar(10)  NOT NULL,  -- MSME, SA, RA
    UserKey      varchar(100) NOT NULL,  -- ZED ID or assessor user id
    DeviceId     varchar(200) NOT NULL,
    Model        varchar(100) NULL,
    OsVersion    varchar(50)  NULL,
    FirstSeenAt  datetime2(0) NOT NULL,
    LastLoginAt  datetime2(0) NOT NULL,
    LastSeenAt   datetime2(0) NOT NULL,
    LastIp       varchar(50)  NULL,
    CONSTRAINT PK_MobileDeviceBindings PRIMARY KEY (AppKind, UserKey, DeviceId)
);
GO
IF OBJECT_ID('dbo.MobileDeviceEvents', 'U') IS NULL
CREATE TABLE dbo.MobileDeviceEvents
(
    Id        bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_MobileDeviceEvents PRIMARY KEY,
    AppKind   varchar(10)  NOT NULL,
    UserKey   varchar(100) NOT NULL,
    DeviceId  varchar(200) NULL,
    Path      varchar(200) NOT NULL,
    Ip        varchar(50)  NULL,
    Outcome   varchar(20)  NOT NULL,     -- Unknown, Missing
    Refused   bit          NOT NULL,
    At        datetime2(0) NOT NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_MobileDeviceEvents_At')
CREATE INDEX IX_MobileDeviceEvents_At ON dbo.MobileDeviceEvents (At) INCLUDE (Path, Outcome, Refused);
GO
