-- Run on ZEDCS_V2_LIVE (after 0065, which this replaces SP_V4_CERTIFICATION_PAID of). Additive and safe to re-run.
-- 2026-11-16 (the user): Questionnaire → a level's parameters can be disabled. A disabled parameter is left out of NEW
-- applications only: the unit's own copy of the questionnaire (MsmeSections / MsmeRequirements / MsmeOptions /
-- MsmeSubOptions / MsmeEvidences, made by the payment procedures) loses it when the level is paid, as a parameter of
-- another NIC sector already did (0065). Applications already paid keep their copy, so their answers, scores and reports
-- stay as they are. A new column of the existing table: dbo.Sections.IsDisabled (1 = disabled; NULL or 0 = in use).
-- The legacy procedures are not changed (SP_MASTER_GET_SECTIONS reads SELECT *, so V4 sees the column).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Sections', 'IsDisabled') IS NULL
    ALTER TABLE dbo.Sections ADD IsDisabled bit NULL;
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_CERTIFICATION_PAID
    @ZedId varchar(50),
    @Certification varchar(50)
AS
BEGIN
    -- V4_0065: the payment flag of every V4 level (was ZED-X only, 0029).
    -- V4_0092: a first payment also leaves out the parameters the Admin disabled (whatever the unit's NIC sector).
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.MsmePaymentInfo WHERE ZedId = @ZedId AND Certification = @Certification) RETURN;

    BEGIN TRANSACTION;
    IF @Certification = 'ZEDX'
        UPDATE dbo.Msme SET IsZEDXPaymentDone = 1 WHERE ZedId = @ZedId AND ISNULL(IsZEDXPaymentDone, 0) = 0;
    ELSE IF dbo.FN_V4_LEVEL_MODE(@Certification) IS NOT NULL AND @Certification NOT LIKE '%[^A-Za-z0-9]%'
        AND COL_LENGTH('dbo.Msme', 'Is' + @Certification + 'PaymentDone') IS NOT NULL
    BEGIN
        DECLARE @Flag sysname = QUOTENAME('Is' + LTRIM(RTRIM(@Certification)) + 'PaymentDone');
        DECLARE @Set nvarchar(max) = N'UPDATE dbo.Msme SET ' + @Flag + N' = 1 WHERE ZedId = @z AND ISNULL(' + @Flag + N', 0) = 0;';
        EXEC sys.sp_executesql @Set, N'@z varchar(50)', @z = @ZedId;
    END

    DECLARE @Nic varchar(10) = (SELECT TOP 1 LEFT(LTRIM(TwoDigitActivity), 2) FROM dbo.Msme WHERE ZedId = @ZedId);
    IF NOT EXISTS (SELECT 1 FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification)
    BEGIN
        DECLARE @NotApplicable TABLE (SectionCode varchar(50) PRIMARY KEY);
        INSERT INTO @NotApplicable (SectionCode)
        SELECT DISTINCT SectionCode FROM dbo.Sections
        WHERE SectionType = @Certification AND SectionCode IS NOT NULL
          AND (ISNULL(IsDisabled, 0) = 1
               OR (@Nic IS NOT NULL AND LEN(@Nic) = 2
                   AND NULLIF(LTRIM(RTRIM(NicSectors)), '') IS NOT NULL
                   AND CHARINDEX(',' + @Nic + ',', ',' + REPLACE(NicSectors, ' ', '') + ',') = 0));

        IF EXISTS (SELECT 1 FROM @NotApplicable)
        BEGIN
            DELETE e FROM dbo.MsmeEvidences e JOIN @NotApplicable n ON n.SectionCode = e.SectionCode WHERE e.ZedId = @ZedId AND e.SectionType = @Certification;
            DELETE s FROM dbo.MsmeSubOptions s JOIN @NotApplicable n ON n.SectionCode = s.SectionCode WHERE s.ZedId = @ZedId AND s.SectionType = @Certification;
            DELETE o FROM dbo.MsmeOptions o JOIN @NotApplicable n ON n.SectionCode = o.SectionCode WHERE o.ZedId = @ZedId AND o.SectionType = @Certification;
            DELETE r FROM dbo.MsmeRequirements r JOIN @NotApplicable n ON n.SectionCode = r.SectionCode WHERE r.ZedId = @ZedId AND r.SectionType = @Certification;
            DELETE m FROM dbo.MsmeSections m JOIN @NotApplicable n ON n.SectionCode = m.SectionCode WHERE m.ZedId = @ZedId AND m.SectionType = @Certification;
        END
    END
    COMMIT;
END
GO
