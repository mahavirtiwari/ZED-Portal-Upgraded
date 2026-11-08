-- Run on ZEDCS_V2_LIVE (after 0031 and 0060). Safe to re-run (CREATE OR ALTER).
--
-- Agency level allocation (2026-11-08): the automatic allotment of a final submit skips agencies the Master Admin disabled
-- for the level (0060's Users.AllowSilverAssessments / AllowGoldAssessments / AllowZedxAssessments; NULL = allowed). Bronze
-- already did (SP_MSME_AUTO_ALLOT_AGENCY_ROUND_ROBIN, Users.AllowBronzeAssessments).
--   SP_MSME_AUTO_ALLOT_AGENCY_ROUND_ROBIN_SILVER_GOLD (legacy; called by SP_APP_MSME_FINAL_SUBMIT): as before, with the level
--     rule in the facilitator's (Direct) and the round-robin choice; a disabled Direct agency falls back to the round robin,
--     and with no agency at all the unit stays for the Master Admin's Allot page (before, the update wrote NULL and mailed).
--   SP_V4_AUTO_ALLOT_AGENCY (ZED-X, migration 0031): the same level rule.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50063, '0063 runs on ZEDCS_V2_LIVE.', 1;
GO
CREATE OR ALTER PROCEDURE [dbo].[SP_MSME_AUTO_ALLOT_AGENCY_ROUND_ROBIN_SILVER_GOLD]
(
    @ZedId varchar(50) = NULL,
    @CertificationType varchar(50) = NULL
)
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @LastId int = NULL;
    DECLARE @NextUserId varchar(50) = NULL;
    DECLARE @AgencyId varchar(100) = NULL;
    DECLARE @OrgPartnerEmailId varchar(100) = NULL;

    SELECT @OrgPartnerEmailId = OrgPartnerEmailId FROM MsmeFacilitatorEntries
    WHERE LoginVerified = 'Yes' AND ZedId = @ZedId AND Certification = @CertificationType;
    IF @OrgPartnerEmailId = '' SET @OrgPartnerEmailId = NULL;

    IF @OrgPartnerEmailId IS NOT NULL
        SELECT @AgencyId = UserId FROM Users
        WHERE RoleId = 2 AND IsActive = 1 AND LTRIM(RTRIM(OrgPartnerId)) = LTRIM(RTRIM(@OrgPartnerEmailId))
          AND ISNULL(CASE @CertificationType WHEN 'Silver' THEN AllowSilverAssessments WHEN 'Gold' THEN AllowGoldAssessments END, 1) = 1;

    IF @AgencyId IS NOT NULL
    BEGIN
        UPDATE MsmeCertifications SET CertificationBodyUserId = @AgencyId, AllotmentType = 'Direct'
        WHERE ZedId = @ZedId AND Certification = @CertificationType AND CertificationBodyUserId IS NULL AND NcCount = 0;
        INSERT INTO AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType, CreatedDate)
        VALUES (@AgencyId, @ZedId, @CertificationType, 'Direct', GETDATE());
        EXEC [SP_SEND_MAIL_AUTO_ALLOT_AGENCY_ROUND_ROBIN] @ZedId, @AgencyId;
        RETURN;
    END

    SELECT @LastId = U.Id FROM Users U
    WHERE U.UserId = (SELECT TOP 1 AgencyId FROM AgencyAllotmentHistory WHERE AllotType = 'Auto' AND CertificationType = @CertificationType ORDER BY Id DESC);

    SELECT TOP 1 @NextUserId = UserId FROM Users
    WHERE RoleId = 2 AND DesktopVerification = 1 AND IsActive = 1 AND UserId NOT IN ('ZEDAA003', 'ZEDAA0044')
      AND ISNULL(CASE @CertificationType WHEN 'Silver' THEN AllowSilverAssessments WHEN 'Gold' THEN AllowGoldAssessments END, 1) = 1
      AND Id > ISNULL(@LastId, 0)
    ORDER BY Id;
    IF @NextUserId IS NULL
        SELECT TOP 1 @NextUserId = UserId FROM Users
        WHERE RoleId = 2 AND DesktopVerification = 1 AND IsActive = 1 AND UserId NOT IN ('ZEDAA003', 'ZEDAA0044')
          AND ISNULL(CASE @CertificationType WHEN 'Silver' THEN AllowSilverAssessments WHEN 'Gold' THEN AllowGoldAssessments END, 1) = 1
        ORDER BY Id;

    -- No agency allowed for the level: the unit waits on the Master Admin's Allot page.
    IF @NextUserId IS NULL RETURN;

    UPDATE MsmeCertifications SET CertificationBodyUserId = @NextUserId, AllotmentType = 'RoundRobin'
    WHERE ZedId = @ZedId AND Certification = @CertificationType AND CertificationBodyUserId IS NULL AND NcCount = 0;
    INSERT INTO AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType, CreatedDate)
    VALUES (@NextUserId, @ZedId, @CertificationType, 'Auto', GETDATE());
    EXEC [SP_SEND_MAIL_AUTO_ALLOT_AGENCY_ROUND_ROBIN] @ZedId, @NextUserId;
END
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_AUTO_ALLOT_AGENCY
    @ZedId varchar(50),
    @CertificationType varchar(50)
AS
BEGIN
    SET NOCOUNT ON;
    IF NOT EXISTS (SELECT 1 FROM dbo.MsmeCertifications
                   WHERE ZedId = @ZedId AND Certification = @CertificationType AND CertificationBodyUserId IS NULL
                     AND ISNULL(NcCount, 0) = 0 AND CertificationStatus = 2)
        RETURN;

    DECLARE @Category varchar(20) = (
        SELECT TOP 1 COALESCE(
            CASE WHEN s.SectorType IN ('Manufacturing', 'Services') THEN s.SectorType END,
            CASE WHEN NULLIF(LTRIM(m.Activity), '') IS NULL THEN NULL
                 WHEN LTRIM(m.Activity) LIKE 'Manuf%' THEN 'Manufacturing' ELSE 'Services' END)
        FROM dbo.Msme m
        LEFT JOIN dbo.Sectors s ON LTRIM(RTRIM(s.SectorCode)) = LEFT(LTRIM(m.TwoDigitActivity), 2)
        WHERE m.ZedId = @ZedId);

    DECLARE @AgencyId varchar(50) = NULL, @AllotType varchar(20) = NULL;
    DECLARE @OrgPartnerEmailId varchar(100) = (
        SELECT TOP 1 NULLIF(OrgPartnerEmailId, '') FROM dbo.MsmeFacilitatorEntries
        WHERE LoginVerified = 'Yes' AND ZedId = @ZedId AND Certification = @CertificationType);

    -- 2026-11-08 (0063): not an agency the Master Admin disabled for ZED-X.
    IF @OrgPartnerEmailId IS NOT NULL
        SELECT TOP 1 @AgencyId = UserId FROM dbo.Users
        WHERE RoleId = 2 AND IsActive = 1 AND LTRIM(RTRIM(OrgPartnerId)) = LTRIM(RTRIM(@OrgPartnerEmailId))
          AND ISNULL(AllowZedxAssessments, 1) = 1
          AND (@Category IS NULL OR SectorActivity IS NULL OR SectorActivity IN ('Both', @Category));
    IF @AgencyId IS NOT NULL SET @AllotType = 'Direct';

    IF @AgencyId IS NULL
    BEGIN
        DECLARE @LastId int = (
            SELECT TOP 1 u.Id FROM dbo.AgencyAllotmentHistory h JOIN dbo.Users u ON u.UserId = h.AgencyId
            WHERE h.AllotType = 'Auto' AND h.CertificationType = @CertificationType ORDER BY h.Id DESC);
        SELECT TOP 1 @AgencyId = UserId FROM dbo.Users
        WHERE RoleId = 2 AND DesktopVerification = 1 AND IsActive = 1 AND UserId NOT IN ('ZEDAA003', 'ZEDAA0044')
          AND ISNULL(AllowZedxAssessments, 1) = 1
          AND (@Category IS NULL OR SectorActivity IS NULL OR SectorActivity IN ('Both', @Category))
          AND Id > ISNULL(@LastId, 0)
        ORDER BY Id;
        IF @AgencyId IS NULL
            SELECT TOP 1 @AgencyId = UserId FROM dbo.Users
            WHERE RoleId = 2 AND DesktopVerification = 1 AND IsActive = 1 AND UserId NOT IN ('ZEDAA003', 'ZEDAA0044')
              AND ISNULL(AllowZedxAssessments, 1) = 1
              AND (@Category IS NULL OR SectorActivity IS NULL OR SectorActivity IN ('Both', @Category))
            ORDER BY Id;
        IF @AgencyId IS NOT NULL SET @AllotType = 'Auto';
    END

    IF @AgencyId IS NULL RETURN;

    UPDATE dbo.MsmeCertifications SET CertificationBodyUserId = @AgencyId, AllotmentType = CASE WHEN @AllotType = 'Direct' THEN 'Direct' ELSE 'RoundRobin' END
    WHERE ZedId = @ZedId AND Certification = @CertificationType AND CertificationBodyUserId IS NULL AND ISNULL(NcCount, 0) = 0;
    INSERT INTO dbo.AgencyAllotmentHistory (AgencyId, ZedId, CertificationType, AllotType, CreatedDate)
    VALUES (@AgencyId, @ZedId, @CertificationType, @AllotType, GETDATE());
    EXEC dbo.SP_SEND_MAIL_AUTO_ALLOT_AGENCY_ROUND_ROBIN @ZedId, @AgencyId;
END
GO
