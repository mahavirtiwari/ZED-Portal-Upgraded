-- Run on ZED_SURVEILLANCE, after 0038 (dbo.SP_V4_SURVEILLANCE_COPY_UNIT) and 0079. Safe to re-run: each procedure is
-- skipped once edited (0033 / 0038 recreate SP_V4_SURVEILLANCE_COPY_UNIT on every run before this one, which edits it again).
--
-- 2026-11-15 (the user): every level can have every flow (0078), so a main Bronze can be certified after a visit (status
-- 16, SaCertificateNo, no DaCertificateNo) and a main Silver / Gold at the desktop (status 6, DaCertificateNo, no
-- SaCertificateNo). The surveillance procedures took main's certificate number (and the date of certification) by the
-- ROUTE of the level's name: a Bronze round DaCertificateNo / status 6, a Silver / Gold round SaCertificateNo / status 16.
-- They now take them from main's record by its own status, as 0079 reads it:
--   certified            CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))
--   certificate number   CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END
-- A main record certified by neither route gets today's value (the round's own column).
--
-- The surveillance round keeps its OWN scheme: a Bronze round ends at the desktop (SP_MONITORING_DA_FINAL_SUBMIT: status 6,
-- the number in the round's DaCertificateNo), a Silver / Gold / V4 site round after its visit (SP_MONITORING_RA_FINAL_SUBMIT:
-- status 16, SaCertificateNo). Only the VALUE copied into that column changes. The round's own status and column must stay:
-- the surveillance procedures read "in progress" from them (SiteAssessorId IS NOT NULL AND SaCertificateNo IS NULL: the
-- assessor app, attendance (0076), the RA final submit's own re-run check), the lists and the portal read the round's status
-- by its level (Bronze 6, others 16), and SP_DA / SP_RA_GET_CERTIFICATE_DETAILS return the round's own column. So the
-- certificate of a Bronze round shows main's site number in its DaCertificateNo, that of a Silver round main's desktop
-- number in its SaCertificateNo; the portal draws them with the level's own surveillance artwork as before.
--
-- ZED_SURVEILLANCE:
--   SP_MONITORING_DA_FINAL_SUBMIT      Bronze round certified: main's number by main's status (was DaCertificateNo).
--   SP_MONITORING_RA_FINAL_SUBMIT      site round certified: main's number by main's status (was SaCertificateNo; a main
--                                      record certified at the desktop gives its DaCertificateNo).
--   SP_DA_GET_CERTIFICATE_DETAILS      DateOfCertification: main's record at status 6 or 16 (was 6 only: blank for a Bronze
--                                      certified after a visit).
--   SP_RA_GET_CERTIFICATE_DETAILS      DateOfCertification: main's record certified by either route (was 16 only: blank for a
--                                      Silver / Gold certified at the desktop).
--   SP_V4_SURVEILLANCE_COPY_UNIT       (0038; main's SP_V4_LEVEL_SURVEILLANCE_SCHEDULE opens a round with it) the copied
--                                      MsmeBasicInformation.ZedCertifiedDate: Bronze from main's Bronze at 6 or 16 (was 6),
--                                      other levels from main's records certified by either route (was 16).
-- Not changed: the legacy insert jobs (SP_JOB_FOR_INSERT_BRONZE_SURVEILLANCE_DATA / _SURVEILLANCE_DATA, replaced by the V4
-- schedule at its switch-over; each copies the date of the records it selects itself), the payment procedures' agency
-- (main's CertificationBodyUserId at 16), the main certificate's CertificationPhase / benefits updates of the final submits.
-- For the records of today (main Bronze certified at 6 with DaCertificateNo, Silver / Gold at 16 with SaCertificateNo)
-- every value stays the same.
-- The procedures are edited in place by exact replacement (helper below, as in 0079): a live text that differs from the
-- reviewed one changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZED_SURVEILLANCE'
    THROW 50082, '0082 runs on ZED_SURVEILLANCE.', 1;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; as in 0079). #V4_EDIT_PROCEDURE edits one procedure of this
-- database in place: it reads the live definition, applies the replacements listed for it in #V4_EDITS (each Find
-- must occur exactly Expect times, at least once when Expect is NULL, any number of times when Expect is -1), turns
-- CREATE into ALTER (permissions are kept) and runs it with the procedure's own ANSI_NULLS / QUOTED_IDENTIFIER. A
-- definition that already contains @Marker (code text of the edit, never a comment) is left alone. Any difference
-- raises an error.
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
-- The edits
-- ---------------------------------------------------------------------------------------------------------
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_MONITORING_DA_FINAL_SUBMIT', 1,
N'select @CertificateNo=DaCertificateNo, @QrCodeSeqNo=QrCodeSeqNo from ZEDCS_V2_LIVE.dbo.MsmeCertifications where ZedId=@ZedId and Certification=@CertificationType',
N'select @CertificateNo=CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END, @QrCodeSeqNo=QrCodeSeqNo from ZEDCS_V2_LIVE.dbo.MsmeCertifications where ZedId=@ZedId and Certification=@CertificationType',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_MONITORING_RA_FINAL_SUBMIT', 1,
N'select @CertificateNo=SaCertificateNo, @QrCodeSeqNo=QrCodeSeqNo from ZEDCS_V2_LIVE.dbo.MsmeCertifications where ZedId=@ZedId and Certification=@CertificationType',
N'select @CertificateNo=CASE WHEN CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL) THEN DaCertificateNo ELSE SaCertificateNo END, @QrCodeSeqNo=QrCodeSeqNo from ZEDCS_V2_LIVE.dbo.MsmeCertifications where ZedId=@ZedId and Certification=@CertificationType',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_DA_GET_CERTIFICATE_DETAILS', 1,
N'from ZEDCS_V2_LIVE.dbo.MsmeCertifications where ZedId=@ZedId and Certification=@CertificationType and CertificationStatus=6',
N'from ZEDCS_V2_LIVE.dbo.MsmeCertifications where ZedId=@ZedId and Certification=@CertificationType and CertificationStatus IN (6, 16)',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_RA_GET_CERTIFICATE_DETAILS', 1,
N'from ZEDCS_V2_LIVE.dbo.MsmeCertifications where ZedId=@ZedId and Certification=@CertificationType and CertificationStatus=16',
N'from ZEDCS_V2_LIVE.dbo.MsmeCertifications where ZedId=@ZedId and Certification=@CertificationType and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_V4_SURVEILLANCE_COPY_UNIT', 1,
N'AND ZB.Certification = ''Bronze'' AND ZB.CertificationStatus = 6)',
N'AND ZB.Certification = ''Bronze'' AND ZB.CertificationStatus IN (6, 16))',
1),
(N'dbo.SP_V4_SURVEILLANCE_COPY_UNIT', 2,
N'AND ZP.CertificationStatus = 16',
N'AND (ZP.CertificationStatus = 16 OR (ZP.CertificationStatus = 6 AND (ZP.DaCertificateNo IS NOT NULL OR ZP.CertificationPhase IS NOT NULL)))',
1);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF DB_NAME() = N'ZED_SURVEILLANCE'
BEGIN
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_DA_FINAL_SUBMIT', @Marker = N'@CertificateNo=CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_RA_FINAL_SUBMIT', @Marker = N'@CertificateNo=CASE WHEN CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL) THEN DaCertificateNo ELSE SaCertificateNo END';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DA_GET_CERTIFICATE_DETAILS', @Marker = N'and Certification=@CertificationType and CertificationStatus IN (6, 16)';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_RA_GET_CERTIFICATE_DETAILS', @Marker = N'and Certification=@CertificationType and (CertificationStatus = 16 OR (CertificationStatus = 6 AND';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_V4_SURVEILLANCE_COPY_UNIT', @Marker = N'ZB.CertificationStatus IN (6, 16)', @Optional = 1;
END
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
