-- Run on ZED_SURVEILLANCE. Additive and safe to re-run.
-- Surveillance of ZED-X (and other V4 levels): the surveillance database's side of migration 0032.
--   dbo.Msme.IsZEDXPaymentDone        the level's surveillance payment flag here (as IsGoldPaymentDone)
--   dbo.AssessmentFee                 ZED-X surveillance fee rows: copies of Gold's (Rs. 25,000 with Gold's subsidy rules),
--                                     added once; the Admin changes them like the others
--   dbo.SP_V4_SURVEILLANCE_COPY_UNIT @ZedId, @Certification, @Round
--       run by main's SP_V4_LEVEL_SURVEILLANCE_SCHEDULE when it opens a surveillance round: the unit's Msme and
--       MsmeBasicInformation copied from ZEDCS_V2_LIVE (as SP_JOB_FOR_INSERT_SURVEILLANCE_DATA does for every unit 11 months
--       after certification), so it can pay at once; from round 2 on the legacy second-surveillance flags (payment flag
--       cleared, ReSurveillance = 1), so the payment procedure archives the earlier round (SP_RESET_FOR_SECOND_SURVEILLANCE).
--       The payment procedure does that for round 2 only (main's EnableSurveillance1 = 2); for a third or later round
--       (the Admin allows up to 5) the earlier round is archived here, when the round opens, and ReSurveillance is 2 as
--       after a second-round payment (the procedures read 2 as "a later surveillance").
--   dbo.SP_V4_SURVEILLANCE_PAID @ZedId, @Certification
--       run by the portal after every recorded surveillance payment (SurveillancePaymentCompletion). The legacy payment
--       procedures set the payment flags of Bronze / Silver / Gold only and copy the level's whole questionnaire; for a V4
--       level this sets the flags (here and Msme.IsSur{Level}PaymentDone on main), removes from the unit's copy the
--       parameters that do not apply to its NIC sector (Sections.NicSectors, as SP_V4_CERTIFICATION_PAID on main) while
--       the surveillance has not started, and sets the minimum parameters to assess as for Gold (13, at most the
--       parameters the unit has). Nothing happens without a recorded payment of the level.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.Msme', 'IsZEDXPaymentDone') IS NULL ALTER TABLE dbo.Msme ADD IsZEDXPaymentDone bit NULL;
GO
IF OBJECT_ID('dbo.AssessmentFee', 'U') IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM dbo.AssessmentFee WHERE Certification = 'ZEDX')
   AND EXISTS (SELECT 1 FROM dbo.AssessmentFee WHERE Certification = 'Gold')
BEGIN
    DECLARE @cols nvarchar(max) = STUFF((
        SELECT ', ' + QUOTENAME(c.name) FROM sys.columns c
        WHERE c.object_id = OBJECT_ID('dbo.AssessmentFee') AND c.is_identity = 0 AND c.is_computed = 0 AND c.name <> 'Certification'
        ORDER BY c.column_id FOR XML PATH('')), 1, 2, '');
    DECLARE @q nvarchar(max) = N'INSERT INTO dbo.AssessmentFee (Certification, ' + @cols + N') SELECT ''ZEDX'', ' + @cols +
        N' FROM dbo.AssessmentFee WHERE Certification = ''Gold'';';
    EXEC sp_executesql @q;
END
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_SURVEILLANCE_COPY_UNIT
    @ZedId varchar(50),
    @Certification varchar(50),
    @Round int = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @Certification IS NULL OR @Certification LIKE '%[^A-Za-z0-9]%' RETURN;
    BEGIN TRANSACTION;
    -- The unit's rows, with the columns of SP_JOB_FOR_INSERT_SURVEILLANCE_DATA.
    INSERT INTO Msme (
    MsmeId, ZedId, StateId, StateName, DistrictId, DistrictName, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName,
    EnterpriseType, EnterpriseTypee, MobileNo, EmailId, ApplicationId, UamNumber, PFlat, PBuilding, PRoad, PArea, PCity, PAddress,
    PPin, PStateId, PStateName, PLgDistrictCode, PDistrictName, PPlantDetailId, Activity, TwoDigitActivity, FourDigitActivity,
    FiveDigitActivity, ActivityDetailId, PledgeEmailId, IsBronzePaymentDone, IsSilverPaymentDone, IsGoldPaymentDone, IsCouponUsed,
    PledgeCertificateNo, RegistrationType, IncorporationDate, WhetherProdCommenced, PlantIdNo, PUnitName, PUnitIdNo, CreatedDate,
    RegistrationFrom, FinancialAssistanceStatus, WashWebinarCertificateNo, WashCertificateNo, QrCodeNo, IsCouponExpired,
    TechnologyUpgradation, TblMsmeSchemeId, TblMsmeSchemeName, IsSurBronzePaymentDone, IsSurSilverPaymentDone, IsSurGoldPaymentDone
    )
    SELECT
    MsmeId, ZedId, StateId, StateName, DistrictId, DistrictName, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName,
    EnterpriseType, EnterpriseTypee, MobileNo, EmailId, ApplicationId, UamNumber, PFlat, PBuilding, PRoad, PArea, PCity, PAddress,
    PPin, PStateId, PStateName, PLgDistrictCode, PDistrictName, PPlantDetailId, Activity, TwoDigitActivity, FourDigitActivity,
    FiveDigitActivity, ActivityDetailId, PledgeEmailId, NULL, NULL, NULL, 1,
    PledgeCertificateNo, RegistrationType, IncorporationDate, WhetherProdCommenced, PlantIdNo, PUnitName, PUnitIdNo, CreatedDate,
    RegistrationFrom, FinancialAssistanceStatus, WashWebinarCertificateNo, WashCertificateNo, QrCodeNo, IsCouponExpired,
    TechnologyUpgradation, TblMsmeSchemeId, TblMsmeSchemeName, IsSurBronzePaymentDone, IsSurSilverPaymentDone, IsSurGoldPaymentDone
    FROM ZEDCS_V2_LIVE.DBO.Msme AS SourceMsme
    WHERE SourceMsme.ZedId = @ZedId AND NOT EXISTS (SELECT 1 FROM dbo.Msme T WHERE T.ZedId = @ZedId);

    INSERT INTO MsmeBasicInformation(
    MsmeId, ApplicationId, UdyogAadharNo, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName,
    SocialCategory, SocialCategoryName, Gender, PH, PanNo, Address, StateId, StateName, DistrictId, DistrictName,
    LgDistrictCode, Pincode, MobileNo, EmailId, MajorActivity, MajorActivityName, EnterpriseType, EnterpriseTypee,
    CommmenceDate, PreviousEMType, PreviousEMNumber, TotalEmp, InvestmentCost, DicName, AppliedDate, ZedId,
    LastestCertification, ZedCertifiedDate -- Newly Added Local Column
    )
    SELECT
    SourceMsmeBasic.MsmeId, ApplicationId, UdyogAadharNo, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName,
    SocialCategory, SocialCategoryName, Gender, PH, PanNo, Address, StateId, StateName, DistrictId, DistrictName,
    LgDistrictCode, Pincode, MobileNo, EmailId, MajorActivity, MajorActivityName, EnterpriseType, EnterpriseTypee,
    CommmenceDate, PreviousEMType, PreviousEMNumber, TotalEmp, InvestmentCost, DicName, AppliedDate, ZedId,
    LastestCertification,
    (
    SELECT MIN(ZP.CertificationStatusDate)
    FROM ZEDCS_V2_LIVE.DBO.MsmeCertifications ZP
    WHERE (ZP.ZedId = SourceMsmeBasic.ZedId OR ZP.ZedId LIKE SourceMsmeBasic.ZedId + '_R_%')
    AND ZP.Certification = SourceMsmeBasic.LastestCertification
    AND ZP.CertificationStatus = 16
    ) AS ZedCertifiedDate
    
    FROM ZEDCS_V2_LIVE.DBO.MsmeBasicInformation AS SourceMsmeBasic
    WHERE SourceMsmeBasic.ZedId = @ZedId AND NOT EXISTS (SELECT 1 FROM dbo.MsmeBasicInformation T WHERE T.ZedId = @ZedId);

    IF @Round > 1
    BEGIN
        -- As the legacy second-surveillance job: the payment of the new round is due again.
        IF COL_LENGTH('dbo.Msme', 'Is' + @Certification + 'PaymentDone') IS NOT NULL
        BEGIN
            DECLARE @q nvarchar(max) = N'UPDATE dbo.Msme SET ' + QUOTENAME('Is' + @Certification + 'PaymentDone') + N' = NULL WHERE ZedId = @z;';
            EXEC sp_executesql @q, N'@z varchar(50)', @z = @ZedId;
        END
        UPDATE dbo.MsmeBasicInformation SET ReSurveillance = 1, ReSurveillanceLevel = @Certification WHERE ZedId = @ZedId;
        UPDATE dbo.MsmePaymentInfo SET ReSurveillance = 1 WHERE ZedId = @ZedId AND Certification = @Certification;
        IF COL_LENGTH('dbo.PaymentGatewayTransactions', 'GwReSurveillance') IS NOT NULL
            EXEC sp_executesql N'UPDATE dbo.PaymentGatewayTransactions SET GwReSurveillance = 1 WHERE ZedId = @z AND Certification = @c;',
                N'@z varchar(50), @c varchar(50)', @z = @ZedId, @c = @Certification;
        IF @Round > 2 AND EXISTS (SELECT 1 FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification)
        BEGIN
            -- What the payment procedure does for round 2 (SP_MSME_PAYMENT_GATEWAY_DETAILS): the earlier round's rows are
            -- kept under "{ZedId}_S_{Id}" and the new round starts empty.
            EXEC dbo.SP_ADD_CERTIFICATION_ID @ZedId, @Certification;
            EXEC dbo.SP_RESET_FOR_SECOND_SURVEILLANCE NULL, @ZedId, @Certification, NULL;
            UPDATE dbo.MsmeBasicInformation SET ReSurveillance = 2 WHERE ZedId = @ZedId;
        END
    END
    COMMIT;
END
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_SURVEILLANCE_PAID
    @ZedId varchar(50),
    @Certification varchar(50)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @Certification IS NULL OR @Certification IN ('Bronze', 'Silver', 'Gold') OR @Certification LIKE '%[^A-Za-z0-9]%' RETURN;
    IF NOT EXISTS (SELECT 1 FROM dbo.MsmePaymentInfo WHERE ZedId = @ZedId AND Certification = @Certification) RETURN;

    BEGIN TRANSACTION;
    DECLARE @q nvarchar(max);
    IF COL_LENGTH('dbo.Msme', 'Is' + @Certification + 'PaymentDone') IS NOT NULL
    BEGIN
        SET @q = N'UPDATE dbo.Msme SET ' + QUOTENAME('Is' + @Certification + 'PaymentDone') + N' = 1 WHERE ZedId = @z;';
        EXEC sp_executesql @q, N'@z varchar(50)', @z = @ZedId;
    END
    IF COL_LENGTH('ZEDCS_V2_LIVE.dbo.Msme', 'IsSur' + @Certification + 'PaymentDone') IS NOT NULL
    BEGIN
        SET @q = N'UPDATE ZEDCS_V2_LIVE.dbo.Msme SET ' + QUOTENAME('IsSur' + @Certification + 'PaymentDone') + N' = 1 WHERE ZedId = @z;';
        EXEC sp_executesql @q, N'@z varchar(50)', @z = @ZedId;
    END

    -- The current round: the newest record of the level, while its surveillance has not started.
    DECLARE @CertId int = (SELECT TOP 1 Id FROM dbo.MsmeCertifications WHERE ZedId = @ZedId AND Certification = @Certification ORDER BY Id DESC);
    DECLARE @Nic varchar(10) = (SELECT TOP 1 LEFT(LTRIM(TwoDigitActivity), 2) FROM dbo.Msme WHERE ZedId = @ZedId);
    IF @CertId IS NOT NULL AND (SELECT ISNULL(CertificationStatus, 1) FROM dbo.MsmeCertifications WHERE Id = @CertId) <= 1
    BEGIN
        IF @Nic IS NOT NULL AND LEN(@Nic) = 2
        BEGIN
            DECLARE @NotApplicable TABLE (SectionCode varchar(50) PRIMARY KEY);
            INSERT INTO @NotApplicable (SectionCode)
            SELECT DISTINCT SectionCode FROM ZEDCS_V2_LIVE.dbo.Sections
            WHERE SectionType = @Certification AND SectionCode IS NOT NULL
              AND NULLIF(LTRIM(RTRIM(NicSectors)), '') IS NOT NULL
              AND CHARINDEX(',' + @Nic + ',', ',' + REPLACE(NicSectors, ' ', '') + ',') = 0;

            IF EXISTS (SELECT 1 FROM @NotApplicable)
            BEGIN
                DELETE e FROM dbo.MsmeEvidences e JOIN @NotApplicable n ON n.SectionCode = e.SectionCode WHERE e.ZedId = @ZedId AND e.SectionType = @Certification AND ISNULL(e.NcCount, 0) = 0;
                DELETE s FROM dbo.MsmeSubOptions s JOIN @NotApplicable n ON n.SectionCode = s.SectionCode WHERE s.ZedId = @ZedId AND s.SectionType = @Certification AND ISNULL(s.NcCount, 0) = 0;
                DELETE o FROM dbo.MsmeOptions o JOIN @NotApplicable n ON n.SectionCode = o.SectionCode WHERE o.ZedId = @ZedId AND o.SectionType = @Certification AND ISNULL(o.NcCount, 0) = 0;
                DELETE r FROM dbo.MsmeRequirements r JOIN @NotApplicable n ON n.SectionCode = r.SectionCode WHERE r.ZedId = @ZedId AND r.SectionType = @Certification AND ISNULL(r.NcCount, 0) = 0;
                DELETE m FROM dbo.MsmeSections m JOIN @NotApplicable n ON n.SectionCode = m.SectionCode WHERE m.ZedId = @ZedId AND m.SectionType = @Certification AND ISNULL(m.NcCount, 0) = 0;
            END
        END
        DECLARE @Parameters int = (SELECT COUNT(*) FROM dbo.MsmeSections WHERE ZedId = @ZedId AND SectionType = @Certification AND ISNULL(NcCount, 0) = 0);
        UPDATE dbo.MsmeCertifications SET MinimumParameters = CASE WHEN @Parameters BETWEEN 1 AND 12 THEN @Parameters ELSE 13 END WHERE Id = @CertId;
    END
    COMMIT;
END
GO
