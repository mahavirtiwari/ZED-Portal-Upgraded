-- STAGING ONLY. Prepares a restored copy of the production databases for the staging server (docs/STAGING.md),
-- right after the restore and before any V4 host or Zed.Jobs points at it.
--
-- It refuses to run unless @ThisIsStaging = 'YES' and @ExpectedServerName equals @@SERVERNAME, and it always refuses
-- on an Azure SQL Managed Instance (production runs on one). Run it in SSMS connected to the staging server.
--
-- In ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE (those present on this server):
--   1. UrlsMasterData.UrlName: the production host (@ProductionHost) becomes @StagingBaseUrl, the path after the host is
--      kept (procedures build mail links and file paths from it). Rows naming other hosts are only counted.
--   2. V4MailOutbox: unsent rows are deleted (mail queued on production before the backup must not go out again).
--   3. Partner APIs (@DisableApiClients = 1, default): ApiClientTokens.Token, AesKey and AesIV get random values of the
--      same length ("staging-disabled-..." for tokens), ApiClientDynamicTokens.IsValid = 0, so partners' production
--      credentials do not work on staging. Give testers their own rows if partner APIs are to be tested.
--   4. Reset and login secrets: Users.PwdCode = NULL, ForgotPwdLinks emptied, open V4PasswordResets links invalidated,
--      OTP and OTP_old emptied, FailedLogins.Password = NULL. The Admin's office mailboxes (V4Settings 'Email.%', migration
--      0011) are deleted, so staging uses the addresses of its own configuration. The production sign-in history
--      (V4LoginEvents, migration 0013: IP addresses, devices) is emptied.
--   5. @ScramblePasswords = 1 (optional): every Users.Password except the @Testers accounts gets a random V4 value
--      ("V4!" + hex, never accepted as a password, docs/PASSWORDS.md) and their V4UserPasswords hash rows go, so the
--      production passwords of this copy cannot sign in on staging. Testers keep theirs (or reset them). Sub-users
--      (V4SubUsers, migration 0012) lose their password hash unless their UserId is in @Testers (their owner resets it).
--   6. @MaskContacts = 1 (optional, defence in depth on top of Email:RedirectAllTo): every char/varchar column of every
--      user table whose name says it holds an e-mail address or a mobile/phone number (%Email%, %Mobile%No%,
--      %MobileNumber%, %Phone%, %ContactNo%; not ...Body, ...Subject, ...Template, ...Status, ...Sent, ...Verified, ...Otp,
--      ...Count, ...Flag, ...Type, ...Date) gets a fixed masked value, except rows whose UserId or ZedId is in @Testers.
--      One statement per column (no long transaction); a column that refuses (unique index, check constraint) is
--      listed and skipped. Slow on the 76 GB database: run it in a quiet hour.
--   7. @RewriteModuleHosts = 1 (optional): procedures, functions, views and triggers whose code names the production
--      host (83 places in the schema exports: certificate QR / verify links of SP_DA_GET_CERTIFICATE_DETAILS,
--      SP_RA_GET_CERTIFICATE_DETAILS, SP_MSME_INSERT_UDYAM_DETAILS in main and surveillance, mail links, ...) are
--      re-created (CREATE OR ALTER, permissions and their ANSI_NULLS / QUOTED_IDENTIFIER settings kept) with
--      http(s)://<production host> replaced by @StagingBaseUrl, so staging QR codes and links do not open the live
--      site. One module at a time; a module that cannot be re-created is listed and left as it is. This makes the
--      staging code differ from production: run it AFTER the fix scripts were rehearsed (docs/STAGING.md 3.5).
-- Step 1 also rewrites the production host in PageSettings.FilePath (home-page banner) and ApiClientTokens.BaseUrl.
-- @RewriteHosts = 0 skips step 1 (for databases another staging site shares and whose links must stay as they are).
-- @DatabasePrefix = N'ZEDV4_': work on the prefixed set (database\setup.ps1 -DatabasePrefix: ZEDV4_ZEDCS_V2_LIVE, ...)
-- instead; databases without the prefix (an older staging set on the same server) are then not touched.
-- The other applications' databases on the server are not touched.
--
-- @Mode = 'PREVIEW' (default): counts only, changes nothing. 'APPLY': steps 1-5 in one transaction per database, then
-- step 6. Safe to re-run: a second APPLY finds nothing to change. Prints counts and object names only, never data.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;   -- needed for writes to tables with filtered indexes (sqlcmd starts with it OFF)
GO
USE [master];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Mode varchar(10) = 'PREVIEW';
DECLARE @ThisIsStaging varchar(3) = NULL;               -- type YES to confirm this is the staging copy
DECLARE @ExpectedServerName sysname = NULL;             -- must equal SELECT @@SERVERNAME on this server
DECLARE @ProductionHost varchar(200) = 'loginzed.msme.gov.in';
DECLARE @StagingBaseUrl varchar(200) = 'https://zedv3.qci.org.in';
DECLARE @RewriteHosts bit = 1;                          -- step 1 (0: leave stored links as they are)
DECLARE @DisableApiClients bit = 1;
DECLARE @ScramblePasswords bit = 0;
DECLARE @MaskContacts bit = 0;
DECLARE @RewriteModuleHosts bit = 0;
DECLARE @Testers nvarchar(max) = N'';                   -- comma-separated UserIds / ZED IDs kept as they are
DECLARE @DatabasePrefix sysname = N'';                  -- N'ZEDV4_' for the prefixed V4 set

-- ---------------------------------------------------------------- guards
IF @Mode NOT IN ('PREVIEW', 'APPLY') THROW 50200, '@Mode must be PREVIEW or APPLY.', 1;
IF @DatabasePrefix LIKE N'%[^A-Za-z0-9_]%' OR LEN(@DatabasePrefix) > 20 THROW 50205, '@DatabasePrefix: letters, digits and _ only (at most 20).', 1;
IF CAST(SERVERPROPERTY('EngineEdition') AS int) = 8 OR @@SERVERNAME LIKE '%.database.windows.net%'
    THROW 50201, 'This is an Azure SQL Managed Instance (production runs on one): refused.', 1;
IF ISNULL(@ThisIsStaging, '') <> 'YES' THROW 50202, 'Refused: set @ThisIsStaging = ''YES'' after checking this is the staging server.', 1;
IF @ExpectedServerName IS NULL OR @ExpectedServerName <> @@SERVERNAME
    THROW 50203, 'Refused: @ExpectedServerName must equal @@SERVERNAME of this server.', 1;
SET @StagingBaseUrl = RTRIM(@StagingBaseUrl);
IF RIGHT(@StagingBaseUrl, 1) = '/' SET @StagingBaseUrl = LEFT(@StagingBaseUrl, LEN(@StagingBaseUrl) - 1);
IF @StagingBaseUrl NOT LIKE 'https://%' OR @StagingBaseUrl LIKE '%' + @ProductionHost + '%'
    THROW 50204, 'Refused: @StagingBaseUrl must be an https address that is not the production host.', 1;
PRINT CONCAT('Mode ', @Mode, ' on ', @@SERVERNAME, ': ', @ProductionHost, ' -> ', @StagingBaseUrl,
             ' | stored links -> staging: ', @RewriteHosts, ' | partner APIs off: ', @DisableApiClients, ' | scramble passwords: ', @ScramblePasswords, ' | mask contacts: ', @MaskContacts,
             ' | rewrite module hosts: ', @RewriteModuleHosts, ' | databases: ', @DatabasePrefix, 'ZEDCS_V2_LIVE, ', @DatabasePrefix, 'ZED_CONSULTANT, ', @DatabasePrefix, 'ZED_SURVEILLANCE');

IF OBJECT_ID('tempdb..#Testers') IS NOT NULL DROP TABLE #Testers;
CREATE TABLE #Testers (Id varchar(50) COLLATE DATABASE_DEFAULT PRIMARY KEY);
INSERT #Testers (Id) SELECT DISTINCT LTRIM(RTRIM(value)) FROM STRING_SPLIT(@Testers, ',') WHERE LTRIM(RTRIM(value)) <> '';
DECLARE @testerCount int = (SELECT COUNT(*) FROM #Testers);
PRINT CONCAT('Tester accounts kept: ', @testerCount);

IF OBJECT_ID('tempdb..#Report') IS NOT NULL DROP TABLE #Report;
CREATE TABLE #Report (Db sysname, Step varchar(120), Rows bigint, Note nvarchar(400) NULL);

DECLARE @apply bit = CASE WHEN @Mode = 'APPLY' THEN 1 ELSE 0 END;
DECLARE @hostPattern varchar(220) = '%://' + @ProductionHost + '%';
DECLARE @params nvarchar(400) = N'@apply bit, @host varchar(200), @hostPattern varchar(220), @base varchar(200), @disableApi bit, @scramble bit, @rewriteHosts bit';

-- ---------------------------------------------------------------- steps 1-5, run inside each database
DECLARE @body nvarchar(max) = N'
SET NOCOUNT ON; SET XACT_ABORT ON;
DECLARE @n bigint;
IF @apply = 1 BEGIN TRAN;

-- 1. UrlsMasterData (@RewriteHosts = 1)
IF @rewriteHosts = 1 AND OBJECT_ID(N''dbo.UrlsMasterData'', N''U'') IS NOT NULL
BEGIN
    SELECT @n = COUNT(*) FROM dbo.UrlsMasterData WHERE UrlName LIKE @hostPattern;
    INSERT #Report VALUES (DB_NAME(), ''1 UrlsMasterData rows on the production host -> staging'', @n, NULL);
    IF @apply = 1
        UPDATE dbo.UrlsMasterData
        SET UrlName = @base + SUBSTRING(UrlName, CHARINDEX(@host, UrlName) + LEN(@host), 200)
        WHERE UrlName LIKE @hostPattern;
    SELECT @n = COUNT(*) FROM dbo.UrlsMasterData
    WHERE ISNULL(UrlName, '''') <> '''' AND UrlName NOT LIKE @hostPattern AND UrlName NOT LIKE @base + ''%'';
    IF @n > 0 INSERT #Report VALUES (DB_NAME(), ''1 UrlsMasterData rows on other hosts (left as they are)'', @n, NULL);
END
-- 1b. other stored absolute links: the home-page banner (SP_MASTER_INSERT_HOME_PAGE_SETTINGS prefixes the live host)
--     and the partners'' base addresses (SP_API_KEY_MAKER)
IF @rewriteHosts = 1 AND COL_LENGTH(N''dbo.PageSettings'', N''FilePath'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.PageSettings WHERE FilePath LIKE @hp'', N''@hp varchar(220), @n bigint OUTPUT'', @hp = @hostPattern, @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''1 PageSettings.FilePath on the production host -> staging'', @n, NULL);
    IF @apply = 1 AND @n > 0
        EXEC sp_executesql N''UPDATE dbo.PageSettings SET FilePath = @b + SUBSTRING(FilePath, CHARINDEX(@h, FilePath) + LEN(@h), 500) WHERE FilePath LIKE @hp'',
             N''@b varchar(200), @h varchar(200), @hp varchar(220)'', @b = @base, @h = @host, @hp = @hostPattern;
END
IF @rewriteHosts = 1 AND COL_LENGTH(N''dbo.ApiClientTokens'', N''BaseUrl'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.ApiClientTokens WHERE BaseUrl LIKE @hp'', N''@hp varchar(220), @n bigint OUTPUT'', @hp = @hostPattern, @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''1 ApiClientTokens.BaseUrl on the production host -> staging'', @n, NULL);
    IF @apply = 1 AND @n > 0
        EXEC sp_executesql N''UPDATE dbo.ApiClientTokens SET BaseUrl = @b + SUBSTRING(BaseUrl, CHARINDEX(@h, BaseUrl) + LEN(@h), 500) WHERE BaseUrl LIKE @hp'',
             N''@b varchar(200), @h varchar(200), @hp varchar(220)'', @b = @base, @h = @host, @hp = @hostPattern;
END

-- 2. unsent V4 mail
IF OBJECT_ID(N''dbo.V4MailOutbox'', N''U'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.V4MailOutbox WHERE SentAt IS NULL'', N''@n bigint OUTPUT'', @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''2 V4MailOutbox unsent rows deleted'', @n, NULL);
    IF @apply = 1 EXEC sp_executesql N''DELETE FROM dbo.V4MailOutbox WHERE SentAt IS NULL'';
END

-- 3. partner APIs
IF @disableApi = 1 AND OBJECT_ID(N''dbo.ApiClientTokens'', N''U'') IS NOT NULL
BEGIN
    SELECT @n = COUNT(*) FROM dbo.ApiClientTokens WHERE ISNULL(Token, '''') NOT LIKE ''staging-disabled-%'';
    INSERT #Report VALUES (DB_NAME(), ''3 ApiClientTokens tokens (and AES keys) replaced'', @n, NULL);
    IF @apply = 1 AND @n > 0
    BEGIN
        IF COL_LENGTH(N''dbo.ApiClientTokens'', N''AesKey'') IS NOT NULL AND COL_LENGTH(N''dbo.ApiClientTokens'', N''AesIV'') IS NOT NULL
            EXEC sp_executesql N''UPDATE dbo.ApiClientTokens
                SET AesKey = CASE WHEN AesKey IS NULL THEN NULL ELSE LEFT(CONVERT(varchar(400), CRYPT_GEN_RANDOM(150), 2), LEN(AesKey)) END,
                    AesIV  = CASE WHEN AesIV  IS NULL THEN NULL ELSE LEFT(CONVERT(varchar(400), CRYPT_GEN_RANDOM(150), 2), LEN(AesIV)) END
                WHERE ISNULL(Token, '''''''') NOT LIKE ''''staging-disabled-%'''''';
        UPDATE dbo.ApiClientTokens SET Token = ''staging-disabled-'' + CONVERT(varchar(64), CRYPT_GEN_RANDOM(32), 2)
        WHERE ISNULL(Token, '''') NOT LIKE ''staging-disabled-%'';
    END
END
IF @disableApi = 1 AND OBJECT_ID(N''dbo.ApiClientDynamicTokens'', N''U'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.ApiClientDynamicTokens WHERE ISNULL(IsValid, 0) = 1'', N''@n bigint OUTPUT'', @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''3 ApiClientDynamicTokens invalidated'', @n, NULL);
    IF @apply = 1 EXEC sp_executesql N''UPDATE dbo.ApiClientDynamicTokens SET IsValid = 0 WHERE ISNULL(IsValid, 0) = 1'';
END

-- 4. reset and login secrets
IF COL_LENGTH(N''dbo.Users'', N''PwdCode'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.Users WHERE PwdCode IS NOT NULL'', N''@n bigint OUTPUT'', @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''4 Users.PwdCode cleared'', @n, NULL);
    IF @apply = 1 EXEC sp_executesql N''UPDATE dbo.Users SET PwdCode = NULL WHERE PwdCode IS NOT NULL'';
END
IF OBJECT_ID(N''dbo.ForgotPwdLinks'', N''U'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.ForgotPwdLinks'', N''@n bigint OUTPUT'', @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''4 ForgotPwdLinks rows deleted'', @n, NULL);
    IF @apply = 1 EXEC sp_executesql N''DELETE FROM dbo.ForgotPwdLinks'';
END
IF OBJECT_ID(N''dbo.V4PasswordResets'', N''U'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.V4PasswordResets WHERE UsedAt IS NULL AND InvalidatedAt IS NULL'', N''@n bigint OUTPUT'', @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''4 V4PasswordResets open links invalidated'', @n, NULL);
    IF @apply = 1 EXEC sp_executesql N''UPDATE dbo.V4PasswordResets SET InvalidatedAt = SYSUTCDATETIME() WHERE UsedAt IS NULL AND InvalidatedAt IS NULL'';
END
IF OBJECT_ID(N''dbo.OTP'', N''U'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.OTP'', N''@n bigint OUTPUT'', @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''4 OTP rows deleted'', @n, NULL);
    IF @apply = 1 EXEC sp_executesql N''DELETE FROM dbo.OTP'';
END
IF OBJECT_ID(N''dbo.OTP_old'', N''U'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.OTP_old'', N''@n bigint OUTPUT'', @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''4 OTP_old rows deleted'', @n, NULL);
    IF @apply = 1 EXEC sp_executesql N''DELETE FROM dbo.OTP_old'';
END
IF OBJECT_ID(N''dbo.V4Settings'', N''U'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.V4Settings WHERE SettingKey LIKE ''''Email.%'''''', N''@n bigint OUTPUT'', @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''4 V4Settings office mailboxes deleted'', @n, NULL);
    IF @apply = 1 EXEC sp_executesql N''DELETE FROM dbo.V4Settings WHERE SettingKey LIKE ''''Email.%'''''';
END
IF OBJECT_ID(N''dbo.V4LoginEvents'', N''U'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.V4LoginEvents'', N''@n bigint OUTPUT'', @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''4 V4LoginEvents rows deleted'', @n, NULL);
    IF @apply = 1 EXEC sp_executesql N''DELETE FROM dbo.V4LoginEvents'';
END
IF COL_LENGTH(N''dbo.FailedLogins'', N''Password'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.FailedLogins WHERE Password IS NOT NULL'', N''@n bigint OUTPUT'', @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''4 FailedLogins.Password cleared'', @n, NULL);
    IF @apply = 1 EXEC sp_executesql N''UPDATE dbo.FailedLogins SET Password = NULL WHERE Password IS NOT NULL'';
END

-- 5. production passwords (optional)
IF @scramble = 1 AND COL_LENGTH(N''dbo.Users'', N''Password'') IS NOT NULL
BEGIN
    SELECT @n = COUNT(*) FROM dbo.Users U
    WHERE ISNULL(U.Password, '''') NOT LIKE ''V4!%'' AND NOT EXISTS (SELECT 1 FROM #Testers T WHERE T.Id = U.UserId);
    INSERT #Report VALUES (DB_NAME(), ''5 Users.Password scrambled (non-testers)'', @n, NULL);
    IF @apply = 1
    BEGIN
        UPDATE U SET Password = ''V4!'' + CONVERT(varchar(46), CRYPT_GEN_RANDOM(23), 2)
        FROM dbo.Users U
        WHERE ISNULL(U.Password, '''') NOT LIKE ''V4!%'' AND NOT EXISTS (SELECT 1 FROM #Testers T WHERE T.Id = U.UserId);
        IF OBJECT_ID(N''dbo.V4UserPasswords'', N''U'') IS NOT NULL
            EXEC sp_executesql N''DELETE P FROM dbo.V4UserPasswords P WHERE NOT EXISTS (SELECT 1 FROM #Testers T WHERE T.Id = P.UserId)'';
    END
END
IF @scramble = 1 AND OBJECT_ID(N''dbo.V4SubUsers'', N''U'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.V4SubUsers S WHERE S.PasswordHash IS NOT NULL AND NOT EXISTS (SELECT 1 FROM #Testers T WHERE T.Id = S.UserId)'',
        N''@n bigint OUTPUT'', @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''5 V4SubUsers passwords removed (non-testers)'', @n, NULL);
    IF @apply = 1
        EXEC sp_executesql N''UPDATE S SET PasswordHash = NULL FROM dbo.V4SubUsers S WHERE S.PasswordHash IS NOT NULL AND NOT EXISTS (SELECT 1 FROM #Testers T WHERE T.Id = S.UserId)'';
END

IF @apply = 1 COMMIT;';

-- ---------------------------------------------------------------- step 6, run inside each database (optional)
DECLARE @maskBody nvarchar(max) = N'
SET NOCOUNT ON;
SET XACT_ABORT OFF;   -- a column that refuses (unique index, constraint) is skipped, not fatal
DECLARE @cols TABLE (Sch sysname, Tab sysname, Col sysname, Kind char(1), Len int, HasUser bit, HasZed bit);
INSERT @cols
SELECT SCHEMA_NAME(o.schema_id), o.name, c.name,
       CASE WHEN c.name LIKE ''%mail%'' THEN ''E'' ELSE ''M'' END,
       CASE WHEN c.max_length = -1 THEN 100 WHEN TYPE_NAME(c.user_type_id) LIKE ''n%'' THEN c.max_length / 2 ELSE c.max_length END,
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns x WHERE x.object_id = o.object_id AND x.name = ''UserId'') THEN 1 ELSE 0 END,
       CASE WHEN EXISTS (SELECT 1 FROM sys.columns x WHERE x.object_id = o.object_id AND x.name = ''ZedId'') THEN 1 ELSE 0 END
FROM sys.columns c JOIN sys.tables o ON o.object_id = c.object_id
WHERE o.is_ms_shipped = 0 AND o.name NOT LIKE ''V4%'' AND c.is_computed = 0
  AND TYPE_NAME(c.user_type_id) IN (''varchar'', ''nvarchar'', ''char'', ''nchar'')
  AND (c.max_length = -1 OR c.max_length >= 10)
  AND (c.name LIKE ''%Email%'' OR c.name LIKE ''%Mobile%No%'' OR c.name LIKE ''%MobileNumber%'' OR c.name LIKE ''%Phone%'' OR c.name LIKE ''%ContactNo%'')
  AND c.name NOT LIKE ''%Body%'' AND c.name NOT LIKE ''%Subject%'' AND c.name NOT LIKE ''%Template%'' AND c.name NOT LIKE ''%Status%''
  AND c.name NOT LIKE ''%Sent%'' AND c.name NOT LIKE ''%Verified%'' AND c.name NOT LIKE ''%Otp%'' AND c.name NOT LIKE ''%Count%''
  AND c.name NOT LIKE ''%Flag%'' AND c.name NOT LIKE ''%Type%'' AND c.name NOT LIKE ''%Date%'';
DECLARE @s sysname, @t sysname, @c sysname, @k char(1), @len int, @hu bit, @hz bit, @sql nvarchar(max), @value varchar(40), @n bigint;
DECLARE cols CURSOR LOCAL FAST_FORWARD FOR SELECT Sch, Tab, Col, Kind, Len, HasUser, HasZed FROM @cols ORDER BY Tab, Col;
OPEN cols;
FETCH NEXT FROM cols INTO @s, @t, @c, @k, @len, @hu, @hz;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @value = LEFT(CASE WHEN @k = ''E'' THEN ''masked@staging.invalid'' ELSE ''9000000000'' END, @len);
    SET @sql = N'' FROM '' + QUOTENAME(@s) + N''.'' + QUOTENAME(@t) + N'' AS X WHERE X.'' + QUOTENAME(@c) + N'' IS NOT NULL AND LTRIM(X.'' + QUOTENAME(@c)
             + N'') <> '''''''' AND X.'' + QUOTENAME(@c) + N'' <> @v''
             + CASE WHEN @hu = 1 THEN N'' AND NOT EXISTS (SELECT 1 FROM #Testers T WHERE T.Id = X.UserId)'' ELSE N'''' END
             + CASE WHEN @hz = 1 THEN N'' AND NOT EXISTS (SELECT 1 FROM #Testers T WHERE T.Id = X.ZedId)'' ELSE N'''' END;
    BEGIN TRY
        IF @apply = 1
        BEGIN
            DECLARE @upd nvarchar(max) = N''UPDATE X SET X.'' + QUOTENAME(@c) + N'' = @v'' + @sql + N''; SET @n = @@ROWCOUNT;'';
            EXEC sp_executesql @upd, N''@v varchar(40), @n bigint OUTPUT'', @v = @value, @n = @n OUTPUT;
        END
        ELSE
        BEGIN
            DECLARE @cnt nvarchar(max) = N''SELECT @n = COUNT_BIG(*)'' + @sql;
            EXEC sp_executesql @cnt, N''@v varchar(40), @n bigint OUTPUT'', @v = @value, @n = @n OUTPUT;
        END
        INSERT #Report VALUES (DB_NAME(), ''6 masked '' + @t + ''.'' + @c, @n, NULL);
    END TRY
    BEGIN CATCH
        INSERT #Report VALUES (DB_NAME(), ''6 SKIPPED '' + @t + ''.'' + @c, 0, CONCAT(''Msg '', ERROR_NUMBER(), '' (unique index or constraint?)''));
    END CATCH
    FETCH NEXT FROM cols INTO @s, @t, @c, @k, @len, @hu, @hz;
END
CLOSE cols; DEALLOCATE cols;';

-- ---------------------------------------------------------------- step 7, run inside each database (optional)
DECLARE @moduleBody nvarchar(max) = N'
SET NOCOUNT ON;
SET XACT_ABORT OFF;   -- a module that cannot be re-created is listed, not fatal
DECLARE @mods TABLE (Id int, Name nvarchar(400), Def nvarchar(max), AnsiNulls bit, QuotedId bit);
INSERT @mods
SELECT m.object_id, QUOTENAME(SCHEMA_NAME(o.schema_id)) + N''.'' + QUOTENAME(o.name), m.definition, m.uses_ansi_nulls, m.uses_quoted_identifier
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE o.is_ms_shipped = 0 AND o.type IN (''P'', ''FN'', ''IF'', ''TF'', ''V'', ''TR'')
  AND m.definition LIKE N''%://'' + @host + N''%'';
DECLARE @id int, @name nvarchar(400), @d nvarchar(max), @an bit, @qi bit, @i int, @j int, @len int, @ok int = 0, @bad int = 0;
DECLARE mods CURSOR LOCAL FAST_FORWARD FOR SELECT Id, Name, Def, AnsiNulls, QuotedId FROM @mods ORDER BY Name;
OPEN mods;
FETCH NEXT FROM mods INTO @id, @name, @d, @an, @qi;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @d = REPLACE(REPLACE(@d, N''https://'' + @host, @base), N''http://'' + @host, @base);
    -- the first token after whitespace and comments must be CREATE
    SET @i = 1; SET @len = LEN(@d + N''x'') - 1;
    WHILE @i <= @len
    BEGIN
        IF SUBSTRING(@d, @i, 1) IN (N'' '', NCHAR(9), NCHAR(10), NCHAR(13)) SET @i += 1;
        ELSE IF SUBSTRING(@d, @i, 2) = N''--'' BEGIN SET @j = CHARINDEX(NCHAR(10), @d, @i); SET @i = CASE WHEN @j = 0 THEN @len + 1 ELSE @j + 1 END; END
        ELSE IF SUBSTRING(@d, @i, 2) = N''/*'' BEGIN SET @j = CHARINDEX(N''*/'', @d, @i + 2); SET @i = CASE WHEN @j = 0 THEN @len + 1 ELSE @j + 2 END; END
        ELSE BREAK;
    END
    IF UPPER(SUBSTRING(@d, @i, 6)) = N''CREATE'' AND SUBSTRING(@d, @i + 6, 1) IN (N'' '', NCHAR(9), NCHAR(10), NCHAR(13))
    BEGIN
        IF UPPER(LTRIM(REPLACE(REPLACE(REPLACE(SUBSTRING(@d, @i + 6, 20), NCHAR(9), N'' ''), NCHAR(10), N'' ''), NCHAR(13), N'' ''))) NOT LIKE N''OR %''
            SET @d = STUFF(@d, @i, 6, N''CREATE OR ALTER'');
        IF @apply = 1
        BEGIN
            BEGIN TRY
                IF @an = 1 SET ANSI_NULLS ON ELSE SET ANSI_NULLS OFF;
                IF @qi = 1 SET QUOTED_IDENTIFIER ON ELSE SET QUOTED_IDENTIFIER OFF;
                EXEC sp_executesql @d;
                SET @ok += 1;
            END TRY
            BEGIN CATCH
                SET @bad += 1;
                INSERT #Report VALUES (DB_NAME(), ''7 NOT re-created: '' + @name, 0, CONCAT(''Msg '', ERROR_NUMBER()));
            END CATCH
            SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
        END
        ELSE SET @ok += 1;
    END
    ELSE
    BEGIN
        SET @bad += 1;
        INSERT #Report VALUES (DB_NAME(), ''7 skipped (no CREATE found): '' + @name, 0, NULL);
    END
    FETCH NEXT FROM mods INTO @id, @name, @d, @an, @qi;
END
CLOSE mods; DEALLOCATE mods;
INSERT #Report VALUES (DB_NAME(), ''7 modules naming the production host '' + CASE WHEN @apply = 1 THEN ''re-created'' ELSE ''to re-create'' END, @ok, NULL);
IF @bad > 0 INSERT #Report VALUES (DB_NAME(), ''7 modules left as they are'', @bad, NULL);';

-- ---------------------------------------------------------------- run
DECLARE @db sysname, @call nvarchar(max);
DECLARE dbs CURSOR LOCAL FAST_FORWARD FOR
    SELECT @DatabasePrefix + Name FROM (VALUES (N'ZEDCS_V2_LIVE'), (N'ZED_CONSULTANT'), (N'ZED_SURVEILLANCE')) AS D(Name) WHERE DB_ID(@DatabasePrefix + Name) IS NOT NULL;
OPEN dbs;
FETCH NEXT FROM dbs INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @call = N'EXEC ' + QUOTENAME(@db) + N'.sys.sp_executesql @body, @params, @apply = @apply, @host = @host, @hostPattern = @hostPattern, '
              + N'@base = @base, @disableApi = @disableApi, @scramble = @scramble, @rewriteHosts = @rewriteHosts;';
    EXEC sp_executesql @call,
        N'@body nvarchar(max), @params nvarchar(400), @apply bit, @host varchar(200), @hostPattern varchar(220), @base varchar(200), @disableApi bit, @scramble bit, @rewriteHosts bit',
        @body = @body, @params = @params, @apply = @apply, @host = @ProductionHost, @hostPattern = @hostPattern,
        @base = @StagingBaseUrl, @disableApi = @DisableApiClients, @scramble = @ScramblePasswords, @rewriteHosts = @RewriteHosts;
    IF @MaskContacts = 1
    BEGIN
        SET @call = N'EXEC ' + QUOTENAME(@db) + N'.sys.sp_executesql @maskBody, N''@apply bit'', @apply = @apply;';
        EXEC sp_executesql @call, N'@maskBody nvarchar(max), @apply bit', @maskBody = @maskBody, @apply = @apply;
    END
    IF @RewriteModuleHosts = 1
    BEGIN
        SET @call = N'EXEC ' + QUOTENAME(@db) + N'.sys.sp_executesql @moduleBody, N''@apply bit, @host varchar(200), @base varchar(200)'', @apply = @apply, @host = @host, @base = @base;';
        EXEC sp_executesql @call, N'@moduleBody nvarchar(max), @apply bit, @host varchar(200), @base varchar(200)',
            @moduleBody = @moduleBody, @apply = @apply, @host = @ProductionHost, @base = @StagingBaseUrl;
    END
    FETCH NEXT FROM dbs INTO @db;
END
CLOSE dbs; DEALLOCATE dbs;

SELECT Db, Step, Rows, Note FROM #Report ORDER BY Db, Step;
IF @apply = 1 PRINT 'APPLY: done. Run it again: every count of steps 1-7 should be 0.';
ELSE PRINT 'PREVIEW: nothing changed. Set @Mode = ''APPLY'' to apply.';
