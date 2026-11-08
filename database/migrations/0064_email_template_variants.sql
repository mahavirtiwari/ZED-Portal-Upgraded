-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (after 0015). Safe to re-run: the copy is made once.
--
-- Email Templates (2026-11-08): e-mails that one template sent in several cases are now separate entries, so the Admin can
-- word or switch off each (Zed.Portal/Templates/EmailTemplateVariants.cs):
--   StaffLoginDetailsEmail         a new login            StaffLoginDetailsEmail.Reset    a new password / link sent again
--                                                         StaffLoginDetailsEmail.SubUser  a new sub-user
--   PasswordChangedEmail           staff                  PasswordChangedEmail.Msme       an MSME (main)
-- An edit the Admin had made to the shared entry is copied to each new entry the first time this runs, so the mails stay as
-- they were; afterwards each entry is the Admin's own (a later reset of a new entry is not undone by the next run). The
-- extended property V4_0064_Variants on dbo.V4EmailTemplates records that the copy was made.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF OBJECT_ID('dbo.V4EmailTemplates', 'U') IS NULL
    THROW 50064, '0064 needs dbo.V4EmailTemplates (migration 0015).', 1;
GO
IF NOT EXISTS (SELECT 1 FROM sys.extended_properties
               WHERE major_id = OBJECT_ID('dbo.V4EmailTemplates') AND minor_id = 0 AND name = N'V4_0064_Variants')
BEGIN
    BEGIN TRANSACTION;
    INSERT INTO dbo.V4EmailTemplates (TemplateKey, Enabled, Subject, BodyHtml, UpdatedBy)
    SELECT v.NewKey, t.Enabled, t.Subject, t.BodyHtml, LEFT(CONCAT(N'0064 (', ISNULL(t.UpdatedBy, N'Admin'), N')'), 50)
    FROM (VALUES (N'StaffLoginDetailsEmail', N'StaffLoginDetailsEmail.Reset'),
                 (N'StaffLoginDetailsEmail', N'StaffLoginDetailsEmail.SubUser'),
                 (N'PasswordChangedEmail',   N'PasswordChangedEmail.Msme')) AS v(BaseKey, NewKey)
    JOIN dbo.V4EmailTemplates t ON t.TemplateKey = v.BaseKey
    WHERE NOT EXISTS (SELECT 1 FROM dbo.V4EmailTemplates x WHERE x.TemplateKey = v.NewKey);
    PRINT CONCAT(DB_NAME(), N': ', @@ROWCOUNT, N' e-mail template edit(s) copied to the separate entries.');
    EXEC sys.sp_addextendedproperty @name = N'V4_0064_Variants', @value = N'2026-11-08',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = N'V4EmailTemplates';
    COMMIT TRANSACTION;
END
GO
