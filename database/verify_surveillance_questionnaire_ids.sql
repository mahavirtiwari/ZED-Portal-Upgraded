/*
  verify_surveillance_questionnaire_ids.sql  -  read-only data check (2026-11-08), run on ZED_SURVEILLANCE:
    sqlcmd -S "localhost\SQLEXPRESS" -E -C -d ZED_SURVEILLANCE -i verify_surveillance_questionnaire_ids.sql -W -s "|"

  At payment, surveillance copies a unit's checkpoints (MsmeOptions) and evidences (MsmeEvidences) from the main database
  with main's ids (OptionId, EvidenceId; the second surveillance's evidences get id + 100). Surveillance has its own
  questionnaire (dbo.Options, dbo.Evidences) with its own ids. Before 2026-11-08 the checkpoint actions and the evidence's
  checkpoint were looked up by that id alone, so they could come from a row of another requirement. V4 now looks within the
  unit's requirement, by id and text first (CheckpointAnswers.cs, SiteEvidenceChecks.cs). This shows how many rows the old
  lookup got wrong and whether the new one finds a row for each.

  Result set 1: checkpoints by outcome.  Result set 2: evidences by outcome.
  Result set 3: up to 50 checkpoints the old lookup took from another requirement or text (with saved answers first).
  Result set 4: up to 50 evidences the same way.
  Nothing is changed.
*/
SET NOCOUNT ON;

;WITH x AS (
    SELECT mo.Id, mo.ZedId, mo.SectionType, mo.OptionId, mo.OptionCode, mo.OptionName,
           LTRIM(RTRIM(mo.SectionCode)) AS Sc, LTRIM(RTRIM(mo.RequirementCode)) AS Rc,
           old.SectionCode AS OldSc, old.RequirementCode AS OldRc, old.OptionName AS OldName,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.Options o WHERE o.SectionType = mo.SectionType
                                AND LTRIM(RTRIM(o.SectionCode)) = LTRIM(RTRIM(mo.SectionCode))
                                AND LTRIM(RTRIM(o.RequirementCode)) = LTRIM(RTRIM(mo.RequirementCode))
                                AND (o.Id = mo.OptionId OR o.OptionName = mo.OptionName
                                     OR LTRIM(RTRIM(o.OptionCode)) = LTRIM(RTRIM(mo.OptionCode)))) THEN 1 ELSE 0 END AS NewFound
    FROM dbo.MsmeOptions mo
    LEFT JOIN dbo.Options old ON old.Id = mo.OptionId
)
SELECT 'Checkpoints (MsmeOptions)' AS Rows,
       CASE WHEN OldSc IS NULL THEN 'old lookup: no row with that id'
            WHEN SectionType IS NOT NULL AND (LTRIM(RTRIM(OldSc)) <> Sc OR LTRIM(RTRIM(OldRc)) <> Rc) THEN 'old lookup: row of another requirement'
            WHEN OldName <> OptionName THEN 'old lookup: same requirement, other text'
            ELSE 'old lookup: right row' END AS Outcome,
       SUM(CASE WHEN NewFound = 1 THEN 1 ELSE 0 END) AS NewLookupFindsRow,
       SUM(CASE WHEN NewFound = 0 THEN 1 ELSE 0 END) AS NewLookupFindsNone,
       COUNT(DISTINCT ZedId) AS Units, COUNT(*) AS Total
FROM x
GROUP BY CASE WHEN OldSc IS NULL THEN 'old lookup: no row with that id'
            WHEN SectionType IS NOT NULL AND (LTRIM(RTRIM(OldSc)) <> Sc OR LTRIM(RTRIM(OldRc)) <> Rc) THEN 'old lookup: row of another requirement'
            WHEN OldName <> OptionName THEN 'old lookup: same requirement, other text'
            ELSE 'old lookup: right row' END
ORDER BY Outcome;

;WITH x AS (
    SELECT me.Id, me.ZedId, me.SectionType, me.EvidenceId, me.EvidenceCode, me.EvidenceName,
           LTRIM(RTRIM(me.SectionCode)) AS Sc, LTRIM(RTRIM(me.RequirementCode)) AS Rc,
           old.SectionCode AS OldSc, old.RequirementCode AS OldRc, old.EvidenceName AS OldName,
           CASE WHEN EXISTS (SELECT 1 FROM dbo.Evidences e WHERE e.SectionType = me.SectionType
                                AND LTRIM(RTRIM(e.SectionCode)) = LTRIM(RTRIM(me.SectionCode))
                                AND LTRIM(RTRIM(e.RequirementCode)) = LTRIM(RTRIM(me.RequirementCode))
                                AND (e.Id = me.EvidenceId OR e.EvidenceName = me.EvidenceName)) THEN 1 ELSE 0 END AS NewFound
    FROM dbo.MsmeEvidences me
    LEFT JOIN dbo.Evidences old ON old.Id = me.EvidenceId
)
SELECT 'Evidences (MsmeEvidences)' AS Rows,
       CASE WHEN OldSc IS NULL THEN 'old lookup: no row with that id'
            WHEN LTRIM(RTRIM(OldSc)) <> Sc OR LTRIM(RTRIM(OldRc)) <> Rc THEN 'old lookup: row of another requirement'
            WHEN OldName <> EvidenceName THEN 'old lookup: same requirement, other name'
            ELSE 'old lookup: right row' END AS Outcome,
       SUM(CASE WHEN NewFound = 1 THEN 1 ELSE 0 END) AS NewLookupFindsRow,
       SUM(CASE WHEN NewFound = 0 THEN 1 ELSE 0 END) AS NewLookupFindsNone,
       COUNT(DISTINCT ZedId) AS Units, COUNT(*) AS Total
FROM x
GROUP BY CASE WHEN OldSc IS NULL THEN 'old lookup: no row with that id'
            WHEN LTRIM(RTRIM(OldSc)) <> Sc OR LTRIM(RTRIM(OldRc)) <> Rc THEN 'old lookup: row of another requirement'
            WHEN OldName <> EvidenceName THEN 'old lookup: same requirement, other name'
            ELSE 'old lookup: right row' END
ORDER BY Outcome;

SELECT TOP (50) mo.ZedId, mo.SectionType, mo.SectionCode, mo.RequirementCode, mo.OptionCode, mo.OptionId,
       LEFT(mo.OptionName, 80) AS UnitCheckpoint, old.SectionCode AS OldSectionCode, old.RequirementCode AS OldRequirementCode,
       LEFT(old.OptionName, 80) AS OldLookupText
FROM dbo.MsmeOptions mo
JOIN dbo.Options old ON old.Id = mo.OptionId
WHERE LTRIM(RTRIM(old.SectionCode)) <> LTRIM(RTRIM(mo.SectionCode)) OR LTRIM(RTRIM(old.RequirementCode)) <> LTRIM(RTRIM(mo.RequirementCode))
   OR old.OptionName <> mo.OptionName
ORDER BY CASE WHEN COL_LENGTH('dbo.MsmeOptions', 'SaAnswer') IS NOT NULL THEN 0 ELSE 1 END, mo.ZedId, mo.Id;

SELECT TOP (50) me.ZedId, me.SectionType, me.SectionCode, me.RequirementCode, me.EvidenceCode, me.EvidenceId,
       LEFT(me.EvidenceName, 80) AS UnitEvidence, old.SectionCode AS OldSectionCode, old.RequirementCode AS OldRequirementCode,
       LEFT(old.EvidenceName, 80) AS OldLookupName
FROM dbo.MsmeEvidences me
JOIN dbo.Evidences old ON old.Id = me.EvidenceId
WHERE LTRIM(RTRIM(old.SectionCode)) <> LTRIM(RTRIM(me.SectionCode)) OR LTRIM(RTRIM(old.RequirementCode)) <> LTRIM(RTRIM(me.RequirementCode))
   OR old.EvidenceName <> me.EvidenceName
ORDER BY me.ZedId, me.Id;
