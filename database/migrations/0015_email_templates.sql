-- New in V4 (not part of the legacy schema). Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT,
-- ZED_SURVEILLANCE). Additive and safe to re-run: one new table.
-- Admin → Email Templates (Zed.Core/Email/EmailTemplates.cs): per e-mail, whether it is sent and, optionally, the Admin's
-- own subject and HTML body with {{Placeholder}} fields ({{StandardBody}} / {{StandardSubject}} give the standard
-- e-mail). Keys: the portal's Razor template name (e.g. PaymentConfirmationEmail), or "db:<procedure>" for the database
-- procedures' mails, which Zed.Jobs applies when it sends the outbox (run migration 0003 again first: it records the
-- sending procedure in V4MailOutbox.Source). No row: the standard e-mail is sent.
-- The V4 logins need SELECT, INSERT, UPDATE and DELETE on it, Zed.Jobs SELECT (zed_v4_app / zed_v4_jobs have them).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4EmailTemplates', 'U') IS NULL
CREATE TABLE dbo.V4EmailTemplates
(
    TemplateKey  varchar(150)   NOT NULL CONSTRAINT PK_V4EmailTemplates PRIMARY KEY,
    Enabled      bit            NOT NULL CONSTRAINT DF_V4EmailTemplates_Enabled DEFAULT 1,
    Subject      nvarchar(400)  NULL,
    BodyHtml     nvarchar(max)  NULL,
    UpdatedBy    varchar(50)    NULL,
    UpdatedOn    datetime2(0)   NOT NULL CONSTRAINT DF_V4EmailTemplates_UpdatedOn DEFAULT SYSUTCDATETIME()
);
GO
