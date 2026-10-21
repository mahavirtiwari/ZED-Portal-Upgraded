-- Database users left without a login after the managed instance's backups are restored on the new server.
--
-- A restored database keeps its users with the managed instance's SIDs; on the new server no login has those SIDs,
-- so the users are "orphaned": they cannot connect, and a login of the same name created later is not linked to them.
-- Azure AD users (type E/X) cannot exist on SQL Server: they are listed for dropping or re-creating as Windows users.
--
-- Run in SSMS on the new server, as a sysadmin, after the restore and after creating the logins you keep
-- (01_v4_logins_and_roles.sql for V4; the other applications' own logins).
--   @Mode = 'PREVIEW' (default)  lists every orphaned user of the 8 related databases, with its roles and whether it
--                                owns a schema; changes nothing.
--   @Mode = 'APPLY'              maps the users listed in @Map to their login (ALTER USER ... WITH LOGIN) and drops the
--                                users listed in @Drop. Nothing else. All or nothing. A user that owns a schema is not
--                                dropped (the script stops): transfer the schema first.
-- Fill @Map / @Drop from the PREVIEW output. Users created WITHOUT LOGIN (by design: no login) are never listed.
--
-- What breaks: a dropped user loses its access to that database (the legacy read-only users GeoReportUser, ro_qci,
-- suraj_ro, Ro_User1, swamy are candidates: decide with their owners). Mapping changes nothing for the old instance.
USE [master];
SET NOCOUNT ON;
SET XACT_ABORT ON;

DECLARE @Mode varchar(10) = 'PREVIEW';

DECLARE @Map TABLE (Db sysname, UserName sysname, LoginName sysname);   -- e.g. (N'ZEDCS_V2_LIVE', N'ro_qci', N'ro_qci')
-- INSERT @Map VALUES (N'ZEDCS_V2_LIVE', N'<user>', N'<login>');
DECLARE @Drop TABLE (Db sysname, UserName sysname);                    -- e.g. (N'ZEDCS_V2_LIVE', N'suraj_ro')
-- INSERT @Drop VALUES (N'ZEDCS_V2_LIVE', N'<user>');

DECLARE @Dbs TABLE (Db sysname);
INSERT @Dbs VALUES (N'ZEDCS_V2_LIVE'), (N'ZED_CONSULTANT'), (N'ZED_SURVEILLANCE'), (N'ZED_CENTER_AUDIT_PROFESSIONAL'),
                   (N'ZED_CENTER_AUDIT_V2'), (N'KAWACH'), (N'ZED_IMPACT_ASSESSMENT'), (N'ZED_QUALITY_PROFESSIONAL');

IF @Mode NOT IN ('PREVIEW', 'APPLY') THROW 50300, '@Mode must be PREVIEW or APPLY.', 1;

IF OBJECT_ID('tempdb..#U') IS NOT NULL DROP TABLE #U;   -- a re-run in the same SSMS window
CREATE TABLE #U (Db sysname, UserName sysname, TypeDesc nvarchar(60), Roles nvarchar(max), OwnsSchemas nvarchar(max), LoginWithSameName bit);
DECLARE @db sysname, @exec nvarchar(300);
DECLARE @q nvarchar(max) = N'
    INSERT #U
    SELECT DB_NAME(), dp.name, dp.type_desc,
           (SELECT STRING_AGG(r.name, N'', '') FROM sys.database_role_members rm JOIN sys.database_principals r ON r.principal_id = rm.role_principal_id WHERE rm.member_principal_id = dp.principal_id),
           (SELECT STRING_AGG(s.name, N'', '') FROM sys.schemas s WHERE s.principal_id = dp.principal_id),
           CASE WHEN SUSER_ID(dp.name) IS NOT NULL THEN 1 ELSE 0 END
    FROM sys.database_principals dp
    WHERE dp.type IN (''S'', ''U'', ''G'', ''E'', ''X'')
      AND dp.principal_id > 4                                  -- not dbo, guest, INFORMATION_SCHEMA, sys
      AND dp.authentication_type <> 0                          -- not WITHOUT LOGIN users
      AND NOT EXISTS (SELECT 1 FROM sys.server_principals sp WHERE sp.sid = dp.sid);';
DECLARE dbs CURSOR LOCAL FAST_FORWARD FOR SELECT Db FROM @Dbs WHERE DB_ID(Db) IS NOT NULL;
OPEN dbs; FETCH NEXT FROM dbs INTO @db;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @exec = QUOTENAME(@db) + N'.sys.sp_executesql';
    EXEC @exec @q;
    FETCH NEXT FROM dbs INTO @db;
END
CLOSE dbs; DEALLOCATE dbs;

SELECT Db, UserName, TypeDesc, Roles, OwnsSchemas,
       CASE WHEN TypeDesc LIKE 'EXTERNAL%' THEN N'Azure AD user: drop, or re-create as a Windows user'
            WHEN LoginWithSameName = 1 THEN N'a login of this name exists: map it (@Map)'
            ELSE N'no login: create one and map it, or drop the user (@Drop)' END AS Suggestion
FROM #U ORDER BY Db, UserName;
DECLARE @orphans int = (SELECT COUNT(*) FROM #U);
PRINT CONCAT(@orphans, ' orphaned user(s) in the related databases.');
SELECT Db AS MissingDatabase FROM @Dbs WHERE DB_ID(Db) IS NULL;

-- checks on the requested changes
IF EXISTS (SELECT 1 FROM @Map m WHERE NOT EXISTS (SELECT 1 FROM #U u WHERE u.Db = m.Db AND u.UserName = m.UserName))
    THROW 50301, '@Map names a user that is not orphaned (or not in these databases).', 1;
IF EXISTS (SELECT 1 FROM @Map m WHERE SUSER_ID(m.LoginName) IS NULL)
    THROW 50302, '@Map names a login that does not exist: create it first.', 1;
IF EXISTS (SELECT 1 FROM @Map m JOIN #U u ON u.Db = m.Db AND u.UserName = m.UserName WHERE u.TypeDesc LIKE 'EXTERNAL%')
    THROW 50303, 'An Azure AD user cannot be mapped to a login on SQL Server: drop it instead.', 1;
IF EXISTS (SELECT 1 FROM @Drop d WHERE NOT EXISTS (SELECT 1 FROM #U u WHERE u.Db = d.Db AND u.UserName = d.UserName))
    THROW 50304, '@Drop names a user that is not orphaned (or not in these databases).', 1;
IF EXISTS (SELECT 1 FROM @Drop d JOIN #U u ON u.Db = d.Db AND u.UserName = d.UserName WHERE u.OwnsSchemas IS NOT NULL)
    THROW 50305, '@Drop names a user that owns a schema: ALTER AUTHORIZATION ON SCHEMA::<schema> TO dbo first.', 1;

IF NOT EXISTS (SELECT 1 FROM @Map) AND NOT EXISTS (SELECT 1 FROM @Drop)
BEGIN
    IF @orphans > 0 PRINT 'Nothing requested: fill @Map / @Drop from the list above.' ELSE PRINT 'Nothing to change.';
    RETURN;
END
IF @Mode = 'PREVIEW'
BEGIN
    SELECT 'map' AS Action, Db, UserName, LoginName FROM @Map UNION ALL SELECT 'drop', Db, UserName, NULL FROM @Drop;
    PRINT 'PREVIEW: nothing changed. Set @Mode = ''APPLY'' to apply the list above.';
    RETURN;
END

DECLARE @sql nvarchar(max), @u sysname, @l sysname;
BEGIN TRAN;
DECLARE work CURSOR LOCAL FAST_FORWARD FOR
    SELECT Db, UserName, LoginName FROM @Map UNION ALL SELECT Db, UserName, NULL FROM @Drop;
OPEN work; FETCH NEXT FROM work INTO @db, @u, @l;
WHILE @@FETCH_STATUS = 0
BEGIN
    SET @exec = QUOTENAME(@db) + N'.sys.sp_executesql';
    SET @sql = CASE WHEN @l IS NOT NULL THEN N'ALTER USER ' + QUOTENAME(@u) + N' WITH LOGIN = ' + QUOTENAME(@l) + N';'
                    ELSE N'DROP USER ' + QUOTENAME(@u) + N';' END;
    EXEC @exec @sql;
    PRINT @db + N': ' + @sql;
    FETCH NEXT FROM work INTO @db, @u, @l;
END
CLOSE work; DEALLOCATE work;
COMMIT;
PRINT 'APPLY: done. Run again in PREVIEW to see what is left.';
