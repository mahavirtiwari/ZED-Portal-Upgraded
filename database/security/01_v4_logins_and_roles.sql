-- Least-privilege database logins and roles for V4 (CUTOVER.md 1.3, SECURITY-FINDINGS #110: today every application
-- uses one over-privileged login whose password is in the old Web.config files).
--
-- Run in SSMS on the new SQL Server 2022 Standard server, as a sysadmin, after the databases are restored. It creates:
--   * per ZED database (ZEDCS_V2_LIVE, ZED_CONSULTANT, ZED_SURVEILLANCE):
--       zed_v4_app       db_datareader + db_datawriter + EXECUTE on schema dbo (procedures, functions, table types)
--       zed_v4_jobs      zed_v4_app + VIEW DEFINITION on schema dbo (Zed.Jobs --check reads procedure definitions
--                        to find parameter defaults) + ALTER on dbo.WebSiteCounts (SP_DAILY_RUN_WEB_SITE_COUNTS
--                        truncates it; TRUNCATE is not covered by ownership chaining)
--       zed_v4_readonly  db_datareader + EXECUTE on the 7 procedures the read-only cross-system connections call
--   * per referenced database (ZED_CENTER_AUDIT_PROFESSIONAL, ZED_CENTER_AUDIT_V2, KAWACH, ZED_IMPACT_ASSESSMENT):
--       zed_v4_crossdb   SELECT on the tables ZED procedures read there (UPDATE too on ZED_IMPACT_ASSESSMENT.dbo.Msme)
--   * the logins in @Logins, a user for each in every database its family needs, and the role memberships.
-- No db_owner, no DDL rights (except the one ALTER above), no server roles, no xp_cmdshell.
--
-- Why these rights (database/security/README.md has the analysis):
--   * EXECUTE: V4 calls about 650 procedures. Inside a procedure, ownership chaining covers reads and writes on the
--     same database's tables, but not cross-database access (cross-database ownership chaining is off), not dynamic
--     SQL, and not TRUNCATE/ALTER.
--   * db_datareader/db_datawriter: V4 runs inline SQL on about 25 tables (some named at run time, e.g. the payment
--     order tables), the ZED procedures read and write each other's databases by three-part name, and a few use
--     dynamic SQL. Listing every table would be brittle; these roles give data access only, never schema changes.
--   * the referenced databases are other applications' data: only the tables ZED reads, by name.
--
--   @Mode = 'PREVIEW' (default)  shows the current state, warnings and every statement APPLY would run; changes nothing.
--   @Mode = 'APPLY'              runs them, all or nothing. A second run reports "nothing to change".
--   @AuthMode = 'SQL'            SQL logins (CHECK_POLICY ON). Type each password in @Logins in the SSMS window only;
--                                never save them in this file. Needed for new logins (and with @ResetPasswords = 1).
--   @AuthMode = 'WINDOWS'        Windows logins: a gMSA (N'DOMAIN\ZedV4Main$') or, only when SQL Server runs on the
--                                IIS machine, the app pool identity (N'IIS APPPOOL\ZedV4-Main'). Passwords are ignored.
--   @DatabasePrefix = N'ZEDV4_'  for a prefixed set (database\setup.ps1 -DatabasePrefix): every database below gets
--                                the prefix (ZEDV4_ZEDCS_V2_LIVE, ZEDV4_KAWACH, ...; also DefaultDatabase in @Logins:
--                                keep the logical names there). Databases without the prefix are not touched.
--
-- What breaks: nothing for the old sites (their login is not touched). A V4 process gets a permission error if it
-- needs something not granted here; add it here and re-run, never grant db_owner. Revoke the old login only after the
-- cut-over (CUTOVER.md 4).
USE [master];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Mode varchar(10) = 'PREVIEW';
DECLARE @AuthMode varchar(10) = 'SQL';
DECLARE @ResetPasswords bit = 0;
DECLARE @DatabasePrefix sysname = N'';

-- One row per login. Family: app (the three portals and the three mobile deployments), jobs (Zed.Jobs),
-- readonly (main's ConnectionStrings:Consultancy/Surveillance and the Consultancy/Surveillance hosts' ConnectionStrings:Main).
DECLARE @Logins TABLE (Family varchar(10) NOT NULL, LoginName sysname NOT NULL, Password nvarchar(256) NULL, DefaultDatabase sysname NOT NULL);
INSERT @Logins (Family, LoginName, Password, DefaultDatabase) VALUES
    ('app',      N'zed_v4_main',         NULL, N'ZEDCS_V2_LIVE'),
    ('app',      N'zed_v4_consultancy',  NULL, N'ZED_CONSULTANT'),
    ('app',      N'zed_v4_surveillance', NULL, N'ZED_SURVEILLANCE'),
    ('app',      N'zed_v4_mobile',       NULL, N'ZEDCS_V2_LIVE'),
    ('jobs',     N'zed_v4_jobs',         NULL, N'ZEDCS_V2_LIVE'),
    ('readonly', N'zed_v4_readonly',     NULL, N'ZEDCS_V2_LIVE');

-- ------------------------------------------------------------------ what each database gets (do not edit lightly)
DECLARE @ZedDbs TABLE (Db sysname PRIMARY KEY);
INSERT @ZedDbs VALUES (N'ZEDCS_V2_LIVE'), (N'ZED_CONSULTANT'), (N'ZED_SURVEILLANCE');
DECLARE @ReadOnlyProcs TABLE (Db sysname, ProcName sysname);
INSERT @ReadOnlyProcs VALUES
    (N'ZEDCS_V2_LIVE', N'SP_ASSESSMENT_DA_DETAILS'), (N'ZEDCS_V2_LIVE', N'SP_ASSESSMENT_SA_DETAILS'), (N'ZEDCS_V2_LIVE', N'SP_V4_GET_PASSWORD'),
    (N'ZED_CONSULTANT', N'SP_REPORT_GET_DETAILS'),
    (N'ZED_SURVEILLANCE', N'SP_REPORT_GET_DETAILS'), (N'ZED_SURVEILLANCE', N'SP_DA_GET_CERTIFICATE_DETAILS'), (N'ZED_SURVEILLANCE', N'SP_RA_GET_CERTIFICATE_DETAILS');
DECLARE @CrossDb TABLE (Db sysname, TableName sysname, Perm varchar(20));
INSERT @CrossDb VALUES
    (N'ZED_CENTER_AUDIT_PROFESSIONAL', N'Candidates', 'SELECT'), (N'ZED_CENTER_AUDIT_PROFESSIONAL', N'Registrations', 'SELECT'),
    (N'ZED_CENTER_AUDIT_PROFESSIONAL', N'SelfiePhotos', 'SELECT'), (N'ZED_CENTER_AUDIT_PROFESSIONAL', N'Users', 'SELECT'),
    (N'ZED_CENTER_AUDIT_V2', N'Batches', 'SELECT'), (N'ZED_CENTER_AUDIT_V2', N'Candidates', 'SELECT'),
    (N'ZED_CENTER_AUDIT_V2', N'JobRoles', 'SELECT'), (N'ZED_CENTER_AUDIT_V2', N'Registrations', 'SELECT'),
    (N'KAWACH', N'AgencyUserStates', 'SELECT'), (N'KAWACH', N'Msme', 'SELECT'), (N'KAWACH', N'MsmeBasicInformation', 'SELECT'),
    (N'KAWACH', N'MsmeCertifications', 'SELECT'), (N'KAWACH', N'MsmePaymentInfo', 'SELECT'), (N'KAWACH', N'PaymentGateWayTransactions', 'SELECT'),
    (N'KAWACH', N'UserAreaOfKnowledge', 'SELECT'), (N'KAWACH', N'UserNicSectors', 'SELECT'), (N'KAWACH', N'Users', 'SELECT'),
    (N'KAWACH', N'WebinarRegistrations', 'SELECT'),
    (N'ZED_IMPACT_ASSESSMENT', N'Msme', 'SELECT'), (N'ZED_IMPACT_ASSESSMENT', N'Msme', 'UPDATE');

-- The names on this instance (@DatabasePrefix).
IF @DatabasePrefix LIKE N'%[^A-Za-z0-9_]%' OR LEN(@DatabasePrefix) > 20 THROW 50204, '@DatabasePrefix: letters, digits and _ only (at most 20).', 1;
UPDATE @Logins SET DefaultDatabase = @DatabasePrefix + DefaultDatabase;
UPDATE @ZedDbs SET Db = @DatabasePrefix + Db;
UPDATE @ReadOnlyProcs SET Db = @DatabasePrefix + Db;
UPDATE @CrossDb SET Db = @DatabasePrefix + Db;
DECLARE @MainDb sysname = @DatabasePrefix + N'ZEDCS_V2_LIVE';

IF @Mode NOT IN ('PREVIEW', 'APPLY') THROW 50200, '@Mode must be PREVIEW or APPLY.', 1;
IF @AuthMode NOT IN ('SQL', 'WINDOWS') THROW 50201, '@AuthMode must be SQL or WINDOWS.', 1;
IF EXISTS (SELECT 1 FROM @Logins WHERE Family NOT IN ('app', 'jobs', 'readonly')) THROW 50202, 'Family must be app, jobs or readonly.', 1;

-- ------------------------------------------------------------------ current state of every database involved
-- a re-run in the same SSMS window
IF OBJECT_ID('tempdb..#Db') IS NOT NULL DROP TABLE #Db;
IF OBJECT_ID('tempdb..#P') IS NOT NULL DROP TABLE #P;
IF OBJECT_ID('tempdb..#M') IS NOT NULL DROP TABLE #M;
IF OBJECT_ID('tempdb..#G') IS NOT NULL DROP TABLE #G;
IF OBJECT_ID('tempdb..#O') IS NOT NULL DROP TABLE #O;
IF OBJECT_ID('tempdb..#Plan') IS NOT NULL DROP TABLE #Plan;
CREATE TABLE #Db (Db sysname PRIMARY KEY, Kind varchar(10));
INSERT #Db SELECT d.Db, 'zed' FROM @ZedDbs d WHERE DB_ID(d.Db) IS NOT NULL;
INSERT #Db SELECT DISTINCT c.Db, 'ref' FROM @CrossDb c WHERE DB_ID(c.Db) IS NOT NULL;
CREATE TABLE #P (Db sysname, Name sysname, Type char(1), Sid varbinary(85) NULL);
CREATE TABLE #M (Db sysname, RoleName sysname, MemberName sysname);
CREATE TABLE #G (Db sysname, Grantee sysname, Perm nvarchar(128), ClassDesc nvarchar(60), ObjName sysname NULL);
CREATE TABLE #O (Db sysname, Name sysname, Type char(2));
DECLARE @db sysname, @exec nvarchar(300), @q nvarchar(max);
DECLARE dbs CURSOR LOCAL FAST_FORWARD FOR SELECT Db FROM #Db;
OPEN dbs; FETCH NEXT FROM dbs INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @exec = QUOTENAME(@db) + N'.sys.sp_executesql';
    SET @q = N'
        INSERT #P SELECT DB_NAME(), name, type, sid FROM sys.database_principals;
        INSERT #M SELECT DB_NAME(), r.name, m.name FROM sys.database_role_members rm
            JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id JOIN sys.database_principals m ON m.principal_id = rm.member_principal_id;
        INSERT #G SELECT DB_NAME(), g.name, p.permission_name, p.class_desc,
               CASE p.class WHEN 1 THEN OBJECT_NAME(p.major_id) WHEN 3 THEN SCHEMA_NAME(p.major_id) END
            FROM sys.database_permissions p JOIN sys.database_principals g ON g.principal_id = p.grantee_principal_id WHERE p.state IN (''G'', ''W'');
        INSERT #O SELECT DB_NAME(), name, type FROM sys.objects WHERE schema_id = SCHEMA_ID(''dbo'') AND type IN (''U'', ''P'');';
    EXEC @exec @q;
    FETCH NEXT FROM dbs INTO @db;
END
CLOSE dbs; DEALLOCATE dbs;

-- ------------------------------------------------------------------ warnings (never changed by this script)
DECLARE @warn nvarchar(max) = N'';
SELECT @warn += N'WARNING: database ' + d.Db + N' not found on this instance; its users and roles are skipped.' + CHAR(10)
FROM (SELECT Db FROM @ZedDbs UNION SELECT DISTINCT Db FROM @CrossDb) d WHERE DB_ID(d.Db) IS NULL;
SELECT @warn += N'WARNING: login ' + l.LoginName + N' is a member of server role ' + r.name + N': remove that by hand.' + CHAR(10)
FROM @Logins l JOIN sys.server_principals sp ON sp.name = l.LoginName
JOIN sys.server_role_members rm ON rm.member_principal_id = sp.principal_id JOIN sys.server_principals r ON r.principal_id = rm.role_principal_id;
SELECT @warn += N'WARNING: ' + m.Db + N'.' + m.MemberName + N' is in ' + m.RoleName + N': remove that by hand.' + CHAR(10)
FROM #M m JOIN @Logins l ON l.LoginName = m.MemberName WHERE m.RoleName IN (N'db_owner', N'db_securityadmin', N'db_accessadmin', N'db_ddladmin');
SELECT @warn += N'WARNING: ' + p.Db + N' has a user ' + p.Name + N' that is not mapped to login ' + l.LoginName + N' (other SID): fix it with 02_orphaned_users.sql first.' + CHAR(10)
FROM #P p JOIN @Logins l ON l.LoginName = p.Name JOIN sys.server_principals sp ON sp.name = l.LoginName WHERE p.Sid <> sp.sid;
SELECT @warn += N'WARNING: ' + c.Db + N'.dbo.' + c.TableName + N' does not exist; not granted.' + CHAR(10)
FROM @CrossDb c JOIN #Db d ON d.Db = c.Db WHERE NOT EXISTS (SELECT 1 FROM #O o WHERE o.Db = c.Db AND o.Name = c.TableName AND o.Type = 'U');
SELECT @warn += N'WARNING: ' + r.Db + N'.dbo.' + r.ProcName + N' does not exist; not granted.' + CHAR(10)
FROM @ReadOnlyProcs r JOIN #Db d ON d.Db = r.Db WHERE NOT EXISTS (SELECT 1 FROM #O o WHERE o.Db = r.Db AND o.Name = r.ProcName AND o.Type = 'P');
IF @warn <> N'' PRINT @warn;

-- ------------------------------------------------------------------ the plan
CREATE TABLE #Plan (Seq int IDENTITY PRIMARY KEY, Db sysname NULL, Sql nvarchar(max), Display nvarchar(max));

-- logins
INSERT #Plan (Db, Sql, Display)
SELECT NULL,
       CASE WHEN @AuthMode = 'WINDOWS' THEN N'CREATE LOGIN ' + QUOTENAME(l.LoginName) + N' FROM WINDOWS WITH DEFAULT_DATABASE = ' + QUOTENAME(l.DefaultDatabase) + N';'
            ELSE N'CREATE LOGIN ' + QUOTENAME(l.LoginName) + N' WITH PASSWORD = N''' + REPLACE(ISNULL(l.Password, N''), N'''', N'''''') + N''', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = ' + QUOTENAME(l.DefaultDatabase) + N';' END,
       CASE WHEN @AuthMode = 'WINDOWS' THEN N'CREATE LOGIN ' + QUOTENAME(l.LoginName) + N' FROM WINDOWS WITH DEFAULT_DATABASE = ' + QUOTENAME(l.DefaultDatabase) + N';'
            ELSE N'CREATE LOGIN ' + QUOTENAME(l.LoginName) + N' WITH PASSWORD = N''***'', CHECK_POLICY = ON, CHECK_EXPIRATION = OFF, DEFAULT_DATABASE = ' + QUOTENAME(l.DefaultDatabase) + N';' END
FROM @Logins l WHERE SUSER_ID(l.LoginName) IS NULL;
IF @AuthMode = 'SQL' AND @ResetPasswords = 1
    INSERT #Plan (Db, Sql, Display)
    SELECT NULL, N'ALTER LOGIN ' + QUOTENAME(l.LoginName) + N' WITH PASSWORD = N''' + REPLACE(l.Password, N'''', N'''''') + N''';',
           N'ALTER LOGIN ' + QUOTENAME(l.LoginName) + N' WITH PASSWORD = N''***'';'
    FROM @Logins l WHERE SUSER_ID(l.LoginName) IS NOT NULL AND l.Password IS NOT NULL;

-- roles and their rights
DECLARE @Roles TABLE (Kind varchar(10), RoleName sysname);
INSERT @Roles VALUES ('zed', N'zed_v4_app'), ('zed', N'zed_v4_jobs'), ('zed', N'zed_v4_readonly'), ('ref', N'zed_v4_crossdb');
INSERT #Plan (Db, Sql, Display)
SELECT d.Db, N'CREATE ROLE ' + QUOTENAME(r.RoleName) + N';', NULL
FROM #Db d JOIN @Roles r ON r.Kind = d.Kind WHERE NOT EXISTS (SELECT 1 FROM #P p WHERE p.Db = d.Db AND p.Name = r.RoleName AND p.Type = 'R');

DECLARE @Members TABLE (RoleName sysname, MemberName sysname);   -- role-in-role memberships in each ZED database
INSERT @Members VALUES (N'db_datareader', N'zed_v4_app'), (N'db_datawriter', N'zed_v4_app'), (N'zed_v4_app', N'zed_v4_jobs'), (N'db_datareader', N'zed_v4_readonly');
INSERT #Plan (Db, Sql, Display)
SELECT d.Db, N'ALTER ROLE ' + QUOTENAME(m.RoleName) + N' ADD MEMBER ' + QUOTENAME(m.MemberName) + N';', NULL
FROM #Db d CROSS JOIN @Members m WHERE d.Kind = 'zed' AND NOT EXISTS (SELECT 1 FROM #M x WHERE x.Db = d.Db AND x.RoleName = m.RoleName AND x.MemberName = m.MemberName);

DECLARE @SchemaGrants TABLE (Perm nvarchar(128), RoleName sysname);
INSERT @SchemaGrants VALUES (N'EXECUTE', N'zed_v4_app'), (N'VIEW DEFINITION', N'zed_v4_jobs');
INSERT #Plan (Db, Sql, Display)
SELECT d.Db, N'GRANT ' + g.Perm + N' ON SCHEMA::[dbo] TO ' + QUOTENAME(g.RoleName) + N';', NULL
FROM #Db d CROSS JOIN @SchemaGrants g WHERE d.Kind = 'zed'
  AND NOT EXISTS (SELECT 1 FROM #G x WHERE x.Db = d.Db AND x.Grantee = g.RoleName AND x.Perm = g.Perm AND x.ClassDesc = 'SCHEMA' AND x.ObjName = N'dbo');
INSERT #Plan (Db, Sql, Display)
SELECT @MainDb, N'GRANT ALTER ON [dbo].[WebSiteCounts] TO [zed_v4_jobs];', NULL
WHERE EXISTS (SELECT 1 FROM #O WHERE Db = @MainDb AND Name = N'WebSiteCounts' AND Type = 'U')
  AND NOT EXISTS (SELECT 1 FROM #G WHERE Db = @MainDb AND Grantee = N'zed_v4_jobs' AND Perm = N'ALTER' AND ObjName = N'WebSiteCounts');
INSERT #Plan (Db, Sql, Display)
SELECT r.Db, N'GRANT EXECUTE ON [dbo].' + QUOTENAME(r.ProcName) + N' TO [zed_v4_readonly];', NULL
FROM @ReadOnlyProcs r JOIN #Db d ON d.Db = r.Db
WHERE EXISTS (SELECT 1 FROM #O o WHERE o.Db = r.Db AND o.Name = r.ProcName AND o.Type = 'P')
  AND NOT EXISTS (SELECT 1 FROM #G x WHERE x.Db = r.Db AND x.Grantee = N'zed_v4_readonly' AND x.Perm = N'EXECUTE' AND x.ObjName = r.ProcName);
INSERT #Plan (Db, Sql, Display)
SELECT c.Db, N'GRANT ' + c.Perm + N' ON [dbo].' + QUOTENAME(c.TableName) + N' TO [zed_v4_crossdb];', NULL
FROM @CrossDb c JOIN #Db d ON d.Db = c.Db
WHERE EXISTS (SELECT 1 FROM #O o WHERE o.Db = c.Db AND o.Name = c.TableName AND o.Type = 'U')
  AND NOT EXISTS (SELECT 1 FROM #G x WHERE x.Db = c.Db AND x.Grantee = N'zed_v4_crossdb' AND x.Perm = c.Perm AND x.ObjName = c.TableName);

-- users and memberships: app and jobs in every database, readonly in the ZED databases only
DECLARE @Need TABLE (LoginName sysname, Db sysname, RoleName sysname);
INSERT @Need
SELECT l.LoginName, d.Db,
       CASE WHEN d.Kind = 'ref' THEN N'zed_v4_crossdb' WHEN l.Family = 'app' THEN N'zed_v4_app' WHEN l.Family = 'jobs' THEN N'zed_v4_jobs' ELSE N'zed_v4_readonly' END
FROM @Logins l CROSS JOIN #Db d WHERE NOT (l.Family = 'readonly' AND d.Kind = 'ref');
INSERT #Plan (Db, Sql, Display)
SELECT n.Db, N'CREATE USER ' + QUOTENAME(n.LoginName) + N' FOR LOGIN ' + QUOTENAME(n.LoginName) + N' WITH DEFAULT_SCHEMA = [dbo];', NULL
FROM (SELECT DISTINCT LoginName, Db FROM @Need) n
WHERE NOT EXISTS (SELECT 1 FROM #P p WHERE p.Db = n.Db AND p.Name = n.LoginName);
INSERT #Plan (Db, Sql, Display)
SELECT n.Db, N'ALTER ROLE ' + QUOTENAME(n.RoleName) + N' ADD MEMBER ' + QUOTENAME(n.LoginName) + N';', NULL
FROM @Need n WHERE NOT EXISTS (SELECT 1 FROM #M m WHERE m.Db = n.Db AND m.RoleName = n.RoleName AND m.MemberName = n.LoginName);

-- ------------------------------------------------------------------ report and run
DECLARE @count int = (SELECT COUNT(*) FROM #Plan);
IF @count = 0
BEGIN
    PRINT 'Nothing to change: logins, users, roles and grants are in place.';
    RETURN;
END
SELECT Seq, ISNULL(Db, N'(server)') AS [Database], ISNULL(Display, Sql) AS [Statement] FROM #Plan ORDER BY Seq;
PRINT CONCAT(@count, ' statement(s) to run.');

IF @Mode = 'PREVIEW'
BEGIN
    PRINT 'PREVIEW: nothing changed. Set @Mode = ''APPLY'' (and the passwords of new SQL logins) to apply.';
    RETURN;
END
IF @AuthMode = 'SQL' AND EXISTS (SELECT 1 FROM @Logins l WHERE SUSER_ID(l.LoginName) IS NULL AND (l.Password IS NULL OR l.Password = N''))
    THROW 50203, 'APPLY: a new SQL login needs its password in @Logins (type it in this window only).', 1;

DECLARE @seq int = 0, @sql nvarchar(max);
BEGIN TRAN;
WHILE 1 = 1
BEGIN
    SELECT TOP (1) @seq = Seq, @db = Db, @sql = Sql FROM #Plan WHERE Seq > @seq ORDER BY Seq;
    IF @@ROWCOUNT = 0 BREAK;
    SET @exec = ISNULL(QUOTENAME(@db), N'[master]') + N'.sys.sp_executesql';
    EXEC @exec @sql;
END
COMMIT;
PRINT CONCAT('APPLY: done, ', @count, ' statement(s). Run again: it must say "Nothing to change".');
