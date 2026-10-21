-- database\fixes\main\13_xp_cmdshell_report.sql  (server level; run connected to the production instance)
-- SECURITY-FINDINGS #12 (xp_cmdshell part).
-- =====================================================================================================================
-- Run it as it is: it only REPORTS (whether xp_cmdshell is enabled, which procedures of the three ZED databases call
-- it, and which SQL Agent job steps mention it). It changes nothing unless @DisableXpCmdShell is set to 1.
-- =====================================================================================================================
-- Why there is no procedure edit: SP_JOB_TO_CREATE_RENAMING_BATCH_FILES uses xp_cmdshell + bcp to write a .bat file of
-- REN commands into a folder on the database server (paths of the old web server hard-coded), which someone then runs
-- by hand: it renames the PDF and photo folders of rejected Bronze units to their archived ZED ID (..._D_<Id>).
-- Removing the xp_cmdshell calls would silently stop that renaming while the old site is live. The procedure builds
-- the commands from ZedId values that the database generates, so the shell input is not user-controlled; the risk is
-- xp_cmdshell being enabled at all (any SQL injection elsewhere, e.g. #86, then runs operating-system commands as
-- the SQL Server service account).
-- At the cut-over:
--   1. Zed.Jobs takes over the renaming without xp_cmdshell (Jobs:FolderRename, migration 0007, docs/JOBS.md
--      "Renaming the folders of rejected units"). Switch to it and disable the old Agent job first.
--   2. Then set @DisableXpCmdShell = 1 and run this script once (needs sysadmin). Afterwards the procedure fails
--      with "xp_cmdshell is disabled" if anything still calls it, which is the signal you want.
-- What breaks with @DisableXpCmdShell = 1: every caller of xp_cmdshell listed by the report.
SET NOCOUNT ON;
GO
DECLARE @DisableXpCmdShell bit = 0;   -- 1: switch xp_cmdshell off for the whole instance (sysadmin; read the header first).

DECLARE @state nvarchar(20) = (SELECT CASE WHEN CAST(value_in_use AS int) = 1 THEN N'ENABLED' ELSE N'disabled' END
                               FROM sys.configurations WHERE name = N'xp_cmdshell');
PRINT CONCAT(N'xp_cmdshell on this instance: ', @state);

DECLARE @db sysname, @sql nvarchar(max);
DECLARE @dbs TABLE (n int IDENTITY(1, 1) PRIMARY KEY, name sysname NOT NULL);
INSERT @dbs (name) SELECT name FROM sys.databases WHERE name IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE') ORDER BY name;
DECLARE @i int = 0;
WHILE 1 = 1
BEGIN
    SELECT TOP (1) @i = n, @db = name FROM @dbs WHERE n > @i ORDER BY n;
    IF @@ROWCOUNT = 0 BREAK;
    SET @sql = N'SELECT @out = STRING_AGG(CAST(o.name AS nvarchar(max)), N'', '') WITHIN GROUP (ORDER BY o.name)
                 FROM ' + QUOTENAME(@db) + N'.sys.sql_modules m JOIN ' + QUOTENAME(@db) + N'.sys.objects o ON o.object_id = m.object_id
                 WHERE m.definition LIKE N''%xp[_]cmdshell%''';
    DECLARE @out nvarchar(max) = NULL;
    EXEC sys.sp_executesql @sql, N'@out nvarchar(max) OUTPUT', @out = @out OUTPUT;
    PRINT CONCAT(@db, N': objects that mention xp_cmdshell: ', ISNULL(@out, N'none'));
END

IF OBJECT_ID(N'msdb.dbo.sysjobsteps') IS NOT NULL
BEGIN
    DECLARE @jobs nvarchar(max);
    SELECT @jobs = STRING_AGG(CAST(CONCAT(j.name, N' (step ', s.step_id, N')') AS nvarchar(max)), N', ')
    FROM msdb.dbo.sysjobsteps s JOIN msdb.dbo.sysjobs j ON j.job_id = s.job_id
    WHERE s.command LIKE N'%xp[_]cmdshell%' OR s.command LIKE N'%SP[_]JOB[_]TO[_]CREATE[_]RENAMING[_]BATCH[_]FILES%' OR s.subsystem = N'CmdExec';
    PRINT CONCAT(N'SQL Agent job steps that use xp_cmdshell, the renaming job or CmdExec: ', ISNULL(@jobs, N'none'));
END
ELSE PRINT N'SQL Agent tables not found (Express): no jobs to list.';

IF @DisableXpCmdShell = 1
BEGIN
    EXEC sys.sp_configure N'show advanced options', 1;
    RECONFIGURE;
    EXEC sys.sp_configure N'xp_cmdshell', 0;
    RECONFIGURE;
    PRINT N'xp_cmdshell has been switched off.';
END
ELSE PRINT N'Report only: nothing was changed.';
GO
