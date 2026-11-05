-- Run on ZEDCS_V2_LIVE and ZED_SURVEILLANCE, after 0044 on ZED_CONSULTANT (deploy\Invoke-ZedDatabaseScripts.ps1 does).
-- Safe to re-run; each database's edits are one transaction (all or nothing).
--
-- The handholding payment procedures (they live in these databases and read ZED_CONSULTANT), edited in place by exact
-- replacement on the live text (helper below; a text that differs from the reviewed one changes nothing):
--
-- SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS (ZEDCS_V2_LIVE, and ZED_SURVEILLANCE's copy), the fee row of the milestone due:
--   - Silver and Gold have their own fees: the rows of the unit's level. The level was not filtered, so whichever row of
--     the type, category and milestone came first was charged (the fee page therefore set one fee for both levels). A
--     type without rows of the level for that milestone still gets the rows of any level, as before.
--   - The subsidy category is chosen among the level's rows (FN_V4_SUBSIDY_CATEGORY with the level).
--   - "Pay all at milestone 1" (0044): the PayAllAtMilestone1 rows when ZED_CONSULTANT.dbo.FN_V4_PAY_ALL_AT_MILESTONE1
--     says the unit pays that way (milestone 1: the three milestones added up; 2 and 3: nothing to pay), else the
--     ordinary rows. Rows are returned in Id order.
--   The Andhra Pradesh StateAssessmentFee branch is not changed.
--
-- ZEDCS_V2_LIVE only (the copies the V4 web checkout and the app use):
-- SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS and SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS read the chosen fee row by
--   its Id in AssessmentFee, also when it was an Andhra Pradesh StateAssessmentFee row: the order then carried the amount
--   of another row (or none) and V4 refused it, so an AP unit with something left to pay could not pay. They now read it
--   in StateAssessmentFee when ZED_CONSULTANT.dbo.FN_V4_STATE_HANDHOLDING_FEE says the milestone is charged there (the
--   same condition as the fee procedure), and the payment record keeps the state share (StateContributionAfterSubsidy,
--   StateSubsidyPercentage) as the zero payment does.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_SURVEILLANCE')
    THROW 50045, '0045 runs on ZEDCS_V2_LIVE and ZED_SURVEILLANCE.', 1;
IF OBJECT_ID(N'ZED_CONSULTANT.dbo.FN_V4_PAY_ALL_AT_MILESTONE1') IS NULL
    THROW 50045, 'Run 0044 on ZED_CONSULTANT first.', 1;
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
-- SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS (both databases)
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS', 1,
N'SET @SpecialCategory = ZED_CONSULTANT.dbo.FN_V4_SUBSIDY_CATEGORY(@ZedId, @EnterpriseTypee, NULL, @MileStoneNo)',
N'-- V4 0045: the rows of the level (a type without rows of the level for the milestone keeps those of any level).
	DECLARE @FeeLevel varchar(50) = CASE WHEN EXISTS (SELECT 1 FROM ZED_CONSULTANT.dbo.AssessmentFee WHERE EnterpriseTypee = @EnterpriseTypee
		AND MileStone = @MileStoneNo AND Certification = @Certification) THEN @Certification END
	-- V4 0045: pay all at milestone 1 (ZED_CONSULTANT.dbo.AssessmentFee.PayAllAtMilestone1 rows).
	DECLARE @PayAll bit = ZED_CONSULTANT.dbo.FN_V4_PAY_ALL_AT_MILESTONE1(@ZedId, @EnterpriseTypee, @Certification, @MileStoneNo)
	SET @SpecialCategory = ZED_CONSULTANT.dbo.FN_V4_SUBSIDY_CATEGORY(@ZedId, @EnterpriseTypee, @FeeLevel, @MileStoneNo)',
1),
(N'dbo.SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS', 2,
N'FROM ZED_CONSULTANT.dbo.AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Coupon IS NULL AND SpecialCategory = @SpecialCategory AND Milestone=@MileStoneNo',
N'FROM ZED_CONSULTANT.dbo.AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Coupon IS NULL AND SpecialCategory = @SpecialCategory AND Milestone=@MileStoneNo AND (@FeeLevel IS NULL OR Certification = @FeeLevel) AND ISNULL(PayAllAtMilestone1, 0) = @PayAll ORDER BY Id',
2);
GO
-- ---------------------------------------------------------------------------------------------------------
-- SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS and SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS (ZEDCS_V2_LIVE)
-- ---------------------------------------------------------------------------------------------------------
IF DB_NAME() = N'ZEDCS_V2_LIVE'
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS', 1,
N'IF @TransactionId IS NULL',
N'-- V4 0045: an Andhra Pradesh state fee row is read in StateAssessmentFee (the fee procedure chose it there).
	DECLARE @StateFee bit = ZED_CONSULTANT.dbo.FN_V4_STATE_HANDHOLDING_FEE(@ZedId, @Certification)

	IF @TransactionId IS NULL',
1),
(N'dbo.SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS', 2,
N'from ZED_CONSULTANT.dbo.AssessmentFee where Id=@PaymentRefId',
N'from (SELECT Id, ApplicantContributionAfterSubsidy, NetPaybleTds15, NetPaybleTds75, MileStone FROM ZED_CONSULTANT.dbo.AssessmentFee WHERE @StateFee = 0
					UNION ALL SELECT Id, ApplicantContributionAfterSubsidy, NetPaybleTds15, NetPaybleTds75, MileStone FROM ZED_CONSULTANT.dbo.StateAssessmentFee WHERE @StateFee = 1) F
					where Id=@PaymentRefId',
2),
(N'dbo.SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS', 1,
N'DECLARE @StateCode varchar(50) = NULL',
N'-- V4 0045: an Andhra Pradesh state fee row is read in StateAssessmentFee (decided before this payment is recorded).
	DECLARE @StateFee bit = ZED_CONSULTANT.dbo.FN_V4_STATE_HANDHOLDING_FEE(@ZedId, @Certification)
	DECLARE @StateCode varchar(50) = NULL',
1),
(N'dbo.SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS', 2,
N'[SubsidyPercentage],MileStoneNum, TaDaInvoiceNo',
N'[SubsidyPercentage],MileStoneNum, TaDaInvoiceNo, StateContributionAfterSubsidy, StateSubsidyPercentage',
1),
(N'dbo.SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS', 3,
N'[SubsidyPercentage], MileStoneNumber, @NewInvoiceNumber',
N'[SubsidyPercentage], MileStoneNumber, @NewInvoiceNumber, F.StateContributionAfterSubsidy, F.StateSubsidyPercentage',
1),
(N'dbo.SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS', 4,
N'FROM ZED_CONSULTANT.dbo.AssessmentFee F, ZED_CONSULTANT.dbo.PaymentGatewayTransactions P',
N'FROM (SELECT Id, EnterpriseTypee, AssessmentFee, Gst, Total, Coupon, AssessmentFeeAfterCoupon, GstAfterCoupon, TotalAfterCoupon, SubsidyPer, SubsidyAmount,
							GstAfterSubsidy, ApplicantContributionAfterSubsidy, Tds15, Tds75, NetPaybleTds15, NetPaybleTds75, SpecialCategory, SubsidyPercentage,
							CAST(NULL AS decimal(10, 2)) StateContributionAfterSubsidy, CAST(NULL AS decimal(10, 2)) StateSubsidyPercentage
						FROM ZED_CONSULTANT.dbo.AssessmentFee WHERE @StateFee = 0
						UNION ALL
						SELECT Id, EnterpriseTypee, AssessmentFee, Gst, Total, Coupon, AssessmentFeeAfterCoupon, GstAfterCoupon, TotalAfterCoupon, SubsidyPer, SubsidyAmount,
							GstAfterSubsidy, ApplicantContributionAfterSubsidy, Tds15, Tds75, NetPaybleTds15, NetPaybleTds75, SpecialCategory, SubsidyPercentage,
							StateContributionAfterSubsidy, StateSubsidyPercentage
						FROM ZED_CONSULTANT.dbo.StateAssessmentFee WHERE @StateFee = 1) F, ZED_CONSULTANT.dbo.PaymentGatewayTransactions P',
1);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS', @Marker = N'FN_V4_PAY_ALL_AT_MILESTONE1';
IF DB_NAME() = N'ZEDCS_V2_LIVE'
BEGIN
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_CONSULTANCY_MSME_PAYMENT_BASIC_DETAILS', @Marker = N'FN_V4_STATE_HANDHOLDING_FEE';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_CONSULTANCY_MSME_PAYMENT_GATEWAY_DETAILS', @Marker = N'FN_V4_STATE_HANDHOLDING_FEE';
END
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
