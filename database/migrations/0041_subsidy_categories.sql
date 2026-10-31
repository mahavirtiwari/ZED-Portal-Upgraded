-- Run on ZED_CONSULTANT, ZEDCS_V2_LIVE and ZED_SURVEILLANCE, in that order (deploy\Invoke-ZedDatabaseScripts.ps1 does):
-- main's and ZED_SURVEILLANCE's SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS call ZED_CONSULTANT's function. Safe to re-run;
-- each database's part is one transaction (all or nothing).
--
-- Separate subsidy categories. A unit's fee row (dbo.AssessmentFee, dbo.StateAssessmentFee) is chosen by SpecialCategory,
-- now with the same numbers in the three databases:
--   0 General, 1 SC-owned, 2 woman-owned, 3 ST-owned, 4 aspirational district, 5 LWE district, 6 Himalayan region,
--   7 island territory, 8 North Eastern Region.
-- Before: main charged woman 2, SC/ST and Districts.IsAspirationalDt (any enabled Subsidy Region) 1, else 0;
-- ZED_CONSULTANT and ZED_SURVEILLANCE charged every special unit 1, and ZED_CONSULTANT's general row was NULL.
--
-- 1. ZED_CONSULTANT: AssessmentFee.SpecialCategory and StateAssessmentFee.SpecialCategory bit -> int. AssessmentFee's
--    NULL (its general row, chosen with IS NULL until now) becomes 0, except on the Rejected rows (chosen without any
--    category, left as they are). StateAssessmentFee's general row was already 0 (main's procedure chose it with = 0):
--    its values are not changed. MsmePaymentInfo.SpecialCategory stays bit there (a payment's record: 1 = a special
--    category, as before).
-- 2. No price change at deploy: in every group of fee rows (type, level, milestone and state where the table has them,
--    with or without a joining reward), the category-1 rows are copied, same amounts and SubsidyPercentage, to each
--    category the group does not have yet: main 3-8 (its 2, woman, exists), ZED_CONSULTANT and ZED_SURVEILLANCE 2-8
--    (their 1 covered women too). Not for Rejected, not for groups without category-1 rows. Done once per table: an
--    extended property (V4_0041_SubsidyCategories) records it, so a later run never re-adds a category the Admin
--    removed or overwrites the Admin's shares. A table without fee rows is not marked (its first rows are copied on the
--    next run).
-- 3. dbo.FN_V4_SUBSIDY_CATEGORY(@ZedId, @EnterpriseTypee, @Certification, @MileStone): the category to charge. The unit
--    fits 0; 1 (SocialCategoryName 'SC'); 3 ('ST'); 2 (Gender 'Female'), from MsmeBasicInformation as the procedures
--    read it; 4-8 when main's Subsidy Regions (Districts / States .SubsidyAspirational, SubsidyLwe, SubsidyHimalayan,
--    SubsidyIsland, SubsidyNer = 1; migration 0024) list the unit's plant district (Msme.PLgDistrictCode) or its state.
--    Of those it returns the one whose non-coupon AssessmentFee row of the type, level (NULL: any) and, on
--    ZED_CONSULTANT, milestone (NULL: any) has the highest SubsidyPercentage; ties go to the lowest number; 0 when none
--    of them has a row.
-- 4. The payment procedures take the category from the function and choose SpecialCategory = @SpecialCategory (full
--    current text, edits marked "V4 0041"; result sets unchanged):
--      ZEDCS_V2_LIVE     SP_MSME_GET_PAYMENT_DETAILS, SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS
--      ZED_CONSULTANT    SP_MSME_GET_PAYMENT_DETAILS
--      ZED_SURVEILLANCE  SP_MSME_GET_PAYMENT_DETAILS, SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS,
--                        SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND
--    The checkout procedures (SP_*_PAYMENT_BASIC_DETAILS, *_PAYMENT_GATEWAY_DETAILS, SP_MSME_ZERO_PAYMENT_DETAILS) take
--    the chosen row by its Id and are not changed; the *_old and SP_MSME_GET_PAYMENT_DETAILS_BEFORE_STATE copies neither.
-- The procedures are created with dynamic SQL because each database has its own (one script for the three databases).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET XACT_ABORT ON;
SET NOCOUNT ON;
GO
-- Copies the category-1 rows of each group to the categories in @Targets that the group does not have (step 2).
CREATE PROCEDURE #V4_0041_COPY_CATEGORY_ROWS
    @TableName sysname,
    @Targets varchar(100)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Table nvarchar(300) = N'dbo.' + QUOTENAME(@TableName);
    IF OBJECT_ID(@Table, N'U') IS NULL OR COL_LENGTH(@Table, N'SpecialCategory') IS NULL RETURN;
    IF EXISTS (SELECT 1 FROM sys.extended_properties WHERE class = 1 AND major_id = OBJECT_ID(@Table) AND minor_id = 0 AND name = N'V4_0041_SubsidyCategories')
    BEGIN
        PRINT CONCAT(DB_NAME(), N'.', @Table, N': categories were added by an earlier run; rows left as they are.');
        RETURN;
    END

    DECLARE @HasRows bit = 0, @Added int = 0, @cols nvarchar(max), @scols nvarchar(max), @match nvarchar(max), @sql nvarchar(max);
    SET @sql = N'IF EXISTS (SELECT 1 FROM ' + @Table + N' WHERE ISNULL(EnterpriseTypee, '''') <> ''REJECTED'') SET @HasRows = 1;';
    EXEC sys.sp_executesql @sql, N'@HasRows bit OUTPUT', @HasRows = @HasRows OUTPUT;
    IF @HasRows = 0
    BEGIN
        PRINT CONCAT(DB_NAME(), N'.', @Table, N': no fee rows; nothing to copy (copied on a later run once there are).');
        RETURN;
    END

    SELECT @cols = STRING_AGG(CAST(QUOTENAME(c.name) AS nvarchar(max)), N', ') WITHIN GROUP (ORDER BY c.column_id),
           @scols = STRING_AGG(CAST(N's.' + QUOTENAME(c.name) AS nvarchar(max)), N', ') WITHIN GROUP (ORDER BY c.column_id)
    FROM sys.columns c
    WHERE c.object_id = OBJECT_ID(@Table) AND c.is_identity = 0 AND c.is_computed = 0 AND c.name <> N'SpecialCategory';
    -- The group: type, level, milestone and state where the table has them (NULL matches NULL) ...
    SELECT @match = STRING_AGG(CAST(N'(t.' + QUOTENAME(k.name) + N' = s.' + QUOTENAME(k.name) + N' OR (t.' + QUOTENAME(k.name)
                    + N' IS NULL AND s.' + QUOTENAME(k.name) + N' IS NULL))' AS nvarchar(max)), N' AND ')
    FROM (VALUES (N'EnterpriseTypee'), (N'Certification'), (N'MileStone'), (N'StateCode'), (N'StateName')) k (name)
    WHERE COL_LENGTH(@Table, k.name) IS NOT NULL;
    -- ... and with or without a joining reward (the procedures choose Coupon IS NULL / IS NOT NULL).
    SET @sql = N'INSERT INTO ' + @Table + N' (SpecialCategory, ' + @cols + N')
SELECT c.Category, ' + @scols + N'
FROM ' + @Table + N' s
CROSS JOIN (SELECT CAST(value AS int) AS Category FROM STRING_SPLIT(@Targets, '','')) c
WHERE s.SpecialCategory = 1
  AND ISNULL(s.EnterpriseTypee, '''') <> ''REJECTED''
  AND NOT EXISTS (SELECT 1 FROM ' + @Table + N' t
                  WHERE t.SpecialCategory = c.Category AND ' + @match + N'
                    AND ((t.Coupon IS NULL AND s.Coupon IS NULL) OR (t.Coupon IS NOT NULL AND s.Coupon IS NOT NULL)));
SET @Added = @@ROWCOUNT;';
    EXEC sys.sp_executesql @sql, N'@Targets varchar(100), @Added int OUTPUT', @Targets = @Targets, @Added = @Added OUTPUT;

    DECLARE @note nvarchar(200) = CONCAT(N'Categories ', @Targets, N' copied from category 1 (', @Added, N' rows), ', CONVERT(nvarchar(19), SYSUTCDATETIME(), 120), N' UTC');
    EXEC sys.sp_addextendedproperty @name = N'V4_0041_SubsidyCategories', @value = @note,
        @level0type = N'SCHEMA', @level0name = N'dbo', @level1type = N'TABLE', @level1name = @TableName;
    PRINT CONCAT(DB_NAME(), N'.', @Table, N': ', @Added, N' row(s) added (categories ', @Targets, N', copies of category 1).');
END
GO
BEGIN TRANSACTION;
GO
-- ---------------------------------------------------------------- 1. ZED_CONSULTANT: bit -> int, general row NULL -> 0
IF DB_NAME() = N'ZED_CONSULTANT'
BEGIN
    DECLARE @t sysname, @stats nvarchar(max);
    DECLARE tables_0041 CURSOR LOCAL FAST_FORWARD FOR
        SELECT o.name FROM sys.columns c JOIN sys.objects o ON o.object_id = c.object_id
        WHERE o.type = 'U' AND SCHEMA_NAME(o.schema_id) = N'dbo' AND o.name IN (N'AssessmentFee', N'StateAssessmentFee')
          AND c.name = N'SpecialCategory' AND c.system_type_id = TYPE_ID(N'bit');
    OPEN tables_0041;
    FETCH NEXT FROM tables_0041 INTO @t;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        -- Statistics SQL Server made on the column by itself would block the change; they are made again when needed.
        SET @stats = NULL;
        SELECT @stats = STRING_AGG(CAST(N'DROP STATISTICS dbo.' + QUOTENAME(@t) + N'.' + QUOTENAME(s.name) + N';' AS nvarchar(max)), N' ')
        FROM sys.stats s JOIN sys.stats_columns sc ON sc.object_id = s.object_id AND sc.stats_id = s.stats_id
        JOIN sys.columns c ON c.object_id = sc.object_id AND c.column_id = sc.column_id
        WHERE s.object_id = OBJECT_ID(N'dbo.' + QUOTENAME(@t)) AND s.auto_created = 1 AND c.name = N'SpecialCategory';
        IF @stats IS NOT NULL EXEC (@stats);
        EXEC (N'ALTER TABLE dbo.' + @t + N' ALTER COLUMN SpecialCategory int NULL;');
        PRINT CONCAT(DB_NAME(), N'.dbo.', @t, N'.SpecialCategory: bit -> int.');
        FETCH NEXT FROM tables_0041 INTO @t;
    END
    CLOSE tables_0041;
    DEALLOCATE tables_0041;
END
GO
IF DB_NAME() = N'ZED_CONSULTANT' AND OBJECT_ID(N'dbo.AssessmentFee', N'U') IS NOT NULL
BEGIN
    DECLARE @n int;
    UPDATE dbo.AssessmentFee SET SpecialCategory = 0
    WHERE SpecialCategory IS NULL AND ISNULL(EnterpriseTypee, '') <> 'REJECTED';
    SET @n = @@ROWCOUNT;
    IF @n > 0 PRINT CONCAT(DB_NAME(), N'.dbo.AssessmentFee: ', @n, N' general row(s) NULL -> 0.');
END
GO
-- ---------------------------------------------------------------- 2. the new categories start as copies of category 1
IF DB_NAME() = N'ZEDCS_V2_LIVE'
BEGIN
    EXEC #V4_0041_COPY_CATEGORY_ROWS @TableName = N'AssessmentFee', @Targets = '3,4,5,6,7,8';
    EXEC #V4_0041_COPY_CATEGORY_ROWS @TableName = N'StateAssessmentFee', @Targets = '3,4,5,6,7,8';
END
ELSE IF DB_NAME() IN (N'ZED_CONSULTANT', N'ZED_SURVEILLANCE')
BEGIN
    EXEC #V4_0041_COPY_CATEGORY_ROWS @TableName = N'AssessmentFee', @Targets = '2,3,4,5,6,7,8';
    EXEC #V4_0041_COPY_CATEGORY_ROWS @TableName = N'StateAssessmentFee', @Targets = '2,3,4,5,6,7,8';
END
GO
-- ---------------------------------------------------------------- 3. dbo.FN_V4_SUBSIDY_CATEGORY
IF DB_NAME() = N'ZED_CONSULTANT'
    EXEC sys.sp_executesql N'CREATE OR ALTER FUNCTION dbo.FN_V4_SUBSIDY_CATEGORY
(
    @ZedId varchar(50),
    @EnterpriseTypee varchar(50),
    @Certification varchar(50),   -- NULL: any level
    @MileStone int                -- NULL: any milestone
)
RETURNS int
AS
BEGIN
    -- V4 0041: the subsidy category to charge (0 General, 1 SC, 2 woman, 3 ST, 4 aspirational, 5 LWE, 6 Himalayan,
    -- 7 island, 8 NER): of the categories the unit fits, the one whose non-coupon AssessmentFee row has the highest
    -- SubsidyPercentage (ties: the lowest number); 0 when none of them has a row. Regions: main''s Subsidy Regions.
    DECLARE @MsmeId int, @District int, @SocialCategoryName varchar(50), @Gender varchar(50), @Category int;
    DECLARE @Fits TABLE (Category int NOT NULL PRIMARY KEY);
    INSERT INTO @Fits (Category) VALUES (0);

    SELECT @MsmeId = MsmeId, @District = PLgDistrictCode FROM dbo.Msme WHERE ZedId = @ZedId;
    SELECT @SocialCategoryName = SocialCategoryName, @Gender = Gender FROM dbo.MsmeBasicInformation WHERE MsmeId = @MsmeId;
    IF @SocialCategoryName = ''SC'' INSERT INTO @Fits (Category) VALUES (1);
    IF @SocialCategoryName = ''ST'' INSERT INTO @Fits (Category) VALUES (3);
    IF @Gender = ''Female'' INSERT INTO @Fits (Category) VALUES (2);

    IF @District IS NOT NULL
        INSERT INTO @Fits (Category)
        SELECT DISTINCT r.Category
        FROM ZEDCS_V2_LIVE.dbo.Districts d
        LEFT JOIN ZEDCS_V2_LIVE.dbo.States s ON LTRIM(RTRIM(s.StateCode)) = LTRIM(RTRIM(d.StateCode))
        CROSS APPLY (VALUES (4, d.SubsidyAspirational, s.SubsidyAspirational), (5, d.SubsidyLwe, s.SubsidyLwe),
                            (6, d.SubsidyHimalayan, s.SubsidyHimalayan), (7, d.SubsidyIsland, s.SubsidyIsland),
                            (8, d.SubsidyNer, s.SubsidyNer)) r (Category, InDistrict, InState)
        WHERE TRY_CAST(LTRIM(RTRIM(d.DistrictCode)) AS int) = @District
          AND (r.InDistrict = 1 OR r.InState = 1);

    SELECT TOP (1) @Category = f.Category
    FROM @Fits f
    CROSS APPLY (SELECT COUNT(*) AS FeeRows, MAX(a.SubsidyPercentage) AS Share
                 FROM dbo.AssessmentFee a
                 WHERE a.SpecialCategory = f.Category AND a.EnterpriseTypee = @EnterpriseTypee AND a.Coupon IS NULL
                   AND (@Certification IS NULL OR a.Certification = @Certification)
                   AND (@MileStone IS NULL OR a.MileStone = @MileStone)) x
    WHERE x.FeeRows > 0
    ORDER BY ISNULL(x.Share, -1) DESC, f.Category;

    RETURN ISNULL(@Category, 0);
END';
GO
IF DB_NAME() = N'ZEDCS_V2_LIVE' OR DB_NAME() = N'ZED_SURVEILLANCE'
    EXEC sys.sp_executesql N'CREATE OR ALTER FUNCTION dbo.FN_V4_SUBSIDY_CATEGORY
(
    @ZedId varchar(50),
    @EnterpriseTypee varchar(50),
    @Certification varchar(50),   -- NULL: any level
    @MileStone int                -- not used here (the milestones are ZED_CONSULTANT''s); same signature in the three databases
)
RETURNS int
AS
BEGIN
    -- V4 0041: the subsidy category to charge (0 General, 1 SC, 2 woman, 3 ST, 4 aspirational, 5 LWE, 6 Himalayan,
    -- 7 island, 8 NER): of the categories the unit fits, the one whose non-coupon AssessmentFee row has the highest
    -- SubsidyPercentage (ties: the lowest number); 0 when none of them has a row. Regions: main''s Subsidy Regions.
    DECLARE @MsmeId int, @District int, @SocialCategoryName varchar(50), @Gender varchar(50), @Category int;
    DECLARE @Fits TABLE (Category int NOT NULL PRIMARY KEY);
    INSERT INTO @Fits (Category) VALUES (0);

    SELECT @MsmeId = MsmeId, @District = PLgDistrictCode FROM dbo.Msme WHERE ZedId = @ZedId;
    SELECT @SocialCategoryName = SocialCategoryName, @Gender = Gender FROM dbo.MsmeBasicInformation WHERE MsmeId = @MsmeId;
    IF @SocialCategoryName = ''SC'' INSERT INTO @Fits (Category) VALUES (1);
    IF @SocialCategoryName = ''ST'' INSERT INTO @Fits (Category) VALUES (3);
    IF @Gender = ''Female'' INSERT INTO @Fits (Category) VALUES (2);

    IF @District IS NOT NULL
        INSERT INTO @Fits (Category)
        SELECT DISTINCT r.Category
        FROM ZEDCS_V2_LIVE.dbo.Districts d
        LEFT JOIN ZEDCS_V2_LIVE.dbo.States s ON LTRIM(RTRIM(s.StateCode)) = LTRIM(RTRIM(d.StateCode))
        CROSS APPLY (VALUES (4, d.SubsidyAspirational, s.SubsidyAspirational), (5, d.SubsidyLwe, s.SubsidyLwe),
                            (6, d.SubsidyHimalayan, s.SubsidyHimalayan), (7, d.SubsidyIsland, s.SubsidyIsland),
                            (8, d.SubsidyNer, s.SubsidyNer)) r (Category, InDistrict, InState)
        WHERE TRY_CAST(LTRIM(RTRIM(d.DistrictCode)) AS int) = @District
          AND (r.InDistrict = 1 OR r.InState = 1);

    SELECT TOP (1) @Category = f.Category
    FROM @Fits f
    CROSS APPLY (SELECT COUNT(*) AS FeeRows, MAX(a.SubsidyPercentage) AS Share
                 FROM dbo.AssessmentFee a
                 WHERE a.SpecialCategory = f.Category AND a.EnterpriseTypee = @EnterpriseTypee AND a.Coupon IS NULL
                   AND (@Certification IS NULL OR a.Certification = @Certification)) x
    WHERE x.FeeRows > 0
    ORDER BY ISNULL(x.Share, -1) DESC, f.Category;

    RETURN ISNULL(@Category, 0);
END';
GO
-- ---------------------------------------------------------------- 4. the payment procedures
-- ZED_CONSULTANT
IF DB_NAME() = N'ZED_CONSULTANT'
    EXEC sys.sp_executesql N'-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[SP_MSME_GET_PAYMENT_DETAILS] --NULL, ''<redacted>'',''<redacted>''
(
	@MsmeId varchar(50) = NULL,
	@ZedId varchar(50) = NULL,
	@Certification varchar(50) = NULL
)
AS
BEGIN
	
	SET NOCOUNT ON;
	DECLARE @EnterpriseTypee varchar(50), @SpecialCategory varchar(50), @IsAspirationalDt varchar(50), @SubsidyUsed bit = 0
	
	select @IsAspirationalDt=IsAspirationalDt from Districts where DistrictCode in (select PLgDistrictCode from Msme where ZedId=@ZedId)

	if @MsmeId IS NULL
		SELECT @MsmeId = MsmeId from msme where ZedId=@ZedId

		SELECT @EnterpriseTypee=EnterpriseTypee FROM Msme Where ZedId=@ZedId

		IF EXISTS(SELECT * FROM PaymentGateWayTransactions  where Certification=@Certification and PaymentStatus=''success'' and ZedId=CONCAT(@ZedId,''_D''))
		SET @SubsidyUsed = 1

    --SELECT @SpecialCategory=1 FROM MsmeBasicInformation Where MsmeId=@MsmeId
	-- V4 0041: the category the unit fits with the highest subsidy share (0 General, 1 SC, 2 woman, 3 ST, 4-8 regions), dbo.FN_V4_SUBSIDY_CATEGORY;
	-- was: SC, ST, woman or aspirational district 1, else 0
	SET @SpecialCategory = dbo.FN_V4_SUBSIDY_CATEGORY(@ZedId, @EnterpriseTypee, @Certification, NULL)

	IF (select count(*) from MsmeCertifications where ZedId=CONCAT(@ZedId,''_D'') and Certification=@Certification)>0 AND @SubsidyUsed=1
	BEGIN
		
		SELECT *,cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=''REJECTED'' AND Certification=@Certification AND Coupon IS NOT NULL --AND SpecialCategory IS  NULL	
		print 1
		SELECT *,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=''REJECTED'' AND Certification=@Certification AND Coupon IS NULL --AND SpecialCategory IS  NULL	
		print 2

	END

	ELSE
	BEGIN
		-- V4 0041: the rows of the unit''s category (was: IF @SpecialCategory = 1 SpecialCategory IS NOT NULL, else IS NULL)
			SELECT *,cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NOT NULL AND SpecialCategory = @SpecialCategory
			print 3
			SELECT *,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NULL AND SpecialCategory = @SpecialCategory
			print 4
	END

	SELECT  case when IsCouponUsed=1 then 1 else 0 end as IsCouponUsed from msme where ZedId=@ZedId
END';
GO
-- ZEDCS_V2_LIVE
IF DB_NAME() = N'ZEDCS_V2_LIVE'
    EXEC sys.sp_executesql N'-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[SP_MSME_GET_PAYMENT_DETAILS] --NULL, ''<redacted>'',''<redacted>''
(
	@MsmeId varchar(50) = NULL,
	@ZedId varchar(50) = NULL,
	@Certification varchar(50) = NULL
)
AS
BEGIN
	
	SET NOCOUNT ON;
	DECLARE @EnterpriseTypee varchar(50), @SpecialCategory varchar(50), @IsAspirationalDt varchar(50), @SubsidyUsed bit = 0,
	@IsRecertification int = 0,
	@RecertificationLevel varchar(50) = '''',
	@PanNo varchar(50) =NULL,
	@StateCode varchar(50) = NULL,
	@UdyamNo varchar(50) = NULL

	
	select @IsAspirationalDt=IsAspirationalDt,@StateCode=StateCode from Districts where DistrictCode in (select PLgDistrictCode from Msme where ZedId=@ZedId)

	if @MsmeId IS NULL
		SELECT @MsmeId = MsmeId from msme where ZedId=@ZedId

		SELECT @EnterpriseTypee=EnterpriseTypee FROM Msme Where ZedId=@ZedId

		-- checking recertification
    SELECT @IsRecertification=Recertification,@RecertificationLevel=ReCertificationLevel, @PanNo=PanNo, @UdyamNo=UdyogAadharNo FROM MsmeBasicInformation WHERE ZedId=@ZedId --and UdyogAadharNo IN (''<redacted>'', ''<redacted>'', ''<redacted>'',''<redacted>'')

		---IF SUBSIDY USED INITIALLY THEN NO SUBSIDY FOR REJECTED CASES
		IF EXISTS(SELECT * FROM PaymentGateWayTransactions  where Certification=@Certification and PaymentStatus=''success'' and ZedId like CONCAT(@ZedId,''[_]D%''))
			SET @SubsidyUsed = 1
		
		ELSE IF EXISTS(SELECT * FROM MsmePaymentInfo  where Certification=@Certification and Certification in (''Bronze'',''Silver'',''Gold'') and ZedId like CONCAT(@ZedId,''[_]D%''))
			SET @SubsidyUsed = 1 

		--ELSE IF EXISTS(SELECT * FROM MsmePaymentInfo  where Certification=@Certification and Certification=''<redacted>'' and (UseCoupon IS NULL OR UseCoupon=''<redacted>'')  and ZedId like CONCAT(@ZedId,''<redacted>''))
		--	SET @SubsidyUsed = 1 


    --SELECT @SpecialCategory=1 FROM MsmeBasicInformation Where MsmeId=@MsmeId
	-- V4 0041: the category the unit fits with the highest subsidy share (0 General, 1 SC, 2 woman, 3 ST, 4-8 regions), dbo.FN_V4_SUBSIDY_CATEGORY;
	-- was: CASE WHEN Gender=''Female'' then 2 WHEN SocialCategoryName in (''SC'',''ST'') THEN 1 WHEN @IsAspirationalDt=1 then 1 else 0 END
	SET @SpecialCategory = dbo.FN_V4_SUBSIDY_CATEGORY(@ZedId, @EnterpriseTypee, @Certification, NULL)







	IF @StateCode=28 AND (@IsRecertification = 0 OR (@IsRecertification = 1 AND @ReCertificationLevel!=@Certification)) and @Certification in (''Silver'',''Gold'') AND NOT EXISTS (SELECT 1 FROM MsmeCertifications WHERE ZedId LIKE CONCAT(@ZedId, ''[_]D%'') AND Certification = @Certification)
	--IF @UdyamNo=''<redacted>'' and @Certification in (''<redacted>'',''<redacted>'')
	BEGIN
		
		SELECT *,@PanNo UdyamPanNo,cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel,
		concat(''('',cast(StateSubsidyPercentage as int),''%'','')'') StateSubsidyLabel, ''Yes'' IsEligibleStateSubsidy
		FROM StateAssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NOT NULL AND SpecialCategory = @SpecialCategory
		print ''state logic 1''


		SELECT *,@PanNo UdyamPanNo,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel,
		concat(''('',cast(StateSubsidyPercentage as int),''%'','')'') StateSubsidyLabel, ''Yes'' IsEligibleStateSubsidy
		FROM StateAssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NULL AND SpecialCategory = @SpecialCategory
		print ''state logic 2''

	END

	ELSE IF (select count(*) from MsmeCertifications where ZedId like CONCAT(@ZedId,''[_]D%'') and Certification=@Certification)>0 AND @SubsidyUsed=1
	BEGIN
		
		SELECT *, ''No'' IsEligibleStateSubsidy,@PanNo UdyamPanNo,cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=''REJECTED'' AND Certification=@Certification AND Coupon IS NOT NULL --AND SpecialCategory IS  NULL	
		print 1
		SELECT *, ''No'' IsEligibleStateSubsidy,@PanNo UdyamPanNo,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=''REJECTED'' AND Certification=@Certification AND Coupon IS NULL --AND SpecialCategory IS  NULL	
		print 2

	END

	ELSE IF (@IsRecertification = 1 AND @Certification=@RecertificationLevel)
        BEGIN
            SELECT *, ''No'' IsEligibleStateSubsidy,@PanNo UdyamPanNo,cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel  FROM AssessmentFee WHERE EnterpriseTypee=''REJECTED'' AND Certification=@Certification AND Coupon IS NOT NULL;
            
            SELECT *, ''No'' IsEligibleStateSubsidy,@PanNo UdyamPanNo,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=''REJECTED'' AND Certification=@Certification AND Coupon IS NULL;
        END

    ELSE
	BEGIN		
		SELECT *, ''No'' IsEligibleStateSubsidy,@PanNo UdyamPanNo,cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NOT NULL AND SpecialCategory = @SpecialCategory
		print 3
		SELECT *, ''No'' IsEligibleStateSubsidy,@PanNo UdyamPanNo,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NULL AND SpecialCategory = @SpecialCategory
		print 4
		--IF @SpecialCategory = 1
		--BEGIN
		--	SELECT *,cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''<redacted>'',cast(SubsidyPercentage as int),''<redacted>'',''<redacted>'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NOT NULL AND SpecialCategory = @SpecialCategory
		--	print 3
		--	SELECT *,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''<redacted>'',cast(SubsidyPercentage as int),''<redacted>'',''<redacted>'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NULL AND SpecialCategory = @SpecialCategory
		--	print 4
		--END
		--ELSE
		--BEGIN
		--	SELECT *,cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''<redacted>'',cast(SubsidyPercentage as int),''<redacted>'',''<redacted>'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NOT NULL AND SpecialCategory IS NULL
		--	print 5
		--	SELECT *,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''<redacted>'',cast(SubsidyPercentage as int),''<redacted>'',''<redacted>'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NULL AND SpecialCategory IS NULL
		--	print 6
		--END
	END

	SELECT  case when ((@IsRecertification=1 AND @Certification=@RecertificationLevel) OR IsCouponUsed=1)  then 1 else 0 end as IsCouponUsed, @IsRecertification IsRecertification, @RecertificationLevel RecertificationLevel from msme where ZedId=@ZedId
END';
GO
IF DB_NAME() = N'ZEDCS_V2_LIVE'
    EXEC sys.sp_executesql N'-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS] --null, ''<redacted>'',''<redacted>''
(
	@MsmeId varchar(50) = NULL,
	@ZedId varchar(50) = NULL,
	@Certification varchar(50) = NULL
)
AS
BEGIN
	
	SET NOCOUNT ON;
	DECLARE @EnterpriseTypee varchar(50), @SpecialCategory varchar(50), @IsAspirationalDt varchar(50), @SubsidyUsed bit = 0, @MileStoneNo int = 0,
	@PanNo varchar(50) =NULL,
	@StateCode varchar(50) = NULL,
	@UdyamNo varchar(50) = NULL

	IF EXISTS (select * from ZED_CONSULTANT.dbo.MsmeCertifications where ZedId=@ZedId and Certification=@Certification and CertificationStatus<16 and IdDisabled Is null)
	BEGIN
		Insert into MsmeHistoryForDuplicates (ZedId,Descrip,CreatedDate,CertificationType,StatusType)
		values (@ZedId,concat(''Response came from PaymentGateway while milestone is in progress '',@Certification),getdate(),@Certification,NULL)

		UPDATE DummyUsersForError SET IsActive=''ABC PAYMENT DONE'' where UserId=''ZEDMSME000112''

	END
	ELSE
	BEGIN
	
			select @MileStoneNo=isnull(max(NcCount),0)+1 from ZED_CONSULTANT.dbo.MsmeCertifications where ZedId=@ZedId and Certification=@Certification
	
			select @IsAspirationalDt=IsAspirationalDt,@StateCode=StateCode from ZED_CONSULTANT.dbo.Districts where DistrictCode in (select PLgDistrictCode from ZED_CONSULTANT.dbo.Msme where ZedId=@ZedId)

			if @MsmeId IS NULL
				SELECT @MsmeId = MsmeId from ZED_CONSULTANT.dbo.msme where ZedId=@ZedId

				SELECT @EnterpriseTypee=EnterpriseTypee FROM ZED_CONSULTANT.dbo.Msme Where ZedId=@ZedId

			--SELECT @SpecialCategory=1 FROM ZED_CONSULTANT.dbo.MsmeBasicInformation Where MsmeId=@MsmeId
			-- V4 0041: the category the unit fits with the highest subsidy share (0 General, 1 SC, 2 woman, 3 ST, 4-8 regions), ZED_CONSULTANT.dbo.FN_V4_SUBSIDY_CATEGORY;
			-- was: SC, ST, woman or aspirational district 1, else 0
			SELECT  @PanNo=PanNo, @UdyamNo=UdyogAadharNo FROM ZED_CONSULTANT.dbo.MsmeBasicInformation Where MsmeId=@MsmeId
			SET @SpecialCategory = ZED_CONSULTANT.dbo.FN_V4_SUBSIDY_CATEGORY(@ZedId, @EnterpriseTypee, NULL, @MileStoneNo)

			
			IF @StateCode=28 AND (@MileStoneNo=1 OR EXISTS (SELECT 1 FROM ZED_CONSULTANT.dbo.StateHandholdingPaymentDates WHERE ZedId=@ZedId AND CertificationLevel = @Certification and MileStoneNum=1))
			AND NOT EXISTS (SELECT 1 FROM ZED_CONSULTANT.dbo.StateHandholdingPaymentDates WHERE ZedId = @ZedId AND CertificationLevel <> @Certification)
			--IF @UdyamNo=''<redacted>'' AND (@MileStoneNo=1 OR EXISTS (SELECT 1 FROM ZED_CONSULTANT.dbo.StateHandholdingPaymentDates WHERE ZedId=@ZedId AND CertificationLevel = @Certification and MileStoneNum=1))
			--AND NOT EXISTS (SELECT 1 FROM ZED_CONSULTANT.dbo.StateHandholdingPaymentDates WHERE ZedId = @ZedId AND CertificationLevel <> @Certification)
			BEGIN
				SELECT *,@PanNo UdyamPanNo,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel,
				concat(''('',cast(StateSubsidyPercentage as int),''%'','')'') StateSubsidyLabel
				FROM ZED_CONSULTANT.dbo.StateAssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Coupon IS NULL AND SpecialCategory = @SpecialCategory AND Milestone=@MileStoneNo
				
				SELECT *,@PanNo UdyamPanNo,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel,
				concat(''('',cast(StateSubsidyPercentage as int),''%'','')'') StateSubsidyLabel
				FROM ZED_CONSULTANT.dbo.StateAssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Coupon IS NULL AND SpecialCategory = @SpecialCategory AND Milestone=@MileStoneNo
				
			END


			ELSE
			BEGIN
				-- V4 0041: the rows of the unit''s category (was: IF @SpecialCategory = 1 SpecialCategory IS NOT NULL, else IS NULL)
				SELECT *,@PanNo UdyamPanNo,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM ZED_CONSULTANT.dbo.AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Coupon IS NULL AND SpecialCategory = @SpecialCategory AND Milestone=@MileStoneNo
				SELECT *,@PanNo UdyamPanNo,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM ZED_CONSULTANT.dbo.AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Coupon IS NULL AND SpecialCategory = @SpecialCategory AND Milestone=@MileStoneNo
			END

			SELECT  case when IsCouponUsed=1 then 1 else 0 end as IsCouponUsed from ZED_CONSULTANT.dbo.msme where ZedId=@ZedId

	END
END';
GO
-- ZED_SURVEILLANCE
IF DB_NAME() = N'ZED_SURVEILLANCE'
    EXEC sys.sp_executesql N'-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[SP_MSME_GET_PAYMENT_DETAILS] --NULL, ''<redacted>'',''<redacted>''
(
	@MsmeId varchar(50) = NULL,
	@ZedId varchar(50) = NULL,
	@Certification varchar(50) = NULL
)
AS
BEGIN
	
	SET NOCOUNT ON;

	DECLARE @CertGstNo varchar(50) = null, @CertTanNo varchar(50) = null, @CertTds varchar(50) = null, @CertUnitGstin varchar(50) = null, @CertTdsDeductable varchar(50) = null
	print @CertGstNo
	select @CertGstNo=GstinNumber,@CertTanNo=TanNumber,@CertTds=Tds,@CertUnitGstin=UnitGstin,@CertTdsDeductable=TdsDeductible  from ZEDCS_V2_LIVE.DBO.MsmePaymentInfo where ZedId=@ZedId AND Certification=@Certification
	print concat(''gst-'',@CertGstNo,'' tan-'', @CertTanNo,'' tds-'', @CertTds)


	DECLARE @EnterpriseTypee varchar(50), @SpecialCategory varchar(50), @IsAspirationalDt varchar(50), @SubsidyUsed bit = 0,
	@PanNo varchar(50) =NULL
	
	select @IsAspirationalDt=IsAspirationalDt from Districts where DistrictCode in (select PLgDistrictCode from Msme where ZedId=@ZedId)

	if @MsmeId IS NULL
		SELECT @MsmeId = MsmeId from msme where ZedId=@ZedId

		SELECT @EnterpriseTypee=EnterpriseTypee FROM Msme Where ZedId=@ZedId

		IF EXISTS(SELECT * FROM PaymentGateWayTransactions  where Certification=@Certification and PaymentStatus=''success'' and ZedId=CONCAT(@ZedId,''_D''))
		SET @SubsidyUsed = 1

    --SELECT @SpecialCategory=1 FROM MsmeBasicInformation Where MsmeId=@MsmeId
	-- V4 0041: the category the unit fits with the highest subsidy share (0 General, 1 SC, 2 woman, 3 ST, 4-8 regions), dbo.FN_V4_SUBSIDY_CATEGORY;
	-- was: woman, SC, ST or aspirational district 1, else 0
	SELECT   @PanNo=PanNo FROM MsmeBasicInformation Where MsmeId=@MsmeId
	SET @SpecialCategory = dbo.FN_V4_SUBSIDY_CATEGORY(@ZedId, @EnterpriseTypee, @Certification, NULL)

	IF (select count(*) from MsmeCertifications where ZedId=CONCAT(@ZedId,''_D'') and Certification=@Certification)>0 AND @SubsidyUsed=1
	BEGIN
		
		SELECT *,@PanNo UdyamPanNo,cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel, @CertGstNo CertGstNo ,@CertTanNo CertTanNo,@CertTds CertTds,@CertUnitGstin CertUnitGstin, @CertTdsDeductable CertTdsDeductable  FROM AssessmentFee WHERE EnterpriseTypee=''REJECTED'' AND Certification=@Certification AND Coupon IS NOT NULL --AND SpecialCategory IS  NULL	
		print 1
		SELECT *,@PanNo UdyamPanNo,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel, @CertGstNo CertGstNo ,@CertTanNo CertTanNo,@CertTds CertTds,@CertUnitGstin CertUnitGstin, @CertTdsDeductable CertTdsDeductable  FROM AssessmentFee WHERE EnterpriseTypee=''REJECTED'' AND Certification=@Certification AND Coupon IS NULL --AND SpecialCategory IS  NULL	
		print 2

	END

	ELSE
	BEGIN
		
		SELECT *,@PanNo UdyamPanNo,cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel, @CertGstNo CertGstNo ,@CertTanNo CertTanNo,@CertTds CertTds,@CertUnitGstin CertUnitGstin, @CertTdsDeductable CertTdsDeductable  FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NOT NULL AND SpecialCategory = @SpecialCategory
		print 3
		SELECT *,@PanNo UdyamPanNo,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel, @CertGstNo CertGstNo ,@CertTanNo CertTanNo,@CertTds CertTds,@CertUnitGstin CertUnitGstin, @CertTdsDeductable CertTdsDeductable  FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NULL AND SpecialCategory = @SpecialCategory
		print 4
		--IF @SpecialCategory = 1
		--BEGIN
		--	SELECT *,cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''<redacted>'',cast(SubsidyPercentage as int),''<redacted>'',''<redacted>'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NOT NULL AND SpecialCategory = @SpecialCategory
		--	print 3
		--	SELECT *,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''<redacted>'',cast(SubsidyPercentage as int),''<redacted>'',''<redacted>'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NULL AND SpecialCategory = @SpecialCategory
		--	print 4
		--END
		--ELSE
		--BEGIN
		--	SELECT *,cast((TotalAfterCoupon*SubsidyPercentage)/100 as int) Subsidy, concat(''<redacted>'',cast(SubsidyPercentage as int),''<redacted>'',''<redacted>'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NOT NULL AND SpecialCategory IS NULL
		--	print 5
		--	SELECT *,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''<redacted>'',cast(SubsidyPercentage as int),''<redacted>'',''<redacted>'') SubsidyLabel FROM AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Certification=@Certification AND Coupon IS NULL AND SpecialCategory IS NULL
		--	print 6
		--END
	END

	SELECT  case when IsCouponUsed=1 then 1 else 0 end as IsCouponUsed from msme where ZedId=@ZedId
END';
GO
IF DB_NAME() = N'ZED_SURVEILLANCE'
    EXEC sys.sp_executesql N'-- =============================================
-- Author:		<Author,,Name>
-- Create date: <Create Date,,>
-- Description:	<Description,,>
-- =============================================
CREATE OR ALTER PROCEDURE [dbo].[SP_CONSULTANCY_MSME_GET_PAYMENT_DETAILS] --null, ''<redacted>'',''<redacted>''
(
	@MsmeId varchar(50) = NULL,
	@ZedId varchar(50) = NULL,
	@Certification varchar(50) = NULL
)
AS
BEGIN
	
	SET NOCOUNT ON;
	DECLARE @EnterpriseTypee varchar(50), @SpecialCategory varchar(50), @IsAspirationalDt varchar(50), @SubsidyUsed bit = 0, @MileStoneNo int = 0

	select @MileStoneNo=isnull(max(NcCount),0)+1 from ZED_CONSULTANT.dbo.MsmeCertifications where ZedId=@ZedId and Certification=@Certification
	
	select @IsAspirationalDt=IsAspirationalDt from ZED_CONSULTANT.dbo.Districts where DistrictCode in (select PLgDistrictCode from ZED_CONSULTANT.dbo.Msme where ZedId=@ZedId)

	if @MsmeId IS NULL
		SELECT @MsmeId = MsmeId from ZED_CONSULTANT.dbo.msme where ZedId=@ZedId

		SELECT @EnterpriseTypee=EnterpriseTypee FROM ZED_CONSULTANT.dbo.Msme Where ZedId=@ZedId

    --SELECT @SpecialCategory=1 FROM ZED_CONSULTANT.dbo.MsmeBasicInformation Where MsmeId=@MsmeId
	-- V4 0041: the category the unit fits with the highest subsidy share (0 General, 1 SC, 2 woman, 3 ST, 4-8 regions), ZED_CONSULTANT.dbo.FN_V4_SUBSIDY_CATEGORY;
	-- was: SC, ST, woman or aspirational district 1, else 0
	SET @SpecialCategory = ZED_CONSULTANT.dbo.FN_V4_SUBSIDY_CATEGORY(@ZedId, @EnterpriseTypee, NULL, @MileStoneNo)

	


	-- V4 0041: the rows of the unit''s category (was: IF @SpecialCategory = 1 SpecialCategory IS NOT NULL, else IS NULL)
	BEGIN
		SELECT *,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM ZED_CONSULTANT.dbo.AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Coupon IS NULL AND SpecialCategory = @SpecialCategory AND Milestone=@MileStoneNo
		SELECT *,cast((Total*SubsidyPercentage)/100 as int) Subsidy, concat(''('',cast(SubsidyPercentage as int),''%'','')'') SubsidyLabel FROM ZED_CONSULTANT.dbo.AssessmentFee WHERE EnterpriseTypee=@EnterpriseTypee AND Coupon IS NULL AND SpecialCategory = @SpecialCategory AND Milestone=@MileStoneNo
	END

	SELECT  case when IsCouponUsed=1 then 1 else 0 end as IsCouponUsed from ZED_CONSULTANT.dbo.msme where ZedId=@ZedId
END';
GO
IF DB_NAME() = N'ZED_SURVEILLANCE'
    EXEC sys.sp_executesql N'CREATE OR ALTER PROCEDURE [dbo].[SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND] 
(
	@ZedId varchar(50) = NULL,
	@Certification varchar(50) = NULL
)
AS
BEGIN
	SET NOCOUNT ON; -- This stops "rows affected" messages from slowing down the loop
	
	DECLARE @PaymentRefId INT = NULL,
	        @MsmeId varchar(50) = NULL,
            @CertGstNo varchar(50) = null, 
            @CertTanNo varchar(50) = null, 
            @CertTds varchar(50) = null, 
            @CertUnitGstin varchar(50) = null, 
            @CertTdsDeductable varchar(50) = null,
            @EnterpriseTypee varchar(50), 
            @SpecialCategory varchar(50), 
            @IsAspirationalDt varchar(50), 
            @SubsidyUsed bit = 0;

    -- 1. Combined lookup: Fetch all metadata in ONE hit to the tables
	SELECT 
        @CertGstNo = GstinNumber,
        @CertTanNo = TanNumber,
        @CertTds = Tds,
        @CertUnitGstin = UnitGstin,
        @CertTdsDeductable = TdsDeductible  
    FROM ZEDCS_V2_LIVE.DBO.MsmePaymentInfo 
    WHERE ZedId = @ZedId AND Certification = @Certification;

	SELECT 
        @MsmeId = m.MsmeId,
        @EnterpriseTypee = m.EnterpriseTypee,
        @IsAspirationalDt = d.IsAspirationalDt
    FROM msme m
    LEFT JOIN Districts d ON d.DistrictCode = m.PLgDistrictCode
    WHERE m.ZedId = @ZedId;

    -- 2. Check for Subsidy
    IF EXISTS(SELECT 1 FROM PaymentGateWayTransactions WHERE Certification = @Certification AND PaymentStatus = ''success'' AND ZedId = CONCAT(@ZedId,''_D''))
    BEGIN
		SET @SubsidyUsed = 1;
    END

    -- 3. Calculate Special Category
	-- V4 0041: the category the unit fits with the highest subsidy share (0 General, 1 SC, 2 woman, 3 ST, 4-8 regions), dbo.FN_V4_SUBSIDY_CATEGORY;
	-- was: woman, SC, ST or aspirational district 1, else 0
	SET @SpecialCategory = dbo.FN_V4_SUBSIDY_CATEGORY(@ZedId, @EnterpriseTypee, @Certification, NULL);

    -- 4. Logic for PaymentRefId (REMOVED the SELECT * result sets)
	IF EXISTS(SELECT 1 FROM MsmeCertifications WHERE ZedId = CONCAT(@ZedId,''_D'') AND Certification = @Certification) AND @SubsidyUsed = 1
	BEGIN
		SELECT TOP 1 @PaymentRefId = Id 
        FROM AssessmentFee 
        WHERE EnterpriseTypee = ''REJECTED'' AND Certification = @Certification AND Coupon IS NOT NULL;
	END
	ELSE
	BEGIN
		SELECT TOP 1 @PaymentRefId = Id 
        FROM AssessmentFee 
        WHERE EnterpriseTypee = @EnterpriseTypee AND Certification = @Certification AND Coupon IS NOT NULL AND SpecialCategory = @SpecialCategory;
	END

    -- 5. Final Execution
	EXEC [SP_MSME_ZERO_PAYMENT_DETAILS] @ZedId, @Certification, NULL, @CertUnitGstin, @CertGstNo, @CertTdsDeductable, @CertTds, @CertTanNo, @PaymentRefId;

    -- Return only one final message (Optional: Comment this out for maximum speed)
	-- SELECT ''<redacted>'' as Status; 
END';
GO
COMMIT;
GO
