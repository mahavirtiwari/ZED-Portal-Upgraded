-- Run on ZED_CONSULTANT and ZED_SURVEILLANCE, after 0051 on ZEDCS_V2_LIVE. Safe to re-run: the edits are skipped once made.
--
-- Invoice numbers by sector (0051): the payment procedures of these two databases take their invoice number from
-- ZEDCS_V2_LIVE.dbo.SP_GENERATE_NEXT_ZED_INVOICE_NO; they now pass the unit's ZED ID (@ZedId), so that the number is
-- ZEDM/2627/n or ZEDS/2627/n like main's. Nothing else changes; while invoices are off (Admin) they get no number.
-- The procedures are edited in place by exact replacement (helper below): a live text that differs from the reviewed one
-- changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50052, '0052 runs on ZED_CONSULTANT and ZED_SURVEILLANCE only.', 1;
IF NOT EXISTS (SELECT 1 FROM ZEDCS_V2_LIVE.sys.parameters
               WHERE object_id = OBJECT_ID(N'ZEDCS_V2_LIVE.dbo.SP_GENERATE_NEXT_ZED_INVOICE_NO') AND name = N'@ZedId')
    THROW 50052, 'Run 0051 on ZEDCS_V2_LIVE first (SP_GENERATE_NEXT_ZED_INVOICE_NO with @ZedId).', 1;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; the same in 0044 to 0051). #V4_EDIT_PROCEDURE edits one procedure of this
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
-- The callers. ZED_CONSULTANT: the two manual updates and the zero payment; ZED_SURVEILLANCE: the two manual updates
-- and the gateway.
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS', 1,
N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT;', N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT, @ZedId = @ZedId;', 1),
(N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO', 1,
N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT;', N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT, @ZedId = @ZedId;', 1),
(N'dbo.SP_MSME_ZERO_PAYMENT_DETAILS', 1,
N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT;', N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT, @ZedId = @ZedId;', 1),
(N'dbo.SP_MSME_PAYMENT_GATEWAY_DETAILS', 1,
N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT;', N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT, @ZedId = @ZedId;', 1);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS', @Marker = N'OUTPUT, @ZedId = @ZedId';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO', @Marker = N'OUTPUT, @ZedId = @ZedId';
IF DB_NAME() = N'ZED_CONSULTANT'
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_ZERO_PAYMENT_DETAILS', @Marker = N'OUTPUT, @ZedId = @ZedId';
IF DB_NAME() = N'ZED_SURVEILLANCE'
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_PAYMENT_GATEWAY_DETAILS', @Marker = N'OUTPUT, @ZedId = @ZedId';
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
