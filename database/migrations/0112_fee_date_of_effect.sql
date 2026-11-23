-- Run on ZED_CONSULTANT first, then ZEDCS_V2_LIVE and ZED_SURVEILLANCE (deploy\Invoke-ZedDatabaseScripts.ps1 does): main's and
-- ZED_SURVEILLANCE's SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS read ZED_CONSULTANT.dbo.AssessmentFee's new columns. Safe to
-- re-run: each column and the constraint are added once, an edited procedure (it has /*V4_0112*/) is left alone. Every
-- procedure edit is one transaction (all or nothing).
--
-- 2026-11-23 (the user: "put the new fees effect from date also for all the modules ... keep date range according amend
-- the database"): Admin -> Master -> Payments keeps the fees as dated fee sets, as Expenditure rates keeps its rate sets.
--
-- 1. dbo.AssessmentFee (the legacy table the payment procedures read; no side table) gets two columns:
--      EffectiveFrom  date  the first day the row's fee set is charged; NULL = since the beginning (the rows of today)
--      EffectiveTo    date  the last day; NULL = open (no later set yet)
--    A fee set is every row of the portal with the same EffectiveFrom. The fee page (AssessmentFeesController) makes a new
--    set by copying the set in force on its date (every enterprise type, level, milestone and subsidy category) with the new
--    date, and closes the earlier set the day before; ended sets are kept unchanged (history), so a payment's PaymentRefId
--    still points at the amounts it was charged. Until a second set is made every row is NULL / NULL: nothing changes.
-- 2. The procedures that choose a unit's fee row by enterprise type, level and category charge the set in force today:
--      SP_MSME_GET_PAYMENT_DETAILS (the three portals), SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS (main, ZED_SURVEILLANCE:
--      ZED_CONSULTANT's rows), FN_V4_SUBSIDY_CATEGORY (the three), FN_V4_PAY_ALL_AT_MILESTONE1 (ZED_CONSULTANT, the
--      schedule rows), SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND (ZED_SURVEILLANCE).
--    The procedures that read a row by its Id (the gateway, zero-payment and basic-details procedures: PaymentRefId) are not
--    changed: an order made on the last day of a set is paid at its amounts the next day too.
--    The condition added before each selection is
--      CAST(GETDATE() AS date) BETWEEN ISNULL(EffectiveFrom, '19000101') AND ISNULL(EffectiveTo, '99991231')
--    The edits are made on the live text by exact replacement (helper below, as 0044): a text that differs from the reviewed
--    one stops the script and changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
    THROW 50112, '0112 runs on ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE only.', 1;
GO
IF COL_LENGTH('dbo.AssessmentFee', 'EffectiveFrom') IS NULL ALTER TABLE dbo.AssessmentFee ADD EffectiveFrom date NULL;
IF COL_LENGTH('dbo.AssessmentFee', 'EffectiveTo') IS NULL ALTER TABLE dbo.AssessmentFee ADD EffectiveTo date NULL;
GO
IF OBJECT_ID(N'dbo.CK_AssessmentFee_EffectiveDates', N'C') IS NULL
    ALTER TABLE dbo.AssessmentFee WITH CHECK ADD CONSTRAINT CK_AssessmentFee_EffectiveDates
        CHECK (EffectiveFrom IS NULL OR EffectiveTo IS NULL OR EffectiveTo >= EffectiveFrom);
GO
-- ZED_CONSULTANT's columns must exist before main's and ZED_SURVEILLANCE's procedures are edited (they read them).
IF DB_NAME() <> N'ZED_CONSULTANT' AND COL_LENGTH('ZED_CONSULTANT.dbo.AssessmentFee', 'EffectiveFrom') IS NULL
    THROW 50113, '0112: run it on ZED_CONSULTANT first.', 1;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; as 0044, for procedures and functions). #V4_EDIT_MODULE edits one procedure or
-- function of this database in place: it reads the live definition, applies the replacements listed for it in #V4_EDITS
-- (each Find must occur exactly Expect times, at least once when Expect is NULL, any number of times when Expect is -1),
-- turns CREATE into ALTER (permissions are kept) and runs it with the module's own ANSI_NULLS / QUOTED_IDENTIFIER. A
-- definition that already contains @Marker is left alone. Any difference raises an error.
-- ---------------------------------------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#V4_EDITS') IS NOT NULL DROP TABLE #V4_EDITS;
CREATE TABLE #V4_EDITS (Obj nvarchar(300) NOT NULL, Seq int NOT NULL, Find nvarchar(max) NOT NULL, Replacement nvarchar(max) NOT NULL, Expect int NULL);
GO
IF OBJECT_ID('tempdb..#V4_EDIT_MODULE') IS NOT NULL DROP PROCEDURE #V4_EDIT_MODULE;
GO
CREATE PROCEDURE #V4_EDIT_MODULE
    @Object nvarchar(300),
    @Marker nvarchar(400),
    @Optional bit = 0
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @id int = OBJECT_ID(@Object), @msg nvarchar(2048);
    IF @id IS NULL OR OBJECT_DEFINITION(@id) IS NULL
    BEGIN
        IF @Optional = 1 BEGIN PRINT CONCAT(DB_NAME(), N'.', @Object, N': not in this database, skipped.'); RETURN; END;
        SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': not found.');
        THROW 50114, @msg, 1;
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
        IF (@expect IS NULL AND @count = 0) OR (@expect >= 0 AND @count <> @expect)
        BEGIN
            SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': replacement ', @seq, N' found ', @count, N' time(s), expected ',
                ISNULL(CAST(@expect AS nvarchar(10)), N'at least 1'), N'. The live definition differs from the reviewed one: nothing was changed.');
            THROW 50115, @msg, 1;
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
        THROW 50116, @msg, 1;
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
        SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': the module was not altered as expected.');
        THROW 50117, @msg, 1;
    END
    PRINT CONCAT(DB_NAME(), N'.', @Object, N': edited.');
END
GO
-- ---------------------------------------------------------------------------------------------------------
-- The payment-details procedures: every "AssessmentFee WHERE " chooses a fee row (none of them reads one by Id). The
-- Andhra Pradesh "StateAssessmentFee WHERE " is set aside first (two spaces) so it is not matched, then the condition is
-- added after each remaining WHERE.
-- ---------------------------------------------------------------------------------------------------------
DECLARE @inForce nvarchar(200) = N'/*V4_0112*/ CAST(GETDATE() AS date) BETWEEN ISNULL(EffectiveFrom, ''19000101'') AND ISNULL(EffectiveTo, ''99991231'') AND ';
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect)
SELECT o.Obj, s.Seq, s.Find, s.Replacement, s.Expect
FROM (VALUES (N'dbo.SP_MSME_GET_PAYMENT_DETAILS'), (N'dbo.SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS')) o (Obj)
CROSS JOIN (VALUES
    (1, N'StateAssessmentFee WHERE ', N'StateAssessmentFee  WHERE ', -1),
    (2, N'AssessmentFee WHERE ', N'AssessmentFee WHERE ' + @inForce, NULL)) s (Seq, Find, Replacement, Expect);

-- FN_V4_SUBSIDY_CATEGORY: the categories with fee rows, and their share, in the set in force (the switch-off check reads
-- every row: a category switched off is off in every set).
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.FN_V4_SUBSIDY_CATEGORY', 1,
 N'WHERE a.SpecialCategory = f.Category AND a.EnterpriseTypee = @EnterpriseTypee AND a.Coupon IS NULL',
 N'WHERE /*V4_0112*/ CAST(GETDATE() AS date) BETWEEN ISNULL(a.EffectiveFrom, ''19000101'') AND ISNULL(a.EffectiveTo, ''99991231'') AND a.SpecialCategory = f.Category AND a.EnterpriseTypee = @EnterpriseTypee AND a.Coupon IS NULL',
 1);

-- FN_V4_PAY_ALL_AT_MILESTONE1 (ZED_CONSULTANT): the milestone-1 schedule rows of the set in force; milestones 2 and 3 keep
-- reading the unit's own milestone 1 row by Id.
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.FN_V4_PAY_ALL_AT_MILESTONE1', 1,
 N'WHERE F.EnterpriseTypee = @EnterpriseTypee AND F.MileStone = 1 AND F.PayAllAtMilestone1 = 1',
 N'WHERE /*V4_0112*/ CAST(GETDATE() AS date) BETWEEN ISNULL(F.EffectiveFrom, ''19000101'') AND ISNULL(F.EffectiveTo, ''99991231'') AND F.EnterpriseTypee = @EnterpriseTypee AND F.MileStone = 1 AND F.PayAllAtMilestone1 = 1',
 1),
(N'dbo.FN_V4_PAY_ALL_AT_MILESTONE1', 2,
 N'L WHERE L.EnterpriseTypee = @EnterpriseTypee',
 N'L WHERE CAST(GETDATE() AS date) BETWEEN ISNULL(L.EffectiveFrom, ''19000101'') AND ISNULL(L.EffectiveTo, ''99991231'') AND L.EnterpriseTypee = @EnterpriseTypee',
 1);

-- SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND (ZED_SURVEILLANCE): the Rs. 0 row of the set in force.
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND', 1,
 N'WHERE EnterpriseTypee = ',
 N'WHERE /*V4_0112*/ CAST(GETDATE() AS date) BETWEEN ISNULL(EffectiveFrom, ''19000101'') AND ISNULL(EffectiveTo, ''99991231'') AND EnterpriseTypee = ',
 2);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
EXEC #V4_EDIT_MODULE @Object = N'dbo.SP_MSME_GET_PAYMENT_DETAILS', @Marker = N'/*V4_0112*/';
EXEC #V4_EDIT_MODULE @Object = N'dbo.FN_V4_SUBSIDY_CATEGORY', @Marker = N'/*V4_0112*/';
IF DB_NAME() <> N'ZED_CONSULTANT'
    EXEC #V4_EDIT_MODULE @Object = N'dbo.SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS', @Marker = N'/*V4_0112*/';
IF DB_NAME() = N'ZED_CONSULTANT'
    EXEC #V4_EDIT_MODULE @Object = N'dbo.FN_V4_PAY_ALL_AT_MILESTONE1', @Marker = N'/*V4_0112*/';
IF DB_NAME() = N'ZED_SURVEILLANCE'
    EXEC #V4_EDIT_MODULE @Object = N'dbo.SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND', @Marker = N'/*V4_0112*/', @Optional = 1;
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_MODULE;
DROP TABLE #V4_EDITS;
GO
