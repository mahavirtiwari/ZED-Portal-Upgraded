-- PRODUCTION (https://zedv3.qci.org.in, docs/PRODUCTION.md), ONCE before go-live: removes the units and everything done
-- for them while this server was the test server, and keeps the Admin's setup.
--
-- In ZEDV4_ZEDCS_V2_LIVE, ZEDV4_ZED_CONSULTANT and ZEDV4_ZED_SURVEILLANCE (@DatabasePrefix):
--   Removed (every row):
--   - every table with a ZedId column: units, their certifications, assessments, evidence, photos, NCs, payments,
--     invoices, handholding, financial assistance, surveillance, their history and API logs;
--   - the units' logins: Users with RoleId 5 (MSME), and their rows in the tables that hold a UserId (passwords, reset
--     links, failed logins, login history);
--   - test logs: V4MailOutbox, OTP, OTP_old, FailedLogins, ForgotPwdLinks, V4LoginEvents, UserLoginsWeb,
--     Dashboard_Summary_Cache, V4Cache (those present).
--   Kept: everything else - certification levels, fees and fee masters, questionnaires and checkpoints, sectors and the
--   other masters, texts, email templates and mail servers, app forms, V4Settings (payment gateway, invoices, captcha),
--   links, and every staff account (Admin, MasterAdmin, agencies, assessors, consultants). The staff accounts whose e-mail
--   is a test mailbox (@TestMailbox) are listed: the Admin gives them their real e-mail in User Management.
--   The new counters (ZEDM / ZEDS IDs and invoice numbers, migration 0051) start again from 1 (@RestartCounters).
--
-- PREVIEW (default) only counts. APPLY needs @Confirm = 'DELETE ALL UNITS' and @BackupFolder (a folder on this server
-- that SQL Server can write to): each database is first backed up there (COPY_ONLY), then cleaned in one transaction
-- (all or nothing). It refuses a database with more than @MaxUnits units (a guard against real data).
-- Afterwards: move the units' files aside (the storage folders named in docs/PRODUCTION.md), they belong to the removed
-- units. Run it once more: every count should be 0.
SET NOCOUNT ON;
DECLARE @Mode varchar(10) = 'PREVIEW';                   -- PREVIEW (default) or APPLY
DECLARE @Confirm varchar(40) = NULL;                     -- 'DELETE ALL UNITS' for APPLY
DECLARE @ExpectedServerName sysname = NULL;              -- must equal SELECT @@SERVERNAME on this server
DECLARE @DatabasePrefix sysname = N'ZEDV4_';
DECLARE @BackupFolder nvarchar(260) = NULL;              -- e.g. N'E:\SqlBackups\BeforeCleanup' (APPLY)
DECLARE @MaxUnits int = 1000;
DECLARE @RestartCounters bit = 1;
DECLARE @TestMailbox varchar(200) = 'dev.zed@qcin.org';

IF @Mode NOT IN ('PREVIEW', 'APPLY') THROW 50310, '@Mode must be PREVIEW or APPLY.', 1;
IF @DatabasePrefix LIKE N'%[^A-Za-z0-9_]%' OR LEN(@DatabasePrefix) > 20 THROW 50311, '@DatabasePrefix: letters, digits and _ only (at most 20).', 1;
IF @ExpectedServerName IS NULL OR @ExpectedServerName <> @@SERVERNAME
    THROW 50312, 'Refused: @ExpectedServerName must equal @@SERVERNAME of this server.', 1;
IF @Mode = 'APPLY' AND ISNULL(@Confirm, '') <> 'DELETE ALL UNITS'
    THROW 50313, 'Refused: APPLY removes every unit. Set @Confirm = ''DELETE ALL UNITS''.', 1;
IF @Mode = 'APPLY' AND NULLIF(LTRIM(RTRIM(@BackupFolder)), N'') IS NULL
    THROW 50314, 'Refused: APPLY needs @BackupFolder (each database is backed up there first).', 1;
PRINT CONCAT('Mode ', @Mode, ' on ', @@SERVERNAME, ' | databases: ', @DatabasePrefix, 'ZEDCS_V2_LIVE, ', @DatabasePrefix,
             'ZED_CONSULTANT, ', @DatabasePrefix, 'ZED_SURVEILLANCE');

IF OBJECT_ID('tempdb..#Report') IS NOT NULL DROP TABLE #Report;
CREATE TABLE #Report (Db sysname, Step varchar(200), Rows bigint, Note nvarchar(400) NULL);
DECLARE @apply bit = CASE WHEN @Mode = 'APPLY' THEN 1 ELSE 0 END;

-- ---------------------------------------------------------------- inside each database
DECLARE @body nvarchar(max) = N'
SET NOCOUNT ON;
SET XACT_ABORT OFF;   -- a refused delete (foreign key) is retried in the next pass, not fatal
DECLARE @n bigint, @units bigint, @sql nvarchar(max), @t sysname, @kind char(1), @pass int, @left int, @err int, @round int;

-- the units, and the MSME logins
SELECT @units = COUNT(*) FROM dbo.Msme;
INSERT #Report VALUES (DB_NAME(), ''0 units (dbo.Msme)'', @units, NULL);
IF @units > @maxUnits
BEGIN
    INSERT #Report VALUES (DB_NAME(), ''0 REFUSED: more units than @MaxUnits (real data?) - nothing changed here'', @units, NULL);
    RETURN;
END
INSERT #Report SELECT DB_NAME(), ''0 staff account with the test mailbox: '' + UserId + '' (role '' + CAST(RoleId AS varchar(10)) + '')'', 1, NULL
FROM dbo.Users WHERE RoleId <> 5 AND Email = @testMailbox;

IF OBJECT_ID(''tempdb..#Msme'') IS NOT NULL DROP TABLE #Msme;
CREATE TABLE #Msme (UserId varchar(100) COLLATE DATABASE_DEFAULT PRIMARY KEY);
INSERT #Msme SELECT DISTINCT UserId FROM dbo.Users WHERE RoleId = 5 AND UserId IS NOT NULL;
INSERT #Msme SELECT DISTINCT ZedId FROM dbo.Msme m WHERE ZedId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM #Msme x WHERE x.UserId = m.ZedId);

-- the work: A = every row (ZedId tables, test logs), U = rows of the MSME logins (UserId tables), R = Users with RoleId 5
IF OBJECT_ID(''tempdb..#Work'') IS NOT NULL DROP TABLE #Work;
CREATE TABLE #Work (Tbl sysname PRIMARY KEY, Kind char(1));
INSERT #Work SELECT t.name, ''A'' FROM sys.tables t
WHERE t.is_ms_shipped = 0 AND EXISTS (SELECT 1 FROM sys.columns c WHERE c.object_id = t.object_id AND c.name = ''ZedId'');
INSERT #Work SELECT t.name, ''A'' FROM sys.tables t
WHERE t.name IN (''V4MailOutbox'', ''OTP'', ''OTP_old'', ''FailedLogins'', ''ForgotPwdLinks'', ''V4LoginEvents'', ''UserLoginsWeb'', ''Dashboard_Summary_Cache'', ''V4Cache'')
  AND NOT EXISTS (SELECT 1 FROM #Work w WHERE w.Tbl = t.name);
INSERT #Work SELECT t.name, ''U'' FROM sys.tables t
WHERE t.is_ms_shipped = 0 AND t.name <> ''Users''
  AND EXISTS (SELECT 1 FROM sys.columns c WHERE c.object_id = t.object_id AND c.name = ''UserId'')
  AND NOT EXISTS (SELECT 1 FROM #Work w WHERE w.Tbl = t.name);
IF OBJECT_ID(N''dbo.Users'', N''U'') IS NOT NULL INSERT #Work VALUES (''Users'', ''R'');

DECLARE @where nvarchar(200);
DECLARE w CURSOR LOCAL FAST_FORWARD FOR SELECT Tbl, Kind FROM #Work ORDER BY Tbl;
OPEN w; FETCH NEXT FROM w INTO @t, @kind;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @where = CASE @kind WHEN ''A'' THEN N'''' WHEN ''U'' THEN N'' WHERE UserId IN (SELECT UserId FROM #Msme)'' ELSE N'' WHERE RoleId = 5'' END;
    SET @sql = N''SELECT @n = COUNT_BIG(*) FROM dbo.'' + QUOTENAME(@t) + @where;
    EXEC sp_executesql @sql, N''@n bigint OUTPUT'', @n = @n OUTPUT;
    IF @n > 0 INSERT #Report VALUES (DB_NAME(), ''1 '' + CASE @kind WHEN ''A'' THEN ''all rows of '' WHEN ''U'' THEN ''MSME rows of '' ELSE ''MSME logins in '' END + @t, @n, NULL);
    FETCH NEXT FROM w INTO @t, @kind;
END
CLOSE w; DEALLOCATE w;
IF @apply = 0 RETURN;

-- backup first
DECLARE @file nvarchar(400) = @backupFolder + CASE WHEN RIGHT(@backupFolder, 1) = ''\'' THEN '''' ELSE ''\'' END
    + DB_NAME() + N''_before_cleanup_'' + FORMAT(GETDATE(), ''yyyyMMdd_HHmmss'') + N''.bak'';
SET @sql = N''BACKUP DATABASE '' + QUOTENAME(DB_NAME()) + N'' TO DISK = @f WITH COPY_ONLY, INIT, CHECKSUM'';
BEGIN TRY
    EXEC sp_executesql @sql, N''@f nvarchar(400)'', @f = @file;
END TRY
BEGIN CATCH
    -- No backup, no clean-up: nothing is removed from this database.
    INSERT #Report VALUES (DB_NAME(), ''2 BACKUP FAILED: nothing changed here'', 0,
        CONCAT(''Msg '', ERROR_NUMBER(), '': '', LEFT(ERROR_MESSAGE(), 300), '' (the folder must exist and SQL Server''''s service account must be able to write to it)''));
    RETURN;
END CATCH
IF NOT EXISTS (SELECT 1 FROM msdb.dbo.backupset WHERE database_name = DB_NAME() AND backup_finish_date >= DATEADD(MINUTE, -10, GETDATE()) AND is_copy_only = 1)
BEGIN
    INSERT #Report VALUES (DB_NAME(), ''2 BACKUP NOT FOUND in msdb: nothing changed here'', 0, @file);
    RETURN;
END
INSERT #Report VALUES (DB_NAME(), ''2 backup '' + @file, 0, NULL);

-- delete, all or nothing: passes for foreign keys, rounds for rows that delete triggers write into history tables
BEGIN TRAN;
SET @round = 1;
WHILE @round <= 3
BEGIN
    IF OBJECT_ID(''tempdb..#Todo'') IS NOT NULL DROP TABLE #Todo;
    SELECT Tbl, Kind INTO #Todo FROM #Work;
    SET @pass = 1;
    WHILE @pass <= 15 AND EXISTS (SELECT 1 FROM #Todo)
    BEGIN
        DECLARE d CURSOR LOCAL FAST_FORWARD FOR SELECT Tbl, Kind FROM #Todo ORDER BY Tbl;
        OPEN d; FETCH NEXT FROM d INTO @t, @kind;
        WHILE @@FETCH_STATUS = 0
        BEGIN
            SET @where = CASE @kind WHEN ''A'' THEN N'''' WHEN ''U'' THEN N'' WHERE UserId IN (SELECT UserId FROM #Msme)'' ELSE N'' WHERE RoleId = 5'' END;
            SET @sql = N''DELETE FROM dbo.'' + QUOTENAME(@t) + @where;
            BEGIN TRY
                EXEC sp_executesql @sql;
                DELETE FROM #Todo WHERE Tbl = @t;
            END TRY
            BEGIN CATCH
                SET @err = ERROR_NUMBER();
                IF @err <> 547 OR XACT_STATE() = -1
                BEGIN
                    INSERT #Report VALUES (DB_NAME(), ''3 FAILED on '' + @t + '': rolled back, nothing changed here'', 0, CONCAT(''Msg '', @err, '': '', LEFT(ERROR_MESSAGE(), 300)));
                    IF XACT_STATE() <> 0 ROLLBACK;
                    CLOSE d; DEALLOCATE d;
                    RETURN;
                END
            END CATCH
            FETCH NEXT FROM d INTO @t, @kind;
        END
        CLOSE d; DEALLOCATE d;
        SET @pass += 1;
    END
    SELECT @left = COUNT(*) FROM #Todo;
    IF @left > 0
    BEGIN
        INSERT #Report SELECT DB_NAME(), ''3 FAILED (foreign key) on '' + Tbl + '': rolled back, nothing changed here'', 0, NULL FROM #Todo;
        ROLLBACK;
        RETURN;
    END
    SET @round += 1;
END

IF @restartCounters = 1
BEGIN
    IF OBJECT_ID(N''dbo.V4ZedIdManufacturingSequence'', N''SO'') IS NOT NULL EXEC (N''ALTER SEQUENCE dbo.V4ZedIdManufacturingSequence RESTART WITH 1'');
    IF OBJECT_ID(N''dbo.V4ZedIdServicesSequence'', N''SO'') IS NOT NULL EXEC (N''ALTER SEQUENCE dbo.V4ZedIdServicesSequence RESTART WITH 1'');
    IF OBJECT_ID(N''dbo.V4InvoiceManufacturingSequence'', N''SO'') IS NOT NULL EXEC (N''ALTER SEQUENCE dbo.V4InvoiceManufacturingSequence RESTART WITH 1'');
    IF OBJECT_ID(N''dbo.V4InvoiceServicesSequence'', N''SO'') IS NOT NULL EXEC (N''ALTER SEQUENCE dbo.V4InvoiceServicesSequence RESTART WITH 1'');
    IF OBJECT_ID(N''dbo.V4ZedIdManufacturingSequence'', N''SO'') IS NOT NULL INSERT #Report VALUES (DB_NAME(), ''4 ZEDM / ZEDS and invoice counters start again from 1'', 0, NULL);
END
COMMIT;
INSERT #Report VALUES (DB_NAME(), ''5 cleaned'', 0, NULL);';

DECLARE @db sysname, @call nvarchar(max);
DECLARE dbs CURSOR LOCAL FAST_FORWARD FOR
    SELECT @DatabasePrefix + Name FROM (VALUES (N'ZEDCS_V2_LIVE'), (N'ZED_CONSULTANT'), (N'ZED_SURVEILLANCE')) AS D(Name) WHERE DB_ID(@DatabasePrefix + Name) IS NOT NULL;
OPEN dbs;
FETCH NEXT FROM dbs INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @call = N'EXEC ' + QUOTENAME(@db) + N'.sys.sp_executesql @body, N''@apply bit, @maxUnits int, @testMailbox varchar(200), @backupFolder nvarchar(260), @restartCounters bit'', '
              + N'@apply = @apply, @maxUnits = @maxUnits, @testMailbox = @testMailbox, @backupFolder = @backupFolder, @restartCounters = @restartCounters;';
    EXEC sp_executesql @call, N'@body nvarchar(max), @apply bit, @maxUnits int, @testMailbox varchar(200), @backupFolder nvarchar(260), @restartCounters bit',
        @body = @body, @apply = @apply, @maxUnits = @MaxUnits, @testMailbox = @TestMailbox, @backupFolder = @BackupFolder, @restartCounters = @RestartCounters;
    FETCH NEXT FROM dbs INTO @db;
END
CLOSE dbs; DEALLOCATE dbs;

SELECT Db, Step, Rows, Note FROM #Report ORDER BY Db, Step;
IF @apply = 1 PRINT 'APPLY: done (see the report). Run it again in PREVIEW: only the staff accounts with the test mailbox should be listed.';
ELSE PRINT 'PREVIEW: nothing changed. APPLY: @Mode = ''APPLY'', @Confirm = ''DELETE ALL UNITS'', @BackupFolder = N''<folder>''.';
