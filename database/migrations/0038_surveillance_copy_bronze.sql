-- Run on ZED_SURVEILLANCE only. Safe to re-run. Goes with 0037 on ZEDCS_V2_LIVE (the V4 surveillance schedule for Bronze,
-- Silver and Gold too).
-- dbo.SP_V4_SURVEILLANCE_COPY_UNIT copies a unit here when its surveillance round opens. For Bronze (certified at status 6,
-- desktop) it now copies as the legacy SP_JOB_FOR_INSERT_BRONZE_SURVEILLANCE_DATA does: ZedCertifiedDate is the Bronze
-- certificate's date and Msme.InsertedFor is 'Bronze'. Other levels as in 0033.
-- The three dbo.SectionTypes columns of 0037 too: a level saved on the main portal is saved on this database's copy of the
-- levels as well (as 0036), and that save now writes them.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.SectionTypes', 'U') IS NOT NULL
BEGIN
    IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceAutoApply') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceAutoApply bit NULL;
    IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceSuspendRounds') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceSuspendRounds int NULL;
    IF COL_LENGTH('dbo.SectionTypes', 'SurveillanceScheduleFrom') IS NULL ALTER TABLE dbo.SectionTypes ADD SurveillanceScheduleFrom date NULL;
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
    TechnologyUpgradation, TblMsmeSchemeId, TblMsmeSchemeName, IsSurBronzePaymentDone, IsSurSilverPaymentDone, IsSurGoldPaymentDone,
    InsertedFor
    )
    SELECT
    MsmeId, ZedId, StateId, StateName, DistrictId, DistrictName, OwnerName, EnterpriseName, OrganisationType, OrganisationTypeName,
    EnterpriseType, EnterpriseTypee, MobileNo, EmailId, ApplicationId, UamNumber, PFlat, PBuilding, PRoad, PArea, PCity, PAddress,
    PPin, PStateId, PStateName, PLgDistrictCode, PDistrictName, PPlantDetailId, Activity, TwoDigitActivity, FourDigitActivity,
    FiveDigitActivity, ActivityDetailId, PledgeEmailId, NULL, NULL, NULL, 1,
    PledgeCertificateNo, RegistrationType, IncorporationDate, WhetherProdCommenced, PlantIdNo, PUnitName, PUnitIdNo, CreatedDate,
    RegistrationFrom, FinancialAssistanceStatus, WashWebinarCertificateNo, WashCertificateNo, QrCodeNo, IsCouponExpired,
    TechnologyUpgradation, TblMsmeSchemeId, TblMsmeSchemeName, IsSurBronzePaymentDone, IsSurSilverPaymentDone, IsSurGoldPaymentDone,
    -- As the legacy Bronze job marks its rows (the Silver / Gold job leaves it empty).
    CASE WHEN @Certification = 'Bronze' THEN 'Bronze' END
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
    -- Bronze is certified at status 6 (desktop): its date, as the legacy Bronze job copies it.
    CASE WHEN @Certification = 'Bronze' THEN (
        SELECT MIN(ZB.CertificationStatusDate) FROM ZEDCS_V2_LIVE.DBO.MsmeCertifications ZB
        WHERE ZB.ZedId = SourceMsmeBasic.ZedId AND ZB.Certification = 'Bronze' AND ZB.CertificationStatus = 6)
    ELSE (
    SELECT MIN(ZP.CertificationStatusDate)
    FROM ZEDCS_V2_LIVE.DBO.MsmeCertifications ZP
    WHERE (ZP.ZedId = SourceMsmeBasic.ZedId OR ZP.ZedId LIKE SourceMsmeBasic.ZedId + '_R_%')
    AND ZP.Certification = SourceMsmeBasic.LastestCertification
    AND ZP.CertificationStatus = 16
    ) END AS ZedCertifiedDate
    
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
