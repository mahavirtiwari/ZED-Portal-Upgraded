-- Run on ZEDCS_V2_LIVE. Safe to re-run: each procedure is skipped once edited, and the repair changes only rows whose text
-- still differs from the level's questionnaire.
--
-- 2026-11-21 (Assessment Agency UI audit, item 1: a Silver record showed Bronze requirement and checkpoint texts):
-- a unit's copy of the questionnaire (MsmeRequirements / MsmeOptions / MsmeSubOptions) must hold the texts of its own level
-- (SectionType). Two legacy procedures match a unit's rows on codes only, without the level:
--
--   dbo.SP_RECOVER_MISSING_MSME_PARAMETERS_DATA (run by hand to re-create a unit's missing questionnaire rows): its
--     "only if missing" checks look for any row of the unit with the same code, whatever its level (and, for requirements,
--     options and evidences, whatever its parameter). For a Bronze-certified unit recovering its Silver rows, every Silver
--     row whose code the Bronze copy also has was skipped, so the Silver record read Bronze's rows; a NULL QuestionCode
--     never matched, so those rows were inserted again on every run. The checks now match the level, the parameter and the
--     requirement as well, NULL-safe on QuestionCode.
--   dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT (the desktop assessor's final submit raises the next NC round): it copied every
--     non-conforming requirement of the unit with the round's number, of any level, and joined sections, checkpoints and
--     sub-points on codes only, so a unit with two levels got the other level's rows (and texts) in its NC round. It now
--     copies the record's level only, as SP_ASSESSMENT_RA_FINAL_SUBMIT (the site assessment's) already did.
--
-- Repair: the unit copies' requirement, checkpoint and sub-point texts are set from the questionnaire of their own level
-- (same SectionType, parameter code, requirement code, checkpoint / sub-point code; the questionnaire's first row, by Id, when
-- a code has several), every round included. Only the text columns change, only where the text differs and the questionnaire
-- has one; answers, conformance, remarks and scores are not touched. The pages also read the texts from the questionnaire
-- (Zed.Core.Assessment.RequirementTexts), so a later edit of the questionnaire shows at once.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50108, '0108 runs on ZEDCS_V2_LIVE.', 1;
GO
-- ---------------------------------------------------------------------------------------------------------
-- Helper (temporary, dropped at the end; as in 0079 / 0082 / 0102 / 0104).
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
-- 1. SP_RECOVER_MISSING_MSME_PARAMETERS_DATA: "only if missing" within the same level, parameter and requirement.
-- ---------------------------------------------------------------------------------------------------------
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_RECOVER_MISSING_MSME_PARAMETERS_DATA', 1,
 N'WHERE ms.ZedId = @ZedId AND ms.SectionCode = s.SectionCode);',
 N'WHERE ms.ZedId = @ZedId AND ms.SectionCode = s.SectionCode AND ms.SectionType = s.SectionType /*V4_0108*/);', 1),
(N'dbo.SP_RECOVER_MISSING_MSME_PARAMETERS_DATA', 2,
 N'WHERE mr.ZedId = @ZedId AND mr.RequirementCode = r.RequirementCode AND mr.QuestionCode = r.QuestionCode);',
 N'WHERE mr.ZedId = @ZedId AND mr.SectionType = r.SectionType AND mr.SectionCode = r.SectionCode AND mr.RequirementCode = r.RequirementCode AND ISNULL(mr.QuestionCode, '''') = ISNULL(r.QuestionCode, ''''));', 1),
(N'dbo.SP_RECOVER_MISSING_MSME_PARAMETERS_DATA', 3,
 N'WHERE mo.ZedId = @ZedId AND mo.OptionCode = o.OptionCode AND mo.QuestionCode = o.QuestionCode);',
 N'WHERE mo.ZedId = @ZedId AND mo.SectionType = o.SectionType AND mo.SectionCode = o.SectionCode AND ISNULL(mo.RequirementCode, '''') = ISNULL(o.RequirementCode, '''') AND mo.OptionCode = o.OptionCode AND ISNULL(mo.QuestionCode, '''') = ISNULL(o.QuestionCode, ''''));', 1),
(N'dbo.SP_RECOVER_MISSING_MSME_PARAMETERS_DATA', 4,
 N'WHERE mso.ZedId = @ZedId AND mso.SubOptionCode = so.SubOptionCode AND mso.OptionCode = so.OptionCode);',
 N'WHERE mso.ZedId = @ZedId AND mso.SectionType = so.SectionType AND mso.SectionCode = so.SectionCode AND ISNULL(mso.RequirementCode, '''') = ISNULL(so.RequirementCode, '''') AND mso.SubOptionCode = so.SubOptionCode AND mso.OptionCode = so.OptionCode);', 1),
(N'dbo.SP_RECOVER_MISSING_MSME_PARAMETERS_DATA', 5,
 N'WHERE me.ZedId = @ZedId AND me.EvidenceCode = e.EvidenceCode AND me.RequirementCode = e.RequirementCode);',
 N'WHERE me.ZedId = @ZedId AND me.SectionType = e.SectionType AND me.SectionCode = e.SectionCode AND me.EvidenceCode = e.EvidenceCode AND me.RequirementCode = e.RequirementCode);', 1);

-- ---------------------------------------------------------------------------------------------------------
-- 2. SP_ASSESSMENT_DA_FINAL_SUBMIT: the next NC round copies the record's level only (as SP_ASSESSMENT_RA_FINAL_SUBMIT).
-- ---------------------------------------------------------------------------------------------------------
INSERT #V4_EDITS (Obj, Seq, Find, Replacement, Expect) VALUES
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 1,
 N'inner join MsmeSections S on (R.SectionCode=S.SectionCode and R.NcCount=S.NcCount) where R.zedid=@ZedId and S.zedid=@ZedId and Conformance=''No''  and S.NcCount=@NcCount',
 N'inner join MsmeSections S on (R.SectionCode=S.SectionCode and R.NcCount=S.NcCount and S.SectionType=R.SectionType) where R.zedid=@ZedId and S.zedid=@ZedId and Conformance=''No''  and S.NcCount=@NcCount and S.SectionType=@CertificationType /*V4_0108*/', 1),
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 2,
 N',@NcCount+1,AssessorRemarks,UpdatedDate from MsmeRequirements where zedid=@ZedId and Conformance=''No'' and NcCount=@NcCount',
 N',@NcCount+1,AssessorRemarks,UpdatedDate from MsmeRequirements where zedid=@ZedId and Conformance=''No'' and NcCount=@NcCount and SectionType=@CertificationType', 1),
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 3,
 N'inner join MsmeOptions O on (R.SectionCode=O.SectionCode and R.RequirementCode=O.RequirementCode and R.NcCount=O.NcCount) where R.zedid=@ZedId and O.zedid=@ZedId and Conformance=''No'' and O.NcCount=@NcCount',
 N'inner join MsmeOptions O on (R.SectionCode=O.SectionCode and R.RequirementCode=O.RequirementCode and R.NcCount=O.NcCount and R.SectionType=O.SectionType) where R.zedid=@ZedId and O.zedid=@ZedId and Conformance=''No'' and O.NcCount=@NcCount and R.SectionType=@CertificationType', 1),
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 4,
 N'inner join MsmeSubOptions O on (R.SectionCode=O.SectionCode and R.RequirementCode=O.RequirementCode  and R.NcCount=O.NcCount ) where R.zedid=@ZedId and O.zedid=@ZedId and Conformance=''No'' and O.NcCount=@NcCount',
 N'inner join MsmeSubOptions O on (R.SectionCode=O.SectionCode and R.RequirementCode=O.RequirementCode  and R.NcCount=O.NcCount and R.SectionType=O.SectionType) where R.zedid=@ZedId and O.zedid=@ZedId and Conformance=''No'' and O.NcCount=@NcCount and R.SectionType=@CertificationType', 1),
(N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', 5,
 N',@NcCount+1,RequirementId from MsmeRequirements where zedid=@ZedId and Conformance=''No'' and NcCount=@NcCount',
 N',@NcCount+1,RequirementId from MsmeRequirements where zedid=@ZedId and Conformance=''No'' and NcCount=@NcCount and SectionType=@CertificationType', 1);
GO
SET XACT_ABORT ON;
BEGIN TRANSACTION;
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_RECOVER_MISSING_MSME_PARAMETERS_DATA', @Marker = N'/*V4_0108*/';
EXEC #V4_EDIT_PROCEDURE @Object = N'dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT', @Marker = N'/*V4_0108*/';
COMMIT;
GO
DROP PROCEDURE #V4_EDIT_PROCEDURE;
DROP TABLE #V4_EDITS;
GO

-- ---------------------------------------------------------------------------------------------------------
-- 3. Repair: the unit copies' texts from the questionnaire of their own level. Batches of 20,000 rows (a row once set no
--    longer differs, so each loop ends); the text columns only.
-- ---------------------------------------------------------------------------------------------------------
SET XACT_ABORT ON;
DECLARE @n int, @total int;

-- 3a. Requirement texts (MsmeRequirements.RequirementName) from dbo.Requirements.
SELECT @n = 1, @total = 0;
WHILE @n > 0
BEGIN
    UPDATE TOP (20000) r SET r.RequirementName = m.RequirementName
    FROM dbo.MsmeRequirements AS r
    CROSS APPLY (SELECT TOP (1) LTRIM(RTRIM(q.RequirementName)) AS RequirementName
                 FROM dbo.Requirements AS q
                 WHERE q.SectionType = r.SectionType
                   AND LTRIM(RTRIM(q.SectionCode)) = LTRIM(RTRIM(r.SectionCode))
                   AND LTRIM(RTRIM(q.RequirementCode)) = LTRIM(RTRIM(r.RequirementCode))
                   AND NULLIF(LTRIM(RTRIM(q.RequirementName)), '') IS NOT NULL
                 ORDER BY q.Id) AS m
    WHERE ISNULL(LTRIM(RTRIM(r.RequirementName)), '') <> m.RequirementName
      -- 2026-11-21 (review): only a copy from ANOTHER level (its text is another level's text for the same codes); a text
      -- that differs because the Admin edited the questionnaire after the unit applied is history and stays.
      AND EXISTS (SELECT 1 FROM dbo.Requirements AS x
                  WHERE x.SectionType <> r.SectionType AND LTRIM(RTRIM(x.SectionCode)) = LTRIM(RTRIM(r.SectionCode))
                    AND LTRIM(RTRIM(x.RequirementCode)) = LTRIM(RTRIM(r.RequirementCode))
                    AND LTRIM(RTRIM(x.RequirementName)) = LTRIM(RTRIM(r.RequirementName)));
    SET @n = @@ROWCOUNT; SET @total += @n;
END
PRINT CONCAT(DB_NAME(), N': requirement texts repaired: ', @total);

-- 3b. Checkpoint texts (MsmeOptions.OptionName) from dbo.Options.
SELECT @n = 1, @total = 0;
WHILE @n > 0
BEGIN
    UPDATE TOP (20000) o SET o.OptionName = m.OptionName
    FROM dbo.MsmeOptions AS o
    CROSS APPLY (SELECT TOP (1) LTRIM(RTRIM(q.OptionName)) AS OptionName
                 FROM dbo.Options AS q
                 WHERE q.SectionType = o.SectionType
                   AND LTRIM(RTRIM(q.SectionCode)) = LTRIM(RTRIM(o.SectionCode))
                   AND LTRIM(RTRIM(q.RequirementCode)) = LTRIM(RTRIM(o.RequirementCode))
                   AND LTRIM(RTRIM(q.OptionCode)) = LTRIM(RTRIM(o.OptionCode))
                   AND NULLIF(LTRIM(RTRIM(q.OptionName)), '') IS NOT NULL
                 ORDER BY q.Id) AS m
    WHERE ISNULL(LTRIM(RTRIM(o.OptionName)), '') <> m.OptionName
      AND EXISTS (SELECT 1 FROM dbo.Options AS x
                  WHERE x.SectionType <> o.SectionType AND LTRIM(RTRIM(x.SectionCode)) = LTRIM(RTRIM(o.SectionCode))
                    AND LTRIM(RTRIM(x.RequirementCode)) = LTRIM(RTRIM(o.RequirementCode))
                    AND LTRIM(RTRIM(x.OptionCode)) = LTRIM(RTRIM(o.OptionCode))
                    AND LTRIM(RTRIM(x.OptionName)) = LTRIM(RTRIM(o.OptionName)));
    SET @n = @@ROWCOUNT; SET @total += @n;
END
PRINT CONCAT(DB_NAME(), N': checkpoint texts repaired: ', @total);

-- 3c. Sub-point texts (MsmeSubOptions.SubOptionName) from dbo.SubOptions.
SELECT @n = 1, @total = 0;
WHILE @n > 0
BEGIN
    UPDATE TOP (20000) s SET s.SubOptionName = m.SubOptionName
    FROM dbo.MsmeSubOptions AS s
    CROSS APPLY (SELECT TOP (1) LTRIM(RTRIM(q.SubOptionName)) AS SubOptionName
                 FROM dbo.SubOptions AS q
                 WHERE q.SectionType = s.SectionType
                   AND LTRIM(RTRIM(q.SectionCode)) = LTRIM(RTRIM(s.SectionCode))
                   AND LTRIM(RTRIM(q.RequirementCode)) = LTRIM(RTRIM(s.RequirementCode))
                   AND LTRIM(RTRIM(q.OptionCode)) = LTRIM(RTRIM(s.OptionCode))
                   AND LTRIM(RTRIM(q.SubOptionCode)) = LTRIM(RTRIM(s.SubOptionCode))
                   AND NULLIF(LTRIM(RTRIM(q.SubOptionName)), '') IS NOT NULL
                 ORDER BY q.Id) AS m
    WHERE ISNULL(LTRIM(RTRIM(s.SubOptionName)), '') <> m.SubOptionName
      AND EXISTS (SELECT 1 FROM dbo.SubOptions AS x
                  WHERE x.SectionType <> s.SectionType AND LTRIM(RTRIM(x.SectionCode)) = LTRIM(RTRIM(s.SectionCode))
                    AND LTRIM(RTRIM(x.RequirementCode)) = LTRIM(RTRIM(s.RequirementCode))
                    AND LTRIM(RTRIM(x.OptionCode)) = LTRIM(RTRIM(s.OptionCode))
                    AND LTRIM(RTRIM(x.SubOptionCode)) = LTRIM(RTRIM(s.SubOptionCode))
                    AND LTRIM(RTRIM(x.SubOptionName)) = LTRIM(RTRIM(s.SubOptionName)));
    SET @n = @@ROWCOUNT; SET @total += @n;
END
PRINT CONCAT(DB_NAME(), N': sub-point texts repaired: ', @total);
GO
