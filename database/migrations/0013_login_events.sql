-- New in V4 (not part of the legacy schema). Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT,
-- ZED_SURVEILLANCE). Additive and safe to re-run: one new table.
-- Every sign-in attempt, web and mobile, successful or not (Zed.Core/Security/LoginAudit.cs): who (the typed or signed-in
-- user, the sub-user working for an owner, the role), when, the result and the reason shown, and from where: IP address;
-- for the web the user agent with its browser, operating system and device type and a persistent browser ID (cookie
-- zed.device); for the apps the device registration ID, model, manufacturer, OS version, API level and app version
-- from the app's DeviceInfo. Never the password. Each host writes to its own database (the mobile API host to
-- ZEDCS_V2_LIVE). The V4 logins need INSERT and SELECT on it (the zed_v4_app role has them through
-- db_datareader/db_datawriter). Rows older than the retention the ZED team decides can be deleted at any time.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4LoginEvents', 'U') IS NULL
CREATE TABLE dbo.V4LoginEvents
(
    Id            bigint IDENTITY(1, 1) NOT NULL CONSTRAINT PK_V4LoginEvents PRIMARY KEY,
    At            datetime2(0)   NOT NULL CONSTRAINT DF_V4LoginEvents_At DEFAULT SYSUTCDATETIME(),   -- UTC
    System        varchar(20)    NOT NULL,   -- Main, Consultancy, Surveillance, Mobile API
    Channel       varchar(10)    NOT NULL,   -- Web, Mobile
    App           varchar(30)    NOT NULL,   -- Staff, MSME, Udyami Bharat, MSME registration, MSME app, Site assessment app, ...
    UserId        varchar(100)   NULL,       -- typed user ID / ZED ID, or the signed-in user
    ActingUserId  varchar(50)    NULL,       -- sub-user (V4SubUsers) working as UserId
    RoleId        int            NULL,
    Result        varchar(10)    NOT NULL,   -- Success, Failed
    Reason        nvarchar(200)  NULL,       -- the message shown when refused
    IpAddress     varchar(50)    NULL,
    UserAgent     nvarchar(400)  NULL,
    Browser       varchar(50)    NULL,
    Os            varchar(50)    NULL,
    DeviceType    varchar(20)    NULL,       -- Desktop, Mobile, Tablet (web) or App
    DeviceId      varchar(200)   NULL,       -- the app's device registration ID, or the web browser's zed.device ID
    DeviceModel   varchar(150)   NULL,
    Manufacturer  varchar(100)   NULL,
    OsVersion     varchar(50)    NULL,
    ApiLevel      int            NULL,
    AppVersion    varchar(50)    NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_V4LoginEvents_User' AND object_id = OBJECT_ID('dbo.V4LoginEvents'))
    CREATE INDEX IX_V4LoginEvents_User ON dbo.V4LoginEvents (UserId, At);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_V4LoginEvents_At' AND object_id = OBJECT_ID('dbo.V4LoginEvents'))
    CREATE INDEX IX_V4LoginEvents_At ON dbo.V4LoginEvents (At) INCLUDE (Result, Channel);
GO
