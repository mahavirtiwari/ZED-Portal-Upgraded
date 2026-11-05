-- Run on ZEDCS_V2_LIVE only. Safe to re-run; the procedure edits are one transaction (all or nothing).
--
-- Recertification: its own fee, the level's validity, and a second cycle.
--
-- 1. Its own fee. A unit re-certifying a level paid the level's "Rejected" fee rows (AssessmentFee EnterpriseTypee
--    'REJECTED': full fee, no subsidy, no joining reward), so the rejection fee and the recertification fee could not
--    differ. The level's rows are copied once to EnterpriseTypee 'RECERTIFICATION' (same amounts: nothing changes at
--    deploy), which Admin -> Masters -> Payments now shows as the enterprise type "Recertification".
--    SP_MSME_GET_PAYMENT_DETAILS charges a recertification those rows (both result sets: there is no joining reward), and
--    still the Rejected rows of a level that has no Recertification rows. A unit rejected after using its subsidy still
--    pays the Rejected rows. The financial-support reports show the unit's own enterprise type for a recertification
--    payment, as they do for a Rejected one.
-- 2. The level's validity (Admin -> Certification Levels, SectionTypes.ValidityMonths, 36 by default) instead of the
--    fixed 3 years: SP_JOB_TO_UPDATE_3YEARS_COMPLETED_TO_EXPIRED (expiry) and SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_
--    RECERTIFICATION (the renewal mail and the RE-CERTIFICATION button, 6 months before expiry: was 30 months after the
--    certification). The mail now also covers the V4 site levels (ZED-X), whose certificates already expire on that
--    validity (SP_V4_LEVEL_SURVEILLANCE_SCHEDULE); its "valid for 3 years" sentence is dropped (the expiry date stays).
-- 3. A second cycle: the mail job left out every unit that had ever had a renewal mail or a recertification enabled
--    for the level, so a re-certified unit never got either again. Only those of the current certificate (on or after
--    its CertificationStatusDate) count now.
-- The edits are made on the live text by exact replacement (helper below; fix main\05_mail_passwords.sql edits other
-- parts of the mail procedure, in either order): a text that differs from the reviewed one changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50046, '0046 runs on ZEDCS_V2_LIVE only.', 1;
GO
-- 1. The Recertification rows: once, from the Rejected rows without a coupon (the ones the fee page edits).
IF NOT EXISTS (SELECT 1 FROM dbo.AssessmentFee WHERE EnterpriseTypee = 'RECERTIFICATION')
BEGIN
    DECLARE @cols nvarchar(max) = (SELECT STRING_AGG(QUOTENAME(name), ', ') WITHIN GROUP (ORDER BY column_id)
                                   FROM sys.columns
                                   WHERE object_id = OBJECT_ID('dbo.AssessmentFee') AND is_identity = 0 AND is_computed = 0 AND name <> 'EnterpriseTypee');
    DECLARE @copy nvarchar(max) = CONCAT(N'INSERT INTO dbo.AssessmentFee (EnterpriseTypee, ', @cols, N') SELECT ''RECERTIFICATION'', ', @cols,
        N' FROM dbo.AssessmentFee WHERE EnterpriseTypee = ''REJECTED'' AND Coupon IS NULL ORDER BY Id;');
    EXEC sys.sp_executesql @copy;
    PRINT CONCAT(N'Recertification fee rows added: ', @@ROWCOUNT);
END
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; the same in 0044 to 0046). #V4_EDIT_PROCEDURE edits one procedure of this
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
-- 1. SP_MSME_GET_PAYMENT_DETAILS: the Recertification rows
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_MSME_GET_PAYMENT_DETAILS', 1,
N'SET @SpecialCategory = dbo.FN_V4_SUBSIDY_CATEGORY(@ZedId, @EnterpriseTypee, @Certification, NULL)',
N'SET @SpecialCategory = dbo.FN_V4_SUBSIDY_CATEGORY(@ZedId, @EnterpriseTypee, @Certification, NULL)
	-- V4 0046: a recertification is charged the level''s Recertification rows (the Rejected rows when it has none).
	DECLARE @RecertFeeType varchar(50) = CASE WHEN EXISTS (SELECT 1 FROM AssessmentFee WHERE EnterpriseTypee = ''RECERTIFICATION''
		AND Certification = @Certification AND Coupon IS NULL) THEN ''RECERTIFICATION'' ELSE ''REJECTED'' END',
1),
(N'dbo.SP_MSME_GET_PAYMENT_DETAILS', 2,
N'cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel  FROM AssessmentFee WHERE EnterpriseTypee=''REJECTED'' AND Certification=@Certification AND Coupon IS NOT NULL;',
N'cast((ISNULL(TotalAfterCoupon, Total)*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel  FROM AssessmentFee WHERE EnterpriseTypee=@RecertFeeType AND Certification=@Certification AND (Coupon IS NOT NULL OR @RecertFeeType <> ''REJECTED'');',
1),
(N'dbo.SP_MSME_GET_PAYMENT_DETAILS', 3,
N'FROM AssessmentFee WHERE EnterpriseTypee=''REJECTED'' AND Certification=@Certification AND Coupon IS NULL;',
N'FROM AssessmentFee WHERE EnterpriseTypee=@RecertFeeType AND Certification=@Certification AND Coupon IS NULL;',
1);
GO
-- ---------------------------------------------------------------------------------------------------------
-- 2. Expiry on the level's validity
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_JOB_TO_UPDATE_3YEARS_COMPLETED_TO_EXPIRED', 1,
N'AND C.CertificationStatusDate <= DATEADD(YEAR, -3, GETDATE())',
N'AND C.CertificationStatusDate <= DATEADD(MONTH, -ISNULL((SELECT TOP (1) T.ValidityMonths FROM SectionTypes T WHERE T.SectionType = C.Certification), 36), GETDATE())',
1);
GO
-- ---------------------------------------------------------------------------------------------------------
-- 2 and 3. The renewal mail: the validity, the V4 site levels, the current certificate only
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION', 1,
N'FORMAT(DATEADD(YEAR, 3, C.CertificationStatusDate), ''MMM dd yyyy'') AS ExpiryDate,',
N'FORMAT(DATEADD(MONTH, ISNULL(T.ValidityMonths, 36), C.CertificationStatusDate), ''MMM dd yyyy'') AS ExpiryDate,',
1),
(N'dbo.SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION', 2,
N'INNER JOIN MsmeCertifications C ON (M.ZedId=C.ZedId)',
N'INNER JOIN MsmeCertifications C ON (M.ZedId=C.ZedId)
        LEFT JOIN SectionTypes T ON (T.SectionType = C.Certification)',
1),
(N'dbo.SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION', 3,
N'AND Certification in (''Silver'',''Gold'')',
N'AND (C.Certification IN (''Silver'',''Gold'') OR (T.IsCertificationLevel = 1 AND C.Certification NOT IN (''Bronze'',''Silver'',''Gold'')
               AND ISNULL(T.AssessmentMode, ''Site'') <> ''Desktop'' AND C.SaCertificateNo IS NOT NULL))',
1),
(N'dbo.SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION', 4,
N'AND CAST(CertificationStatusDate AS DATE) <= CAST(DATEADD(MONTH,-30, GETDATE()) AS DATE)',
N'AND CAST(C.CertificationStatusDate AS DATE) <= CAST(DATEADD(MONTH, -(CASE WHEN ISNULL(T.ValidityMonths, 36) > 6 THEN ISNULL(T.ValidityMonths, 36) - 6 ELSE 0 END), GETDATE()) AS DATE)',
1),
(N'dbo.SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION', 5,
N'AND H.MailType = ''RECERTIFICATION''',
N'AND H.MailType = ''RECERTIFICATION''
				AND ISNULL(H.CreatedDate, C.CertificationStatusDate) >= C.CertificationStatusDate',
1),
(N'dbo.SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION', 6,
N'AND H.StatusType = ''RecertificationEnabled''',
N'AND H.StatusType = ''RecertificationEnabled''
                AND ISNULL(H.CreatedDate, C.CertificationStatusDate) >= C.CertificationStatusDate',
1),
(N'dbo.SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION', 7,
N'Your current certificate is valid for 3 years. Please note',
N'Please note',
1);
GO
-- ---------------------------------------------------------------------------------------------------------
-- 1. The financial-support reports: a Recertification payment shows the unit's enterprise type (as a Rejected one)
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect)
SELECT N'dbo.' + o.name, 1, N'p.EnterpriseTypee  = ''REJECTED'' then b.EnterpriseTypee',
       N'p.EnterpriseTypee IN (''REJECTED'', ''RECERTIFICATION'') then b.EnterpriseTypee', NULL
FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
WHERE o.type = 'P' AND SCHEMA_NAME(o.schema_id) = 'dbo'
  AND m.definition LIKE N'%p.EnterpriseTypee  = ''REJECTED'' then b.EnterpriseTypee%';
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_GET_PAYMENT_DETAILS', @Marker = N'@RecertFeeType';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_JOB_TO_UPDATE_3YEARS_COMPLETED_TO_EXPIRED', @Marker = N'T.ValidityMonths';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_JOB_TO_SEND_AUTO_MAIL_FOR_CERTIFICATE_RECERTIFICATION', @Marker = N'T.ValidityMonths';
DECLARE @report nvarchar(300);
DECLARE r CURSOR LOCAL FAST_FORWARD FOR SELECT DISTINCT Obj FROM #V4_EDITS WHERE Find LIKE N'p.EnterpriseTypee  = %' ORDER BY Obj;
OPEN r;
FETCH NEXT FROM r INTO @report;
WHILE @@FETCH_STATUS = 0
BEGIN
    EXEC #V4_EDIT_PROCEDURE @Object = @report, @Marker = N'''RECERTIFICATION'') then b.EnterpriseTypee';
    FETCH NEXT FROM r INTO @report;
END
CLOSE r;
DEALLOCATE r;
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
