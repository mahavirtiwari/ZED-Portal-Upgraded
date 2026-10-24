-- New in V4 (not part of the legacy schema). Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT,
-- ZED_SURVEILLANCE). Additive and safe to re-run: one new table.
-- Settings the Admin changes on the portal, one row per setting (Zed.Core/Data/PortalSettings.cs). In use:
-- 'CaptchaMode' (Off, Text or Google; Admin → Settings → Captcha Settings, Zed.Core/Security/Captcha.cs) and the
-- 'Email.*' mailboxes (Admin → Settings → Email Settings, Zed.Core/Email/EmailAddresses.cs; Email.DbMailBcc and
-- Email.DbReportRecipients are read by Zed.Jobs for the procedures' mail). Without the table, or without a row, the
-- portal uses its configuration (Recaptcha:Enabled, Email:ContactInbox, Email:RegistrationCc, ...).
-- The portal logins need SELECT, INSERT, UPDATE and DELETE on it, the Zed.Jobs login SELECT (the zed_v4_app role has
-- them through db_datareader/db_datawriter).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4Settings', 'U') IS NULL
CREATE TABLE dbo.V4Settings
(
    SettingKey   varchar(100)  NOT NULL CONSTRAINT PK_V4Settings PRIMARY KEY,
    SettingValue nvarchar(400) NOT NULL,
    UpdatedBy    varchar(50)   NULL,   -- Users.UserId of the Admin who saved it
    UpdatedOn    datetime2(0)  NOT NULL CONSTRAINT DF_V4Settings_UpdatedOn DEFAULT SYSUTCDATETIME()
);
GO
