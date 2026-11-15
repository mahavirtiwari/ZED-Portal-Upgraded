-- Run on ZEDCS_V2_LIVE and ZED_SURVEILLANCE, after 0078 (dbo.FN_V4_LEVEL_DESKTOP) and the earlier edits of these procedures
-- (0046, 0047, 0050; fixes main 07, 09, 12, 14 when they ran). Safe to re-run: each procedure is skipped once edited.
--
-- 2026-11-15 (the user): every level can now have every flow (0078), so a Bronze can be certified after a visit (status
-- 16, SaCertificateNo) and a Silver / Gold at the desktop (status 6, DaCertificateNo). The operational procedures below read
-- "certified" by the level's name (Bronze 6, Silver / Gold 16); they now read it from the record:
--   certified            CertificationStatus = 16
--                        OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))
--                        (16 is only reached through certification; only certification sets CertificationPhase: ACTIVE,
--                        later UPGRADED / EXPIRED / WITHDRAWN. A unit waiting for its visit has neither: a Silver after its
--                        desktop step, a level skipped to its visit (0074), 0078's Bronze with a visit. So a very old Bronze
--                        at 6 without DaCertificateNo stays certified, and the answer never depends on the level's flow.)
--   waiting for a visit  CertificationStatus = 6 and not certified
--   certificate number   CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END; folder SA at 16, else DA
--   desktop path         DaCertificateNo IS NOT NULL OR (CertificationStatus = 6 AND CertificationPhase IS NOT NULL)
--                        OR (dbo.FN_V4_LEVEL_DESKTOP(Certification) = 1 AND (CertificationStatus < 6 OR CertificationStatus IN (7, 99)))
--                        certified at the desktop, or a Desktop-only level before its desktop final submit or rejected at
--                        the desktop (7, 99). Picks Bronze's stage scale (> 5 done, NCs at the desktop) or Silver's (> 8
--                        visit, > 15 done) where a procedure picked it by the name; only the steps of units in progress
--                        depend on the level's flow.
-- For the records of today (Bronze certified at 6, Silver / Gold at 16, waiting at 6 with no number or phase) every answer
-- stays the same. Names kept for other purposes stay: payment flags, NC columns, Gold's products, the UPGRADED marking,
-- the partner API's and the consultancy hand-over's Bronze / Silver / Gold only, each app column's own values.
-- ZEDCS_V2_LIVE:
--   SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO(_AND_ZEDID)  partner API: the latest certified Bronze / Silver / Gold by the
--                                         rule; the file path's folder (DA / SA) by the record's status.
--   SP_APP_MSME_CHECK_LOGIN, SP_APP_MSME_STATUS  MSME app: the done step by the desktop path (Bronze column 3, Silver / Gold
--                                         column 4, the values the app reads as certified); the certificate paths by the
--                                         certificate number and status; the higher level that marks Bronze / Silver as
--                                         upgraded (5) is the latest certified non-Bronze level.
--   SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE, SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE  the certified level (Gold,
--                                         Silver, Bronze, in that order) by the rule.
--   SP_ASSESSMENT_ALLOT_LIST              agency's site allotment: records waiting for a visit (8, or 6 not certified), any level.
--   SP_ASSESSMENT_DA_DETAILS              the visit's result sets (site photos, meetings, products, raw materials) also for a
--                                         Bronze whose flow has a visit (dbo.FN_V4_LEVEL_DESKTOP = 0: the flow of the assessment
--                                         in progress), as for Silver; a desktop Bronze gets today's sets. The portal picks the
--                                         screenshots / ESG sets by the number of sets returned.
--   SP_CONSULTANCY_APP_MSME_STATUS        ZedCertificate (handholding): the latest certified Bronze / Silver / Gold.
--   SP_MONITORING_GET_LIST(_PAGINATION)   the "Certified" filter by the rule; the assessor's completed list (5 / 6 or 15 / 16)
--                                         by the desktop path.
--   SP_MONITORING_SEND_BACK_TO_ASSESSOR   QC / rejection send back: Bronze's branch (NC-based 3 / 4, rejection 7 -> 4) for a
--                                         record on the desktop path, Silver's (3 from the desktop, 13 / 14, rejection 17 -> 14)
--                                         otherwise (fix 07's state check too, when it ran).
--   SP_MSME_GET_DETAILS                   the surveillance buttons: a certified record with its certificate number, any route.
--   SP_MSME_GET_MY_DOCUMENTS              the certificates: shown when the certificate number is given, folder by the status.
--   SP_VERIFY_QR_CODE                     CertificateNo by the record's status.
--   SP_JOB_TO_UPDATE_3YEARS_COMPLETED_TO_EXPIRED  the certified Bronze / Silver / Gold, and the higher certified level that
--                                         keeps a lower one from expiring, by the rule.
-- ZED_SURVEILLANCE (the main certificate read through ZEDCS_V2_LIVE; FN_V4_LEVEL_DESKTOP over its own SectionTypes copy):
--   SURVEILLANCE_REJECTION_UPGRADED_MAINSYSTEM, SP_AUTO_REJECT_BRONZE_SURVEILLANCE_BEFORE_EXPIRY  the main Silver / Gold that
--                                         makes the Bronze surveillance unnecessary, and the main Bronze nearing expiry, by the rule.
-- The procedures are edited in place by exact replacement (helper below, as in 0077; Expect -1 marks an edit of text that
-- an optional fix added, made when present): a live text that differs from the reviewed one changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() NOT IN (N'ZEDCS_V2_LIVE', N'ZED_SURVEILLANCE')
    THROW 50079, '0079 runs on ZEDCS_V2_LIVE and ZED_SURVEILLANCE.', 1;
IF OBJECT_ID(N'dbo.FN_V4_LEVEL_DESKTOP', N'FN') IS NULL
    THROW 50079, 'Run 0078 first (dbo.FN_V4_LEVEL_DESKTOP).', 1;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; as in 0077, plus Expect -1). #V4_EDIT_PROCEDURE edits one procedure of this
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
(N'dbo.SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO', 1,
N'(CertificationStatus = 6 AND Certification = ''Bronze'')',
N'(Certification IN (''Bronze'', ''Silver'', ''Gold'') AND CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))',
1),
(N'dbo.SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO', 2,
N'OR (CertificationStatus = 16 AND Certification IN (''Silver'', ''Gold''))',
N'OR (CertificationStatus = 16 AND Certification IN (''Bronze'', ''Silver'', ''Gold''))',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO_AND_ZEDID', 1,
N'(CertificationStatus = 6 AND Certification = ''Bronze'')',
N'(Certification IN (''Bronze'', ''Silver'', ''Gold'') AND CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))',
1),
(N'dbo.SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO_AND_ZEDID', 2,
N'OR (CertificationStatus = 16 AND Certification IN (''Silver'', ''Gold''))',
N'OR (CertificationStatus = 16 AND Certification IN (''Bronze'', ''Silver'', ''Gold''))',
1),
(N'dbo.SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO_AND_ZEDID', 3,
N'concat(''/'',CertPath,''/DA/'',@ZedId,''/Bronze.pdf'') BronzePath',
N'concat(''/'',CertPath,CASE WHEN C.CertificationStatus = 16 THEN ''/SA/'' ELSE ''/DA/'' END,@ZedId,''/Bronze.pdf'') BronzePath',
1),
(N'dbo.SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO_AND_ZEDID', 4,
N'concat(''/'',CertPath,''/SA/'',@ZedId,''/Silver.pdf'') SilverPath',
N'concat(''/'',CertPath,CASE WHEN C.CertificationStatus = 16 THEN ''/SA/'' ELSE ''/DA/'' END,@ZedId,''/Silver.pdf'') SilverPath',
1),
(N'dbo.SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO_AND_ZEDID', 5,
N'concat(''/'',CertPath,''/SA/'',@ZedId,''/Gold.pdf'') GoldPath',
N'concat(''/'',CertPath,CASE WHEN C.CertificationStatus = 16 THEN ''/SA/'' ELSE ''/DA/'' END,@ZedId,''/Gold.pdf'') GoldPath',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_APP_MSME_CHECK_LOGIN', 1,
N'from MsmeCertifications where CertificationStatus=16 and ZedId=@UserId',
N'from MsmeCertifications where Certification<>''Bronze'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))) and ZedId=@UserId',
1),
(N'dbo.SP_APP_MSME_CHECK_LOGIN', 2,
N'WHEN CertificationStatus>5 THEN 3',
N'WHEN CertificationStatus>5 AND ((C.DaCertificateNo IS NOT NULL OR (C.CertificationStatus = 6 AND C.CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(C.Certification) = 1 AND (C.CertificationStatus < 6 OR C.CertificationStatus IN (7, 99)))) OR C.CertificationStatus>15) THEN 3',
1),
(N'dbo.SP_APP_MSME_CHECK_LOGIN', 3,
N'WHEN CertificationStatus>15 THEN 4',
N'WHEN CertificationStatus>15 OR (CertificationStatus>5 AND (C.DaCertificateNo IS NOT NULL OR (C.CertificationStatus = 6 AND C.CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(C.Certification) = 1 AND (C.CertificationStatus < 6 OR C.CertificationStatus IN (7, 99))))) THEN 4',
2),
(N'dbo.SP_APP_MSME_CHECK_LOGIN', 4,
N'case when DaCertificateNo is null then '''' else concat(@CurrentUrl,''/Certificates/DA/'',@UserId,''/Bronze.pdf'') end',
N'case when (CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END) is null then '''' else concat(@CurrentUrl,''/Certificates/'',case when CertificationStatus = 16 then ''SA'' else ''DA'' end,''/'',@UserId,''/Bronze.pdf'') end',
NULL),
(N'dbo.SP_APP_MSME_CHECK_LOGIN', 5,
N'case when SaCertificateNo is null then '''' else concat(@CurrentUrl,''/Certificates/SA/'',@UserId,''/Silver.pdf'') end',
N'case when (CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END) is null then '''' else concat(@CurrentUrl,''/Certificates/'',case when CertificationStatus = 16 then ''SA'' else ''DA'' end,''/'',@UserId,''/Silver.pdf'') end',
NULL),
(N'dbo.SP_APP_MSME_CHECK_LOGIN', 6,
N'case when SaCertificateNo is null then '''' else concat(@CurrentUrl,''/Certificates/SA/'',@UserId,''/Gold.pdf'') end',
N'case when (CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END) is null then '''' else concat(@CurrentUrl,''/Certificates/'',case when CertificationStatus = 16 then ''SA'' else ''DA'' end,''/'',@UserId,''/Gold.pdf'') end',
NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_APP_MSME_STATUS', 1,
N'from MsmeCertifications where CertificationStatus=16 and ZedId=@ZedId',
N'from MsmeCertifications where Certification<>''Bronze'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))) and ZedId=@ZedId',
1),
(N'dbo.SP_APP_MSME_STATUS', 2,
N'WHEN CertificationStatus>5 THEN 3',
N'WHEN CertificationStatus>5 AND ((C.DaCertificateNo IS NOT NULL OR (C.CertificationStatus = 6 AND C.CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(C.Certification) = 1 AND (C.CertificationStatus < 6 OR C.CertificationStatus IN (7, 99)))) OR C.CertificationStatus>15) THEN 3',
1),
(N'dbo.SP_APP_MSME_STATUS', 3,
N'WHEN CertificationStatus>15 THEN 4',
N'WHEN CertificationStatus>15 OR (CertificationStatus>5 AND (C.DaCertificateNo IS NOT NULL OR (C.CertificationStatus = 6 AND C.CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(C.Certification) = 1 AND (C.CertificationStatus < 6 OR C.CertificationStatus IN (7, 99))))) THEN 4',
2),
(N'dbo.SP_APP_MSME_STATUS', 4,
N'case when DaCertificateNo is null then '''' else concat(@CurrentUrl,''/Certifications/DA/'',@ZedId,''/Bronze.pdf'') end',
N'case when (CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END) is null then '''' else concat(@CurrentUrl,''/Certifications/'',case when CertificationStatus = 16 then ''SA'' else ''DA'' end,''/'',@ZedId,''/Bronze.pdf'') end',
NULL),
(N'dbo.SP_APP_MSME_STATUS', 5,
N'case when SaCertificateNo is null then '''' else concat(@CurrentUrl,''/Certifications/SA/'',@ZedId,''/Silver.pdf'') end',
N'case when (CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END) is null then '''' else concat(@CurrentUrl,''/Certifications/'',case when CertificationStatus = 16 then ''SA'' else ''DA'' end,''/'',@ZedId,''/Silver.pdf'') end',
NULL),
(N'dbo.SP_APP_MSME_STATUS', 6,
N'case when SaCertificateNo is null then '''' else concat(@CurrentUrl,''/Certifications/SA/'',@ZedId,''/Gold.pdf'') end',
N'case when (CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END) is null then '''' else concat(@CurrentUrl,''/Certifications/'',case when CertificationStatus = 16 then ''SA'' else ''DA'' end,''/'',@ZedId,''/Gold.pdf'') end',
NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE', 1,
N'AND Certification=''Gold'' AND CertificationStatus=16 )',
N'AND Certification=''Gold'' AND (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))) )',
1),
(N'dbo.SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE', 2,
N'AND Certification=''Silver'' AND CertificationStatus=16 )',
N'AND Certification=''Silver'' AND (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))) )',
1),
(N'dbo.SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE', 3,
N'AND Certification=''Bronze'' AND CertificationStatus=6 )',
N'AND Certification=''Bronze'' AND (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))) )',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE', 1,
N'AND Certification=''Gold'' AND CertificationStatus=16 )',
N'AND Certification=''Gold'' AND (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))) )',
1),
(N'dbo.SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE', 2,
N'AND Certification=''Silver'' AND CertificationStatus=16 )',
N'AND Certification=''Silver'' AND (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))) )',
1),
(N'dbo.SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE', 3,
N'AND Certification=''Bronze'' AND CertificationStatus=6 )',
N'AND Certification=''Bronze'' AND (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))) )',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_ASSESSMENT_ALLOT_LIST', 1,
N'AND CertificationBodyUserId=@UserId AND Certification!=''Bronze''',
N'AND CertificationBodyUserId=@UserId',
1),
(N'dbo.SP_ASSESSMENT_ALLOT_LIST', 2,
N'AND ( CertificationStatus in (6,8)',
N'AND ( (CertificationStatus = 8 OR (CertificationStatus = 6 AND P.DaCertificateNo IS NULL AND P.CertificationPhase IS NULL))',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_ASSESSMENT_DA_DETAILS', 1,
N'IF @Certification!=''Bronze''',
N'IF @Certification!=''Bronze'' OR dbo.FN_V4_LEVEL_DESKTOP(@Certification) = 0',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_CONSULTANCY_APP_MSME_STATUS', 1,
N'(((Certification in (''Silver'',''Gold'') and CertificationStatus=16)) OR ((Certification=''Bronze'' and CertificationStatus=6)))',
N'(Certification in (''Bronze'',''Silver'',''Gold'') and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))))',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_MONITORING_GET_LIST', 1,
N'(@Status=6 AND ((P.Certification=''Bronze'' and CertificationStatus=6) OR ( P.Certification!=''Bronze'' and CertificationStatus=16)))',
N'(@Status=6 AND (P.CertificationStatus = 16 OR (P.CertificationStatus = 6 AND (P.DaCertificateNo IS NOT NULL OR P.CertificationPhase IS NOT NULL))))',
2),
(N'dbo.SP_MONITORING_GET_LIST', 2,
N'(@Status=6 AND ((P.Certification=''Bronze'' and CertificationStatus IN (5,6)) OR ( P.Certification!=''Bronze'' and CertificationStatus IN (15,16))))',
N'(@Status=6 AND ((P.CertificationStatus IN (5,6) AND (P.DaCertificateNo IS NOT NULL OR (P.CertificationStatus = 6 AND P.CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(P.Certification) = 1 AND (P.CertificationStatus < 6 OR P.CertificationStatus IN (7, 99))))) OR P.CertificationStatus IN (15,16)))',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_MONITORING_GET_LIST_PAGINATION', 1,
N'(@Status=6 AND P.Certification=''Bronze'' and CertificationStatus=6) OR (@Status=6 AND P.Certification!=''Bronze'' and CertificationStatus=16)',
N'(@Status=6 AND (P.CertificationStatus = 16 OR (P.CertificationStatus = 6 AND (P.DaCertificateNo IS NOT NULL OR P.CertificationPhase IS NOT NULL))))',
9);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', 1,
N'@Nc5Status int = NULL',
N'@Nc5Status int = NULL,
	@V4Desktop bit = 0',
1),
(N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', 2,
N'@NewCertiStatus=case when (NcCount=0 and Certification=''Bronze'') then 3 when (NcCount>0 and Certification=''Bronze'') then 4',
N'@V4Desktop=CASE WHEN (DaCertificateNo IS NOT NULL OR (CertificationStatus = 6 AND CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(Certification) = 1 AND (CertificationStatus < 6 OR CertificationStatus IN (7, 99)))) THEN 1 ELSE 0 END,
	@NewCertiStatus=case when (NcCount=0 and (DaCertificateNo IS NOT NULL OR (CertificationStatus = 6 AND CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(Certification) = 1 AND (CertificationStatus < 6 OR CertificationStatus IN (7, 99))))) then 3 when (NcCount>0 and (DaCertificateNo IS NOT NULL OR (CertificationStatus = 6 AND CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(Certification) = 1 AND (CertificationStatus < 6 OR CertificationStatus IN (7, 99))))) then 4 when NcCount=0 then 13 when NcCount>0 then 14',
1),
(N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', 3,
N'((Certification=''Bronze'' and CertificationStatus=7) OR (Certification!=''Bronze'' and CertificationStatus=17))',
N'((@V4Desktop=1 and CertificationStatus=7) OR (@V4Desktop=0 and CertificationStatus=17))',
1),
(N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', 4,
N'(@CertificationType=''Bronze'' AND @CertiStatus=7) OR (@CertificationType<>''Bronze'' AND @CertiStatus=17)',
N'(@V4Desktop=1 AND @CertiStatus=7) OR (@V4Desktop=0 AND @CertiStatus=17)',
-1),
(N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', 5,
N'IF @CertificationType=''Bronze''',
N'IF @V4Desktop=1',
2);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_MSME_GET_DETAILS', 1,
N'WHERE CertificationStatus = 6 AND DaCertificateNo IS NOT NULL',
N'WHERE ((CertificationStatus = 6 AND DaCertificateNo IS NOT NULL) OR (CertificationStatus = 16 AND SaCertificateNo IS NOT NULL))',
1),
(N'dbo.SP_MSME_GET_DETAILS', 2,
N'WHERE CertificationStatus = 16 AND SaCertificateNo IS NOT NULL',
N'WHERE ((CertificationStatus = 6 AND DaCertificateNo IS NOT NULL) OR (CertificationStatus = 16 AND SaCertificateNo IS NOT NULL))',
2);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_MSME_GET_MY_DOCUMENTS', 1,
NCHAR(9) + N'CASE WHEN DaCertificateNo IS NULL THEN NULL ELSE',
NCHAR(9) + N'CASE WHEN (CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END) IS NULL THEN NULL ELSE',
1),
(N'dbo.SP_MSME_GET_MY_DOCUMENTS', 2,
NCHAR(9) + N'CASE WHEN SaCertificateNo IS NULL THEN NULL ELSE',
NCHAR(9) + N'CASE WHEN (CASE WHEN CertificationStatus = 16 THEN SaCertificateNo ELSE DaCertificateNo END) IS NULL THEN NULL ELSE',
2),
(N'dbo.SP_MSME_GET_MY_DOCUMENTS', 3,
N'+ ''/DA/'' + @ZedId + ''/Bronze.pdf''',
N'+ CASE WHEN CertificationStatus = 16 THEN ''/SA/'' ELSE ''/DA/'' END + @ZedId + ''/Bronze.pdf''',
NULL),
(N'dbo.SP_MSME_GET_MY_DOCUMENTS', 4,
N'+ ''/SA/'' + @ZedId + ''/Silver.pdf''',
N'+ CASE WHEN CertificationStatus = 16 THEN ''/SA/'' ELSE ''/DA/'' END + @ZedId + ''/Silver.pdf''',
NULL),
(N'dbo.SP_MSME_GET_MY_DOCUMENTS', 5,
N'+ ''/SA/'' + @ZedId + ''/Gold.pdf''',
N'+ CASE WHEN CertificationStatus = 16 THEN ''/SA/'' ELSE ''/DA/'' END + @ZedId + ''/Gold.pdf''',
NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_VERIFY_QR_CODE', 1,
N'case when @CertificationType=''Bronze'' then DaCertificateNo else SaCertificateNo end as CertificateNo',
N'CASE WHEN C.CertificationStatus = 16 THEN C.SaCertificateNo ELSE C.DaCertificateNo END as CertificateNo',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_JOB_TO_UPDATE_3YEARS_COMPLETED_TO_EXPIRED', 1,
N'(C.Certification = ''Bronze'' AND C.CertificationStatus = 6',
N'(C.Certification = ''Bronze'' AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL)))',
1),
(N'dbo.SP_JOB_TO_UPDATE_3YEARS_COMPLETED_TO_EXPIRED', 2,
N'S.Certification IN (''Silver'', ''Gold'') AND S.CertificationStatus = 16',
N'S.Certification IN (''Silver'', ''Gold'') AND (S.CertificationStatus = 16 OR (S.CertificationStatus = 6 AND (S.DaCertificateNo IS NOT NULL OR S.CertificationPhase IS NOT NULL)))',
1),
(N'dbo.SP_JOB_TO_UPDATE_3YEARS_COMPLETED_TO_EXPIRED', 3,
N'(C.Certification = ''Silver'' AND C.CertificationStatus = 16',
N'(C.Certification = ''Silver'' AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL)))',
1),
(N'dbo.SP_JOB_TO_UPDATE_3YEARS_COMPLETED_TO_EXPIRED', 4,
N'G.Certification = ''Gold'' AND G.CertificationStatus = 16',
N'G.Certification = ''Gold'' AND (G.CertificationStatus = 16 OR (G.CertificationStatus = 6 AND (G.DaCertificateNo IS NOT NULL OR G.CertificationPhase IS NOT NULL)))',
1),
(N'dbo.SP_JOB_TO_UPDATE_3YEARS_COMPLETED_TO_EXPIRED', 5,
N'(C.Certification = ''Gold'' AND C.CertificationStatus = 16)',
N'(C.Certification = ''Gold'' AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))))',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SURVEILLANCE_REJECTION_UPGRADED_MAINSYSTEM', 1,
N'AND lc.CertificationStatus = 16;',
N'AND (lc.CertificationStatus = 16 OR (lc.CertificationStatus = 6 AND (lc.DaCertificateNo IS NOT NULL OR lc.CertificationPhase IS NOT NULL)));',
1);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_AUTO_REJECT_BRONZE_SURVEILLANCE_BEFORE_EXPIRY', 1,
N'AND S.CertificationStatus = 16',
N'AND (S.CertificationStatus = 16 OR (S.CertificationStatus = 6 AND (S.DaCertificateNo IS NOT NULL OR S.CertificationPhase IS NOT NULL)))',
1),
(N'dbo.SP_AUTO_REJECT_BRONZE_SURVEILLANCE_BEFORE_EXPIRY', 2,
N'main.CertificationStatus = 6',
N'(main.CertificationStatus = 16 OR (main.CertificationStatus = 6 AND (main.DaCertificateNo IS NOT NULL OR main.CertificationPhase IS NOT NULL)))',
1);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF DB_NAME() = N'ZEDCS_V2_LIVE'
BEGIN
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO', @Marker = N'AND CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_API_MSME_GET_CERTIFICATIONS_BY_UDYAM_NO_AND_ZEDID', @Marker = N'AND CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_APP_MSME_CHECK_LOGIN', @Marker = N'where Certification<>''Bronze'' and (CertificationStatus = 16';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_APP_MSME_STATUS', @Marker = N'where Certification<>''Bronze'' and (CertificationStatus = 16';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_APP_MSME_INSERT_FINANCIAL_ASSISTANCE', @Marker = N'AND Certification=''Gold'' AND (CertificationStatus = 16 OR';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_FINANCIAL_ASSISTANCE_GET_CURRENT_CERTIFICATE', @Marker = N'AND Certification=''Gold'' AND (CertificationStatus = 16 OR';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_ALLOT_LIST', @Marker = N'(CertificationStatus = 6 AND P.DaCertificateNo IS NULL AND P.CertificationPhase IS NULL)';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_DA_DETAILS', @Marker = N'OR dbo.FN_V4_LEVEL_DESKTOP(@Certification) = 0';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_CONSULTANCY_APP_MSME_STATUS', @Marker = N'(Certification in (''Bronze'',''Silver'',''Gold'') and (CertificationStatus = 16';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_GET_LIST', @Marker = N'(@Status=6 AND (P.CertificationStatus = 16';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_GET_LIST_PAGINATION', @Marker = N'(@Status=6 AND (P.CertificationStatus = 16';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MONITORING_SEND_BACK_TO_ASSESSOR', @Marker = N'@V4Desktop bit = 0';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_GET_DETAILS', @Marker = N'WHERE ((CertificationStatus = 6 AND DaCertificateNo IS NOT NULL) OR (CertificationStatus = 16 AND SaCertificateNo IS NOT NULL))';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_MSME_GET_MY_DOCUMENTS', @Marker = N'CASE WHEN CertificationStatus = 16 THEN ''/SA/'' ELSE ''/DA/'' END + @ZedId';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_VERIFY_QR_CODE', @Marker = N'CASE WHEN C.CertificationStatus = 16 THEN C.SaCertificateNo ELSE C.DaCertificateNo END';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_JOB_TO_UPDATE_3YEARS_COMPLETED_TO_EXPIRED', @Marker = N'(C.Certification = ''Bronze'' AND (C.CertificationStatus = 16';
END
IF DB_NAME() = N'ZED_SURVEILLANCE'
BEGIN
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SURVEILLANCE_REJECTION_UPGRADED_MAINSYSTEM', @Marker = N'AND (lc.CertificationStatus = 16 OR';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_AUTO_REJECT_BRONZE_SURVEILLANCE_BEFORE_EXPIRY', @Marker = N'AND (S.CertificationStatus = 16 OR';
END
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
