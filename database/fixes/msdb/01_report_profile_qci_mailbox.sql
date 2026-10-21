-- SECURITY-FINDINGS #130: the Database Mail profile ZED_Report_Profile ("ZED Daily Reporting") sends through a vendor's
-- mailbox (account GeoStat_Outlook). This moves the profile to the QCI mailbox dev.zed@qcin.org.
--
-- Run in SSMS on the instance that holds the profile (the old instance now; the new SQL Server 2022 Standard server
-- too, if Database Mail is set up there for the other applications). It only touches msdb Database Mail
-- configuration: profile ZED_Report_Profile, the new account QCI_ZED_Reports and, if asked, the old account
-- GeoStat_Outlook. No ZED database changes.
--
--   @Mode = 'PREVIEW' (default)  shows the profile's accounts now and what APPLY would do; changes nothing.
--   @Mode = 'APPLY'              creates (or updates) account QCI_ZED_Reports, makes it the profile's only account and
--                                takes GeoStat_Outlook out of the profile. All or nothing.
--   @Password                    the mailbox password, needed for APPLY when the account is new or the password changes.
--                                Type it here only in your SSMS window; never save it in this file.
--   @DeleteVendorAccount = 1     also deletes the account GeoStat_Outlook (only if no other profile uses it). Its
--                                stored credential goes with it.
--   @SendTestTo                  after APPLY, sends one test mail through the profile to this address.
--
-- What breaks: whatever sends through ZED_Report_Profile now sends as dev.zed@qcin.org. Mail already queued keeps the
-- old account until it is sent or fails. Run it again: "nothing to change".
-- SMTP: the other QCI accounts of this instance use smtp-mail.outlook.com:587 with TLS; change @Server/@Port if the
-- mailbox uses another server. Microsoft 365 must allow SMTP AUTH for the mailbox (docs/JOBS.md "Mail").
USE [msdb];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Mode varchar(10) = 'PREVIEW';
DECLARE @Password nvarchar(256) = NULL;
DECLARE @DeleteVendorAccount bit = 0;
DECLARE @SendTestTo nvarchar(256) = NULL;

DECLARE @Profile sysname = N'ZED_Report_Profile';
DECLARE @Account sysname = N'QCI_ZED_Reports';
DECLARE @Address nvarchar(128) = N'dev.zed@qcin.org';
DECLARE @DisplayName nvarchar(128) = N'ZED Daily Reporting';
DECLARE @Server sysname = N'smtp-mail.outlook.com';
DECLARE @Port int = 587;
DECLARE @VendorAccount sysname = N'GeoStat_Outlook';

IF @Mode NOT IN ('PREVIEW', 'APPLY') THROW 50100, '@Mode must be PREVIEW or APPLY.', 1;

DECLARE @ProfileId int = (SELECT profile_id FROM dbo.sysmail_profile WHERE name = @Profile);
DECLARE @AccountId int = (SELECT account_id FROM dbo.sysmail_account WHERE name = @Account);
DECLARE @VendorId int = (SELECT account_id FROM dbo.sysmail_account WHERE name = @VendorAccount);
DECLARE @VendorElsewhere int = (SELECT COUNT(*) FROM dbo.sysmail_profileaccount WHERE account_id = @VendorId AND profile_id <> ISNULL(@ProfileId, -1));

PRINT CONCAT('Profile ', @Profile, CASE WHEN @ProfileId IS NULL THEN ': not found' ELSE ': found' END,
             ' | account ', @Account, CASE WHEN @AccountId IS NULL THEN ': to be created' ELSE ': exists' END,
             ' | account ', @VendorAccount, CASE WHEN @VendorId IS NULL THEN ': not found' ELSE CONCAT(': exists, used by ', @VendorElsewhere, ' other profile(s)') END);
SELECT p.name AS profile_name, a.name AS account_name, a.email_address, a.display_name, s.servername, s.port, pa.sequence_number
FROM dbo.sysmail_profile p
LEFT JOIN dbo.sysmail_profileaccount pa ON pa.profile_id = p.profile_id
LEFT JOIN dbo.sysmail_account a ON a.account_id = pa.account_id
LEFT JOIN dbo.sysmail_server s ON s.account_id = a.account_id
WHERE p.name = @Profile
ORDER BY pa.sequence_number;

IF @ProfileId IS NULL THROW 50101, 'Profile ZED_Report_Profile does not exist on this instance: nothing to move.', 1;

DECLARE @NeedsAccount bit = CASE WHEN @AccountId IS NULL THEN 1 ELSE 0 END;
DECLARE @NeedsLink bit = CASE WHEN NOT EXISTS (SELECT 1 FROM dbo.sysmail_profileaccount WHERE profile_id = @ProfileId AND account_id = @AccountId) THEN 1 ELSE 0 END;
DECLARE @OtherAccounts int = (SELECT COUNT(*) FROM dbo.sysmail_profileaccount WHERE profile_id = @ProfileId AND account_id <> ISNULL(@AccountId, -1));
DECLARE @DeleteVendor bit = CASE WHEN @DeleteVendorAccount = 1 AND @VendorId IS NOT NULL AND @VendorElsewhere = 0 THEN 1 ELSE 0 END;

IF @NeedsAccount = 0 AND @NeedsLink = 0 AND @OtherAccounts = 0 AND @DeleteVendor = 0 AND @Password IS NULL
BEGIN
    PRINT 'Nothing to change: the profile sends only through ' + @Account + '.';
    RETURN;
END

PRINT CONCAT('Plan: ', CASE WHEN @NeedsAccount = 1 THEN 'create account ' + @Account + ' (' + @Address + ' via ' + @Server + ':' + CAST(@Port AS varchar(10)) + ', TLS); '
                            WHEN @Password IS NOT NULL THEN 'update the password of ' + @Account + '; ' ELSE '' END,
             CASE WHEN @NeedsLink = 1 THEN 'add it to the profile as account 1; ' ELSE '' END,
             CASE WHEN @OtherAccounts > 0 THEN CONCAT('remove the profile''s other ', @OtherAccounts, ' account(s); ') ELSE '' END,
             CASE WHEN @DeleteVendor = 1 THEN 'delete account ' + @VendorAccount + '; '
                  WHEN @DeleteVendorAccount = 1 AND @VendorElsewhere > 0 THEN @VendorAccount + ' is used by another profile: kept; ' ELSE '' END);

IF @Mode = 'PREVIEW'
BEGIN
    PRINT 'PREVIEW: nothing changed. Set @Mode = ''APPLY'' (and @Password) to apply.';
    RETURN;
END

IF @NeedsAccount = 1 AND (@Password IS NULL OR @Password = N'')
    THROW 50102, 'APPLY: @Password is needed to create the account (type it in this window only).', 1;

BEGIN TRAN;
    IF @NeedsAccount = 1
    BEGIN
        EXEC dbo.sysmail_add_account_sp @account_name = @Account, @email_address = @Address, @display_name = @DisplayName,
             @replyto_address = NULL, @description = N'ZED daily reports (replaces the vendor mailbox, SECURITY-FINDINGS 130)',
             @mailserver_name = @Server, @mailserver_type = N'SMTP', @port = @Port, @enable_ssl = 1,
             @use_default_credentials = 0, @username = @Address, @password = @Password;
        SET @AccountId = (SELECT account_id FROM dbo.sysmail_account WHERE name = @Account);
    END
    ELSE IF @Password IS NOT NULL
        EXEC dbo.sysmail_update_account_sp @account_name = @Account, @email_address = @Address, @display_name = @DisplayName,
             @mailserver_name = @Server, @mailserver_type = N'SMTP', @port = @Port, @enable_ssl = 1,
             @use_default_credentials = 0, @username = @Address, @password = @Password;

    DECLARE @Other int;
    WHILE 1 = 1
    BEGIN
        SET @Other = (SELECT TOP (1) account_id FROM dbo.sysmail_profileaccount WHERE profile_id = @ProfileId AND account_id <> @AccountId);
        IF @Other IS NULL BREAK;
        EXEC dbo.sysmail_delete_profileaccount_sp @profile_id = @ProfileId, @account_id = @Other;
    END
    IF NOT EXISTS (SELECT 1 FROM dbo.sysmail_profileaccount WHERE profile_id = @ProfileId AND account_id = @AccountId)
        EXEC dbo.sysmail_add_profileaccount_sp @profile_id = @ProfileId, @account_id = @AccountId, @sequence_number = 1;

    IF @DeleteVendor = 1
        EXEC dbo.sysmail_delete_account_sp @account_name = @VendorAccount;
COMMIT;
PRINT 'APPLY: done. The profile now sends only through ' + @Account + '.';

IF @SendTestTo IS NOT NULL
    EXEC dbo.sp_send_dbmail @profile_name = @Profile, @recipients = @SendTestTo,
         @subject = N'ZED Daily Reporting: test after the mailbox change', @body = N'Database Mail profile ZED_Report_Profile now sends through the QCI mailbox.';
