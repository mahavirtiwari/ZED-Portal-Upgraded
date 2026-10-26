-- New in V4 (not part of the legacy schema). Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT,
-- ZED_SURVEILLANCE). Additive and safe to re-run: one new table.
-- The mail servers (SMTP) the Admin sets per module on Admin → Settings → Email Settings (Zed.Core/Email/SmtpServers.cs):
-- one row per module (Default, Registration, Otp, Login, Payment, DocumentUpload, Allocation, Certification, Schemes,
-- Contact, Database). A module without a row uses the Default row; without a Default row, the server configuration
-- (Email:Profiles). The password is encrypted for the server's machine (Windows DPAPI, LocalMachine), so a copy of the
-- database does not reveal it and another server cannot read it (it must then be entered again there).
-- The portal logins need SELECT, INSERT, UPDATE and DELETE on it, the Zed.Jobs login SELECT (the zed_v4_app role has
-- them through db_datareader/db_datawriter).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4SmtpServers', 'U') IS NULL
CREATE TABLE dbo.V4SmtpServers
(
    Module            varchar(50)    NOT NULL CONSTRAINT PK_V4SmtpServers PRIMARY KEY,
    Host              nvarchar(255)  NOT NULL,
    Port              int            NOT NULL,
    UseStartTls       bit            NOT NULL,
    FromAddress       nvarchar(320)  NOT NULL,
    UserName          nvarchar(320)  NULL,
    PasswordProtected nvarchar(2000) NULL,   -- DPAPI LocalMachine, base64 with a "dpapi1:" prefix
    UpdatedBy         varchar(50)    NULL,   -- Users.UserId of the Admin who saved it
    UpdatedOn         datetime2(0)   NOT NULL CONSTRAINT DF_V4SmtpServers_UpdatedOn DEFAULT SYSUTCDATETIME()
);
GO
