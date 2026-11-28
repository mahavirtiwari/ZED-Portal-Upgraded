-- database\migrations\0116_workflow_review_fixes.sql  (ZEDCS_V2_LIVE only; after 0086, 0098 and 0115). Safe to re-run.
--
-- 2026-11-27, review of the workflows and permissions of every login (the owner's decisions of that day included):
--   1. Automatic agency allotment after the documents' final submit (Bronze, Silver / Gold, every V4 level) gives a unit only to an
--      agency the Master Admin could allot it to: the permission the level's flow needs, the unit's plant state and NIC sector when
--      the agency has states / sectors set, and a purchase order for the level that is not used up (FN_V4_AGENCY_ELIGIBLE,
--      FN_V4_AGENCY_PO_STOPPED). Before, round robin by Users.Id only: a used-up PO kept receiving units. No eligible agency: the
--      unit waits on the Master Admin's Allot page (no history row with an empty agency, no mail). The ZED Facilitator's partner
--      agency ("Direct") still gets it unless its PO is used up.
--   2. SP_APP_MSME_FINAL_SUBMIT: a second call for a level already submitted (a double tap in the app) does nothing (it added a
--      second history row and a second automatic allotment, which mailed a second agency).
--   3. SP_ASSESSMENT_DA_AUTO_REJECT (NC closure job): only an NC round the unit has not answered; one transaction.
--   4. SP_MONITORING_SEND_BACK_TO_ASSESSOR: send back from a rejection after the NC rounds whatever the level's rounds (the
--      rejection's NcCount is rounds + 1, 2 to 6; only 6 was accepted, so a level with fewer than 5 rounds could not be sent back).
--   5. SP_ASSESSMENT_ALLOT_TO_AGENCY: a re-allotment after the desktop stage keeps the desktop assessor.
-- ZED_SURVEILLANCE keeps its own procedures (surveillance allotment by SP_V4_SURVEILLANCE_NEXT_AGENCY, 0102).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50116, '0116 runs on ZEDCS_V2_LIVE.', 1;
IF OBJECT_ID(N'dbo.FN_V4_NC_ROUNDS') IS NULL OR OBJECT_ID(N'dbo.PurchaseOrders', N'U') IS NULL
    THROW 50116, 'Run 0086 and 0098 first.', 1;
GO

-- ---------------------------------------------------------------------------------------------------------
-- 1. Who may receive a unit automatically: the Master Admin's Allot page's rules (AllotmentAgencies.ForAsync), in SQL so every
--    final submit (web, ZED MSME app, old app) applies them.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.FN_V4_AGENCY_PO_STOPPED (@AgencyId varchar(50), @Level varchar(50))
RETURNS bit
AS
BEGIN
    -- V4 0116: the agency's purchase orders for the level are used up (PoLimits: cases counted since the first PO, surveillance
    -- visits left out, plus the cases allotted and not finished). No PO = no limit.
    DECLARE @Agency varchar(50) = LTRIM(RTRIM(@AgencyId)), @Cases int, @FirstPo datetime;
    SELECT @Cases = SUM(Cases), @FirstPo = MIN(PoDate) FROM dbo.PurchaseOrders WHERE PartyId = @Agency AND Level = @Level;
    IF @FirstPo IS NULL RETURN 0;
    DECLARE @Used int = (SELECT COUNT(*) FROM dbo.MsmeCertifications C
                         WHERE LTRIM(RTRIM(C.ExpAgencyId)) = @Agency AND C.Certification = @Level AND C.ExpCountedOn >= @FirstPo
                           AND ISNULL(C.ExpCaseKind, '') <> 'Surveillance');
    DECLARE @Open int = (SELECT COUNT(*) FROM dbo.MsmeCertifications C
                         WHERE LTRIM(RTRIM(C.CertificationBodyUserId)) = @Agency AND C.Certification = @Level AND C.ExpCountedOn IS NULL
                           AND C.CertificationStatus BETWEEN 2 AND 98 AND C.CertificationStatus <> 16
                           AND NOT (C.CertificationStatus = 6 AND (NULLIF(LTRIM(RTRIM(C.DaCertificateNo)), '') IS NOT NULL
                                    OR ISNULL(C.CertificationPhase, 'PENDING') NOT IN ('PENDING', 'REJECTED'))));
    RETURN CASE WHEN @Used + @Open >= ISNULL(@Cases, 0) THEN 1 ELSE 0 END;
END
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_AGENCY_ELIGIBLE (@AgencyId varchar(50), @ZedId varchar(50), @Level varchar(50))
RETURNS bit
AS
BEGIN
    -- V4 0116 (the owner, 2026-11-27: automatic allotment by PO, states and sectors): the agency
    --   * has the permission the level's flow needs (Desktop only: DesktopVerification; with a remote / onsite visit: SiteVerification),
    --   * covers the unit's plant state (AgencyUserStates; none listed = every state) and NIC sector (UserNicSectors; none = every one),
    --   * and its purchase order for the level is not used up.
    DECLARE @Agency varchar(50) = LTRIM(RTRIM(@AgencyId));
    IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE UserId = @Agency AND RoleId = 2 AND IsActive = 1
                   AND CASE WHEN dbo.FN_V4_LEVEL_DESKTOP(@Level) = 1 THEN ISNULL(DesktopVerification, 0) ELSE ISNULL(SiteVerification, 0) END = 1)
        RETURN 0;
    IF EXISTS (SELECT 1 FROM dbo.AgencyUserStates WHERE UserId = @Agency AND RoleId = 2)
       AND NOT EXISTS (SELECT 1 FROM dbo.AgencyUserStates A JOIN dbo.Msme M ON M.ZedId = @ZedId
                       WHERE A.UserId = @Agency AND A.RoleId = 2 AND LTRIM(RTRIM(A.States)) = LTRIM(RTRIM(M.PStateName)))
        RETURN 0;
    IF EXISTS (SELECT 1 FROM dbo.UserNicSectors WHERE UserId = @Agency AND RoleId = 2)
       AND NOT EXISTS (SELECT 1 FROM dbo.UserNicSectors S JOIN dbo.Msme M ON M.ZedId = @ZedId
                       WHERE S.UserId = @Agency AND S.RoleId = 2 AND LTRIM(RTRIM(S.NicSectorCode)) = SUBSTRING(LTRIM(M.TwoDigitActivity), 1, 2))
        RETURN 0;
    RETURN CASE WHEN dbo.FN_V4_AGENCY_PO_STOPPED(@Agency, @Level) = 1 THEN 0 ELSE 1 END;
END
GO

-- ---------------------------------------------------------------------------------------------------------
-- 2. The automatic allotments (Silver / Gold and the V4 levels are V4's own procedures: 0063, 0065).
-- ---------------------------------------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE dbo.SP_V4_AUTO_ALLOT_AGENCY
    @ZedId varchar(50),
    @CertificationType varchar(50)
AS
BEGIN
    -- V4_0065: any V4 level, with its own agency column (0063 had ZED-X's AllowZedxAssessments).
    -- V4 0116: only an eligible agency (FN_V4_AGENCY_ELIGIBLE: flow permission, states, sectors, purchase order), else the unit
    -- waits on the Master Admin's Allot page; history and mail only when the unit was really allotted.
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.MsmeCertifications
                   WHERE ZedId = @ZedId AND Certification = @CertificationType AND CertificationBodyUserId IS NULL
                     AND ISNULL(NcCount, 0) = 0 AND CertificationStatus = 2)
        RETURN;

    DECLARE @Category varchar(20) = (
        SELECT TOP 1 COALESCE(
            CASE WHEN s.SectorType IN ('Manufacturing', 'Services') THEN s.SectorType END,
            CASE WHEN NULLIF(LTRIM(m.Activity), '') IS NULL THEN NULL
                 WHEN LTRIM(m.Activity) LIKE 'Manuf%' THEN 'Manufacturing' ELSE 'Services' END)
        FROM dbo.Msme m
        LEFT JOIN dbo.Sectors s ON LTRIM(RTRIM(s.SectorCode)) = LEFT(LTRIM(m.TwoDigitActivity), 2)
        WHERE m.ZedId = @ZedId);

    DECLARE @Column sysname = CASE WHEN @CertificationType = 'ZEDX' THEN 'AllowZedxAssessments' ELSE 'Allow' + LTRIM(RTRIM(@CertificationType)) + 'Assessments' END;
    DECLARE @Allowed nvarchar(400) =
        CASE WHEN @CertificationType NOT LIKE '%[^A-Za-z0-9]%' AND COL_LENGTH('dbo.Users', @Column) IS NOT NULL
             THEN N'ISNULL(' + QUOTENAME(@Column) + N', 1) = 1' ELSE N'1 = 1' END;
    DECLARE @Sql nvarchar(max);

    DECLARE @AgencyId varchar(50) = NULL, @AllotType varchar(20) = NULL;
    DECLARE @OrgPartnerEmailId varchar(100) = (
        SELECT TOP 1 NULLIF(OrgPartnerEmailId, '') FROM dbo.MsmeFacilitatorEntries
        WHERE LoginVerified = 'Yes' AND ZedId = @ZedId AND Certification = @CertificationType);

    IF @OrgPartnerEmailId IS NOT NULL
    BEGIN
        SET @Sql = N'SELECT TOP 1 @a = UserId FROM dbo.Users
            WHERE RoleId = 2 AND IsActive = 1 AND LTRIM(RTRIM(OrgPartnerId)) = LTRIM(RTRIM(@o))
              AND ' + @Allowed + N'
              AND (@c IS NULL OR SectorActivity IS NULL OR SectorActivity IN (''Both'', @c))
              AND dbo.FN_V4_AGENCY_PO_STOPPED(UserId, @lv) = 0;';
        EXEC sys.sp_executesql @Sql, N'@a varchar(50) OUTPUT, @o varchar(100), @c varchar(20), @lv varchar(50)',
            @a = @AgencyId OUTPUT, @o = @OrgPartnerEmailId, @c = @Category, @lv = @CertificationType;
    END
    IF @AgencyId IS NOT NULL SET @AllotType = 'Direct';

    IF @AgencyId IS NULL
    BEGIN
        DECLARE @LastId int = (
            SELECT TOP 1 u.Id FROM dbo.AgencyAllotmentHistory h JOIN dbo.Users u ON u.UserId = h.AgencyId
            WHERE h.AllotType = 'Auto' AND h.CertificationType = @CertificationType ORDER BY h.Id DESC);
        SET @Sql = N'SELECT TOP 1 @a = UserId FROM dbo.Users
            WHERE RoleId = 2 AND IsActive = 1 AND UserId NOT IN (''ZEDAA003'', ''ZEDAA0044'')
              AND ' + @Allowed + N'
              AND (@c IS NULL OR SectorActivity IS NULL OR SectorActivity IN (''Both'', @c))
              AND dbo.FN_V4_AGENCY_ELIGIBLE(UserId, @z, @lv) = 1
              AND Id > ISNULL(@l, 0)
            ORDER BY Id;';
        EXEC sys.sp_executesql @Sql, N'@a varchar(50) OUTPUT, @c varchar(20), @l int, @z varchar(50), @lv varchar(50)',
            @a = @AgencyId OUTPUT, @c = @Category, @l = @LastId, @z = @ZedId, @lv = @CertificationType;
        IF @AgencyId IS NULL
            EXEC sys.sp_executesql @Sql, N'@a varchar(50) OUTPUT, @c varchar(20), @l int, @z varchar(50), @lv varchar(50)',
                @a = @AgencyId OUTPUT, @c = @Category, @l = 0, @z = @ZedId, @lv = @CertificationType;
        IF @AgencyId IS NOT NULL SET @AllotType = 'Auto';
    END

    IF @AgencyId IS NULL RETURN;

    UPDATE dbo.MsmeCertifications SET CertificationBodyUserId = @AgencyId, AllotmentType = CASE WHEN @AllotType = 'Direct' THEN 'Direct' ELSE 'RoundRobin' END
    WHERE ZedId = @ZedId AND Certification = @CertificationType AND CertificationBodyUserId IS NULL AND ISNULL(NcCount, 0) = 0;
    IF @@ROWCOUNT = 0 RETURN;   -- V4 0116: allotted meanwhile (a second final submit): no second history row or mail
    INSERT INTO dbo.AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType, CreatedDate)
    VALUES (@AgencyId, @ZedId, @CertificationType, @AllotType, GETDATE());
    EXEC dbo.SP_SEND_MAIL_AUTO_ALLOT_AGENCY_ROUND_ROBIN @ZedId, @AgencyId;
END
GO
CREATE OR ALTER PROCEDURE [dbo].[SP_MSME_AUTO_ALLOT_AGENCY_ROUND_ROBIN_SILVER_GOLD]
(
    @ZedId varchar(50) = NULL,
    @CertificationType varchar(50) = NULL
)
AS
BEGIN
    -- V4 0116: only an eligible agency (FN_V4_AGENCY_ELIGIBLE: flow permission, states, sectors, purchase order); history and
    -- mail only when the unit was really allotted.
    SET NOCOUNT ON;

    DECLARE @LastId int = NULL;
    DECLARE @NextUserId varchar(50) = NULL;
    DECLARE @AgencyId varchar(100) = NULL;
    DECLARE @OrgPartnerEmailId varchar(100) = NULL;

    SELECT @OrgPartnerEmailId = OrgPartnerEmailId FROM MsmeFacilitatorEntries
    WHERE LoginVerified = 'Yes' AND ZedId = @ZedId AND Certification = @CertificationType;
    IF @OrgPartnerEmailId = '' SET @OrgPartnerEmailId = NULL;

    IF @OrgPartnerEmailId IS NOT NULL
        SELECT @AgencyId = UserId FROM Users
        WHERE RoleId = 2 AND IsActive = 1 AND LTRIM(RTRIM(OrgPartnerId)) = LTRIM(RTRIM(@OrgPartnerEmailId))
          AND ISNULL(CASE @CertificationType WHEN 'Silver' THEN AllowSilverAssessments WHEN 'Gold' THEN AllowGoldAssessments END, 1) = 1
          AND dbo.FN_V4_AGENCY_PO_STOPPED(UserId, @CertificationType) = 0;

    IF @AgencyId IS NOT NULL
    BEGIN
        UPDATE MsmeCertifications SET CertificationBodyUserId = @AgencyId, AllotmentType = 'Direct'
        WHERE ZedId = @ZedId AND Certification = @CertificationType AND CertificationBodyUserId IS NULL AND NcCount = 0;
        IF @@ROWCOUNT = 0 RETURN;
        INSERT INTO AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType, CreatedDate)
        VALUES (@AgencyId, @ZedId, @CertificationType, 'Direct', GETDATE());
        EXEC [SP_SEND_MAIL_AUTO_ALLOT_AGENCY_ROUND_ROBIN] @ZedId, @AgencyId;
        RETURN;
    END

    SELECT @LastId = U.Id FROM Users U
    WHERE U.UserId = (SELECT TOP 1 AgencyId FROM AgencyAllotmentHistory WHERE AllotType = 'Auto' AND CertificationType = @CertificationType ORDER BY Id DESC);

    SELECT TOP 1 @NextUserId = UserId FROM Users
    WHERE RoleId = 2 AND DesktopVerification = 1 AND IsActive = 1 AND UserId NOT IN ('ZEDAA003', 'ZEDAA0044')
      AND ISNULL(CASE @CertificationType WHEN 'Silver' THEN AllowSilverAssessments WHEN 'Gold' THEN AllowGoldAssessments END, 1) = 1
      AND dbo.FN_V4_AGENCY_ELIGIBLE(UserId, @ZedId, @CertificationType) = 1
      AND Id > ISNULL(@LastId, 0)
    ORDER BY Id;
    IF @NextUserId IS NULL
        SELECT TOP 1 @NextUserId = UserId FROM Users
        WHERE RoleId = 2 AND DesktopVerification = 1 AND IsActive = 1 AND UserId NOT IN ('ZEDAA003', 'ZEDAA0044')
          AND ISNULL(CASE @CertificationType WHEN 'Silver' THEN AllowSilverAssessments WHEN 'Gold' THEN AllowGoldAssessments END, 1) = 1
          AND dbo.FN_V4_AGENCY_ELIGIBLE(UserId, @ZedId, @CertificationType) = 1
        ORDER BY Id;

    -- No agency allowed for the level: the unit waits on the Master Admin's Allot page.
    IF @NextUserId IS NULL RETURN;

    UPDATE MsmeCertifications SET CertificationBodyUserId = @NextUserId, AllotmentType = 'RoundRobin'
    WHERE ZedId = @ZedId AND Certification = @CertificationType AND CertificationBodyUserId IS NULL AND NcCount = 0;
    IF @@ROWCOUNT = 0 RETURN;
    INSERT INTO AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType, CreatedDate)
    VALUES (@NextUserId, @ZedId, @CertificationType, 'Auto', GETDATE());
    EXEC [SP_SEND_MAIL_AUTO_ALLOT_AGENCY_ROUND_ROBIN] @ZedId, @NextUserId;
END
GO

-- ---------------------------------------------------------------------------------------------------------
-- 3. The NC closure job (V4's own procedure since 0086) and the allotment to an agency.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR ALTER PROCEDURE [dbo].[SP_ASSESSMENT_DA_AUTO_REJECT]
(
	@ZedId VarChar(50)						= NULL,
	@CertificationType VarChar(50)			= NULL,
	@AssessorRemarks VarChar(5000)			= NULL
)
AS
BEGIN
	SET NOCOUNT ON;
	SET XACT_ABORT ON;
	-- V4 0086: an NC not closed by its final closure date rejects the application at every level
	-- (desktop NC 4 -> 7, remote / onsite NC 14 -> 17); the date comes from the level's NC days (FN_V4_NC_DAYS).
	-- V4 0116 (workflow review): only while the unit has not answered the current round (Nc{n}Status 1): an answer waiting for the
	-- assessor's review is the assessor's to act on, not a reason to reject. History and status change in one transaction.
	DECLARE @Due TABLE (Id int PRIMARY KEY, ZedId varchar(50), Certification varchar(50), CertificationStatus int);
	INSERT @Due (Id, ZedId, Certification, CertificationStatus)
	SELECT Id, ZedId, Certification, CertificationStatus FROM dbo.MsmeCertifications
	WHERE CertificationStatus IN (4, 14) AND NcFinalClosureDt < GETDATE()
	  AND ISNULL(CASE NcCount WHEN 1 THEN Nc1Status WHEN 2 THEN Nc2Status WHEN 3 THEN Nc3Status WHEN 4 THEN Nc4Status WHEN 5 THEN Nc5Status END, 1) = 1;
	IF NOT EXISTS (SELECT 1 FROM @Due) RETURN;

	BEGIN TRANSACTION;
	insert into MsmeHistory(ZedId,Descrip,CreatedDate,CertificationType,StatusType)
	select ZedId,concat('Auto Rejected On ',FORMAT(getdate(), 'MMMM d, yyyy')),getdate(),Certification,'Certification auto Rejected due to NC closure time is exceeded' from @Due
	UPDATE C set NcCount=6, CertificationStatus=CASE WHEN D.CertificationStatus = 4 THEN 7 ELSE 17 END, CertificationStatusDate=getdate(), IsAutoReject=1
	FROM dbo.MsmeCertifications C JOIN @Due D ON D.Id = C.Id
	WHERE C.CertificationStatus = D.CertificationStatus
	COMMIT;
END
GO
CREATE OR ALTER PROC [dbo].[SP_ASSESSMENT_ALLOT_TO_AGENCY]
(
	@ZedId varchar(50) = NULL,
	@Certification varchar(50) = NULL,
	@CertificationBodyUserId varchar(100) = NULL
)
AS
BEGIN
	-- V4 0116 (workflow review): a re-allotment after the desktop stage (a site / remote allotment the agency rejected, or a unit
	-- waiting at 6 for its site assessor) keeps the desktop assessor and its acceptance; only the desktop stage (2 / 3) starts
	-- the desktop allotment again. The history line says which allotment it was ("... Alotted to Agency {id}" is kept).
	DECLARE @Status int = (SELECT TOP (1) CertificationStatus FROM [MsmeCertifications] WHERE ZedId=@ZedId AND Certification=@Certification);
	DECLARE @DesktopStage bit = CASE WHEN @Status IS NULL OR @Status <= 3 THEN 1 ELSE 0 END;

	UPDATE [MsmeCertifications] 
	SET CertificationBodyUserId=@CertificationBodyUserId,AcceptOrRejectDate=NULL,ReasonForRejection=NULL,
	DesktopAssessorId=CASE WHEN @DesktopStage=1 THEN NULL ELSE DesktopAssessorId END,
	DesktopAccepted=CASE WHEN @DesktopStage=1 THEN NULL ELSE DesktopAccepted END,
	DesktopAcceptOrRejectDate=CASE WHEN @DesktopStage=1 THEN NULL ELSE DesktopAcceptOrRejectDate END,
	CertificationStatus=case when CertificationStatus=3 then 2 else CertificationStatus end
	where  ZedId=@ZedId AND Certification=@Certification

	insert into MsmeHistory(ZedId,Descrip,CreatedDate,CertificationType,StatusType)
	values (@ZedId,concat(CASE WHEN @DesktopStage=1 THEN 'DA' ELSE 'Site assessment' END,' for ',@Certification, ' Alotted to Agency ',@CertificationBodyUserId),getdate(),@Certification,'AgencyAlloted')

	INSERT INTO AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType,  CreatedDate)
	VALUES (@CertificationBodyUserId, @ZedId, @Certification, 'Manual', GETDATE())

END
GO

-- ---------------------------------------------------------------------------------------------------------
-- 4. Pattern edits of two legacy procedures (the helper of 0086: each text must be found as reviewed, else nothing is changed).
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
    DECLARE @def nvarchar(max) = OBJECT_DEFINITION(@id), @before nvarchar(max);
    IF CHARINDEX(@Marker, @def) > 0
    BEGIN
        PRINT CONCAT(DB_NAME(), N'.', @Object, N': already edited.');
        RETURN;
    END

    DECLARE @seq int, @find nvarchar(max), @rep nvarchar(max), @expect int, @count int;
    SET @before = @def;
    DECLARE e CURSOR LOCAL FAST_FORWARD FOR SELECT Seq, Find, Replacement, Expect FROM #V4_EDITS WHERE Obj = @Object ORDER BY Seq;
    OPEN e;
    FETCH NEXT FROM e INTO @seq, @find, @rep, @expect;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @count = (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @find, N''))) / DATALENGTH(@find);
        -- Expect -1 (2026-11-28): optional, for text an optional fix script adds (database\fixes, not run by the deploy).
        IF ISNULL(@expect, 0) <> -1 AND ((@expect IS NULL AND @count = 0) OR (@expect IS NOT NULL AND @count <> @expect))
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
    IF @def = @before
    BEGIN
        -- Only optional replacements, none found: the procedure has nothing this migration changes.
        PRINT CONCAT(DB_NAME(), N'.', @Object, N': nothing to edit here (its optional text is not in this database), left as it is.');
        RETURN;
    END

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

INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
-- Bronze's automatic allotment: eligible agencies only, no history or mail without an agency or a second time.
(N'dbo.SP_MSME_AUTO_ALLOT_AGENCY_ROUND_ROBIN', 1,
 N'AND LTRIM(RTRIM(OrgPartnerId)) = LTRIM(RTRIM(@OrgPartnerEmailId))',
 N'AND LTRIM(RTRIM(OrgPartnerId)) = LTRIM(RTRIM(@OrgPartnerEmailId)) AND dbo.FN_V4_AGENCY_PO_STOPPED(UserId, @CertificationType) = 0', 1),
(N'dbo.SP_MSME_AUTO_ALLOT_AGENCY_ROUND_ROBIN', 2,
 N'and UserId not in (''ZEDAA001'',''ZEDAA003'',''ZEDAA0044'')',
 N'and UserId not in (''ZEDAA001'',''ZEDAA003'',''ZEDAA0044'') AND dbo.FN_V4_AGENCY_ELIGIBLE(UserId, @ZedId, @CertificationType) = 1', 2),
(N'dbo.SP_MSME_AUTO_ALLOT_AGENCY_ROUND_ROBIN', 3,
 N'----update certifications table with auto agency-----',
 N'IF @NextUserId IS NULL RETURN;   -- V4 0116: no eligible agency: the unit waits on the Master Admin''s Allot page
				----update certifications table with auto agency-----', 1),
-- The app / web final submit: a second call for a level already submitted (a double tap) does nothing.
(N'dbo.SP_APP_MSME_FINAL_SUBMIT', 1,
 N'UPDATE MsmeCertifications set CertificationStatus=2, EvidenceSubmissionDate=getdate(),CertificationStatusDate=getdate() where ZedId=@ZedId and Certification=@CertificationType',
 N'UPDATE MsmeCertifications set CertificationStatus=2, EvidenceSubmissionDate=getdate(),CertificationStatusDate=getdate() where ZedId=@ZedId and Certification=@CertificationType AND ISNULL(CertificationStatus, 1) <= 1
		IF @@ROWCOUNT = 0 RETURN;   -- V4 0116: already submitted (a double tap): no second history row or allotment', 1),
-- Send back from a rejection after the NC rounds at any number of rounds (NcCount = rounds + 1, 2 to 6), into the last round.
(N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', 1,
 N'WHEN @NcNumber=6 AND @CertiStatus IN (7, 17) THEN 1',
 N'WHEN @NcNumber BETWEEN 2 AND 6 AND @CertiStatus IN (7, 17) THEN 1', -1),   -- only where fix main/07 added the state check
(N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', 2,
 N'SELECT @Nc5Status=Nc5Status, @ExactNcStatus= CASE',
 N'SELECT @Nc5Status=CASE WHEN Nc5Status <> 0 THEN Nc5Status WHEN Nc4Status <> 0 THEN Nc4Status WHEN Nc3Status <> 0 THEN Nc3Status WHEN Nc2Status <> 0 THEN Nc2Status ELSE Nc1Status END,   -- V4 0116: the last round''s status
	@ExactNcStatus= CASE', 1),
(N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', 3,
 N'where ZedId=@ZedId and Certification=@CertificationType and NcCount=6',
 N'where ZedId=@ZedId and Certification=@CertificationType and NcCount=@NcNumber', NULL),   -- also in the procedure's commented-out lines
(N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', 4,
 N'where ZedId=@ZedId and Certification=@CertificationType and Nc5Status=2',
 N'where ZedId=@ZedId and Certification=@CertificationType and NcCount=@ExactNcStatus', 2);
GO
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_AUTO_ALLOT_AGENCY_ROUND_ROBIN', @Marker = N'FN_V4_AGENCY_ELIGIBLE';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_APP_MSME_FINAL_SUBMIT', @Marker = N'ISNULL(CertificationStatus, 1) <= 1';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', @Marker = N'V4 0116: the last round';
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
