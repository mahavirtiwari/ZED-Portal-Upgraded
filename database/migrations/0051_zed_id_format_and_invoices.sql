-- Run on ZEDCS_V2_LIVE only. Safe to re-run: the sequences and the function are created once, and the procedure edits
-- are skipped once made.
--
-- 1. New ZED IDs by sector: ZEDM000001, ZEDM000002 ... for Manufacturing units and ZEDS000001 ... for Services units,
--    each sector with its own counter (dbo.V4ZedIdManufacturingSequence / dbo.V4ZedIdServicesSequence, from 1; after
--    999999 the number simply grows to 7 digits). The sector is the selected activity's NIC sector type in Masters ->
--    Sectors (dbo.Sectors.SectorType, migration 0025) and nothing else: a sector without a type is refused (V4 checks it
--    before the registration is submitted; the procedure refuses it too). Units registered before keep their ZEDMSME
--    IDs. MsmeId (the internal number, pledge certificate number) still comes from MsmeIdSequence.
-- 2. Certificate numbers (SP_MONITORING_DA_FINAL_SUBMIT / SP_MONITORING_RA_FINAL_SUBMIT: date_serial): the serial was the
--    ZED ID without its first 7 characters ("ZEDMSME"). dbo.FN_V4_CERTIFICATE_SERIAL keeps that for the old IDs
--    (ZEDMSME000123 -> 000123) and gives M000123 / S000123 for the new ones (ZEDM000123 -> M000123). Surveillance
--    certificates reuse these numbers.
-- 3. Invoices (Admin -> Settings -> Payment Gateway and Invoices): SP_GENERATE_NEXT_ZED_INVOICE_NO gives no number
--    (NULL) while invoices are off (dbo.V4Settings 'Invoices.Enabled' not 'true': the default). When on, the series is
--    the unit's sector: ZEDM/2627/n for Manufacturing, ZEDS/2627/n for Services, each with its own counter
--    (dbo.V4InvoiceManufacturingSequence / dbo.V4InvoiceServicesSequence), reset with the old one at the start of each
--    financial year. The sector is read from the new ZED ID (ZEDM... / ZEDS...), else from the unit's NIC sector type in
--    Masters -> Sectors; a unit whose sector cannot be found keeps the old series ZED/2627/n. The procedure gets the
--    unit's ZED ID in a new optional parameter @ZedId; the four callers here pass it (0052 does the same for the callers
--    in ZED_CONSULTANT and ZED_SURVEILLANCE).
-- 4. dbo.V4Settings.SettingValue grows to nvarchar(2000): the payment gateway keys are stored there encrypted (DPAPI),
--    which is longer than the 400 characters the other settings need.
-- The procedures are edited in place by exact replacement (helper below, as in 0044 to 0050): a live text that differs
-- from the reviewed one changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50051, '0051 runs on ZEDCS_V2_LIVE only.', 1;
IF OBJECT_ID(N'dbo.V4Settings', N'U') IS NULL
    THROW 50051, 'Run 0011 first (dbo.V4Settings).', 1;
IF COL_LENGTH(N'dbo.Sectors', N'SectorType') IS NULL
    THROW 50051, 'Run 0025 first (dbo.Sectors.SectorType).', 1;
GO
-- ---------------------------------------------------------------------------------------------------------
-- 1. Counters, the certificate serial and the settings column
-- ---------------------------------------------------------------------------------------------------------
IF OBJECT_ID(N'dbo.V4ZedIdManufacturingSequence', N'SO') IS NULL
    CREATE SEQUENCE dbo.V4ZedIdManufacturingSequence AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO CYCLE NO CACHE;
IF OBJECT_ID(N'dbo.V4ZedIdServicesSequence', N'SO') IS NULL
    CREATE SEQUENCE dbo.V4ZedIdServicesSequence AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO CYCLE NO CACHE;
IF OBJECT_ID(N'dbo.V4InvoiceManufacturingSequence', N'SO') IS NULL
    CREATE SEQUENCE dbo.V4InvoiceManufacturingSequence AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO CYCLE NO CACHE;
IF OBJECT_ID(N'dbo.V4InvoiceServicesSequence', N'SO') IS NULL
    CREATE SEQUENCE dbo.V4InvoiceServicesSequence AS bigint START WITH 1 INCREMENT BY 1 MINVALUE 1 NO CYCLE NO CACHE;
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_CERTIFICATE_SERIAL (@ZedId varchar(50))
RETURNS varchar(50)
AS
BEGIN
    -- V4 0051: the serial of a certificate number. Old IDs lose "ZEDMSME" (as before); new IDs lose "ZED" (M000123).
    RETURN CASE
        WHEN @ZedId LIKE 'ZEDMSME%' THEN STUFF(@ZedId, 1, 7, '')
        WHEN @ZedId LIKE 'ZED[MS][0-9]%' THEN STUFF(@ZedId, 1, 3, '')
        ELSE STUFF(@ZedId, 1, 7, '')
    END;
END
GO
IF COL_LENGTH(N'dbo.V4Settings', N'SettingValue') < 4000
    ALTER TABLE dbo.V4Settings ALTER COLUMN SettingValue nvarchar(2000) NOT NULL;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; the same in 0044 to 0050). #V4_EDIT_PROCEDURE edits one procedure of this
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
-- 2. Registration (the ZED ID), the final submits (the certificate serial), the invoice number
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_MSME_INSERT_UDYAM_DETAILS', 1,
N'SET @ZedId = CONCAT(''ZEDMSME'', FORMAT(CAST(@MsmeId AS BIGINT), ''000000''));',
N'DECLARE @V4SectorType varchar(20) = (SELECT TOP (1) SectorType FROM dbo.Sectors
		WHERE @TwoDigitActivity LIKE SectorCode + ''%'' AND SectorType IN (''Manufacturing'', ''Services'') ORDER BY LEN(SectorCode) DESC);
	IF @V4SectorType IS NULL
		THROW 50051, ''The sector type (Manufacturing / Services) of the selected activity is not set in Masters -> Sectors.'', 1;
	DECLARE @V4ZedNo bigint;
	IF @V4SectorType = ''Manufacturing''
		SET @V4ZedNo = NEXT VALUE FOR dbo.V4ZedIdManufacturingSequence;
	ELSE
		SET @V4ZedNo = NEXT VALUE FOR dbo.V4ZedIdServicesSequence;
	SET @ZedId = CONCAT(CASE WHEN @V4SectorType = ''Manufacturing'' THEN ''ZEDM'' ELSE ''ZEDS'' END, FORMAT(@V4ZedNo, ''000000''));', 1),
(N'dbo.SP_MONITORING_DA_FINAL_SUBMIT', 1,
N'select @SerialNo=STUFF(ZedId, 1, 7, '''') from MsmeCertifications where ZedId=@ZedId',
N'select @SerialNo=dbo.FN_V4_CERTIFICATE_SERIAL(ZedId) from MsmeCertifications where ZedId=@ZedId', 1),
(N'dbo.SP_MONITORING_RA_FINAL_SUBMIT', 1,
N'select @SerialNo=STUFF(ZedId, 1, 7, '''') from MsmeCertifications where ZedId=@ZedId',
N'select @SerialNo=dbo.FN_V4_CERTIFICATE_SERIAL(ZedId) from MsmeCertifications where ZedId=@ZedId', 1),
(N'dbo.SP_GENERATE_NEXT_ZED_INVOICE_NO', 1,
N'@NewTADAInvoiceNo VARCHAR(50) OUTPUT',
N'@NewTADAInvoiceNo VARCHAR(50) OUTPUT,
    @ZedId varchar(50) = NULL', 1),
(N'dbo.SP_GENERATE_NEXT_ZED_INVOICE_NO', 2,
N'SET NOCOUNT ON;',
N'SET NOCOUNT ON;
    -- V4 0051: no invoice number while invoices are off (Admin -> Settings -> Payment Gateway and Invoices).
    IF ISNULL((SELECT TOP (1) SettingValue FROM dbo.V4Settings WHERE SettingKey = ''Invoices.Enabled''), ''false'') <> ''true''
    BEGIN
        SET @NewTADAInvoiceNo = NULL;
        RETURN;
    END
    -- V4 0051: the series of the unit''s sector (ZEDM / ZEDS); ZED when it cannot be found.
    DECLARE @V4Series varchar(10) = ''ZED'';
    IF @ZedId LIKE ''ZEDM[0-9]%'' SET @V4Series = ''ZEDM'';
    ELSE IF @ZedId LIKE ''ZEDS[0-9]%'' SET @V4Series = ''ZEDS'';
    ELSE IF @ZedId IS NOT NULL
        SELECT TOP (1) @V4Series = CASE s.SectorType WHEN ''Manufacturing'' THEN ''ZEDM'' ELSE ''ZEDS'' END
        FROM dbo.Msme m JOIN dbo.Sectors s ON m.TwoDigitActivity LIKE s.SectorCode + ''%''
        WHERE m.ZedId = @ZedId AND s.SectorType IN (''Manufacturing'', ''Services'')
        ORDER BY LEN(s.SectorCode) DESC;', 1),
(N'dbo.SP_GENERATE_NEXT_ZED_INVOICE_NO', 3,
N'EXEC(''ALTER SEQUENCE dbo.Seq_Zed_Invoice_Number RESTART WITH 1'');',
N'EXEC(''ALTER SEQUENCE dbo.Seq_Zed_Invoice_Number RESTART WITH 1'');
        EXEC(''ALTER SEQUENCE dbo.V4InvoiceManufacturingSequence RESTART WITH 1'');
        EXEC(''ALTER SEQUENCE dbo.V4InvoiceServicesSequence RESTART WITH 1'');', 1),
(N'dbo.SP_GENERATE_NEXT_ZED_INVOICE_NO', 4,
N'SET @NewSequenceNumber = NEXT VALUE FOR dbo.Seq_Zed_Invoice_Number;',
N'IF @V4Series = ''ZEDM''
        SET @NewSequenceNumber = NEXT VALUE FOR dbo.V4InvoiceManufacturingSequence;
    ELSE IF @V4Series = ''ZEDS''
        SET @NewSequenceNumber = NEXT VALUE FOR dbo.V4InvoiceServicesSequence;
    ELSE
        SET @NewSequenceNumber = NEXT VALUE FOR dbo.Seq_Zed_Invoice_Number;', 1),
(N'dbo.SP_GENERATE_NEXT_ZED_INVOICE_NO', 5,
N'SET @NewTADAInvoiceNo = CONCAT(''ZED/'', @CurrentFY_String, ''/'', @NewSequenceNumber);',
N'SET @NewTADAInvoiceNo = CONCAT(@V4Series, ''/'', @CurrentFY_String, ''/'', @NewSequenceNumber);', 1),
(N'dbo.SP_MSME_PAYMENT_GATEWAY_DETAILS', 1,
N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT;', N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT, @ZedId = @ZedId;', 1),
(N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS', 1,
N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT;', N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT, @ZedId = @ZedId;', 1),
(N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO', 1,
N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT;', N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT, @ZedId = @ZedId;', 1),
(N'dbo.SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS', 1,
N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT;', N'@NewTADAInvoiceNo = @NewInvoiceNumber OUTPUT, @ZedId = @ZedId;', 1);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_INSERT_UDYAM_DETAILS', @Marker = N'V4ZedIdManufacturingSequence';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_DA_FINAL_SUBMIT', @Marker = N'FN_V4_CERTIFICATE_SERIAL';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_RA_FINAL_SUBMIT', @Marker = N'FN_V4_CERTIFICATE_SERIAL';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_GENERATE_NEXT_ZED_INVOICE_NO', @Marker = N'V4InvoiceManufacturingSequence';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_PAYMENT_GATEWAY_DETAILS', @Marker = N'OUTPUT, @ZedId = @ZedId';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS', @Marker = N'OUTPUT, @ZedId = @ZedId';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO', @Marker = N'OUTPUT, @ZedId = @ZedId';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS', @Marker = N'OUTPUT, @ZedId = @ZedId';
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
