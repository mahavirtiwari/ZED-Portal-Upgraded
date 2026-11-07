-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE, after 0019-0021. Safe to re-run: the second run finds nothing.
--
-- UDYAM-UP-16-0001476 is no longer a test unit (2026-11-07, at the Admin's request): the legacy procedures, functions and
-- views that left it out of counts, lists, mails and partner APIs (UdyogAadharNo NOT IN ('UDYAM-GJ-01-0013310',
-- 'UDYAM-MH-23-0006117', 'UDYAM-UP-29-0003915', 'UDYAM-UP-16-0001476')) now count it. The other three numbers stay
-- excluded. Each module whose code names it is re-created (CREATE OR ALTER, permissions and its ANSI_NULLS /
-- QUOTED_IDENTIFIER kept) with the number removed from the list; a module that cannot be re-created is listed and left.
-- 0019-0021 (SP_V4_DASHBOARD_ANALYTICS) no longer list it either. The marker (an extended property on
-- SP_V4_DASHBOARD_ANALYTICS) records the run.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50055, '0055 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
GO
SET XACT_ABORT OFF;   -- a module that cannot be re-created is listed, not fatal
DECLARE @udyam nvarchar(40) = N'''UDYAM-UP-16-0001476''';
DECLARE @mods TABLE (Name nvarchar(400), Def nvarchar(max), AnsiNulls bit, QuotedId bit);
INSERT @mods
SELECT QUOTENAME(SCHEMA_NAME(o.schema_id)) + N'.' + QUOTENAME(o.name), m.definition, m.uses_ansi_nulls, m.uses_quoted_identifier
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE o.is_ms_shipped = 0 AND o.type IN ('P', 'FN', 'IF', 'TF', 'V', 'TR') AND m.definition LIKE N'%UDYAM-UP-16-0001476%';

DECLARE @name nvarchar(400), @d nvarchar(max), @an bit, @qi bit, @i int, @j int, @len int, @p int, @k int, @ok int = 0, @bad int = 0;
DECLARE mods CURSOR LOCAL FAST_FORWARD FOR SELECT Name, Def, AnsiNulls, QuotedId FROM @mods ORDER BY Name;
OPEN mods;
FETCH NEXT FROM mods INTO @name, @d, @an, @qi;
WHILE @@FETCH_STATUS = 0
BEGIN
    -- The number out of the list, wherever it stands in it: with the comma before it (spaces, tabs and line breaks
    -- between allowed: some lists put one number per line), else with the comma after it.
    SET @p = CHARINDEX(@udyam, @d);
    WHILE @p > 0
    BEGIN
        SET @k = @p - 1;
        WHILE @k > 0 AND SUBSTRING(@d, @k, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @k -= 1;
        IF @k > 0 AND SUBSTRING(@d, @k, 1) = N','
            SET @d = STUFF(@d, @k, @p + LEN(@udyam) - @k, N'');
        ELSE
        BEGIN
            SET @k = @p + LEN(@udyam);
            WHILE @k <= LEN(@d + N'x') - 1 AND SUBSTRING(@d, @k, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @k += 1;
            IF SUBSTRING(@d, @k, 1) <> N',' BREAK;   -- alone in its list: left as it is
            SET @d = STUFF(@d, @p, @k - @p + 1, N'');
        END
        SET @p = CHARINDEX(@udyam, @d);
    END
    IF CHARINDEX(N'UDYAM-UP-16-0001476', @d) > 0
    BEGIN
        SET @bad += 1;
        PRINT CONCAT(DB_NAME(), N': ', @name, N' left as it is (the number is not in a list it can be taken out of).');
    END
    ELSE
    BEGIN
        -- CREATE -> CREATE OR ALTER after the leading comments.
        SET @i = 1; SET @len = LEN(@d + N'x') - 1;
        WHILE @i <= @len
        BEGIN
            IF SUBSTRING(@d, @i, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @i += 1;
            ELSE IF SUBSTRING(@d, @i, 2) = N'--' BEGIN SET @j = CHARINDEX(NCHAR(10), @d, @i); SET @i = CASE WHEN @j = 0 THEN @len + 1 ELSE @j + 1 END; END
            ELSE IF SUBSTRING(@d, @i, 2) = N'/*' BEGIN SET @j = CHARINDEX(N'*/', @d, @i + 2); SET @i = CASE WHEN @j = 0 THEN @len + 1 ELSE @j + 2 END; END
            ELSE BREAK;
        END
        IF UPPER(SUBSTRING(@d, @i, 6)) = N'CREATE' AND SUBSTRING(@d, @i + 6, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13))
        BEGIN
            IF UPPER(LTRIM(REPLACE(REPLACE(REPLACE(SUBSTRING(@d, @i + 6, 20), NCHAR(9), N' '), NCHAR(10), N' '), NCHAR(13), N' '))) NOT LIKE N'OR %'
                SET @d = STUFF(@d, @i, 6, N'CREATE OR ALTER');
            BEGIN TRY
                IF @an = 1 SET ANSI_NULLS ON ELSE SET ANSI_NULLS OFF;
                IF @qi = 1 SET QUOTED_IDENTIFIER ON ELSE SET QUOTED_IDENTIFIER OFF;
                EXEC sp_executesql @d;
                SET @ok += 1;
            END TRY
            BEGIN CATCH
                SET @bad += 1;
                PRINT CONCAT(DB_NAME(), N': ', @name, N' NOT re-created: Msg ', ERROR_NUMBER(), N': ', LEFT(ERROR_MESSAGE(), 300));
            END CATCH
            SET ANSI_NULLS ON; SET QUOTED_IDENTIFIER ON;
        END
        ELSE
        BEGIN
            SET @bad += 1;
            PRINT CONCAT(DB_NAME(), N': ', @name, N' skipped (no CREATE found).');
        END
    END
    FETCH NEXT FROM mods INTO @name, @d, @an, @qi;
END
CLOSE mods; DEALLOCATE mods;
PRINT CONCAT(DB_NAME(), N': UDYAM-UP-16-0001476 taken out of the test units in ', @ok, N' module(s); ', @bad, N' left as they are.');

IF OBJECT_ID(N'dbo.SP_V4_DASHBOARD_ANALYTICS', N'P') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND minor_id = 0
                   AND major_id = OBJECT_ID(N'dbo.SP_V4_DASHBOARD_ANALYTICS') AND name = N'V4_0055_TestUdyamCounted')
    EXEC sys.sp_addextendedproperty @name = N'V4_0055_TestUdyamCounted', @value = N'2026-11-07',
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'PROCEDURE', @level1name = N'SP_V4_DASHBOARD_ANALYTICS';
GO
