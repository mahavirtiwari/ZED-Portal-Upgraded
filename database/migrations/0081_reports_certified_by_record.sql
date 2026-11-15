-- Run on ZEDCS_V2_LIVE, after 0079 (and 0078's dbo.FN_V4_LEVEL_DESKTOP; 0019 and 0055 before it, as always). Safe to re-run:
-- each procedure / view is skipped once edited.
--
-- 2026-11-15 (the user): the later pass of 0079 - the REPORTS and DASHBOARDS. Every level can now have every flow (0078): a
-- Bronze certified after a visit (status 16, SaCertificateNo), a Silver / Gold / ZED-X certified at the desktop (status 6,
-- DaCertificateNo). The reports and dashboards below read "certified" (or a level's stage) by the level's name (Bronze 6,
-- Silver / Gold 16); they now read it from the record, by 0079's rule:
--   certified            CertificationStatus = 16
--                        OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))
--   waiting for a visit  CertificationStatus = 6 and not certified ("QC Completed", as a Silver at 6 always was)
--   certified, numbered  (6 with its DaCertificateNo) or (16 with its SaCertificateNo) where a report counted certificate numbers
--   desktop path         DaCertificateNo IS NOT NULL OR (CertificationStatus = 6 AND CertificationPhase IS NOT NULL)
--                        OR (dbo.FN_V4_LEVEL_DESKTOP(Certification) = 1 AND (CertificationStatus < 6 OR CertificationStatus IN (7, 99)))
--                        picks the stage scale where a report picked it by the name: Bronze's (pending 2-3, NC 4/5/7, remarks
--                        AssessorRemarks) on the desktop path, Silver's (pending 2/3/5/6/8/9/13, NC 14/15/17, SaAssessorRemarks)
--                        otherwise.
-- Each report keeps its own levels (Bronze / Silver / Gold, plus ZED-X where it had it), columns, filters, dates, payment flags,
-- test units and texts; only the certified / stage reading changes. For the records of today (Bronze certified at 6 with its
-- number or phase, Silver / Gold at 16, a Silver waiting at 6 with neither) every figure and row stays the same; a Bronze at 16
-- and a Silver / Gold at 6 with its desktop number are now counted and listed as certified.
-- ZEDCS_V2_LIVE:
--   certified lists      SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME, view DynamicListofZedCertifiedMsme, SP_WEB_SITE_LIST_OF_CERTIFIED_MSME,
--                        SP_GET_CERTIFED_COUNT_STATE_WISE, SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED (also its "Under Evaluation" /
--                        "Scheduled" stage and rejection remarks by the desktop path), SP_DYNAMIC_REPORT_ZED_BASIC_INFO_2022_2023 /
--                        _2024_2025 (the products of a Bronze certified at 16).
--   units status         SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY and its five year copies (2022-2023 ... 2026-2027).
--   status lists         SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME (and its in-progress filter), _LIST_OF_DATE_MSME_NEW_BRONZE,
--                        _LIST_OF_REGISTERED_MSME_FA, _ZEDID_STATUS, view DynamicListOfZEDRegisteredMsme: the status text per level
--                        ("Certified" / "Silver Certified" / "Gold Certified" when certified by the rule, "QC Completed" when waiting
--                        for a visit, any of the three levels); SP_DYNAMIC_REPORT_ASSESSOR_COMMENTS (the visit remarks of a record
--                        not on the desktop path, any level).
--   all dates per level  SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2022_23 ... _2026_27, _BRONZE_CERTIFIED_2022_2023_2024 / _2025 /
--                        _2026, _BRONZE_INPROGRESS, _BRONZE_REJECTED, _SILVER, _GOLD, SP_REPORT_ZEDID_ALL_DATES: status text and
--                        Certified Date by the rule (their #BaseCerts gets DaCertificateNo and CertificationPhase).
--   financial support    SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2022_23 ... _2026_27, _CERT_SILVER, _CERT_GOLD,
--                        _WITH_DATES, _WITH_DATES_ASSESSMENT, _WITH_DATES_STATECODE_DISTRICTCODE, view
--                        DynamicListOfFinancialSupportZedIdsWithDates, _PAID_ZEDIDS_2025_26, _PAID_ZEDIDS_ALL_TIME,
--                        _ZEDIDS_APPLIED_FOR_RECERTIFICATION, SP_DYNAMIC_REPORT_RECERTIFICATION_ONLY_2025_26: "Certified" and the
--                        Certified/RejectedDate by the rule (the surveillance blocks, ZED_SURVEILLANCE's own statuses, unchanged:
--                        where the same text follows there, only the main blocks' occurrences are replaced, Only below).
--   dashboards           SP_DASHBOARD_GET_DETAILS and SP_V4_DASHBOARD_ANALYTICS (0019; the staff dashboard's cards): Completed /
--                        Sa*Completed by the rule (agencies / assessors: the record's certificate number, desktop or site), Pending
--                        and NC Raised on the stage scale of the record's path (V4Cert / V4Desk columns of their CTEs / #A; the
--                        desktop path through @V4DeskLevels, FN_V4_LEVEL_DESKTOP once per level, not per record); the analytics'
--                        certified units (#C) by the rule. SP_DASHBOARD_COUNTS_BY_FILTERS (certified per level),
--                        SP_DAILY_RUN_WEB_SITE_COUNTS (the website's certified counts: certified with its certificate number).
-- Not changed (no certified reading by the name, or not a ZED main record): the payment / registration / NC / rejected-only lists
-- (e.g. SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS, _LIST_OF_REJECTED_MSME, SP_DASHBOARD_REGISTERED_MSME,
-- SP_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS), the surveillance / handholding / KAWACH reports (SP_DYNAMIC_REPORT_SECOND_SURVELLIANCE,
-- _BRONZE_SURVEILLANCE_2025_26, _LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_SURVEILLANCE / _CONSULTANCY, *_KAWACH), and the backup / test
-- copies no job, page or procedure calls (*_OLD, *_old, *_old2, *_BKP, *_bkp_new_S, *_testing*, *_TEMP, *_checking, *_optimized,
-- *_OPTIMIZED, *_opt, *_backup_before_optimize, *_CHECKING_SP, SP_API_MSME_RAMP_REPORT_BKP, USP_REFRESH_DASHBOARD_CACHE).
-- The procedures are edited in place by exact replacement (0079's helper; it also takes views, and Only = replace only the first n
-- occurrences): a live text that differs from the reviewed one changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50081, '0081 runs on ZEDCS_V2_LIVE.', 1;
IF OBJECT_ID(N'dbo.FN_V4_LEVEL_DESKTOP', N'FN') IS NULL
    THROW 50081, 'Run 0078 first (dbo.FN_V4_LEVEL_DESKTOP).', 1;
IF OBJECT_ID(N'dbo.SP_V4_DASHBOARD_ANALYTICS', N'P') IS NULL
    THROW 50081, 'Run 0019 first (dbo.SP_V4_DASHBOARD_ANALYTICS).', 1;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; 0079's, for procedures and views, plus Only). #V4_EDIT_PROCEDURE edits one procedure
-- or view of this database in place: it reads the live definition, applies the replacements listed for it in #V4_EDITS (each
-- Find must occur exactly Expect times, at least once when Expect is NULL, any number of times when Expect is -1; with Only,
-- only its first Only occurrences are replaced), turns CREATE into ALTER (permissions are kept) and runs it with the module's
-- own ANSI_NULLS / QUOTED_IDENTIFIER. A definition that already contains @Marker (code text of the edit, never a comment) is
-- left alone. Any difference raises an error.
-- ---------------------------------------------------------------------------------------------------------
IF OBJECT_ID('tempdb..#V4_EDITS') IS NOT NULL DROP TABLE #V4_EDITS;
CREATE TABLE #V4_EDITS (Obj nvarchar(300) NOT NULL, Seq int NOT NULL, Find nvarchar(max) NOT NULL, Replacement nvarchar(max) NOT NULL, Expect int NULL, Only int NULL);
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
    DECLARE @id int = OBJECT_ID(@Object), @msg nvarchar(2048);
    IF @id IS NOT NULL AND OBJECTPROPERTY(@id, 'IsProcedure') = 0 AND OBJECTPROPERTY(@id, 'IsView') = 0 SET @id = NULL;
    IF @id IS NULL
    BEGIN
        IF @Optional = 1 BEGIN PRINT CONCAT(DB_NAME(), N'.', @Object, N': not in this database, skipped.'); RETURN; END;
        SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': not found.');
        THROW 50040, @msg, 1;
    END
    DECLARE @def nvarchar(max) = OBJECT_DEFINITION(@id);
    -- 2026-11-15: 0084 rewrites the certified rule this script wrote ({a}CertificationPhase IS [NOT] NULL) everywhere, markers
    -- included; a procedure carrying the rewritten marker is edited too (a re-run after 0084 changes nothing).
    DECLARE @Marker84 nvarchar(1000) = @Marker;
    DECLARE @aliases TABLE (O int NOT NULL PRIMARY KEY, A nvarchar(10) NOT NULL);
    INSERT @aliases VALUES (1, N'C.'), (2, N'G.'), (3, N'MC.'), (4, N'P.'), (5, N'S.'), (6, N'ZP.'), (7, N'lc.'), (8, N'main.'), (9, N'');
    DECLARE @o int = 1, @a nvarchar(10);
    WHILE @o <= 9   -- the bare name last, after the aliased ones
    BEGIN
        SELECT @a = A FROM @aliases WHERE O = @o;
        SET @Marker84 = REPLACE(REPLACE(@Marker84, @a + N'CertificationPhase IS NOT NULL', N'ISNULL(' + @a + N'CertificationPhase, ''PENDING'') NOT IN (''PENDING'', ''REJECTED'')'),
            @a + N'CertificationPhase IS NULL', N'ISNULL(' + @a + N'CertificationPhase, ''PENDING'') IN (''PENDING'', ''REJECTED'')');
        SET @o += 1;
    END
    IF CHARINDEX(@Marker, @def) > 0 OR CHARINDEX(@Marker84, @def) > 0
    BEGIN
        PRINT CONCAT(DB_NAME(), N'.', @Object, N': already edited.');
        RETURN;
    END

    DECLARE @seq int, @find nvarchar(max), @rep nvarchar(max), @expect int, @only int, @count int, @p int, @n int;
    DECLARE e CURSOR LOCAL FAST_FORWARD FOR SELECT Seq, Find, Replacement, Expect, Only FROM #V4_EDITS WHERE Obj = @Object ORDER BY Seq;
    OPEN e;
    FETCH NEXT FROM e INTO @seq, @find, @rep, @expect, @only;
    WHILE @@FETCH_STATUS = 0
    BEGIN
        SET @count = (DATALENGTH(@def) - DATALENGTH(REPLACE(@def, @find, N''))) / DATALENGTH(@find);
        IF (@expect IS NULL AND @count = 0) OR (@expect IS NOT NULL AND @expect <> -1 AND @count <> @expect) OR (@only IS NOT NULL AND @count < @only)
        BEGIN
            SET @msg = CONCAT(DB_NAME(), N'.', @Object, N': replacement ', @seq, N' found ', @count, N' time(s), expected ',
                ISNULL(CAST(@expect AS nvarchar(10)), N'at least 1'), N'. The live definition differs from the reviewed one: nothing was changed.');
            THROW 50041, @msg, 1;
        END
        IF @only IS NULL
            SET @def = REPLACE(@def, @find, @rep);
        ELSE
        BEGIN
            -- the first @only occurrences, left to right
            SELECT @p = 1, @n = 0;
            WHILE @n < @only
            BEGIN
                SET @p = CHARINDEX(@find, @def, @p);
                SET @def = STUFF(@def, @p, LEN(@find + N'x') - 1, @rep);
                SET @p = @p + LEN(@rep + N'x') - 1;
                SET @n += 1;
            END
        END
        FETCH NEXT FROM e INTO @seq, @find, @rep, @expect, @only;
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
    -- typed as CREATE OR ALTER (0019, or 0055's re-creation): ALTER OR ALTER -> ALTER
    SET @j = @i + 5;
    WHILE SUBSTRING(@def, @j, 1) IN (N' ', NCHAR(9), NCHAR(10), NCHAR(13)) SET @j += 1;
    IF UPPER(SUBSTRING(@def, @j, 3)) IN (N'OR ', N'OR' + NCHAR(9), N'OR' + NCHAR(10), N'OR' + NCHAR(13))
    BEGIN
        DECLARE @k int = CHARINDEX(N'ALTER', @def, @j);
        SET @def = STUFF(@def, @j, @k + 5 - @j, N'');
    END

    DECLARE @sql nvarchar(400);
    SELECT @sql = CONCAT(N'SET ANSI_NULLS ', CASE WHEN M.uses_ansi_nulls = 1 THEN N'ON' ELSE N'OFF' END,
        N'; SET QUOTED_IDENTIFIER ', CASE WHEN M.uses_quoted_identifier = 1 THEN N'ON' ELSE N'OFF' END, N'; EXEC sys.sp_executesql @d;')
    FROM sys.sql_modules M WHERE M.object_id = @id;
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
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME', 1,
N'(CertificationStatus=6 and Certification=''Bronze'')',
N'(Certification IN (''Bronze'',''Silver'',''Gold'') AND CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))',
3, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME', 2,
N'(CertificationStatus=16 and Certification IN (''Silver'',''Gold''))',
N'(CertificationStatus=16 and Certification IN (''Bronze'',''Silver'',''Gold''))',
3, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.DynamicListofZedCertifiedMsme', 1,
N'(CertificationStatus=6 and Certification=''Bronze'')',
N'(Certification IN (''Bronze'',''Silver'',''Gold'') AND CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.DynamicListofZedCertifiedMsme', 2,
N'(CertificationStatus=16 and Certification IN (''Silver'',''Gold''))',
N'(CertificationStatus=16 and Certification IN (''Bronze'',''Silver'',''Gold''))',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_WEB_SITE_LIST_OF_CERTIFIED_MSME', 1,
N'((certification=''Bronze'' and Certificationstatus=6) or (certification!=''Bronze'' and Certificationstatus=16))',
N'(Certificationstatus = 16 OR (Certificationstatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_GET_CERTIFED_COUNT_STATE_WISE', 1,
N'C.Certification = ''Bronze'' AND C.CertificationStatus = 6 THEN',
N'C.Certification = ''Bronze'' AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN',
1, NULL),
(N'dbo.SP_GET_CERTIFED_COUNT_STATE_WISE', 2,
N'C.Certification = ''Silver'' AND C.CertificationStatus = 16 THEN',
N'C.Certification = ''Silver'' AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN',
1, NULL),
(N'dbo.SP_GET_CERTIFED_COUNT_STATE_WISE', 3,
N'C.Certification = ''Gold'' AND C.CertificationStatus = 16 THEN',
N'C.Certification = ''Gold'' AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY', 1,
N'(C.CertificationStatus = 6 AND C.Certification = ''Bronze'')',
N'(C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY', 2,
N'(C.CertificationStatus = 16 AND C.Certification IN (''Silver'', ''Gold''))',
N'(C.CertificationStatus = 16 AND C.Certification IN (''Bronze'', ''Silver'', ''Gold''))',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2022-2023]', 1,
N'(C.CertificationStatus = 6 AND C.Certification = ''Bronze'')',
N'(C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2022-2023]', 2,
N'(C.CertificationStatus = 16 AND C.Certification IN (''Silver'', ''Gold''))',
N'(C.CertificationStatus = 16 AND C.Certification IN (''Bronze'', ''Silver'', ''Gold''))',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2023-2024]', 1,
N'(C.CertificationStatus = 6 AND C.Certification = ''Bronze'')',
N'(C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2023-2024]', 2,
N'(C.CertificationStatus = 16 AND C.Certification IN (''Silver'', ''Gold''))',
N'(C.CertificationStatus = 16 AND C.Certification IN (''Bronze'', ''Silver'', ''Gold''))',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2024-2025]', 1,
N'(C.CertificationStatus = 6 AND C.Certification = ''Bronze'')',
N'(C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2024-2025]', 2,
N'(C.CertificationStatus = 16 AND C.Certification IN (''Silver'', ''Gold''))',
N'(C.CertificationStatus = 16 AND C.Certification IN (''Bronze'', ''Silver'', ''Gold''))',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2025-2026]', 1,
N'(C.CertificationStatus = 6 AND C.Certification = ''Bronze'')',
N'(C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2025-2026]', 2,
N'(C.CertificationStatus = 16 AND C.Certification IN (''Silver'', ''Gold''))',
N'(C.CertificationStatus = 16 AND C.Certification IN (''Bronze'', ''Silver'', ''Gold''))',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2026-2027]', 1,
N'(C.CertificationStatus = 6 AND C.Certification = ''Bronze'')',
N'(C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2026-2027]', 2,
N'(C.CertificationStatus = 16 AND C.Certification IN (''Silver'', ''Gold''))',
N'(C.CertificationStatus = 16 AND C.Certification IN (''Bronze'', ''Silver'', ''Gold''))',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 1,
N'WHEN c.Certification = ''Bronze'' AND c.CertificationStatus IN (3, 4, 5, 7) THEN ''Under Evaluation''',
N'WHEN c.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND (c.DaCertificateNo IS NOT NULL OR (c.CertificationStatus = 6 AND c.CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(c.Certification) = 1 AND (c.CertificationStatus < 6 OR c.CertificationStatus IN (7, 99)))) AND c.CertificationStatus IN (3, 4, 5, 7) THEN ''Under Evaluation''',
1, NULL),
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 2,
N'WHEN c.Certification IN (''Silver'', ''Gold'') AND c.CertificationStatus IN (13, 14, 15, 17) THEN ''Under Evaluation''',
N'WHEN c.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND c.CertificationStatus IN (13, 14, 15, 17) THEN ''Under Evaluation''',
1, NULL),
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 3,
N'WHEN c.CertificationStatus = 99 AND c.Certification = ''Bronze'' THEN c.AssessorRemarks',
N'WHEN c.CertificationStatus = 99 AND (c.DaCertificateNo IS NOT NULL OR (c.CertificationStatus = 6 AND c.CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(c.Certification) = 1 AND (c.CertificationStatus < 6 OR c.CertificationStatus IN (7, 99)))) THEN c.AssessorRemarks',
1, NULL),
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 4,
N'WHEN c.CertificationStatus = 99 AND c.Certification != ''Bronze'' THEN c.SaAssessorRemarks',
N'WHEN c.CertificationStatus = 99 AND c.Certification IS NOT NULL THEN c.SaAssessorRemarks',
1, NULL),
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 5,
N'WHEN c.Certification = ''Bronze'' AND c.CertificationStatus = 6 THEN ''Completed''',
N'WHEN c.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL) THEN ''Completed''',
1, NULL),
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 6,
N'WHEN c.Certification IN (''Silver'', ''Gold'') AND c.CertificationStatus = 16 THEN ''Completed''',
N'WHEN c.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND c.CertificationStatus = 16 THEN ''Completed''',
1, NULL),
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 7,
N'WHEN c.Certification = ''Bronze'' AND c.CertificationStatus = 2 AND c.DesktopAccepted = 1',
N'WHEN c.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND (c.DaCertificateNo IS NOT NULL OR (c.CertificationStatus = 6 AND c.CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(c.Certification) = 1 AND (c.CertificationStatus < 6 OR c.CertificationStatus IN (7, 99)))) AND c.CertificationStatus = 2 AND c.DesktopAccepted = 1',
1, NULL),
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 8,
N'WHEN c.Certification IN (''Silver'', ''Gold'') AND c.CertificationStatus IN (8,9) AND c.AssessmentDate IS NOT NULL',
N'WHEN c.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND c.CertificationStatus IN (8,9) AND c.AssessmentDate IS NOT NULL',
1, NULL),
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 9,
N'WHEN c.Certification IN (''Bronze'') AND c.CertificationStatus IN (3,4,5,7) THEN ''Under Evaluation''',
N'WHEN c.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND (c.DaCertificateNo IS NOT NULL OR (c.CertificationStatus = 6 AND c.CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(c.Certification) = 1 AND (c.CertificationStatus < 6 OR c.CertificationStatus IN (7, 99)))) AND c.CertificationStatus IN (3,4,5,7) THEN ''Under Evaluation''',
1, NULL),
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 10,
N'WHEN c.Certification IN (''Silver'', ''Gold'') AND c.CertificationStatus IN (13,14,15,17) THEN ''Under Evaluation''',
N'WHEN c.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND c.CertificationStatus IN (13,14,15,17) THEN ''Under Evaluation''',
1, NULL),
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 11,
N'(C.Certification = ''Bronze'' AND C.CertificationStatus = 6)',
N'(C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', 12,
N'OR (C.Certification IN (''Silver'',''Gold'') AND C.CertificationStatus = 16)',
N'OR (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16)',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZED_BASIC_INFO_2022_2023', 1,
N'OR (P.Certification!=''Bronze'' and CertificationStatus=16)',
N'OR (CertificationStatus=16 and P.Certification IS NOT NULL)',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZED_BASIC_INFO_2024_2025', 1,
N'OR (P.Certification!=''Bronze'' and CertificationStatus=16)',
N'OR (CertificationStatus=16 and P.Certification IS NOT NULL)',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_STATUS', 1,
N'when (certification=''Bronze'' and CertificationStatus=6) then',
N'when (certification=''Bronze'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_STATUS', 2,
N'when (certification in (''Silver'',''Gold'') and CertificationStatus=6) then',
N'when (certification in (''Bronze'',''Silver'',''Gold'') and CertificationStatus = 6 AND DaCertificateNo IS NULL AND CertificationPhase IS NULL) then',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_STATUS', 3,
N'when (certification=''Silver'' and CertificationStatus=16) then',
N'when (certification=''Silver'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_STATUS', 4,
N'when (certification=''Gold'' and CertificationStatus=16) then',
N'when (certification=''Gold'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.DynamicListOfZEDRegisteredMsme', 1,
N'when (certification=''Bronze'' and CertificationStatus=6) then',
N'when (certification=''Bronze'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then',
1, NULL),
(N'dbo.DynamicListOfZEDRegisteredMsme', 2,
N'when (certification in (''Silver'',''Gold'') and CertificationStatus=6) then',
N'when (certification in (''Bronze'',''Silver'',''Gold'') and CertificationStatus = 6 AND DaCertificateNo IS NULL AND CertificationPhase IS NULL) then',
1, NULL),
(N'dbo.DynamicListOfZEDRegisteredMsme', 3,
N'when (certification=''Silver'' and CertificationStatus=16) then',
N'when (certification=''Silver'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then',
1, NULL),
(N'dbo.DynamicListOfZEDRegisteredMsme', 4,
N'when (certification=''Gold'' and CertificationStatus=16) then',
N'when (certification=''Gold'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME', 1,
N'when (certification=''Bronze'' and CertificationStatus=6) then',
N'when (certification=''Bronze'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then',
3, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME', 2,
N'when (certification in (''Silver'',''Gold'') and CertificationStatus=6) then',
N'when (certification in (''Bronze'',''Silver'',''Gold'') and CertificationStatus = 6 AND DaCertificateNo IS NULL AND CertificationPhase IS NULL) then',
3, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME', 3,
N'when (certification=''Silver'' and CertificationStatus=16) then',
N'when (certification=''Silver'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then',
3, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME', 4,
N'when (certification=''Gold'' and CertificationStatus=16) then',
N'when (certification=''Gold'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then',
3, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME', 5,
N'(CertificationStatus = 6 AND Certification = ''Bronze'')',
N'(CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))',
3, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_DATE_MSME_NEW_BRONZE', 1,
N'when (certification=''Bronze'' and CertificationStatus=6) then',
N'when (certification=''Bronze'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then',
3, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_DATE_MSME_NEW_BRONZE', 2,
N'when (certification in (''Silver'',''Gold'') and CertificationStatus=6) then',
N'when (certification in (''Bronze'',''Silver'',''Gold'') and CertificationStatus = 6 AND DaCertificateNo IS NULL AND CertificationPhase IS NULL) then',
3, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_DATE_MSME_NEW_BRONZE', 3,
N'when (certification=''Silver'' and CertificationStatus=16) then',
N'when (certification=''Silver'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then',
3, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_DATE_MSME_NEW_BRONZE', 4,
N'when (certification=''Gold'' and CertificationStatus=16) then',
N'when (certification=''Gold'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then',
3, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_DATE_MSME_NEW_BRONZE', 5,
N'(CertificationStatus = 6 AND Certification = ''Bronze'')',
N'(CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL))',
3, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME_FA', 1,
N'when (p.certification=''Bronze'' and CertificationStatus=6) then',
N'when (p.certification=''Bronze'' and (p.CertificationStatus = 16 OR (p.CertificationStatus = 6 AND (p.DaCertificateNo IS NOT NULL OR p.CertificationPhase IS NOT NULL)))) then',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME_FA', 2,
N'when (p.certification in (''Silver'',''Gold'') and CertificationStatus=6) then',
N'when (p.certification in (''Bronze'',''Silver'',''Gold'') and p.CertificationStatus = 6 AND p.DaCertificateNo IS NULL AND p.CertificationPhase IS NULL) then',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME_FA', 3,
N'when (p.certification=''Silver'' and CertificationStatus=16) then',
N'when (p.certification=''Silver'' and (p.CertificationStatus = 16 OR (p.CertificationStatus = 6 AND (p.DaCertificateNo IS NOT NULL OR p.CertificationPhase IS NOT NULL)))) then',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME_FA', 4,
N'when (p.certification=''Gold'' and CertificationStatus=16) then',
N'when (p.certification=''Gold'' and (p.CertificationStatus = 16 OR (p.CertificationStatus = 6 AND (p.DaCertificateNo IS NOT NULL OR p.CertificationPhase IS NOT NULL)))) then',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2022_23', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2022_23', 2,
N'WHEN (c.Certification = ''Bronze'' AND c.CertificationStatus = 6) THEN ''Certified''',
N'WHEN (c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2022_23', 3,
N'WHEN (c.Certification IN (''Silver'',''Gold'') AND c.CertificationStatus = 6) THEN ''QC Completed''',
N'WHEN (c.Certification IN (''Bronze'',''Silver'',''Gold'') AND c.CertificationStatus = 6 AND c.DaCertificateNo IS NULL AND c.CertificationPhase IS NULL) THEN ''QC Completed''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2022_23', 4,
N'WHEN (c.Certification = ''Silver'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Silver'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2022_23', 5,
N'WHEN (c.Certification = ''Gold'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Gold'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2022_23', 6,
N'CASE WHEN c.Certification = ''Bronze'' AND c.CertificationStatus = 6 THEN DATEDIFF',
N'CASE WHEN c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2023_24', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2023_24', 2,
N'WHEN (c.Certification = ''Bronze'' AND c.CertificationStatus = 6) THEN ''Certified''',
N'WHEN (c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2023_24', 3,
N'WHEN (c.Certification IN (''Silver'',''Gold'') AND c.CertificationStatus = 6) THEN ''QC Completed''',
N'WHEN (c.Certification IN (''Bronze'',''Silver'',''Gold'') AND c.CertificationStatus = 6 AND c.DaCertificateNo IS NULL AND c.CertificationPhase IS NULL) THEN ''QC Completed''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2023_24', 4,
N'WHEN (c.Certification = ''Silver'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Silver'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2023_24', 5,
N'WHEN (c.Certification = ''Gold'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Gold'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2023_24', 6,
N'CASE WHEN c.Certification = ''Bronze'' AND c.CertificationStatus = 6 THEN DATEDIFF',
N'CASE WHEN c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2024_25', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2024_25', 2,
N'WHEN (c.Certification = ''Bronze'' AND c.CertificationStatus = 6) THEN ''Certified''',
N'WHEN (c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2024_25', 3,
N'WHEN (c.Certification IN (''Silver'',''Gold'') AND c.CertificationStatus = 6) THEN ''QC Completed''',
N'WHEN (c.Certification IN (''Bronze'',''Silver'',''Gold'') AND c.CertificationStatus = 6 AND c.DaCertificateNo IS NULL AND c.CertificationPhase IS NULL) THEN ''QC Completed''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2024_25', 4,
N'WHEN (c.Certification = ''Silver'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Silver'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2024_25', 5,
N'WHEN (c.Certification = ''Gold'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Gold'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2024_25', 6,
N'CASE WHEN c.Certification = ''Bronze'' AND c.CertificationStatus = 6 THEN DATEDIFF',
N'CASE WHEN c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2025_26', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2025_26', 2,
N'WHEN (c.Certification = ''Bronze'' AND c.CertificationStatus = 6) THEN ''Certified''',
N'WHEN (c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2025_26', 3,
N'WHEN (c.Certification IN (''Silver'',''Gold'') AND c.CertificationStatus = 6) THEN ''QC Completed''',
N'WHEN (c.Certification IN (''Bronze'',''Silver'',''Gold'') AND c.CertificationStatus = 6 AND c.DaCertificateNo IS NULL AND c.CertificationPhase IS NULL) THEN ''QC Completed''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2025_26', 4,
N'WHEN (c.Certification = ''Silver'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Silver'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2025_26', 5,
N'WHEN (c.Certification = ''Gold'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Gold'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2025_26', 6,
N'CASE WHEN c.Certification = ''Bronze'' AND c.CertificationStatus = 6 THEN DATEDIFF',
N'CASE WHEN c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2026_27', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2026_27', 2,
N'WHEN (c.Certification = ''Bronze'' AND c.CertificationStatus = 6) THEN ''Certified''',
N'WHEN (c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2026_27', 3,
N'WHEN (c.Certification IN (''Silver'',''Gold'') AND c.CertificationStatus = 6) THEN ''QC Completed''',
N'WHEN (c.Certification IN (''Bronze'',''Silver'',''Gold'') AND c.CertificationStatus = 6 AND c.DaCertificateNo IS NULL AND c.CertificationPhase IS NULL) THEN ''QC Completed''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2026_27', 4,
N'WHEN (c.Certification = ''Silver'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Silver'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2026_27', 5,
N'WHEN (c.Certification = ''Gold'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Gold'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2026_27', 6,
N'CASE WHEN c.Certification = ''Bronze'' AND c.CertificationStatus = 6 THEN DATEDIFF',
N'CASE WHEN c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_REJECTED', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_REJECTED', 2,
N'WHEN (c.Certification = ''Bronze'' AND c.CertificationStatus = 6) THEN ''Certified''',
N'WHEN (c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_REJECTED', 3,
N'WHEN (c.Certification IN (''Silver'',''Gold'') AND c.CertificationStatus = 6) THEN ''QC Completed''',
N'WHEN (c.Certification IN (''Bronze'',''Silver'',''Gold'') AND c.CertificationStatus = 6 AND c.DaCertificateNo IS NULL AND c.CertificationPhase IS NULL) THEN ''QC Completed''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_REJECTED', 4,
N'WHEN (c.Certification = ''Silver'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Silver'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_REJECTED', 5,
N'WHEN (c.Certification = ''Gold'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Gold'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_REJECTED', 6,
N'CASE WHEN c.Certification = ''Bronze'' AND c.CertificationStatus = 6 THEN DATEDIFF',
N'CASE WHEN c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2022_2023_2024', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2022_2023_2024', 2,
N'WHEN (c.Certification = ''Bronze'' AND c.CertificationStatus = 6) THEN ''Certified''',
N'WHEN (c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2022_2023_2024', 3,
N'WHEN (c.Certification IN (''Silver'',''Gold'') AND c.CertificationStatus = 6) THEN ''QC Completed''',
N'WHEN (c.Certification IN (''Bronze'',''Silver'',''Gold'') AND c.CertificationStatus = 6 AND c.DaCertificateNo IS NULL AND c.CertificationPhase IS NULL) THEN ''QC Completed''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2022_2023_2024', 4,
N'WHEN (c.Certification = ''Silver'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Silver'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2022_2023_2024', 5,
N'WHEN (c.Certification = ''Gold'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Gold'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2022_2023_2024', 6,
N'CASE WHEN c.Certification = ''Bronze'' AND c.CertificationStatus = 6 THEN DATEDIFF',
N'CASE WHEN c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2022_2023_2024', 7,
N'and c.Certification = ''Bronze'' and CertificationStatus =6',
N'and c.Certification = ''Bronze'' and (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2025', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2025', 2,
N'WHEN (c.Certification = ''Bronze'' AND c.CertificationStatus = 6) THEN ''Certified''',
N'WHEN (c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2025', 3,
N'WHEN (c.Certification IN (''Silver'',''Gold'') AND c.CertificationStatus = 6) THEN ''QC Completed''',
N'WHEN (c.Certification IN (''Bronze'',''Silver'',''Gold'') AND c.CertificationStatus = 6 AND c.DaCertificateNo IS NULL AND c.CertificationPhase IS NULL) THEN ''QC Completed''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2025', 4,
N'WHEN (c.Certification = ''Silver'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Silver'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2025', 5,
N'WHEN (c.Certification = ''Gold'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Gold'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2025', 6,
N'CASE WHEN c.Certification = ''Bronze'' AND c.CertificationStatus = 6 THEN DATEDIFF',
N'CASE WHEN c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2025', 7,
N'and c.Certification = ''Bronze'' and CertificationStatus =6',
N'and c.Certification = ''Bronze'' and (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2026', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2026', 2,
N'WHEN (c.Certification = ''Bronze'' AND c.CertificationStatus = 6) THEN ''Certified''',
N'WHEN (c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2026', 3,
N'WHEN (c.Certification IN (''Silver'',''Gold'') AND c.CertificationStatus = 6) THEN ''QC Completed''',
N'WHEN (c.Certification IN (''Bronze'',''Silver'',''Gold'') AND c.CertificationStatus = 6 AND c.DaCertificateNo IS NULL AND c.CertificationPhase IS NULL) THEN ''QC Completed''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2026', 4,
N'WHEN (c.Certification = ''Silver'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Silver'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2026', 5,
N'WHEN (c.Certification = ''Gold'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Gold'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2026', 6,
N'CASE WHEN c.Certification = ''Bronze'' AND c.CertificationStatus = 6 THEN DATEDIFF',
N'CASE WHEN c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2026', 7,
N'and c.Certification = ''Bronze'' and CertificationStatus =6',
N'and c.Certification = ''Bronze'' and (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_INPROGRESS', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_INPROGRESS', 2,
N'WHEN (c.Certification = ''Bronze'' AND c.CertificationStatus = 6) THEN ''Certified''',
N'WHEN (c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_INPROGRESS', 3,
N'WHEN (c.Certification IN (''Silver'',''Gold'') AND c.CertificationStatus = 6) THEN ''QC Completed''',
N'WHEN (c.Certification IN (''Bronze'',''Silver'',''Gold'') AND c.CertificationStatus = 6 AND c.DaCertificateNo IS NULL AND c.CertificationPhase IS NULL) THEN ''QC Completed''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_INPROGRESS', 4,
N'WHEN (c.Certification = ''Silver'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Silver'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_INPROGRESS', 5,
N'WHEN (c.Certification = ''Gold'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Gold'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_INPROGRESS', 6,
N'CASE WHEN c.Certification = ''Bronze'' AND c.CertificationStatus = 6 THEN DATEDIFF',
N'CASE WHEN c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_INPROGRESS', 7,
N'WHERE c.Certification = ''Bronze'' and CertificationStatus in (2,3,4,5,7)',
N'WHERE c.Certification = ''Bronze'' and (CertificationStatus in (2,3,4,5,7) OR (c.CertificationStatus IN (6, 8, 9, 13, 14, 15, 17) AND NOT (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))))',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_REPORT_ZEDID_ALL_DATES', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_REPORT_ZEDID_ALL_DATES', 2,
N'WHEN (c.Certification = ''Bronze'' AND c.CertificationStatus = 6) THEN ''Certified''',
N'WHEN (c.Certification = ''Bronze'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN ''Certified''',
1, NULL),
(N'dbo.SP_REPORT_ZEDID_ALL_DATES', 3,
N'WHEN (c.Certification IN (''Silver'',''Gold'') AND c.CertificationStatus = 6) THEN ''QC Completed''',
N'WHEN (c.Certification IN (''Bronze'',''Silver'',''Gold'') AND c.CertificationStatus = 6 AND c.DaCertificateNo IS NULL AND c.CertificationPhase IS NULL) THEN ''QC Completed''',
1, NULL),
(N'dbo.SP_REPORT_ZEDID_ALL_DATES', 4,
N'WHEN (c.Certification = ''Silver'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Silver'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_REPORT_ZEDID_ALL_DATES', 5,
N'WHEN (c.Certification = ''Gold'' AND c.CertificationStatus = 16) THEN',
N'WHEN (c.Certification = ''Gold'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL)))) THEN',
1, NULL),
(N'dbo.SP_REPORT_ZEDID_ALL_DATES', 6,
N'CASE WHEN c.CertificationStatus = 6 THEN DATEDIFF(DAY, ''18991230'', c.CertificationStatusDate) ELSE NULL END AS [Certified Date]',
N'CASE WHEN (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF(DAY, ''18991230'', c.CertificationStatusDate) ELSE NULL END AS [Certified Date]',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_SILVER', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_SILVER', 2,
N'WHEN (C.Certification = ''Bronze'' AND C.CertificationStatus = 6)',
N'WHEN (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_SILVER', 3,
N'OR (C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
N'OR (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_SILVER', 4,
N',CASE WHEN c.Certification = ''Silver'' AND c.CertificationStatus = 16 THEN DATEDIFF',
N',CASE WHEN c.Certification = ''Silver'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_GOLD', 1,
N'c.NcFinalClosureDt,',
N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_GOLD', 2,
N'WHEN (C.Certification = ''Bronze'' AND C.CertificationStatus = 6)',
N'WHEN (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_GOLD', 3,
N'OR (C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
N'OR (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_GOLD', 4,
N',CASE WHEN c.Certification = ''Gold'' AND c.CertificationStatus = 16 THEN DATEDIFF',
N',CASE WHEN c.Certification = ''Gold'' AND (c.CertificationStatus = 16 OR (c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL))) THEN DATEDIFF',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2022_23', 1,
N'WHEN (C.Certification = ''Bronze'' AND C.CertificationStatus = 6)',
N'WHEN (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2022_23', 2,
N'OR (C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
N'OR (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2022_23', 3,
N'WHEN C.Certification = ''Bronze'' AND C.CertificationStatus = 6 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2022_23', 4,
N'WHEN C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2023_24', 1,
N'WHEN (C.Certification = ''Bronze'' AND C.CertificationStatus = 6)',
N'WHEN (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2023_24', 2,
N'OR (C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
N'OR (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2023_24', 3,
N'WHEN C.Certification = ''Bronze'' AND C.CertificationStatus = 6 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2023_24', 4,
N'WHEN C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2024_25', 1,
N'WHEN (C.Certification = ''Bronze'' AND C.CertificationStatus = 6)',
N'WHEN (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2024_25', 2,
N'OR (C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
N'OR (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2024_25', 3,
N'WHEN C.Certification = ''Bronze'' AND C.CertificationStatus = 6 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2024_25', 4,
N'WHEN C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2025_26', 1,
N'WHEN (C.Certification = ''Bronze'' AND C.CertificationStatus = 6)',
N'WHEN (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2025_26', 2,
N'OR (C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
N'OR (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2025_26', 3,
N'WHEN C.Certification = ''Bronze'' AND C.CertificationStatus = 6 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2025_26', 4,
N'WHEN C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2026_27', 1,
N'WHEN (C.Certification = ''Bronze'' AND C.CertificationStatus = 6)',
N'WHEN (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2026_27', 2,
N'OR (C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
N'OR (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2026_27', 3,
N'WHEN C.Certification = ''Bronze'' AND C.CertificationStatus = 6 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2026_27', 4,
N'WHEN C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_SILVER', 1,
N'WHEN (C.Certification = ''Bronze'' AND C.CertificationStatus = 6)',
N'WHEN (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_SILVER', 2,
N'OR (C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
N'OR (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_SILVER', 3,
N'WHEN C.Certification = ''Bronze'' AND C.CertificationStatus = 6 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_SILVER', 4,
N'WHEN C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_SILVER', 5,
N'CASE WHEN C.CertificationStatus = 16 THEN 1 ELSE 2 END ASC,',
N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN 1 ELSE 2 END ASC,',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_GOLD', 1,
N'WHEN (C.Certification = ''Bronze'' AND C.CertificationStatus = 6)',
N'WHEN (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_GOLD', 2,
N'OR (C.Certification IN (''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
N'OR (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_GOLD', 3,
N'WHEN C.Certification = ''Bronze'' AND C.CertificationStatus = 6 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_GOLD', 4,
N'WHEN C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16 THEN C.CertificationStatusDate',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_GOLD', 5,
N'CASE WHEN C.CertificationStatus = 16 THEN 1 ELSE 2 END ASC,',
N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN 1 ELSE 2 END ASC,',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_RECERTIFICATION_ONLY_2025_26', 1,
N'WHEN (C.Certification = ''Bronze'' AND C.CertificationStatus = 6) THEN ''Certified''',
N'WHEN (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL)) THEN ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_RECERTIFICATION_ONLY_2025_26', 2,
N'WHEN (C.Certification IN (''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
N'WHEN (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 16) THEN ''Certified''',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_PAID_ZEDIDS_2025_26', 1,
N'WHEN ((C.CertificationStatus=6 and C.certification=''Bronze'') OR (C.CertificationStatus=16 and C.certification!=''Bronze'')) THEN ''Certified''',
N'WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN ''Certified''',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_PAID_ZEDIDS_ALL_TIME', 1,
N'WHEN ((C.CertificationStatus=6 and C.certification=''Bronze'') OR (C.CertificationStatus=16 and C.certification!=''Bronze'')) THEN ''Certified''',
N'WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN ''Certified''',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_APPLIED_FOR_RECERTIFICATION', 1,
N'WHEN ((C.CertificationStatus=6 and C.certification=''Bronze'') OR (C.CertificationStatus=16 and C.certification!=''Bronze'')) THEN ''Certified''',
N'WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN ''Certified''',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES', 1,
N'CASE WHEN C.CertificationStatus=6 THEN C.CertificationStatusDate ELSE NULL END',
N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN C.CertificationStatusDate ELSE NULL END',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES', 2,
N'CASE WHEN C.CertificationStatus=16 THEN C.CertificationStatusDate ELSE NULL END',
N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN C.CertificationStatusDate ELSE NULL END',
4, 2);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES_ASSESSMENT', 1,
N'CASE WHEN C.CertificationStatus=6 THEN C.CertificationStatusDate ELSE NULL END',
N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN C.CertificationStatusDate ELSE NULL END',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES_ASSESSMENT', 2,
N'CASE WHEN C.CertificationStatus=16 THEN C.CertificationStatusDate ELSE NULL END',
N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN C.CertificationStatusDate ELSE NULL END',
4, 2);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.DynamicListOfFinancialSupportZedIdsWithDates', 1,
N'CASE WHEN C.CertificationStatus=6 THEN C.CertificationStatusDate ELSE NULL END',
N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN C.CertificationStatusDate ELSE NULL END',
1, NULL),
(N'dbo.DynamicListOfFinancialSupportZedIdsWithDates', 2,
N'CASE WHEN C.CertificationStatus=16 THEN C.CertificationStatusDate ELSE NULL END',
N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN C.CertificationStatusDate ELSE NULL END',
4, 2);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES_STATECODE_DISTRICTCODE', 1,
N'CASE WHEN C.CertificationStatus=6 THEN C.CertificationStatusDate ELSE NULL END',
N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN C.CertificationStatusDate ELSE NULL END',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES_STATECODE_DISTRICTCODE', 2,
N'CASE WHEN C.CertificationStatus=16 THEN C.CertificationStatusDate ELSE NULL END',
N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN C.CertificationStatusDate ELSE NULL END',
4, 2),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES_STATECODE_DISTRICTCODE', 3,
N'when C.CertificationStatus=6 then ''Certified''',
N'when (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) then ''Certified''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES_STATECODE_DISTRICTCODE', 4,
N'when ((C.CertificationStatus<6) or (C.CertificationStatus=7)) then ''Inprogress''',
N'when ((C.CertificationStatus<16) or (C.CertificationStatus=17)) then ''Inprogress''',
1, NULL),
(N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES_STATECODE_DISTRICTCODE', 5,
N'when C.CertificationStatus=16 then ''Certified''',
N'when (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) then ''Certified''',
2, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DYNAMIC_REPORT_ASSESSOR_COMMENTS', 1,
N'where C.certification!=''Bronze'' and CertificationStatus>13',
N'where NOT (C.DaCertificateNo IS NOT NULL OR (C.CertificationStatus = 6 AND C.CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(C.Certification) = 1 AND (C.CertificationStatus < 6 OR C.CertificationStatus IN (7, 99)))) and CertificationStatus>13',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DASHBOARD_COUNTS_BY_FILTERS', 1,
N'AND C.CertificationStatus=6 and C.Certification=''Bronze'')',
N'AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) and C.Certification=''Bronze'')',
1, NULL),
(N'dbo.SP_DASHBOARD_COUNTS_BY_FILTERS', 2,
N'AND C.CertificationStatus=16 and C.Certification=''Silver'')',
N'AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) and C.Certification=''Silver'')',
1, NULL),
(N'dbo.SP_DASHBOARD_COUNTS_BY_FILTERS', 3,
N'AND C.CertificationStatus=16 and C.Certification=''Gold'')',
N'AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) and C.Certification=''Gold'')',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DAILY_RUN_WEB_SITE_COUNTS', 1,
N'C.Certification = ''Bronze'' AND C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL THEN',
N'C.Certification = ''Bronze'' AND ((C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL) OR (C.CertificationStatus = 16 AND C.SaCertificateNo IS NOT NULL)) THEN',
1, NULL),
(N'dbo.SP_DAILY_RUN_WEB_SITE_COUNTS', 2,
N'C.Certification = ''Silver'' AND C.CertificationStatus = 16 AND C.SaCertificateNo IS NOT NULL THEN',
N'C.Certification = ''Silver'' AND ((C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL) OR (C.CertificationStatus = 16 AND C.SaCertificateNo IS NOT NULL)) THEN',
1, NULL),
(N'dbo.SP_DAILY_RUN_WEB_SITE_COUNTS', 3,
N'C.Certification = ''Gold'' AND C.CertificationStatus = 16 AND C.SaCertificateNo IS NOT NULL THEN',
N'C.Certification = ''Gold'' AND ((C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL) OR (C.CertificationStatus = 16 AND C.SaCertificateNo IS NOT NULL)) THEN',
1, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_DASHBOARD_GET_DETAILS', 1,
N'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;',
N'SET TRANSACTION ISOLATION LEVEL READ UNCOMMITTED; DECLARE @V4DeskLevels TABLE (Lvl varchar(100) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY); INSERT @V4DeskLevels (Lvl) SELECT L.SectionType FROM dbo.SectionTypes L WHERE L.IsCertificationLevel = 1 AND L.SectionType IS NOT NULL AND dbo.FN_V4_LEVEL_DESKTOP(L.SectionType) = 1 UNION SELECT ''Bronze'' WHERE NOT EXISTS (SELECT 1 FROM dbo.SectionTypes L WHERE L.SectionType = ''Bronze'' AND L.IsCertificationLevel = 1);',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 2,
N'MC.CertificationStatus,',
N'MC.CertificationStatus, CAST(CASE WHEN (MC.CertificationStatus = 16 OR (MC.CertificationStatus = 6 AND (MC.DaCertificateNo IS NOT NULL OR MC.CertificationPhase IS NOT NULL))) THEN 1 ELSE 0 END AS bit) AS V4Cert, CAST(CASE WHEN (MC.DaCertificateNo IS NOT NULL OR (MC.CertificationStatus = 6 AND MC.CertificationPhase IS NOT NULL) OR ((MC.CertificationStatus < 6 OR MC.CertificationStatus IN (7, 99)) AND MC.Certification IN (SELECT V.Lvl FROM @V4DeskLevels V))) THEN 1 ELSE 0 END AS bit) AS V4Desk,',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 3,
N'CASE WHEN SaCertificateNo IS NOT NULL THEN 1 ELSE 0 END AS HasSaCert',
N'CASE WHEN SaCertificateNo IS NOT NULL THEN 1 ELSE 0 END AS HasSaCert, CASE WHEN (DaCertificateNo IS NOT NULL OR (CertificationStatus = 6 AND CertificationPhase IS NOT NULL) OR ((CertificationStatus < 6 OR CertificationStatus IN (7, 99)) AND Certification IN (SELECT V.Lvl FROM @V4DeskLevels V))) THEN 1 ELSE 0 END AS V4Desk',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 4,
N'BaseZedId, Certification, CertificationStatus, HasDaCert, HasSaCert,',
N'BaseZedId, Certification, CertificationStatus, HasDaCert, HasSaCert, V4Desk,',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 5,
N'Certification = ''Bronze'' AND HasDaCert = 1 THEN',
N'Certification = ''Bronze'' AND (HasDaCert = 1 OR HasSaCert = 1) THEN',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 6,
N'Certification = ''Bronze'' AND HasDaCert = 0 AND CertificationStatus < 6 AND CertificationStatus > 1 THEN',
N'Certification = ''Bronze'' AND HasDaCert = 0 AND HasSaCert = 0 AND (V4Desk = 0 OR (CertificationStatus < 6 AND CertificationStatus > 1)) THEN',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 7,
N'HasSaCert = 1 AND Certification = ''Silver'' THEN',
N'(HasSaCert = 1 OR HasDaCert = 1) AND Certification = ''Silver'' THEN',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 8,
N'HasSaCert = 0 AND Certification = ''Silver'' THEN',
N'HasSaCert = 0 AND HasDaCert = 0 AND (V4Desk = 0 OR (CertificationStatus < 6 AND CertificationStatus > 1)) AND Certification = ''Silver'' THEN',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 9,
N'HasSaCert = 1 AND Certification = ''Gold'' THEN',
N'(HasSaCert = 1 OR HasDaCert = 1) AND Certification = ''Gold'' THEN',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 10,
N'HasSaCert = 0 AND Certification = ''Gold'' THEN',
N'HasSaCert = 0 AND HasDaCert = 0 AND (V4Desk = 0 OR (CertificationStatus < 6 AND CertificationStatus > 1)) AND Certification = ''Gold'' THEN',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 11,
N'Certification = ''Bronze'' AND CertificationStatus = 6 THEN 1 ELSE 0 END), 0) AS BronzeCompleted',
N'Certification = ''Bronze'' AND V4Cert = 1 THEN 1 ELSE 0 END), 0) AS BronzeCompleted',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 12,
N'Certification = ''Bronze'' AND CertificationStatus IN (2,3) THEN',
N'Certification = ''Bronze'' AND ((V4Desk = 1 AND CertificationStatus IN (2,3)) OR (V4Desk = 0 AND V4Cert = 0 AND CertificationStatus IN (2,3,5,6,8,9,13))) THEN',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 13,
N'Certification = ''Bronze'' AND CertificationStatus IN (4,5,7) THEN',
N'Certification = ''Bronze'' AND ((V4Desk = 1 AND CertificationStatus IN (4,5,7)) OR (V4Desk = 0 AND CertificationStatus IN (14,15,17))) THEN',
2, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 14,
N'Certification = ''Silver'' AND CertificationStatus = 16 THEN',
N'Certification = ''Silver'' AND V4Cert = 1 THEN',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 15,
N'Certification = ''Silver'' AND CertificationStatus IN (2,3,5,6,8,9,13) THEN',
N'Certification = ''Silver'' AND ((V4Desk = 0 AND V4Cert = 0 AND CertificationStatus IN (2,3,5,6,8,9,13)) OR (V4Desk = 1 AND CertificationStatus IN (2,3))) THEN',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 16,
N'Certification = ''Silver'' AND CertificationStatus IN (14,15,17) THEN',
N'Certification = ''Silver'' AND ((V4Desk = 0 AND CertificationStatus IN (14,15,17)) OR (V4Desk = 1 AND CertificationStatus IN (4,5,7))) THEN',
2, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 17,
N'Certification = ''Gold'' AND CertificationStatus = 16 THEN',
N'Certification = ''Gold'' AND V4Cert = 1 THEN',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 18,
N'Certification = ''Gold'' AND CertificationStatus IN (2,3,5,6,8,9,13) THEN',
N'Certification = ''Gold'' AND ((V4Desk = 0 AND V4Cert = 0 AND CertificationStatus IN (2,3,5,6,8,9,13)) OR (V4Desk = 1 AND CertificationStatus IN (2,3))) THEN',
1, NULL),
(N'dbo.SP_DASHBOARD_GET_DETAILS', 19,
N'Certification = ''Gold'' AND CertificationStatus IN (14,15,17) THEN',
N'Certification = ''Gold'' AND ((V4Desk = 0 AND CertificationStatus IN (14,15,17)) OR (V4Desk = 1 AND CertificationStatus IN (4,5,7))) THEN',
2, NULL);
GO
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect, Only) VALUES
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 1,
N'SET NOCOUNT ON;',
N'SET NOCOUNT ON; DECLARE @V4DeskLevels TABLE (Lvl varchar(100) COLLATE DATABASE_DEFAULT NOT NULL PRIMARY KEY); INSERT @V4DeskLevels (Lvl) SELECT L.SectionType FROM dbo.SectionTypes L WHERE L.IsCertificationLevel = 1 AND L.SectionType IS NOT NULL AND dbo.FN_V4_LEVEL_DESKTOP(L.SectionType) = 1 UNION SELECT ''Bronze'' WHERE NOT EXISTS (SELECT 1 FROM dbo.SectionTypes L WHERE L.SectionType = ''Bronze'' AND L.IsCertificationLevel = 1);',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 2,
N'SiteAssessorId varchar(100) NULL',
N'SiteAssessorId varchar(100) NULL, V4Cert bit NOT NULL, V4Desk bit NOT NULL',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 3,
N'X.HasDaCert, X.HasSaCert, X.CertificationBodyUserId, X.DesktopAssessorId, X.SiteAssessorId',
N'X.HasDaCert, X.HasSaCert, X.CertificationBodyUserId, X.DesktopAssessorId, X.SiteAssessorId, X.V4Cert, X.V4Desk',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 4,
N'C.CertificationBodyUserId, C.DesktopAssessorId, C.SiteAssessorId',
N'C.CertificationBodyUserId, C.DesktopAssessorId, C.SiteAssessorId, CAST(CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN 1 ELSE 0 END AS bit) AS V4Cert, CAST(CASE WHEN (C.DaCertificateNo IS NOT NULL OR (C.CertificationStatus = 6 AND C.CertificationPhase IS NOT NULL) OR ((C.CertificationStatus < 6 OR C.CertificationStatus IN (7, 99)) AND C.Certification IN (SELECT V.Lvl FROM @V4DeskLevels V))) THEN 1 ELSE 0 END AS bit) AS V4Desk',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 5,
N'WHERE (A.Certification = ''Bronze'' AND A.CertificationStatus = 6) OR (A.Certification IN (''Silver'', ''Gold'', ''ZEDX'') AND A.CertificationStatus = 16)',
N'WHERE A.Certification IN (''Bronze'', ''Silver'', ''Gold'', ''ZEDX'') AND A.V4Cert = 1',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 6,
N'ORDER BY CASE WHEN A.HasSaCert = 1 THEN 1 WHEN A.HasDaCert = 1 THEN 2 ELSE 3 END, A.Id DESC) AS rn',
N'ORDER BY CASE WHEN A.HasSaCert = 1 THEN 1 WHEN A.HasDaCert = 1 THEN 2 ELSE 3 END, A.Id DESC) AS rn, A.V4Cert, A.V4Desk',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 7,
N'ORDER BY CASE WHEN A.CertificationStatus = 16 THEN 1 WHEN A.CertificationStatus = 6 THEN 2 ELSE 3 END, A.Id DESC) AS rn',
N'ORDER BY CASE WHEN A.CertificationStatus = 16 THEN 1 WHEN A.CertificationStatus = 6 THEN 2 ELSE 3 END, A.Id DESC) AS rn, A.V4Cert, A.V4Desk',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 8,
N'Certification = ''Bronze'' AND HasDaCert = 0 AND CertificationStatus < 6 AND CertificationStatus > 1 THEN',
N'Certification = ''Bronze'' AND HasDaCert = 0 AND HasSaCert = 0 AND (V4Desk = 0 OR (CertificationStatus < 6 AND CertificationStatus > 1)) THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 9,
N'Certification = ''Bronze'' AND HasDaCert = 1 THEN',
N'Certification = ''Bronze'' AND (HasDaCert = 1 OR HasSaCert = 1) THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 10,
N'Certification = ''Silver'' AND HasSaCert = 0 THEN',
N'Certification = ''Silver'' AND HasSaCert = 0 AND HasDaCert = 0 AND (V4Desk = 0 OR (CertificationStatus < 6 AND CertificationStatus > 1)) THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 11,
N'Certification = ''Silver'' AND HasSaCert = 1 THEN',
N'Certification = ''Silver'' AND (HasSaCert = 1 OR HasDaCert = 1) THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 12,
N'Certification = ''Gold'' AND HasSaCert = 0 THEN',
N'Certification = ''Gold'' AND HasSaCert = 0 AND HasDaCert = 0 AND (V4Desk = 0 OR (CertificationStatus < 6 AND CertificationStatus > 1)) THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 13,
N'Certification = ''Gold'' AND HasSaCert = 1 THEN',
N'Certification = ''Gold'' AND (HasSaCert = 1 OR HasDaCert = 1) THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 14,
N'Certification = ''ZEDX'' AND HasSaCert = 0 THEN',
N'Certification = ''ZEDX'' AND HasSaCert = 0 AND HasDaCert = 0 AND (V4Desk = 0 OR (CertificationStatus < 6 AND CertificationStatus > 1)) THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 15,
N'Certification = ''ZEDX'' AND HasSaCert = 1 THEN',
N'Certification = ''ZEDX'' AND (HasSaCert = 1 OR HasDaCert = 1) THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 16,
N'Certification = ''Bronze'' AND CertificationStatus = 6 THEN 1 ELSE 0 END), 0) AS BronzeCompleted',
N'Certification = ''Bronze'' AND V4Cert = 1 THEN 1 ELSE 0 END), 0) AS BronzeCompleted',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 17,
N'Certification = ''Bronze'' AND CertificationStatus IN (2, 3) THEN',
N'Certification = ''Bronze'' AND ((V4Desk = 1 AND CertificationStatus IN (2, 3)) OR (V4Desk = 0 AND V4Cert = 0 AND CertificationStatus IN (2, 3, 5, 6, 8, 9, 13))) THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 18,
N'Certification = ''Bronze'' AND CertificationStatus IN (4, 5, 7) THEN',
N'Certification = ''Bronze'' AND ((V4Desk = 1 AND CertificationStatus IN (4, 5, 7)) OR (V4Desk = 0 AND CertificationStatus IN (14, 15, 17))) THEN',
2, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 19,
N'Certification = ''Silver'' AND CertificationStatus = 16 THEN',
N'Certification = ''Silver'' AND V4Cert = 1 THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 20,
N'Certification = ''Silver'' AND CertificationStatus IN (2, 3, 5, 6, 8, 9, 13) THEN',
N'Certification = ''Silver'' AND ((V4Desk = 0 AND V4Cert = 0 AND CertificationStatus IN (2, 3, 5, 6, 8, 9, 13)) OR (V4Desk = 1 AND CertificationStatus IN (2, 3))) THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 21,
N'Certification = ''Silver'' AND CertificationStatus IN (14, 15, 17) THEN',
N'Certification = ''Silver'' AND ((V4Desk = 0 AND CertificationStatus IN (14, 15, 17)) OR (V4Desk = 1 AND CertificationStatus IN (4, 5, 7))) THEN',
2, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 22,
N'Certification = ''Gold'' AND CertificationStatus = 16 THEN',
N'Certification = ''Gold'' AND V4Cert = 1 THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 23,
N'Certification = ''Gold'' AND CertificationStatus IN (2, 3, 5, 6, 8, 9, 13) THEN',
N'Certification = ''Gold'' AND ((V4Desk = 0 AND V4Cert = 0 AND CertificationStatus IN (2, 3, 5, 6, 8, 9, 13)) OR (V4Desk = 1 AND CertificationStatus IN (2, 3))) THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 24,
N'Certification = ''Gold'' AND CertificationStatus IN (14, 15, 17) THEN',
N'Certification = ''Gold'' AND ((V4Desk = 0 AND CertificationStatus IN (14, 15, 17)) OR (V4Desk = 1 AND CertificationStatus IN (4, 5, 7))) THEN',
2, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 25,
N'Certification = ''ZEDX'' AND CertificationStatus = 16 THEN',
N'Certification = ''ZEDX'' AND V4Cert = 1 THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 26,
N'Certification = ''ZEDX'' AND CertificationStatus IN (2, 3, 5, 6, 8, 9, 13) THEN',
N'Certification = ''ZEDX'' AND ((V4Desk = 0 AND V4Cert = 0 AND CertificationStatus IN (2, 3, 5, 6, 8, 9, 13)) OR (V4Desk = 1 AND CertificationStatus IN (2, 3))) THEN',
1, NULL),
(N'dbo.SP_V4_DASHBOARD_ANALYTICS', 27,
N'Certification = ''ZEDX'' AND CertificationStatus IN (14, 15, 17) THEN',
N'Certification = ''ZEDX'' AND ((V4Desk = 0 AND CertificationStatus IN (14, 15, 17)) OR (V4Desk = 1 AND CertificationStatus IN (4, 5, 7))) THEN',
2, NULL);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
IF DB_NAME() = N'ZEDCS_V2_LIVE'
BEGIN
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_CERTIFIED_MSME', @Marker = N'(CertificationStatus=16 and Certification IN (''Bronze'',''Silver'',''Gold''))';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.DynamicListofZedCertifiedMsme', @Marker = N'(CertificationStatus=16 and Certification IN (''Bronze'',''Silver'',''Gold''))';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_WEB_SITE_LIST_OF_CERTIFIED_MSME', @Marker = N'(Certificationstatus = 16 OR (Certificationstatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_GET_CERTIFED_COUNT_STATE_WISE', @Marker = N'C.Certification = ''Bronze'' AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY', @Marker = N'(C.CertificationStatus = 16 AND C.Certification IN (''Bronze'', ''Silver'', ''Gold''))';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2022-2023]', @Marker = N'(C.CertificationStatus = 16 AND C.Certification IN (''Bronze'', ''Silver'', ''Gold''))';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2023-2024]', @Marker = N'(C.CertificationStatus = 16 AND C.Certification IN (''Bronze'', ''Silver'', ''Gold''))';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2024-2025]', @Marker = N'(C.CertificationStatus = 16 AND C.Certification IN (''Bronze'', ''Silver'', ''Gold''))';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2025-2026]', @Marker = N'(C.CertificationStatus = 16 AND C.Certification IN (''Bronze'', ''Silver'', ''Gold''))';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.[SP_DYNAMIC_REPORT_LIST_OF_UNITS_STATUS_MINISTRY_2026-2027]', @Marker = N'(C.CertificationStatus = 16 AND C.Certification IN (''Bronze'', ''Silver'', ''Gold''))';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_GENERATE_RAMP_REPORT_DATA_FOR_ZED', @Marker = N'WHEN c.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND c.CertificationStatus = 6 AND (c.DaCertificateNo IS NOT NULL OR c.CertificationPhase IS NOT NULL) THEN ''Completed''';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZED_BASIC_INFO_2022_2023', @Marker = N'OR (CertificationStatus=16 and P.Certification IS NOT NULL)';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZED_BASIC_INFO_2024_2025', @Marker = N'OR (CertificationStatus=16 and P.Certification IS NOT NULL)';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_STATUS', @Marker = N'when (certification=''Bronze'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.DynamicListOfZEDRegisteredMsme', @Marker = N'when (certification=''Bronze'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME', @Marker = N'when (certification=''Bronze'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_DATE_MSME_NEW_BRONZE', @Marker = N'when (certification=''Bronze'' and (CertificationStatus = 16 OR (CertificationStatus = 6 AND (DaCertificateNo IS NOT NULL OR CertificationPhase IS NOT NULL)))) then';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_REGISTERED_MSME_FA', @Marker = N'when (p.certification=''Bronze'' and (p.CertificationStatus = 16 OR (p.CertificationStatus = 6 AND (p.DaCertificateNo IS NOT NULL OR p.CertificationPhase IS NOT NULL)))) then';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2022_23', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2023_24', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2024_25', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2025_26', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_2026_27', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_REJECTED', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2022_2023_2024', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2025', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_CERTIFIED_2026', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_BRONZE_INPROGRESS', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_REPORT_ZEDID_ALL_DATES', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_SILVER', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ZEDID_ALL_DATES_GOLD', @Marker = N'c.NcFinalClosureDt, c.DaCertificateNo, c.CertificationPhase,';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2022_23', @Marker = N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2023_24', @Marker = N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2024_25', @Marker = N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2025_26', @Marker = N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_2026_27', @Marker = N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_SILVER', @Marker = N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_CERT_GOLD', @Marker = N'WHEN C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL) THEN C.CertificationStatusDate';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_RECERTIFICATION_ONLY_2025_26', @Marker = N'WHEN (C.Certification IN (''Bronze'', ''Silver'', ''Gold'') AND C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL)) THEN ''Certified''';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_PAID_ZEDIDS_2025_26', @Marker = N'WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN ''Certified''';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_PAID_ZEDIDS_ALL_TIME', @Marker = N'WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN ''Certified''';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_APPLIED_FOR_RECERTIFICATION', @Marker = N'WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN ''Certified''';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES', @Marker = N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN C.CertificationStatusDate ELSE NULL END';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES_ASSESSMENT', @Marker = N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN C.CertificationStatusDate ELSE NULL END';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.DynamicListOfFinancialSupportZedIdsWithDates', @Marker = N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN C.CertificationStatusDate ELSE NULL END';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_LIST_OF_FINANCIAL_SUPPORT_ZEDIDS_WITH_DATES_STATECODE_DISTRICTCODE', @Marker = N'CASE WHEN (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) THEN C.CertificationStatusDate ELSE NULL END';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DYNAMIC_REPORT_ASSESSOR_COMMENTS', @Marker = N'where NOT (C.DaCertificateNo IS NOT NULL OR (C.CertificationStatus = 6 AND C.CertificationPhase IS NOT NULL) OR (dbo.FN_V4_LEVEL_DESKTOP(C.Certification) = 1 AND (C.CertificationStatus < 6 OR C.CertificationStatus IN (7, 99)))) and CertificationStatus>13';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DASHBOARD_COUNTS_BY_FILTERS', @Marker = N'AND (C.CertificationStatus = 16 OR (C.CertificationStatus = 6 AND (C.DaCertificateNo IS NOT NULL OR C.CertificationPhase IS NOT NULL))) and C.Certification=''Bronze'')';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DAILY_RUN_WEB_SITE_COUNTS', @Marker = N'C.Certification = ''Bronze'' AND ((C.CertificationStatus = 6 AND C.DaCertificateNo IS NOT NULL) OR (C.CertificationStatus = 16 AND C.SaCertificateNo IS NOT NULL)) THEN';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_DASHBOARD_GET_DETAILS', @Marker = N'AS V4Cert, CAST(CASE WHEN';
    EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_V4_DASHBOARD_ANALYTICS', @Marker = N'X.SiteAssessorId, X.V4Cert, X.V4Desk';
END
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO
