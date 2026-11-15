-- Run on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE, after 0051, 0052 and 0055. Safe to re-run: the edits are
-- skipped once made.
--
-- 2026-11-15 (the user): Admin -> Settings -> Payment Gateway and Invoices -> Invoices gets a setup of what was fixed in
-- the procedures. Kept in dbo.V4Settings of ZEDCS_V2_LIVE (Invoices.*); a missing value keeps today's.
--   1. ZEDCS_V2_LIVE.dbo.SP_GENERATE_NEXT_ZED_INVOICE_NO: the series text of each sector, Invoices.SeriesManufacturing
--      (else ZEDM) and Invoices.SeriesServices (else ZEDS). Only the text changes: each sector keeps its own counter
--      (0051's sequences, back to 1 every 1 April), so no number is given twice.
--   2. The SP_API_FINANCE_GET_* procedures (customer, invoice and receipt in ZEDCS_V2_LIVE; invoice and receipt in
--      ZED_CONSULTANT and ZED_SURVEILLANCE) no longer name the test units (UdyogAadharNo NOT IN (the three UDYAM
--      numbers left after 0055)): the portal skips the units of Invoices.ExcludedUdyam before it calls them
--      (ErpFinanceService; the same three numbers until the Admin changes the list). The list becomes a value no UDYAM
--      number has, so a unit without a UDYAM number is still left out, as before.
--   The Board, Portal, Location code, fee ledger and item names stay in the procedures; the portal replaces them in
--   what it posts when the Admin saves other values.
-- The procedures are edited in place by exact replacement (helper below, as in 0051 and 0052): a live text that differs
-- from the reviewed one changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50077, '0077 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.', 1;
IF DB_NAME() = N'ZEDCS_V2_LIVE' AND (OBJECT_ID(N'dbo.V4Settings', N'U') IS NULL OR OBJECT_ID(N'dbo.V4InvoiceManufacturingSequence', N'SO') IS NULL)
    THROW 50077, 'Run 0011 and 0051 first (dbo.V4Settings, the invoice sequences).', 1;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; the same in 0044 to 0052). #V4_EDIT_PROCEDURE edits one procedure of this
-- database in place: it reads the live definition, applies the replacements listed for it in #V4_EDITS (each Find
-- must occur exactly Expect times, or at least once when Expect is NULL), turns CREATE into ALTER (permissions are
-- kept) and runs it with the procedure's own ANSI_NULLS / QUOTED_IDENTIFIER. A definition that already contains
-- @Marker (code text of the edit, never a comment) is left alone. Any difference raises an error.
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
        IF (@expect IS NULL AND @count = 0) OR (@expect IS NOT NULL AND @count <> @expect)
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
-- The edits
-- ---------------------------------------------------------------------------------------------------------
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_GENERATE_NEXT_ZED_INVOICE_NO', 1,
N'SET @NewTADAInvoiceNo = CONCAT(@V4Series, ''/'', @CurrentFY_String, ''/'', @NewSequenceNumber);',
N'SET @NewTADAInvoiceNo = CONCAT(ISNULL(CASE @V4Series   -- V4 0077: the series text set by the Admin
        WHEN ''ZEDM'' THEN (SELECT TOP (1) NULLIF(LTRIM(RTRIM(SettingValue)), N'''') FROM dbo.V4Settings WHERE SettingKey = ''Invoices.SeriesManufacturing'')
        WHEN ''ZEDS'' THEN (SELECT TOP (1) NULLIF(LTRIM(RTRIM(SettingValue)), N'''') FROM dbo.V4Settings WHERE SettingKey = ''Invoices.SeriesServices'')
        END, @V4Series), ''/'', @CurrentFY_String, ''/'', @NewSequenceNumber);', 1),
(N'dbo.SP_API_FINANCE_GET_UNIT_DETAILS', 1,
N'(''UDYAM-GJ-01-0013310'',''UDYAM-MH-23-0006117'',''UDYAM-UP-29-0003915'')', N'(N''V4_0077_TEST_UNITS_IN_PORTAL'')', 1),
(N'dbo.SP_API_FINANCE_GET_INVOICE_DETAILS', 1,
N'(''UDYAM-GJ-01-0013310'',''UDYAM-MH-23-0006117'',''UDYAM-UP-29-0003915'')', N'(N''V4_0077_TEST_UNITS_IN_PORTAL'')', 1),
(N'dbo.SP_API_FINANCE_GET_RECEIPT_DETAILS', 1,
N'(''UDYAM-GJ-01-0013310'',''UDYAM-MH-23-0006117'',''UDYAM-UP-29-0003915'')', N'(N''V4_0077_TEST_UNITS_IN_PORTAL'')', 1);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF DB_NAME() = N'ZEDCS_V2_LIVE'
BEGIN
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_GENERATE_NEXT_ZED_INVOICE_NO', @Marker = N'Invoices.SeriesManufacturing';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_API_FINANCE_GET_UNIT_DETAILS', @Marker = N'V4_0077_TEST_UNITS_IN_PORTAL';
END
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_API_FINANCE_GET_INVOICE_DETAILS', @Marker = N'V4_0077_TEST_UNITS_IN_PORTAL';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_API_FINANCE_GET_RECEIPT_DETAILS', @Marker = N'V4_0077_TEST_UNITS_IN_PORTAL';
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
