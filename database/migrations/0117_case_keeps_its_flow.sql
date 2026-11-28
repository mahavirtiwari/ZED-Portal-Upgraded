-- database\migrations\0117_case_keeps_its_flow.sql  (ZEDCS_V2_LIVE only; after 0078, 0079, 0116). Safe to re-run.
--
-- 2026-11-27 (the owner): each certification case keeps the assessment flow it started with. The Admin may change a level's flow
-- (Administration -> Certification Levels) at any time; only applications submitted afterwards follow the new flow. Until now every
-- step read the level's flow live (dbo.SectionTypes.AssessmentFlow through FN_V4_LEVEL_DESKTOP / FN_V4_LEVEL_MODE), so a change
-- re-routed the cases being assessed, and the change was refused while units were in progress (commit a8b3daa6).
--
--   1. dbo.MsmeCertifications.AssessmentFlow  varchar(20) NULL: 'Desktop', 'Remote', 'Onsite', 'DesktopRemote', 'DesktopOnsite' (the
--      values of SectionTypes.AssessmentFlow); NULL = not yet taken (the level's flow applies). Taken when the case enters the
--      assessment: the documents' final submit (status 2, SP_APP_MSME_FINAL_SUBMIT, called by the web portal and the ZED MSME app).
--      The cases already in progress (status 2-98, not certified, not rejected at 99) get their level's current flow here.
--   2. Readers (the case's flow, else the level's):
--        dbo.FN_V4_LEVEL_FLOW(@Code)                the level's flow as the portal reads it (LevelFlows.FlowOf): the stored one,
--                                                   else Desktop for a desktop level (FN_V4_LEVEL_DESKTOP), else DesktopOnsite.
--        dbo.FN_V4_FLOW_OF(@CaseFlow, @Code)        a case's flow from its column (for queries over many rows), else the level's.
--        dbo.FN_V4_FLOW_DESKTOP(@CaseFlow, @Code)   1 when that flow is Desktop only (certified at the desktop).
--        dbo.FN_V4_CASE_FLOW(@ZedId, @Code)         the same, reading the case's row.
--        dbo.FN_V4_CASE_DESKTOP(@ZedId, @Code)
--   3. Every step that routes a case in progress reads the case's flow:
--        SP_ASSESSMENT_DA_FINAL_SUBMIT, SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT  desktop NCs only for a Desktop only case
--        SP_ASSESSMENT_DA_DETAILS                  Bronze's result sets only for a Desktop only Bronze case
--        SP_V4_DA_FINAL_SUBMIT, SP_MONITORING_DA_FINAL_SUBMIT  certified at the desktop, or on to the visit
--        SP_V4_SKIP_DESKTOP                        Remote only / Onsite only: no desktop step
--        SP_MONITORING_SEND_BACK_TO_ASSESSOR       back into the desktop (3 / 4) or the visit (13 / 14) track
--        FN_V4_AGENCY_ELIGIBLE                     the automatic allotment's agency permission (desktop / site verification)
--        SP_MONITORING_GET_LIST, SP_APP_MSME_STATUS, SP_APP_MSME_CHECK_LOGIN, SP_DYNAMIC_REPORT_ASSESSOR_COMMENTS,
--        SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED, SP_DASHBOARD_GET_DETAILS, SP_V4_DASHBOARD_ANALYTICS
--                                                  "in the desktop track" of a row (desktop-certified levels before status 6)
--      Left on the level: payment (SP_V4_CERTIFICATION_PAID), the "as Gold" product / NC forms of a V4 level (FN_V4_LEVEL_MODE =
--      'Site'), the surveillance rounds (ZED_SURVEILLANCE), FN_V4_NC_DAYS (its stage is passed by the caller).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50117, '0117 runs on ZEDCS_V2_LIVE.', 1;
IF OBJECT_ID(N'dbo.FN_V4_LEVEL_DESKTOP') IS NULL OR OBJECT_ID(N'dbo.SP_V4_SKIP_DESKTOP') IS NULL OR OBJECT_ID(N'dbo.FN_V4_AGENCY_ELIGIBLE') IS NULL
    THROW 50117, 'Run 0078 and 0116 first.', 1;
GO

-- ---------------------------------------------------------------------------------------------------------
-- 1. The case's flow.
-- ---------------------------------------------------------------------------------------------------------
IF COL_LENGTH('dbo.MsmeCertifications', 'AssessmentFlow') IS NULL
    ALTER TABLE dbo.MsmeCertifications ADD AssessmentFlow varchar(20) NULL;
GO

-- ---------------------------------------------------------------------------------------------------------
-- 2. Readers.
-- ---------------------------------------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.FN_V4_LEVEL_FLOW (@Code varchar(50))
RETURNS varchar(20)
AS
BEGIN
    -- V4 0117: the level's flow (Admin), as LevelFlows.FlowOf: the stored one, else Desktop only for a desktop level, else Desktop + Onsite.
    DECLARE @flow varchar(20) = (SELECT TOP (1) LTRIM(RTRIM(AssessmentFlow)) FROM dbo.SectionTypes WHERE SectionType = @Code AND IsCertificationLevel = 1);
    IF @flow IN ('Desktop', 'Remote', 'Onsite', 'DesktopRemote', 'DesktopOnsite') RETURN @flow;
    RETURN CASE WHEN dbo.FN_V4_LEVEL_DESKTOP(@Code) = 1 THEN 'Desktop' ELSE 'DesktopOnsite' END;
END
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_FLOW_OF (@CaseFlow varchar(20), @Code varchar(50))
RETURNS varchar(20)
AS
BEGIN
    -- V4 0117: a case's flow (MsmeCertifications.AssessmentFlow, taken at the documents' final submit), else its level's.
    DECLARE @f varchar(20) = LTRIM(RTRIM(@CaseFlow));
    IF @f IN ('Desktop', 'Remote', 'Onsite', 'DesktopRemote', 'DesktopOnsite') RETURN @f;
    RETURN dbo.FN_V4_LEVEL_FLOW(@Code);
END
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_FLOW_DESKTOP (@CaseFlow varchar(20), @Code varchar(50))
RETURNS bit
AS
BEGIN
    -- V4 0117: 1 when the case is certified at the desktop (its flow is Desktop only); no flow taken: the level's (FN_V4_LEVEL_DESKTOP).
    DECLARE @f varchar(20) = LTRIM(RTRIM(@CaseFlow));
    IF @f IN ('Desktop', 'Remote', 'Onsite', 'DesktopRemote', 'DesktopOnsite') RETURN CASE WHEN @f = 'Desktop' THEN 1 ELSE 0 END;
    RETURN dbo.FN_V4_LEVEL_DESKTOP(@Code);
END
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_CASE_FLOW (@ZedId varchar(50), @Code varchar(50))
RETURNS varchar(20)
AS
BEGIN
    -- V4 0117: the flow of the unit's case of this level (FN_V4_FLOW_OF over its row).
    DECLARE @f varchar(20) = (SELECT TOP (1) AssessmentFlow FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Code ORDER BY Id DESC);
    RETURN dbo.FN_V4_FLOW_OF(@f, @Code);
END
GO
CREATE OR ALTER FUNCTION dbo.FN_V4_CASE_DESKTOP (@ZedId varchar(50), @Code varchar(50))
RETURNS bit
AS
BEGIN
    -- V4 0117: 1 when the unit's case of this level is certified at the desktop (FN_V4_FLOW_DESKTOP over its row).
    DECLARE @f varchar(20) = (SELECT TOP (1) AssessmentFlow FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Code ORDER BY Id DESC);
    RETURN dbo.FN_V4_FLOW_DESKTOP(@f, @Code);
END
GO

-- The cases in progress keep the flow their level has now (the Admin could not change it while they were assessed: a8b3daa6).
UPDATE dbo.MsmeCertifications
SET AssessmentFlow = dbo.FN_V4_LEVEL_FLOW(Certification)
WHERE AssessmentFlow IS NULL
  AND CertificationStatus BETWEEN 2 AND 98 AND CertificationStatus <> 16
  AND NOT (CertificationStatus = 6 AND (NULLIF(LTRIM(RTRIM(DaCertificateNo)), '') IS NOT NULL
           OR ISNULL(CertificationPhase, 'PENDING') NOT IN ('PENDING', 'REJECTED')));
GO

-- ---------------------------------------------------------------------------------------------------------
-- 3a. The automatic allotment's agency permission by the case's flow (0116's function, one line changed).
-- ---------------------------------------------------------------------------------------------------------
CREATE OR ALTER FUNCTION dbo.FN_V4_AGENCY_ELIGIBLE (@AgencyId varchar(50), @ZedId varchar(50), @Level varchar(50))
RETURNS bit
AS
BEGIN
    -- V4 0116 (the owner, 2026-11-27: automatic allotment by PO, states and sectors): the agency
    --   * has the permission the case's flow needs (Desktop only: DesktopVerification; with a remote / onsite visit: SiteVerification;
    --     V4 0117: the case's flow, FN_V4_CASE_DESKTOP),
    --   * covers the unit's plant state (AgencyUserStates; none listed = every state) and NIC sector (UserNicSectors; none = every one),
    --   * and its purchase order for the level is not used up.
    DECLARE @Agency varchar(50) = LTRIM(RTRIM(@AgencyId));
    IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE UserId = @Agency AND RoleId = 2 AND IsActive = 1
                   AND CASE WHEN dbo.FN_V4_CASE_DESKTOP(@ZedId, @Level) = 1 THEN ISNULL(DesktopVerification, 0) ELSE ISNULL(SiteVerification, 0) END = 1)
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
-- 3b. Pattern edits of the procedures (the helper of 0086 / 0116: each text must be found as reviewed, else nothing is changed).
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
-- The documents' final submit (web and app): the case takes its level's flow.
(N'dbo.SP_APP_MSME_FINAL_SUBMIT', 1,
 N'CertificationStatusDate=getdate() where ZedId=@ZedId and Certification=@CertificationType AND ISNULL(CertificationStatus, 1) <= 1',
 N'CertificationStatusDate=getdate(), AssessmentFlow=dbo.FN_V4_LEVEL_FLOW(@CertificationType) where ZedId=@ZedId and Certification=@CertificationType AND ISNULL(CertificationStatus, 1) <= 1   -- V4 0117: the case keeps this flow', 1),
-- The desktop assessor's final submit and its confirmation: desktop NCs for a Desktop only case.
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 1,
 N'dbo.FN_V4_LEVEL_DESKTOP(@CertificationType) = 1', N'dbo.FN_V4_CASE_DESKTOP(@ZedId, @CertificationType) = 1', 1),
(N'dbo.SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT', 1,
 N'dbo.FN_V4_LEVEL_DESKTOP(@CertificationType) = 1', N'dbo.FN_V4_CASE_DESKTOP(@ZedId, @CertificationType) = 1', 3),
-- The desktop review page: Bronze's result sets only for a Desktop only Bronze case.
(N'dbo.SP_ASSESSMENT_DA_DETAILS', 1,
 N'dbo.FN_V4_LEVEL_DESKTOP(@Certification) = 0', N'dbo.FN_V4_CASE_DESKTOP(@ZedId, @Certification) = 0', 1),
-- The agency's desktop final submit: certified here or on to the visit, by the case's flow.
(N'dbo.SP_V4_DA_FINAL_SUBMIT', 1,
 N'DECLARE @desktop bit = dbo.FN_V4_LEVEL_DESKTOP(@CertificationType);',
 N'DECLARE @desktop bit = dbo.FN_V4_CASE_DESKTOP(@ZedId, @CertificationType);   -- V4 0117: the case''s flow', 1),
(N'dbo.SP_MONITORING_DA_FINAL_SUBMIT', 1,
 N'ELSE IF dbo.FN_V4_LEVEL_MODE(@CertificationType) = ''Desktop''',
 N'ELSE IF dbo.FN_V4_LEVEL_MODE(@CertificationType) IS NOT NULL AND dbo.FN_V4_CASE_DESKTOP(@ZedId, @CertificationType) = 1   -- V4 0117: the case''s flow', -1),   -- only where fix main/14 added the desktop-level branch
-- No desktop step for a Remote only / Onsite only case.
(N'dbo.SP_V4_SKIP_DESKTOP', 1,
 N'DECLARE @flow varchar(20) = (SELECT TOP 1 AssessmentFlow FROM dbo.SectionTypes WHERE SectionType = @Certification AND IsCertificationLevel = 1);',
 N'DECLARE @flow varchar(20) = dbo.FN_V4_CASE_FLOW(@ZedId, @Certification);   -- V4 0117: the case''s flow', 1),
-- Send back: the desktop or the visit track by the case's flow.
(N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', 1,
 N'dbo.FN_V4_LEVEL_DESKTOP(Certification) = 1', N'dbo.FN_V4_FLOW_DESKTOP(AssessmentFlow, Certification) = 1', 3),
-- "In the desktop track" of a row, by its own flow.
(N'dbo.SP_MONITORING_GET_LIST', 1,
 N'dbo.FN_V4_LEVEL_DESKTOP(P.Certification) = 1', N'dbo.FN_V4_FLOW_DESKTOP(P.AssessmentFlow, P.Certification) = 1', 1),
(N'dbo.SP_APP_MSME_STATUS', 1,
 N'dbo.FN_V4_LEVEL_DESKTOP(C.Certification) = 1', N'dbo.FN_V4_FLOW_DESKTOP(C.AssessmentFlow, C.Certification) = 1', 3),
(N'dbo.SP_APP_MSME_CHECK_LOGIN', 1,
 N'dbo.FN_V4_LEVEL_DESKTOP(C.Certification) = 1', N'dbo.FN_V4_FLOW_DESKTOP(C.AssessmentFlow, C.Certification) = 1', 3),
(N'dbo.SP_DYNAMIC_REPORT_ASSESSOR_COMMENTS', 1,
 N'dbo.FN_V4_LEVEL_DESKTOP(C.Certification) = 1', N'dbo.FN_V4_FLOW_DESKTOP(C.AssessmentFlow, C.Certification) = 1', 1),
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 1,
 N'dbo.FN_V4_LEVEL_DESKTOP(c.Certification) = 1', N'dbo.FN_V4_FLOW_DESKTOP(c.AssessmentFlow, c.Certification) = 1', 4),
-- The dashboards' desktop-level table, unless the row has its own flow (inline: no function call per row).
(N'dbo.SP_DASHBOARD_GET_DETAILS', 1,
 N'AND MC.Certification IN (SELECT V.Lvl FROM @V4DeskLevels V)',
 N'AND (MC.AssessmentFlow = ''Desktop'' OR (ISNULL(MC.AssessmentFlow, '''') NOT IN (''Desktop'', ''Remote'', ''Onsite'', ''DesktopRemote'', ''DesktopOnsite'') AND MC.Certification IN (SELECT V.Lvl FROM @V4DeskLevels V)))', 1),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 2,
 N'AND Certification IN (SELECT V.Lvl FROM @V4DeskLevels V)',
 N'AND (AssessmentFlow = ''Desktop'' OR (ISNULL(AssessmentFlow, '''') NOT IN (''Desktop'', ''Remote'', ''Onsite'', ''DesktopRemote'', ''DesktopOnsite'') AND Certification IN (SELECT V.Lvl FROM @V4DeskLevels V)))', 1),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 1,
 N'AND C.Certification IN (SELECT V.Lvl FROM @V4DeskLevels V)',
 N'AND (C.AssessmentFlow = ''Desktop'' OR (ISNULL(C.AssessmentFlow, '''') NOT IN (''Desktop'', ''Remote'', ''Onsite'', ''DesktopRemote'', ''DesktopOnsite'') AND C.Certification IN (SELECT V.Lvl FROM @V4DeskLevels V)))', 1);
GO
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_APP_MSME_FINAL_SUBMIT', @Marker = N'FN_V4_LEVEL_FLOW(@CertificationType)';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', @Marker = N'FN_V4_CASE_DESKTOP';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_DA_CONFIRM_FINAL_SUBMIT', @Marker = N'FN_V4_CASE_DESKTOP';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_DA_DETAILS', @Marker = N'FN_V4_CASE_DESKTOP';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_V4_DA_FINAL_SUBMIT', @Marker = N'FN_V4_CASE_DESKTOP';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_DA_FINAL_SUBMIT', @Marker = N'FN_V4_CASE_DESKTOP';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_V4_SKIP_DESKTOP', @Marker = N'FN_V4_CASE_FLOW';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', @Marker = N'FN_V4_FLOW_DESKTOP';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_GET_LIST', @Marker = N'FN_V4_FLOW_DESKTOP';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_APP_MSME_STATUS', @Marker = N'FN_V4_FLOW_DESKTOP';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_APP_MSME_CHECK_LOGIN', @Marker = N'FN_V4_FLOW_DESKTOP';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ASSESSOR_COMMENTS', @Marker = N'FN_V4_FLOW_DESKTOP';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', @Marker = N'FN_V4_FLOW_DESKTOP';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DASHBOARD_GET_DETAILS', @Marker = N'MC.AssessmentFlow = ''Desktop''';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_V4_DASHBOARD_ANALYTICS', @Marker = N'C.AssessmentFlow = ''Desktop''';
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
