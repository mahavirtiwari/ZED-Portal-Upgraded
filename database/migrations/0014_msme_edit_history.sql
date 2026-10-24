-- New in V4 (not part of the legacy schema). Run on ZEDCS_V2_LIVE (the MSME's own database). Additive and safe to
-- re-run: one new table.
-- The applicant's (MSME's) change history (Zed.Core/Security/MsmeEditHistory.cs): every change made in the MSME login on
-- the web (profile, payment GSTIN/PAN and payment start, financial assistance, technology upgradation, handholding
-- milestone acceptance, password) and in the MSME app (basic information, photos, ESG checklist, financial assistance,
-- NC replies, final submit, password), successful or refused, with the values submitted (passwords, OTPs, tokens and
-- captcha answers masked; files as name and size), IP address and device. Every host writes and reads it by its
-- three-part name (the staff of all three portals see it in the MSME profile; the MSME under Edit History).
-- The V4 logins need INSERT and SELECT on it (the zed_v4_app role has them through db_datareader/db_datawriter).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4MsmeEditHistory', 'U') IS NULL
CREATE TABLE dbo.V4MsmeEditHistory
(
    Id         bigint IDENTITY(1, 1) NOT NULL CONSTRAINT PK_V4MsmeEditHistory PRIMARY KEY,
    At         datetime2(0)   NOT NULL CONSTRAINT DF_V4MsmeEditHistory_At DEFAULT SYSUTCDATETIME(),   -- UTC
    System     varchar(20)    NOT NULL,   -- Main, Consultancy, Surveillance, Mobile API
    Channel    varchar(10)    NOT NULL,   -- Web, Mobile
    ZedId      varchar(100)   NOT NULL,
    Action     varchar(100)   NOT NULL,   -- e.g. "Financial assistance: document uploaded"
    Path       varchar(200)   NULL,
    Result     varchar(10)    NOT NULL,   -- Success, Failed
    Message    nvarchar(400)  NULL,       -- the message shown when refused
    Data       nvarchar(max)  NULL,       -- submitted values (JSON, at most 8000 characters)
    IpAddress  varchar(50)    NULL,
    DeviceId   varchar(200)   NULL,       -- the app's device registration ID or the browser's zed.device ID
    UserAgent  nvarchar(400)  NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_V4MsmeEditHistory_ZedId' AND object_id = OBJECT_ID('dbo.V4MsmeEditHistory'))
    CREATE INDEX IX_V4MsmeEditHistory_ZedId ON dbo.V4MsmeEditHistory (ZedId, Id DESC);
GO
