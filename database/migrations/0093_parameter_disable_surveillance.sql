-- Run on ZED_SURVEILLANCE (after 0033, which this replaces SP_V4_SURVEILLANCE_PAID of). Additive and safe to re-run.
-- 2026-11-16 (the user): the surveillance portal's Questionnaire → a level's parameters can be disabled (this database's
-- dbo.Sections.IsDisabled: 1 = disabled; NULL or 0 = in use). A disabled parameter is left out of NEW surveillance
-- rounds only: the round's copy of the questionnaire loses it once the round is paid (status 0, 1 or 8, before the
-- surveillance starts), as a parameter of another NIC sector already did for the V4 levels (0033). Rounds already
-- started keep their copy, and rows with a non-conformance are never removed.
-- SP_V4_SURVEILLANCE_PAID runs for Bronze, Silver and Gold too now (the portal calls it after every recorded surveillance
-- payment); for those three it only leaves out the disabled parameters (their payment flags and minimum parameters stay
-- with the legacy procedures, unless a parameter was left out).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Sections', 'IsDisabled') IS NULL
    ALTER TABLE dbo.Sections ADD IsDisabled bit NULL;
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_SURVEILLANCE_PAID
    @ZedId varchar(50),
    @Certification varchar(50)
AS
BEGIN
    -- V4_0093: every level; the disabled parameters (this database's Sections.IsDisabled) left out of a new round.
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @Certification IS NULL OR @Certification LIKE '%[^A-Za-z0-9]%' RETURN;
    DECLARE @Legacy bit = CASE WHEN @Certification IN ('Bronze', 'Silver', 'Gold') THEN 1 ELSE 0 END;
    IF @Legacy = 0 AND NOT EXISTS (SELECT 1 FROM dbo.MsmePaymentInfo WHERE ZedId = @ZedId AND Certification = @Certification) RETURN;

    BEGIN TRANSACTION;
    DECLARE @q nvarchar(max);
    IF @Legacy = 0 AND COL_LENGTH('dbo.Msme', 'Is' + @Certification + 'PaymentDone') IS NOT NULL
    BEGIN
        SET @q = N'UPDATE dbo.Msme SET ' + QUOTENAME('Is' + @Certification + 'PaymentDone') + N' = 1 WHERE ZedId = @z;';
        EXEC sp_executesql @q, N'@z varchar(50)', @z = @ZedId;
    END
    IF @Legacy = 0 AND COL_LENGTH('ZEDCS_V2_LIVE.dbo.Msme', 'IsSur' + @Certification + 'PaymentDone') IS NOT NULL
    BEGIN
        SET @q = N'UPDATE ZEDCS_V2_LIVE.dbo.Msme SET ' + QUOTENAME('IsSur' + @Certification + 'PaymentDone') + N' = 1 WHERE ZedId = @z;';
        EXEC sp_executesql @q, N'@z varchar(50)', @z = @ZedId;
    END

    -- The current round: the newest record of the level, while its surveillance has not started: status 1 (paid with
    -- nothing to pay: the whole questionnaire copied) or 8 (paid through the gateway: the unit's own certification
    -- answers copied, the sections marked for surveillance only, Sections.SurveMandatories).
    DECLARE @CertId int = (SELECT TOP 1 Id FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification ORDER BY Id DESC);
    DECLARE @Nic varchar(10) = (SELECT TOP 1 LEFT(LTRIM(TwoDigitActivity), 2) FROM dbo.Msme WHERE ZedId = @ZedId);
    IF @CertId IS NOT NULL AND (SELECT ISNULL(CertificationStatus, 1) FROM dbo.MsmeCertifications WHERE Id = @CertId) IN (0, 1, 8)
    BEGIN
        DECLARE @NotApplicable TABLE (SectionCode varchar(50) PRIMARY KEY);
        INSERT INTO @NotApplicable (SectionCode)
        SELECT DISTINCT SectionCode FROM dbo.Sections
        WHERE SectionType = @Certification AND SectionCode IS NOT NULL AND ISNULL(IsDisabled, 0) = 1;
        IF @Legacy = 0 AND @Nic IS NOT NULL AND LEN(@Nic) = 2
            INSERT INTO @NotApplicable (SectionCode)
            SELECT DISTINCT s.SectionCode FROM ZEDCS_V2_LIVE.dbo.Sections s
            WHERE s.SectionType = @Certification AND s.SectionCode IS NOT NULL
              AND NULLIF(LTRIM(RTRIM(s.NicSectors)), '') IS NOT NULL
              AND CHARINDEX(',' + @Nic + ',', ',' + REPLACE(s.NicSectors, ' ', '') + ',') = 0
              AND NOT EXISTS (SELECT 1 FROM @NotApplicable n WHERE n.SectionCode = s.SectionCode);

        DECLARE @Removed int = 0;
        IF EXISTS (SELECT 1 FROM @NotApplicable)
        BEGIN
            DELETE e FROM dbo.MsmeEvidences e JOIN @NotApplicable n ON n.SectionCode = e.SectionCode WHERE e.ZedId = @ZedId AND e.SectionType = @Certification AND ISNULL(e.NcCount, 0) = 0;
            DELETE s FROM dbo.MsmeSubOptions s JOIN @NotApplicable n ON n.SectionCode = s.SectionCode WHERE s.ZedId = @ZedId AND s.SectionType = @Certification AND ISNULL(s.NcCount, 0) = 0;
            DELETE o FROM dbo.MsmeOptions o JOIN @NotApplicable n ON n.SectionCode = o.SectionCode WHERE o.ZedId = @ZedId AND o.SectionType = @Certification AND ISNULL(o.NcCount, 0) = 0;
            DELETE r FROM dbo.MsmeRequirements r JOIN @NotApplicable n ON n.SectionCode = r.SectionCode WHERE r.ZedId = @ZedId AND r.SectionType = @Certification AND ISNULL(r.NcCount, 0) = 0;
            DELETE m FROM dbo.MsmeSections m JOIN @NotApplicable n ON n.SectionCode = m.SectionCode WHERE m.ZedId = @ZedId AND m.SectionType = @Certification AND ISNULL(m.NcCount, 0) = 0;
            SET @Removed = @@ROWCOUNT;
        END
        IF @Legacy = 0 OR @Removed > 0
        BEGIN
            DECLARE @Parameters int = (SELECT COUNT(*) FROM dbo.MsmeSections WHERE ZedId = @ZedId AND SectionType = @Certification AND ISNULL(NcCount, 0) = 0);
            UPDATE dbo.MsmeCertifications SET MinimumParameters = CASE WHEN @Parameters BETWEEN 1 AND 12 THEN @Parameters ELSE 13 END WHERE Id = @CertId;
        END
    END
    COMMIT;
END
GO
