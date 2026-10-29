-- Run on ZEDCS_V2_LIVE. Additive and safe to re-run.
-- ZED-X (level code ZEDX, migration 0028): applying and paying, and the NIC sector-wise questionnaire of every level.
--   dbo.Msme.IsZEDXPaymentDone / IsSurZEDXPaymentDone   the level's payment flags, as IsGoldPaymentDone / IsSurGoldPaymentDone
--   dbo.SP_V4_CERTIFICATION_PAID @ZedId, @Certification  (new; V4 runs it after every recorded certification payment:
--       gateway, mobile, zero amount, staff "mark successful"). The legacy payment procedures copy the level's whole
--       questionnaire to the unit (MsmeSections, MsmeRequirements, MsmeOptions, MsmeSubOptions, MsmeEvidences) and set
--       Is{Level}PaymentDone for Bronze, Silver and Gold only. This procedure, without changing them:
--         - sets IsZEDXPaymentDone for a ZED-X payment;
--         - removes from the unit's copy the parameters that do not apply to its NIC sector (Sections.NicSectors,
--           migration 0028; the unit's sector is LEFT(Msme.TwoDigitActivity, 2), as the legacy reports take it),
--           while the unit has not started the level (no MsmeCertifications row yet), so nothing it submitted is touched.
--       It does nothing without a recorded payment of the level (MsmePaymentInfo) and can be run again safely.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Msme', 'IsZEDXPaymentDone') IS NULL ALTER TABLE dbo.Msme ADD IsZEDXPaymentDone bit NULL;
IF COL_LENGTH('dbo.Msme', 'IsSurZEDXPaymentDone') IS NULL ALTER TABLE dbo.Msme ADD IsSurZEDXPaymentDone bit NULL;
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_CERTIFICATION_PAID
    @ZedId varchar(50),
    @Certification varchar(50)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.MsmePaymentInfo WHERE ZedId = @ZedId AND Certification = @Certification) RETURN;

    BEGIN TRANSACTION;
    IF @Certification = 'ZEDX'
        UPDATE dbo.Msme SET IsZEDXPaymentDone = 1 WHERE ZedId = @ZedId AND ISNULL(IsZEDXPaymentDone, 0) = 0;

    DECLARE @Nic varchar(10) = (SELECT TOP 1 LEFT(LTRIM(TwoDigitActivity), 2) FROM dbo.Msme WHERE ZedId = @ZedId);
    IF @Nic IS NOT NULL AND LEN(@Nic) = 2
       AND NOT EXISTS (SELECT 1 FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification)
    BEGIN
        DECLARE @NotApplicable TABLE (SectionCode varchar(50) PRIMARY KEY);
        INSERT INTO @NotApplicable (SectionCode)
        SELECT DISTINCT SectionCode FROM dbo.Sections
        WHERE SectionType = @Certification AND SectionCode IS NOT NULL
          AND NULLIF(LTRIM(RTRIM(NicSectors)), '') IS NOT NULL
          AND CHARINDEX(',' + @Nic + ',', ',' + REPLACE(NicSectors, ' ', '') + ',') = 0;

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
