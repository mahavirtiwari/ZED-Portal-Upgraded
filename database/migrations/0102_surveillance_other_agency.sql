-- Run on ZED_SURVEILLANCE, after 0028 (Users.SectorActivity, SectionTypes.AssessmentMode on main) and 0082. Safe to re-run:
-- the procedures are recreated (CREATE OR ALTER) and each legacy payment procedure is skipped once edited.
--
-- 2026-11-19 (the user): a surveillance round never goes to the agency that did the unit's certification assessment.
-- Before, the Silver / Gold (and V4 level) surveillance payment procedures gave the round to main's certifying agency
-- (MsmeCertifications.CertificationBodyUserId at status 16), and Bronze rounds went by round robin without leaving that
-- agency out. Now every level, Bronze included, goes by round robin to another active agency that serves the unit's state
-- and sector, as the Master Admin's Allot Surveillance list offers them (SP_ASSESSMENT_AGENCIES_TO_ALLOT and the portal):
--   Bronze             AllowBronzeSurveillance, preferred state (Users.TuPreferredState = the unit's state); agencies of
--                      the unit's district (AgencyUserDistricts) first, as before.
--   other levels       not a Bronze surveillance agency, site verification (desktop verification for a level assessed at
--                      the desktop only), the unit's state in AgencyUserStates (no state rows = every state).
--   every level        active here and on main, the unit's NIC sector in UserNicSectors (no sector rows = every sector),
--                      the unit's kind (Manufacturing / Services) in Users.SectorActivity (not set or Both = any), and never
--                      an agency of main's records of this level (CertificationBodyUserId: the certifying agency).
-- The rotation is the one the Bronze round robin kept: after the agency of the last 'Auto' AgencyAllotmentHistory row of
-- the level, in Users.Id order. With no such agency the round waits on the Master Admin's Allot Surveillance list (as when
-- the certifying agency was blocked); the portal leaves the certifying agency out of that list too.
--
-- ZED_SURVEILLANCE:
--   SP_V4_SURVEILLANCE_NEXT_AGENCY           new: the choice above (reads only).
--   SP_MSME_AUTO_ALLOT_AGENCY_ROUND_ROBIN    Bronze (zero-amount payment): the choice above, then as before (the round's
--                                            agency if it has none yet, the history row; the caller mails the agency).
--   SP_MSME_PAYMENT_GATEWAY_DETAILS, SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS, ..._WITH_INFO
--                                            the round's agency is the choice above instead of main's certifying agency;
--                                            the allotment is written to AgencyAllotmentHistory ('Auto') and the round's
--                                            AutoAllocationDate before the agency is mailed (as before).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZED_SURVEILLANCE'
    THROW 50102, '0102 runs on ZED_SURVEILLANCE.', 1;
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_SURVEILLANCE_NEXT_AGENCY
(
    @ZedId varchar(50),
    @Certification varchar(50),
    @Agency varchar(100) = NULL OUTPUT
)
AS
BEGIN
    SET NOCOUNT ON;
    -- V4_0102 (2026-11-19): the next agency for a surveillance round; never the agency that certified the unit.
    SET @Agency = NULL;

    DECLARE @StateId varchar(50), @StateName varchar(200), @Nic varchar(10), @Activity varchar(200), @District varchar(100),
            @Category varchar(20), @Desktop bit = 0, @LastId bigint;

    SELECT TOP 1 @StateId = LTRIM(RTRIM(CAST(StateId AS varchar(50)))), @StateName = LTRIM(RTRIM(PStateName)),
           @Nic = LEFT(LTRIM(ISNULL(TwoDigitActivity, '')), 2), @Activity = LTRIM(RTRIM(ISNULL(Activity, '')))
    FROM dbo.Msme WHERE ZedId = @ZedId;
    IF @@ROWCOUNT = 0 RETURN;
    SELECT TOP 1 @District = LTRIM(RTRIM(LgDistrictCode)) FROM dbo.MsmeBasicInformation WHERE ZedId = @ZedId;

    -- The unit's kind: its NIC sector's type (main's Master -> Sectors), else its Udyam activity (as the portal reads it).
    SELECT TOP 1 @Category = SectorType FROM ZEDCS_V2_LIVE.dbo.Sectors
    WHERE LTRIM(RTRIM(SectorCode)) = @Nic AND SectorType IN ('Manufacturing', 'Services');
    IF @Category IS NULL AND @Activity <> ''
        SET @Category = CASE WHEN @Activity LIKE 'Manuf%' THEN 'Manufacturing' ELSE 'Services' END;

    IF @Certification <> 'Bronze'
        SELECT @Desktop = CASE WHEN AssessmentMode = 'Desktop' THEN 1 ELSE 0 END
        FROM ZEDCS_V2_LIVE.dbo.SectionTypes WHERE SectionType = @Certification;

    DECLARE @Excluded TABLE (UserId varchar(100) NOT NULL PRIMARY KEY);
    INSERT @Excluded (UserId)
    SELECT DISTINCT LTRIM(RTRIM(CertificationBodyUserId)) FROM ZEDCS_V2_LIVE.dbo.MsmeCertifications
    WHERE ZedId = @ZedId AND Certification = @Certification AND LTRIM(RTRIM(ISNULL(CertificationBodyUserId, ''))) <> '';

    DECLARE @C TABLE (UserId varchar(100) NOT NULL PRIMARY KEY, Id bigint NOT NULL, InDistrict bit NOT NULL);
    INSERT @C (UserId, Id, InDistrict)
    SELECT x.UserId, x.Id, x.InDistrict FROM (
    SELECT LTRIM(RTRIM(U.UserId)) AS UserId, U.Id,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.AgencyUserDistricts D WHERE D.UserId = U.UserId AND LTRIM(RTRIM(D.Districts)) = @District) THEN 1 ELSE 0 END AS InDistrict,
           ROW_NUMBER() OVER (PARTITION BY LTRIM(RTRIM(U.UserId)) ORDER BY U.Id) AS Rn
    FROM dbo.Users U
    WHERE U.RoleId = 2 AND U.IsActive = 1 AND LTRIM(RTRIM(ISNULL(U.UserId, ''))) <> ''
      AND EXISTS (SELECT 1 FROM ZEDCS_V2_LIVE.dbo.Users M WHERE M.UserId = U.UserId AND M.RoleId = 2 AND M.IsActive = 1)
      AND LTRIM(RTRIM(U.UserId)) NOT IN (SELECT UserId FROM @Excluded)
      AND (
            (@Certification = 'Bronze' AND U.AllowBronzeSurveillance = 1 AND LTRIM(RTRIM(U.TuPreferredState)) = @StateId)
         OR (@Certification <> 'Bronze' AND ISNULL(U.AllowBronzeSurveillance, 0) = 0
             AND (CASE WHEN @Desktop = 1 THEN U.DesktopVerification ELSE U.SiteVerification END) = 1
             AND (NOT EXISTS (SELECT 1 FROM dbo.AgencyUserStates S WHERE S.UserId = U.UserId AND S.RoleId = 2)
                  OR EXISTS (SELECT 1 FROM dbo.AgencyUserStates S WHERE S.UserId = U.UserId AND S.RoleId = 2 AND LTRIM(RTRIM(S.States)) = @StateName)))
          )
      AND (NOT EXISTS (SELECT 1 FROM dbo.UserNicSectors N WHERE N.UserId = U.UserId AND N.RoleId = 2)
           OR EXISTS (SELECT 1 FROM dbo.UserNicSectors N WHERE N.UserId = U.UserId AND N.RoleId = 2 AND LTRIM(RTRIM(N.NicSectorCode)) = @Nic))
      AND (@Category IS NULL OR U.SectorActivity IS NULL OR U.SectorActivity NOT IN ('Manufacturing', 'Services') OR U.SectorActivity = @Category)
    ) AS x WHERE x.Rn = 1;

    -- Bronze: the agencies of the unit's district first (the legacy round robin's rule).
    IF @Certification = 'Bronze' AND EXISTS (SELECT 1 FROM @C WHERE InDistrict = 1)
        DELETE @C WHERE InDistrict = 0;

    SELECT @LastId = U.Id FROM dbo.Users U
    WHERE U.UserId = (SELECT TOP 1 AgencyId FROM dbo.AgencyAllotmentHistory WHERE AllotType = 'Auto' AND CertificationType = @Certification ORDER BY Id DESC);

    SELECT TOP 1 @Agency = UserId FROM @C WHERE Id > ISNULL(@LastId, -1) ORDER BY Id;
    IF @Agency IS NULL
        SELECT TOP 1 @Agency = UserId FROM @C ORDER BY Id;
END
GO
CREATE OR ALTER PROCEDURE [dbo].[SP_MSME_AUTO_ALLOT_AGENCY_ROUND_ROBIN]
(
    @ZedId varchar(50) = NULL,
    @CertificationType varchar(50) = NULL
)
AS
BEGIN
    SET NOCOUNT ON;
    -- V4_0102 (2026-11-19): the agency comes from SP_V4_SURVEILLANCE_NEXT_AGENCY (never the certifying agency).
    DECLARE @NextUserId varchar(100) = NULL;
    EXEC dbo.SP_V4_SURVEILLANCE_NEXT_AGENCY @ZedId, @CertificationType, @NextUserId OUTPUT;
    IF @NextUserId IS NULL RETURN;

    UPDATE MsmeCertifications SET CertificationBodyUserId = @NextUserId, AutoAllocationDate = GETDATE()
    WHERE ZedId = @ZedId AND Certification = @CertificationType AND CertificationBodyUserId IS NULL AND NcCount = 0;
    IF @@ROWCOUNT > 0
        INSERT INTO AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType, CreatedDate)
        VALUES (@NextUserId, @ZedId, @CertificationType, 'Auto', GETDATE());
END
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; as in 0079 / 0082). #V4_EDIT_PROCEDURE edits one procedure of this
-- database in place: it reads the live definition, applies the replacements listed for it in #V4_EDITS (each Find
-- must occur exactly Expect times, at least once when Expect is NULL), turns CREATE into ALTER (permissions are kept)
-- and runs it with the procedure's own ANSI_NULLS / QUOTED_IDENTIFIER. A definition that already contains @Marker is
-- left alone. Any difference raises an error.
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
        IF (@expect IS NULL AND @count = 0) OR (@expect IS NOT NULL AND @expect <> -1 AND @count <> @expect)
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
-- The edits (the same two in each payment procedure). 1: after the legacy choice of main's certifying agency, the
-- round robin above decides (the procedure's own check that the agency is active on main follows unchanged).
-- 2: in the procedure's "agency allotted" block, before its mail, the allotment's history row and date.
-- ---------------------------------------------------------------------------------------------------------
DECLARE @nl nvarchar(2) = NCHAR(13) + NCHAR(10);
DECLARE @choose nvarchar(400) = N'--and RestrictMail IS NULL' + @nl +
    N'		EXEC dbo.SP_V4_SURVEILLANCE_NEXT_AGENCY @ZedId, @Certification, @Agency OUTPUT; -- V4 0102: never the certifying agency';
DECLARE @record nvarchar(1000) =
    N'INSERT INTO AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType, CreatedDate) VALUES (@Agency, @ZedId, @Certification, ''Auto'', GETDATE());' + @nl +
    N'				 UPDATE MsmeCertifications SET AutoAllocationDate = GETDATE() WHERE ZedId = @ZedId AND Certification = @Certification AND CertificationBodyUserId = @Agency AND AutoAllocationDate IS NULL;' + @nl +
    N'				 EXEC [SP_SEND_AUTO_MAIL_FOR_AUTO_ALLOT_AGENCY] @ZedId, @Certification';
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect)
SELECT p.Obj, e.Seq, e.Find, e.Replacement, 1
FROM (VALUES (N'dbo.SP_MSME_PAYMENT_GATEWAY_DETAILS'), (N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS'),
             (N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO')) AS p (Obj)
CROSS JOIN (VALUES (1, N'--and RestrictMail IS NULL', @choose),
                   (2, N'EXEC [SP_SEND_AUTO_MAIL_FOR_AUTO_ALLOT_AGENCY] @ZedId, @Certification', @record)) AS e (Seq, Find, Replacement);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF DB_NAME() = N'ZED_SURVEILLANCE'
BEGIN
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_PAYMENT_GATEWAY_DETAILS', @Marker = N'EXEC dbo.SP_V4_SURVEILLANCE_NEXT_AGENCY @ZedId, @Certification, @Agency OUTPUT';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS', @Marker = N'EXEC dbo.SP_V4_SURVEILLANCE_NEXT_AGENCY @ZedId, @Certification, @Agency OUTPUT';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_MANUAL_UPDATE_PAYMENT_GATEWAY_DETAILS_WITH_INFO', @Marker = N'EXEC dbo.SP_V4_SURVEILLANCE_NEXT_AGENCY @ZedId, @Certification, @Agency OUTPUT';
END
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
