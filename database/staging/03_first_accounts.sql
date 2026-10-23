-- STAGING ONLY. The first staff accounts of a set built from scratch (database\setup.ps1 -DatabasePrefix ZEDV4_;
-- docs/STAGING.md 3.0), without anyone typing a password into a file or a production password anywhere.
--
-- Run it in SSMS (or sqlcmd) on the staging server, after the V4 scripts (migrations 0005 and 0008 must be there).
-- It refuses to run unless @ThisIsStaging = 'YES' and @ExpectedServerName equals @@SERVERNAME, and on an Azure SQL
-- Managed Instance (production runs on one).
--
-- What it does, in the prefixed ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE:
--   1. Creates the accounts in @Accounts that do not exist yet (an existing UserId is left exactly as it is). Each gets
--      a random password value ("V4!" + 46 hex digits), which V4 never accepts as a password, even typed exactly
--      (docs/PASSWORDS.md), so nobody knows a password of these accounts until they set their own; Email = @MailTo.
--   2. Issues a one-time password link for the accounts in @IssueLinks (by default the MasterAdmins only), as an
--      administrator would (V4PasswordResets, RequestedBy = 'staging-setup'): StaffPasswordReset:ExcludedRoles is kept,
--      MasterAdmin (7) and SuperAdmin (10) still cannot reset through "Forgot password?", but an administrator may send
--      them a link, and that is what this step is. The links are shown once, in this window's results; they work once,
--      for @LinkValidMinutes, and only their SHA-256 is stored. Treat them like passwords: open each in a browser, set
--      the password, close the window. A new run issues new links and the old ones stop working.
--   3. The other accounts set their password with "Forgot password?" on their portal's staff login: the link goes to
--      their e-mail, @MailTo, and staging mail goes to dev.zed@qcin.org anyway (Email:RedirectAllTo). Or the MasterAdmin
--      sends them a link (Password Reset Link). Or run this script with @IssueLinks = 'ALL'.
--
-- @Mode = 'PREVIEW' (default): lists what it would create and issue; changes nothing. 'APPLY': does it.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
USE [master];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Mode varchar(10) = 'PREVIEW';
DECLARE @ThisIsStaging varchar(3) = NULL;                -- type YES to confirm this is the staging server
DECLARE @ExpectedServerName sysname = NULL;              -- must equal SELECT @@SERVERNAME on this server
DECLARE @DatabasePrefix sysname = N'ZEDV4_';
DECLARE @StagingBaseUrl varchar(200) = 'https://zedv3.qci.org.in';
DECLARE @MailTo varchar(200) = 'dev.zed@qcin.org';       -- Users.Email of every new account
DECLARE @IssueLinks varchar(20) = 'MASTERADMIN';         -- MASTERADMIN, ALL or NONE
DECLARE @LinkValidMinutes int = 1440;                     -- 1 to 1440

-- One row per account and system. Change the ids and names if you like; keep the roles. Sub-roles are the
-- Users.DesktopVerification / SiteVerification / FinancialVerification bits (menus and procedures read them).
DECLARE @Accounts TABLE (System varchar(20), UserId varchar(50), UserName varchar(200), RoleId int, Desktop bit, Site bit, Financial bit, CreatedBy varchar(50), Purpose varchar(100));
INSERT @Accounts VALUES
    ('Main',         'ZEDV4MA01',  'STAGING MASTER ADMIN',       7, 1, 1, 1, 'staging-setup', 'MasterAdmin'),
    ('Main',         'ZEDV4AG01',  'STAGING ASSESSMENT AGENCY',  2, 1, 1, 1, 'staging-setup', 'certification agency'),
    ('Main',         'ZEDV4DA01',  'STAGING DESKTOP ASSESSOR',   3, 1, 0, 0, 'ZEDV4AG01',     'desktop assessor of the agency'),
    ('Main',         'ZEDV4SA01',  'STAGING SITE ASSESSOR',      4, 0, 1, 0, 'ZEDV4AG01',     'site assessor of the agency'),
    ('Consultancy',  'ZEDV4MA01',  'STAGING MASTER ADMIN',       7, 1, 1, 1, 'staging-setup', 'MasterAdmin'),
    ('Consultancy',  'ZEDV4CO01',  'STAGING CONSULTANT ORG',     2, 1, 1, 1, 'staging-setup', 'consultant organisation (CO)'),
    ('Consultancy',  'ZEDV4CC01',  'STAGING CONSULTANT',         3, 0, 1, 0, 'ZEDV4CO01',     'consultant of the CO'),
    ('Consultancy',  'ZEDV4DFO01', 'STAGING DFO',                3, 0, 0, 1, 'ZEDV4CO01',     'TU verifier (DFO)'),
    ('Surveillance', 'ZEDV4MA01',  'STAGING MASTER ADMIN',       7, 1, 1, 1, 'staging-setup', 'MasterAdmin'),
    ('Surveillance', 'ZEDV4AG01',  'STAGING ASSESSMENT AGENCY',  2, 1, 1, 1, 'staging-setup', 'surveillance agency'),
    ('Surveillance', 'ZEDV4SA01',  'STAGING SITE ASSESSOR',      4, 0, 1, 0, 'ZEDV4AG01',     'surveillance site assessor');

-- ---------------------------------------------------------------- guards
IF @Mode NOT IN ('PREVIEW', 'APPLY') THROW 50300, '@Mode must be PREVIEW or APPLY.', 1;
IF @IssueLinks NOT IN ('MASTERADMIN', 'ALL', 'NONE') THROW 50301, '@IssueLinks must be MASTERADMIN, ALL or NONE.', 1;
IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 8 OR @@SERVERNAME LIKE '%.database.windows.net%'
    THROW 50302, 'This is an Azure SQL Managed Instance (production runs on one): refused.', 1;
IF ISNULL(@ThisIsStaging, '') <> 'YES' THROW 50303, 'Refused: set @ThisIsStaging = ''YES'' after checking this is the staging server.', 1;
IF @ExpectedServerName IS NULL OR @ExpectedServerName <> @@SERVERNAME THROW 50304, 'Refused: @ExpectedServerName must equal @@SERVERNAME of this server.', 1;
IF @DatabasePrefix LIKE N'%[^A-Za-z0-9_]%' OR LEN(@DatabasePrefix) > 20 THROW 50305, '@DatabasePrefix: letters, digits and _ only (at most 20).', 1;
IF @LinkValidMinutes NOT BETWEEN 1 AND 1440 THROW 50306, '@LinkValidMinutes must be 1 to 1440.', 1;
SET @StagingBaseUrl = RTRIM(@StagingBaseUrl);
IF RIGHT(@StagingBaseUrl, 1) = '/' SET @StagingBaseUrl = LEFT(@StagingBaseUrl, LEN(@StagingBaseUrl) - 1);
IF @StagingBaseUrl NOT LIKE 'https://%' OR @StagingBaseUrl LIKE '%loginzed.msme.gov.in%'
    THROW 50307, 'Refused: @StagingBaseUrl must be an https address that is not the live site.', 1;

DECLARE @Systems TABLE (System varchar(20) PRIMARY KEY, Db sysname, PathBase varchar(50));
INSERT @Systems VALUES ('Main', @DatabasePrefix + N'ZEDCS_V2_LIVE', ''), ('Consultancy', @DatabasePrefix + N'ZED_CONSULTANT', '/Consultancy'),
    ('Surveillance', @DatabasePrefix + N'ZED_SURVEILLANCE', '/surveillance');
DECLARE @missing nvarchar(400) = N'';
SELECT @missing += s.Db + N' ' FROM @Systems s WHERE DB_ID(s.Db) IS NULL;
IF @missing <> N'' BEGIN SET @missing = N'Refused: database(s) not on this server: ' + @missing; THROW 50308, @missing, 1; END
SET @missing = N'';
SELECT @missing += s.Db + N' ' FROM @Systems s
WHERE OBJECT_ID(s.Db + N'.dbo.V4PasswordResets', N'U') IS NULL OR OBJECT_ID(s.Db + N'.dbo.SP_V4_STAFF_RESET_CREATE', N'P') IS NULL;
IF @missing <> N'' BEGIN SET @missing = N'Refused: run the V4 scripts first (migration 0008 is missing in ' + @missing + N')'; THROW 50309, @missing, 1; END

-- ---------------------------------------------------------------- plan
IF OBJECT_ID('tempdb..#Plan') IS NOT NULL DROP TABLE #Plan;
CREATE TABLE #Plan (Seq int IDENTITY PRIMARY KEY, System varchar(20), Db sysname, UserId varchar(50), RoleId int, Purpose varchar(100), Exists_ bit, Link bit);
INSERT #Plan (System, Db, UserId, RoleId, Purpose, Exists_, Link)
SELECT a.System, s.Db, a.UserId, a.RoleId, a.Purpose, 0,
       CASE WHEN @IssueLinks = 'ALL' OR (@IssueLinks = 'MASTERADMIN' AND a.RoleId = 7) THEN 1 ELSE 0 END
FROM @Accounts a JOIN @Systems s ON s.System = a.System;
DECLARE @seq int = 0, @db sysname, @uid varchar(50), @found int, @q nvarchar(max), @exec nvarchar(300);
WHILE 1 = 1
BEGIN
    SELECT TOP (1) @seq = Seq, @db = Db, @uid = UserId FROM #Plan WHERE Seq > @seq ORDER BY Seq;
    IF @@ROWCOUNT = 0 BREAK;
    SET @exec = QUOTENAME(@db) + N'.sys.sp_executesql';
    EXEC @exec N'SELECT @found = COUNT(*) FROM dbo.Users WHERE UserId = @uid', N'@uid varchar(50), @found int OUTPUT', @uid = @uid, @found = @found OUTPUT;
    UPDATE #Plan SET Exists_ = CASE WHEN @found > 0 THEN 1 ELSE 0 END WHERE Seq = @seq;
END

SELECT p.System, p.Db AS [Database], p.UserId, p.RoleId, p.Purpose,
       CASE WHEN p.Exists_ = 1 THEN 'exists: left as it is' ELSE 'create' END AS Account,
       CASE WHEN p.Link = 1 THEN 'one-time link' ELSE 'Forgot password? (mail to ' + @MailTo + ')' END AS [Password]
FROM #Plan p ORDER BY p.Seq;

IF @Mode = 'PREVIEW'
BEGIN
    PRINT 'PREVIEW: nothing changed. Set @Mode = ''APPLY'', @ThisIsStaging = ''YES'' and @ExpectedServerName to apply.';
    RETURN;
END

-- ---------------------------------------------------------------- apply
DECLARE @Links TABLE (System varchar(20), UserId varchar(50), RoleId int, Link varchar(400), ExpiresUtc datetime2(0));
DECLARE @name varchar(200), @role int, @d bit, @s bit, @f bit, @by varchar(50), @value varchar(50), @system varchar(20), @path varchar(50),
        @raw varbinary(32), @token varchar(64), @hash binary(32), @link bit;
DECLARE @r TABLE (Created bit);
SET @seq = 0;
WHILE 1 = 1
BEGIN
    SELECT TOP (1) @seq = p.Seq, @db = p.Db, @uid = p.UserId, @system = p.System, @found = p.Exists_, @name = a.UserName, @role = a.RoleId,
           @d = a.Desktop, @s = a.Site, @f = a.Financial, @by = a.CreatedBy, @path = s.PathBase, @link = p.Link
    FROM #Plan p JOIN @Accounts a ON a.System = p.System AND a.UserId = p.UserId JOIN @Systems s ON s.System = p.System
    WHERE p.Seq > @seq ORDER BY p.Seq;
    IF @@ROWCOUNT = 0 BREAK;
    SET @exec = QUOTENAME(@db) + N'.sys.sp_executesql';
    IF @found = 0
    BEGIN
        -- A value no login accepts (PasswordStore.ReplacementPrefix): the account has no usable password yet.
        SET @value = 'V4!' + CONVERT(varchar(46), CRYPT_GEN_RANDOM(23), 2);
        SET @q = N'INSERT dbo.Users (UserId, Password, UserName, RoleId, IsActive, Email, CreatedBy, CreatedDate, DesktopVerification, SiteVerification, FinancialVerification)
                   VALUES (@uid, @value, @name, @role, 1, @mail, @by, GETDATE(), @d, @s, @f);';
        EXEC @exec @q, N'@uid varchar(50), @value varchar(50), @name varchar(200), @role int, @mail varchar(200), @by varchar(50), @d bit, @s bit, @f bit',
            @uid = @uid, @value = @value, @name = @name, @role = @role, @mail = @MailTo, @by = @by, @d = @d, @s = @s, @f = @f;
    END
    IF @link = 1
    BEGIN
        -- Same token as PasswordResetTokens.NewToken (32 random bytes, base64url, 43 characters); only its SHA-256 is stored.
        SET @raw = CRYPT_GEN_RANDOM(32);
        SET @token = REPLACE(REPLACE(REPLACE(CAST(N'' AS xml).value('xs:base64Binary(sql:variable("@raw"))', 'varchar(64)'), '=', ''), '+', '-'), '/', '_');
        SET @hash = HASHBYTES('SHA2_256', @token);
        SET @q = N'EXEC dbo.SP_V4_STAFF_RESET_CREATE @UserId = @uid, @TokenHash = @hash, @ValidMinutes = @minutes, @MaxPerHour = 1, @RequestedBy = ''staging-setup'';';
        INSERT @r EXEC @exec @q, N'@uid varchar(50), @hash binary(32), @minutes int', @uid = @uid, @hash = @hash, @minutes = @LinkValidMinutes;
        INSERT @Links VALUES (@system, @uid, @role, @StagingBaseUrl + @path + '/reset-password#token=' + @token, DATEADD(MINUTE, @LinkValidMinutes, SYSUTCDATETIME()));
    END
END

SELECT System, UserId, RoleId, Link AS [One-time password link (treat as a password)], ExpiresUtc FROM @Links ORDER BY System, UserId;
DECLARE @newAccounts int = (SELECT COUNT(*) FROM #Plan WHERE Exists_ = 0), @newLinks int = (SELECT COUNT(*) FROM @Links);
PRINT CONCAT('APPLY: done. ', @newAccounts, ' account(s) created, ', @newLinks, ' link(s) issued. A new run issues new links (the old ones stop working) and leaves the accounts as they are.');
