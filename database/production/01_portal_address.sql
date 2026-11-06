-- PRODUCTION (https://zedv3.qci.org.in, docs/PRODUCTION.md). Makes every address the databases hand out point at this
-- portal instead of the old one (loginzed.msme.gov.in): the QR codes and verification links of pledge and assessment
-- certificates, mail links, file addresses. Nothing else is changed (no mail, partner, password or contact data: those
-- are steps of database\staging\01_prepare_restored_copy.sql that must never run on production).
--
-- In ZEDV4_ZEDCS_V2_LIVE, ZEDV4_ZED_CONSULTANT and ZEDV4_ZED_SURVEILLANCE (@DatabasePrefix):
--   1. UrlsMasterData.UrlName on the old host -> @BaseUrl (the path after the host is kept; procedures build mail links
--      and file paths from it). PageSettings.FilePath (home-page banner) and ApiClientTokens.BaseUrl the same.
--   2. Procedures, functions, views and triggers whose code names the old host (certificate QR / verify links of
--      SP_DA_GET_CERTIFICATE_DETAILS, SP_RA_GET_CERTIFICATE_DETAILS, SP_MSME_INSERT_UDYAM_DETAILS, mail links, ...) are
--      re-created (CREATE OR ALTER, permissions and their ANSI_NULLS / QUOTED_IDENTIFIER kept) with
--      http(s)://<old host> replaced by @BaseUrl. One module at a time; one that cannot be re-created is listed and left.
-- Safe to re-run: a second APPLY finds nothing (every count 0). Run it in SSMS on the production server, PREVIEW first.
-- Run it after the migrations of each update (a migration that edits a procedure searches its reviewed text, which never
-- names the host, so the order does not matter for them).
SET NOCOUNT ON;
DECLARE @Mode varchar(10) = 'PREVIEW';                   -- PREVIEW (default: only counts) or APPLY
DECLARE @ExpectedServerName sysname = NULL;              -- must equal SELECT @@SERVERNAME on this server
DECLARE @OldHost varchar(200) = 'loginzed.msme.gov.in';
DECLARE @BaseUrl varchar(200) = 'https://zedv3.qci.org.in';
DECLARE @DatabasePrefix sysname = N'ZEDV4_';

IF @Mode NOT IN ('PREVIEW', 'APPLY') THROW 50300, '@Mode must be PREVIEW or APPLY.', 1;
IF @DatabasePrefix LIKE N'%[^A-Za-z0-9_]%' OR LEN(@DatabasePrefix) > 20 THROW 50301, '@DatabasePrefix: letters, digits and _ only (at most 20).', 1;
IF @ExpectedServerName IS NULL OR @ExpectedServerName <> @@SERVERNAME
    THROW 50302, 'Refused: @ExpectedServerName must equal @@SERVERNAME of this server.', 1;
SET @BaseUrl = RTRIM(@BaseUrl);
IF RIGHT(@BaseUrl, 1) = '/' SET @BaseUrl = LEFT(@BaseUrl, LEN(@BaseUrl) - 1);
IF @BaseUrl NOT LIKE 'https://%' OR @BaseUrl LIKE '%' + @OldHost + '%'
    THROW 50303, 'Refused: @BaseUrl must be an https address that is not the old host.', 1;
PRINT CONCAT('Mode ', @Mode, ' on ', @@SERVERNAME, ': ', @OldHost, ' -> ', @BaseUrl, ' | databases: ',
             @DatabasePrefix, 'ZEDCS_V2_LIVE, ', @DatabasePrefix, 'ZED_CONSULTANT, ', @DatabasePrefix, 'ZED_SURVEILLANCE');

IF OBJECT_ID('tempdb..#Report') IS NOT NULL DROP TABLE #Report;
CREATE TABLE #Report (Db sysname, Step varchar(120), Rows bigint, Note nvarchar(400) NULL);

DECLARE @apply bit = CASE WHEN @Mode = 'APPLY' THEN 1 ELSE 0 END;
DECLARE @hostPattern varchar(220) = '%://' + @OldHost + '%';

-- ---------------------------------------------------------------- step 1, inside each database
DECLARE @body nvarchar(max) = N'
SET NOCOUNT ON; SET XACT_ABORT ON;
DECLARE @n bigint;
IF @apply = 1 BEGIN TRAN;
IF OBJECT_ID(N''dbo.UrlsMasterData'', N''U'') IS NOT NULL
BEGIN
    SELECT @n = COUNT(*) FROM dbo.UrlsMasterData WHERE UrlName LIKE @hostPattern;
    INSERT #Report VALUES (DB_NAME(), ''1 UrlsMasterData rows on the old host'', @n, NULL);
    IF @apply = 1
        UPDATE dbo.UrlsMasterData
        SET UrlName = @base + SUBSTRING(UrlName, CHARINDEX(@host, UrlName) + LEN(@host), 200)
        WHERE UrlName LIKE @hostPattern;
END
IF COL_LENGTH(N''dbo.PageSettings'', N''FilePath'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.PageSettings WHERE FilePath LIKE @hp'', N''@hp varchar(220), @n bigint OUTPUT'', @hp = @hostPattern, @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''1 PageSettings.FilePath on the old host'', @n, NULL);
    IF @apply = 1 AND @n > 0
        EXEC sp_executesql N''UPDATE dbo.PageSettings SET FilePath = @b + SUBSTRING(FilePath, CHARINDEX(@h, FilePath) + LEN(@h), 500) WHERE FilePath LIKE @hp'',
             N''@b varchar(200), @h varchar(200), @hp varchar(220)'', @b = @base, @h = @host, @hp = @hostPattern;
END
IF COL_LENGTH(N''dbo.ApiClientTokens'', N''BaseUrl'') IS NOT NULL
BEGIN
    EXEC sp_executesql N''SELECT @n = COUNT(*) FROM dbo.ApiClientTokens WHERE BaseUrl LIKE @hp'', N''@hp varchar(220), @n bigint OUTPUT'', @hp = @hostPattern, @n = @n OUTPUT;
    INSERT #Report VALUES (DB_NAME(), ''1 ApiClientTokens.BaseUrl on the old host'', @n, NULL);
    IF @apply = 1 AND @n > 0
        EXEC sp_executesql N''UPDATE dbo.ApiClientTokens SET BaseUrl = @b + SUBSTRING(BaseUrl, CHARINDEX(@h, BaseUrl) + LEN(@h), 500) WHERE BaseUrl LIKE @hp'',
             N''@b varchar(200), @h varchar(200), @hp varchar(220)'', @b = @base, @h = @host, @hp = @hostPattern;
END
IF @apply = 1 COMMIT;';

-- ---------------------------------------------------------------- step 2, inside each database
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
                INSERT #Report VALUES (DB_NAME(), ''2 NOT re-created: '' + @name, 0, CONCAT(''Msg '', ERROR_NUMBER(), '': '', LEFT(ERROR_MESSAGE(), 300)));
            END CATCH
            SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
        END
        ELSE SET @ok += 1;
    END
    ELSE
    BEGIN
        SET @bad += 1;
        INSERT #Report VALUES (DB_NAME(), ''2 skipped (no CREATE found): '' + @name, 0, NULL);
    END
    FETCH NEXT FROM mods INTO @id, @name, @d, @an, @qi;
END
CLOSE mods; DEALLOCATE mods;
INSERT #Report VALUES (DB_NAME(), ''2 modules naming the old host '' + CASE WHEN @apply = 1 THEN ''re-created'' ELSE ''to re-create'' END, @ok, NULL);
IF @bad > 0 INSERT #Report VALUES (DB_NAME(), ''2 modules left as they are'', @bad, NULL);';

-- ---------------------------------------------------------------- run
DECLARE @db sysname, @call nvarchar(max);
DECLARE dbs CURSOR LOCAL FAST_FORWARD FOR
    SELECT @DatabasePrefix + Name FROM (VALUES (N'ZEDCS_V2_LIVE'), (N'ZED_CONSULTANT'), (N'ZED_SURVEILLANCE')) AS D(Name) WHERE DB_ID(@DatabasePrefix + Name) IS NOT NULL;
OPEN dbs;
FETCH NEXT FROM dbs INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @call = N'EXEC ' + QUOTENAME(@db) + N'.sys.sp_executesql @body, N''@apply bit, @host varchar(200), @hostPattern varchar(220), @base varchar(200)'', '
              + N'@apply = @apply, @host = @host, @hostPattern = @hostPattern, @base = @base;';
    EXEC sp_executesql @call, N'@body nvarchar(max), @apply bit, @host varchar(200), @hostPattern varchar(220), @base varchar(200)',
        @body = @body, @apply = @apply, @host = @OldHost, @hostPattern = @hostPattern, @base = @BaseUrl;
    SET @call = N'EXEC ' + QUOTENAME(@db) + N'.sys.sp_executesql @moduleBody, N''@apply bit, @host varchar(200), @base varchar(200)'', @apply = @apply, @host = @host, @base = @base;';
    EXEC sp_executesql @call, N'@moduleBody nvarchar(max), @apply bit, @host varchar(200), @base varchar(200)',
        @moduleBody = @moduleBody, @apply = @apply, @host = @OldHost, @base = @BaseUrl;
    FETCH NEXT FROM dbs INTO @db;
END
CLOSE dbs; DEALLOCATE dbs;

SELECT Db, Step, Rows, Note FROM #Report ORDER BY Db, Step;
IF @apply = 1 PRINT 'APPLY: done. Run it again: every count should be 0.';
ELSE PRINT 'PREVIEW: nothing changed. Set @Mode = ''APPLY'' to apply.';
