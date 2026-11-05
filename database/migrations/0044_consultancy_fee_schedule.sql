-- Run on ZED_CONSULTANT only, before 0045 (deploy\Invoke-ZedDatabaseScripts.ps1 does). Safe to re-run; the procedure
-- edit is one transaction (all or nothing).
--
-- Consultancy (handholding) fees per level and the "pay all at milestone 1" schedule (Admin -> Masters -> Payments on the
-- Consultancy portal; AssessmentFeesController).
--
-- 1. dbo.AssessmentFee gets two columns (the legacy table the payment procedures read; no side table):
--      PayAllAtMilestone1  bit   1 on the rows of the schedule "pay all at milestone 1", made by the fee page from the
--                                ordinary rows (PayAllAtMilestone1 NULL), per enterprise type, level and subsidy category:
--                                  MileStone 1: what milestone 1 then charges, the three milestones' amounts added up;
--                                  MileStone 2 and 3: a row with nothing to pay (the milestone was paid at milestone 1).
--      PayAllFrom          date  on those milestone-1 rows: units whose milestone 1 is paid on or after this day pay
--                                that way; NULL = the schedule is off (units pay milestone by milestone).
--    The ordinary rows are not changed. While no PayAllAtMilestone1 rows exist nothing changes for any unit.
-- 2. dbo.FN_V4_PAY_ALL_AT_MILESTONE1(@ZedId, @EnterpriseTypee, @Certification, @MileStone): 1 when the unit pays that
--    way at that milestone. Milestone 1: the schedule is on for its type and level (PayAllFrom on or before today).
--    Milestones 2 and 3: its milestone 1 of the level was paid on a PayAllAtMilestone1 row (units that started before
--    the schedule keep paying milestone by milestone, and units that paid for all three keep their zero milestones
--    even if the schedule is switched off later).
-- 3. dbo.FN_V4_STATE_HANDHOLDING_FEE(@ZedId, @Certification): 1 when the milestone due is charged on an Andhra Pradesh
--    StateAssessmentFee row, the condition of SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS (plant district in state 28; the
--    first milestone, or one after a first milestone paid with the state subsidy at this level; no state payment at
--    another level). 0045 lets the gateway procedures read those rows there (they read AssessmentFee by the same Id).
-- 4. dbo.SP_MSME_ZERO_PAYMENT_DETAILS (the Rs. 0 handholding payment), edited in place:
--      - milestone 2 or 3 of a unit that paid for all three at milestone 1 is recorded on its zero row (MsmePaymentInfo,
--        PaymentType 'PaidAtMilestone1'), so the milestone opens as a zero state-subsidy milestone does;
--      - StateHandholdingPaymentDates is written for every Andhra Pradesh unit paying milestone 1 at Rs. 0, as the gateway
--        procedure does for a paid milestone 1 (was: one hard-coded Udyam number, so a real AP unit lost the state rows
--        of its milestones 2 and 3).
--    The edit is made on the live text by exact replacement (helper below): a text that differs from the reviewed one
--    stops the script and changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZED_CONSULTANT'
    THROW 50044, '0044 runs on ZED_CONSULTANT only.', 1;
GO
IF COL_LENGTH('dbo.AssessmentFee', 'PayAllAtMilestone1') IS NULL ALTER TABLE dbo.AssessmentFee ADD PayAllAtMilestone1 bit NULL;
IF COL_LENGTH('dbo.AssessmentFee', 'PayAllFrom') IS NULL ALTER TABLE dbo.AssessmentFee ADD PayAllFrom date NULL;
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_PAY_ALL_AT_MILESTONE1
(
    @ZedId varchar(50),
    @EnterpriseTypee varchar(50),   -- NULL: the unit's (dbo.Msme)
    @Certification varchar(50),     -- the handholding level (Silver, Gold)
    @MileStone int                  -- the milestone due
)
RETURNS bit
AS
BEGIN
    -- V4 0044: whether the unit pays all three milestones at milestone 1 (AssessmentFee.PayAllAtMilestone1).
    IF @MileStone IS NULL OR @MileStone < 1 RETURN 0;
    IF @MileStone = 1
    BEGIN
        IF @EnterpriseTypee IS NULL SELECT @EnterpriseTypee = EnterpriseTypee FROM dbo.Msme WHERE ZedId = @ZedId;
        IF EXISTS (SELECT 1 FROM dbo.AssessmentFee F
                   WHERE F.EnterpriseTypee = @EnterpriseTypee AND F.MileStone = 1 AND F.PayAllAtMilestone1 = 1
                     AND F.PayAllFrom IS NOT NULL AND F.PayAllFrom <= CAST(GETDATE() AS date)
                     -- the level's rows; a type without rows of the level uses those of any level (as the fee is chosen)
                     AND (F.Certification = @Certification
                          OR NOT EXISTS (SELECT 1 FROM dbo.AssessmentFee L WHERE L.EnterpriseTypee = @EnterpriseTypee
                                         AND L.MileStone = 1 AND L.Certification = @Certification)))
            RETURN 1;
        RETURN 0;
    END
    IF EXISTS (SELECT 1 FROM dbo.MsmePaymentInfo P JOIN dbo.AssessmentFee F ON F.Id = P.PaymentRefId
               WHERE P.ZedId = @ZedId AND P.Certification = @Certification AND P.MileStoneNum = 1
                 AND F.PayAllAtMilestone1 = 1 AND F.MileStone = 1 AND P.StateSubsidyPercentage IS NULL)
        RETURN 1;
    RETURN 0;
END
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_STATE_HANDHOLDING_FEE
(
    @ZedId varchar(50),
    @Certification varchar(50)
)
RETURNS bit
AS
BEGIN
    -- V4 0044: the condition of SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS for an Andhra Pradesh StateAssessmentFee row.
    DECLARE @StateCode varchar(50), @MileStoneNo int;
    SELECT @StateCode = StateCode FROM dbo.Districts WHERE DistrictCode IN (SELECT PLgDistrictCode FROM dbo.Msme WHERE ZedId = @ZedId);
    SELECT @MileStoneNo = ISNULL(MAX(NcCount), 0) + 1 FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification;
    IF TRY_CAST(@StateCode AS int) = 28
       AND (@MileStoneNo = 1 OR EXISTS (SELECT 1 FROM dbo.StateHandholdingPaymentDates WHERE ZedId = @ZedId AND CertificationLevel = @Certification AND MileStoneNum = 1))
       AND NOT EXISTS (SELECT 1 FROM dbo.StateHandholdingPaymentDates WHERE ZedId = @ZedId AND CertificationLevel <> @Certification)
        RETURN 1;
    RETURN 0;
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
-- SP_MSME_ZERO_PAYMENT_DETAILS
-- ---------------------------------------------------------------------------------------------------------
INSERT INTO #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_MSME_ZERO_PAYMENT_DETAILS', 1,
N'IF @UdyamNo=''UDYAM-UP-29-0003915'' AND @NcCount=1',
N'-- V4 0044: pay all at milestone 1 (AssessmentFee.PayAllAtMilestone1): milestone 2 or 3 of a unit whose milestone 1
	-- paid for all three is recorded at Rs. 0 on the zero row of that milestone.
	IF @NcCount > 1 AND ZED_CONSULTANT.dbo.FN_V4_STATE_HANDHOLDING_FEE(@ZedId, @Certification) = 0
		AND ZED_CONSULTANT.dbo.FN_V4_PAY_ALL_AT_MILESTONE1(@ZedId, NULL, @Certification, @NcCount) = 1
		AND EXISTS (SELECT 1 FROM AssessmentFee WHERE Id = TRY_CAST(@PaymentRefId AS int) AND PayAllAtMilestone1 = 1 AND MileStone = @NcCount
			AND ISNULL(ApplicantContributionAfterSubsidy, 0) = 0)
		AND NOT EXISTS (SELECT 1 FROM MsmePaymentInfo WHERE ZedId = @ZedId AND Certification = @Certification AND MileStoneNum = @NcCount)
	BEGIN
		INSERT INTO MsmePaymentInfo ([ZedId], [EnterpriseTypee], [Certification], [UseCoupon], [UnitGstin], [GstinNumber], [TdsDeductible], [Tds], [TanNumber],
			[PaymentRefId], [AssessmentFee], [Gst], [Total], [Coupon], [AssessmentFeeAfterCoupon], [GstAfterCoupon], [TotalAfterCoupon], [SubsidyPer],
			[SubsidyAmount], [GstAfterSubsidy], [ApplicantContributionAfterSubsidy], [Tds15], [Tds75], [NetPaybleTds15], [NetPaybleTds75], [SpecialCategory], [SubsidyPercentage],
			MileStoneNum, TaDaInvoiceNo, PaymentType)
		SELECT @ZedId, [EnterpriseTypee], @Certification, @UseCoupon, @UnitGstin, @Gstin, @TdsDeductible, @Tds, @Tan,
			@PaymentRefId, [AssessmentFee], [Gst], [Total], [Coupon], [AssessmentFeeAfterCoupon], [GstAfterCoupon], [TotalAfterCoupon], [SubsidyPer],
			[SubsidyAmount], [GstAfterSubsidy], [ApplicantContributionAfterSubsidy], [Tds15], [Tds75], [NetPaybleTds15], [NetPaybleTds75], [SpecialCategory], [SubsidyPercentage],
			@NcCount, @NewInvoiceNumber, ''PaidAtMilestone1''
		FROM AssessmentFee WHERE Id = TRY_CAST(@PaymentRefId AS int)
	END

	-- V4 0044: every Andhra Pradesh unit paying milestone 1 at Rs. 0, as the gateway procedure (was one hard-coded unit).
	IF @StateCode=28 AND @NcCount=1',
1);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_ZERO_PAYMENT_DETAILS', @Marker = N'FN_V4_PAY_ALL_AT_MILESTONE1';
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
