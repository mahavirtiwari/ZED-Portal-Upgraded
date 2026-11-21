-- Run on ZED_CONSULTANT only, after 0089. Safe to re-run: the procedure is skipped once edited (marker /*V4_0110*/).
--
-- 2026-11-21 (Consultancy Master Admin UI audit, item 1: Consultancy Monitoring listed a live Silver case in milestone 1,
-- while the dashboard showed 0 applications and 0 milestone payments): the Consultancy dashboard's figures
-- (dbo.SP_V4_DASHBOARD_ANALYTICS of 0089: the "Applications" and level totals and the status cards' "Milestone n
-- Payment Received") counted the units' milestones from the payment records only (MsmePaymentInfo, by its Certification
-- and MileStoneNum). A payment record whose level or milestone does not match the milestone it opened, or no record,
-- left the case out, while Monitoring, the consultants list and the expenditure read the milestone rows
-- (MsmeCertifications, one per unit, level and milestone, written by the payment procedures when the payment is
-- recorded). The milestones of a unit are now its payment records and its milestone rows together (a handholding level,
-- milestone 1-3; the payment date is the payment record's of that row, MsmePaymentInfo.MsmePmtCertId, else the row's
-- CreatedDate), one per unit, level and milestone as before. Nothing else changes. The staff home cards
-- (StaffDashboardController.Summary) count the same way in the portal (the legacy SP_DASHBOARD_GET_DETAILS is not changed).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZED_CONSULTANT'
    THROW 50110, '0110 runs on ZED_CONSULTANT.', 1;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; as in 0079 / 0082 / 0102 / 0104).
-- ---------------------------------------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#V4_EDITS') IS NOT NULL DROP TABLE #V4_EDITS;
CREATE TABLE #V4_EDITS (Obj nvarchar(300) NOT NULL, Seq int NOT NULL, Find nvarchar(max) NOT NULL, Replacement nvarchar(max) NOT NULL, Expect int NULL);
GO
IF OBJECT_ID('tempdb..#V4_EDIT_PROCEDURE') IS NOT NULL DROP PROCEDURE #V4_EDIT_PROCEDURE;
GO
CREATE PROCEDURE #V4_EDIT_PROCEDURE
    @Object nvarchar(300),
    @Marker nvarchar(400),
    @Optional bit = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id int = OBJECT_ID(@Object, 'P'), @msg nvarchar(2048);
    IF @id IS NULL
    BEGIN
        IF @Optional = 1 BEGIN PRINT CONCAT(DB_NAME(), N'.', @Object, N': not in this database, skipped.'); RETURN; END;
        SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': not found.');
        THROW 50040, @msg, 1;
    END
    DECLARE @def nvarchar(max) = OBJECT_DEFINITION(@id);
    IF CHARINDEX(@Marker, @def) > 0
    BEGIN
        PRINT CONCAT(DB_NAME(), N'.', @Object, N': already edited.');
        RETURN;
    END

    DECLARE @seq int, @find nvarchar(max), @rep nvarchar(max), @expect int, @count int;
    DECLARE e CURSOR LOCAL FAST_FORWARD FOR SELECT Seq, Find, Replacement, Expect FROM #V4_EDITS WHERE Obj = @Object ORDER BY Seq;
    OPEN e;
    FETCH NEXT FROM e INTO @seq, @find, @rep, @expect;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @count = (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @find, N''))) / DATALENGTH(@find);
        IF (@expect IS NULL AND @count = 0) OR (@expect IS NOT NULL AND @expect <> -1 AND @count <> @expect)
        BEGIN
            SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': replacement ', @seq, N' found ', @count, N' time(s), expected ',
                ISNULL(CAST(@expect AS nvarchar(10)), N'at least 1'), N'. The live definition differs from the reviewed one: nothing was changed.');
            THROW 50041, @msg, 1;
        END
        SET @def = REPLACE(@def, @find, @rep);
        FETCH NEXT FROM e INTO @seq, @find, @rep, @expect;
    END
    CLOSE e;
    DEALLOCATE e;

    -- CREATE -> ALTER: the first word outside comments.
    DECLARE @i int = 1, @j int, @len int = LEN(@def + N'x') - 1;
    WHILE @i <= @len
    BEGIN
        IF SUBSTRING(@def, @i, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @i += 1;
        ELSE IF SUBSTRING(@def, @i, 2) = N'--'
        BEGIN
            SET @j = CHARINDEX(NCHAR(10), @def, @i);
            SET @i = CASE WHEN @j = 0 THEN @len + 1 ELSE @j + 1 END;
        END
        ELSE IF SUBSTRING(@def, @i, 2) = N'/*'
        BEGIN
            SET @j = CHARINDEX(N'*/', @def, @i + 2);
            SET @i = CASE WHEN @j = 0 THEN @len + 1 ELSE @j + 2 END;
        END
        ELSE BREAK;
    END
    IF UPPER(SUBSTRING(@def, @i, 6)) <> N'CREATE'
    BEGIN
        SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': the definition does not start with CREATE.');
        THROW 50042, @msg, 1;
    END
    SET @def = STUFF(@def, @i, 6, N'ALTER');
    -- typed as CREATE OR ALTER: ALTER OR ALTER -> ALTER
    SET @j = @i + 5;
    WHILE SUBSTRING(@def, @j, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @j += 1;
    IF UPPER(SUBSTRING(@def, @j, 3)) IN (N'OR ', N'OR' + NCHAR(9), N'OR' + NCHAR(10), N'OR' + NCHAR(13))
    BEGIN
        DECLARE @k int = CHARINDEX(N'ALTER', @def, @j);
        SET @def = STUFF(@def, @j, @k + 5 - @j, N'');
    END

    DECLARE @sql nvarchar(400) = CONCAT(N'SET ANSI_NULLS ', CASE WHEN OBJECTPROPERTY(@id, 'ExecIsAnsiNullsOn') = 1 THEN N'ON' ELSE N'OFF' END,
        N'; SET QUOTED_IDENTIFIER ', CASE WHEN OBJECTPROPERTY(@id, 'ExecIsQuotedIdentOn') = 1 THEN N'ON' ELSE N'OFF' END, N'; EXEC sys.sp_executesql @d;');
    EXEC sys.sp_executesql @sql, N'@d nvarchar(max)', @d = @def;
    IF CHARINDEX(@Marker, OBJECT_DEFINITION(@id)) = 0
    BEGIN
        SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': the procedure was not altered as expected.');
        THROW 50043, @msg, 1;
    END
    PRINT CONCAT(DB_NAME(), N'.', @Object, N': edited.');
END
GO
-- ---------------------------------------------------------------------------------------------------------
-- SP_V4_DASHBOARD_ANALYTICS (0089): the milestones of the units (#P) also from the milestone rows.
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 1,
 N'        WHERE P.ZedId IS NOT NULL AND P.Certification IN (''Silver'', ''Gold'', ''ZEDX'')',
 N'        WHERE P.ZedId IS NOT NULL AND P.Certification IN (''Silver'', ''Gold'', ''ZEDX'')
        UNION ALL
        SELECT CASE WHEN CHARINDEX(''_D'', HC.ZedId) > 0 THEN LEFT(HC.ZedId, CHARINDEX(''_D'', HC.ZedId) - 1) ELSE HC.ZedId END,
               LTRIM(RTRIM(HC.Certification)), HC.NcCount,
               ISNULL((SELECT MIN(HP.CreatedDate) FROM dbo.MsmePaymentInfo HP WHERE HP.MsmePmtCertId = HC.Id), HC.CreatedDate)
        FROM dbo.MsmeCertifications HC
        WHERE HC.ZedId IS NOT NULL AND LTRIM(RTRIM(HC.Certification)) IN (''Silver'', ''Gold'', ''ZEDX'') AND HC.NcCount BETWEEN 1 AND 3 /*V4_0110*/', 1);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_V4_DASHBOARD_ANALYTICS', @Marker = N'/*V4_0110*/';
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
