-- Run on ZEDCS_V2_LIVE (after 0028, which adds dbo.Users.SectorActivity). Safe to re-run (CREATE OR ALTER).
-- ZED-X: the agency of a unit's final submit. SP_APP_MSME_FINAL_SUBMIT runs the round robin for Bronze, Silver and Gold
-- only, so V4 runs this new procedure after it for ZED-X (Zed.Main.MobileApi MsmeController.FinalSubmit). It does what
-- SP_MSME_AUTO_ALLOT_AGENCY_ROUND_ROBIN_SILVER_GOLD does (the facilitator's organising partner directly, else the next
-- agency with desktop verification after the last automatic one of the level, with the same exclusions, the history row
-- and the same mail), with one more rule: the agency must assess the unit's kind (Users.SectorActivity Manufacturing /
-- Services / Both; not set = any). The unit's kind is its NIC sector's type in Masters → Sectors (Sectors.SectorType,
-- migration 0025), else its Udyam activity. Without a matching agency the unit stays for the MasterAdmin's Allot page.
-- It acts only on a unit just submitted (status 2, no agency, no NC), so a second call changes nothing.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
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

    IF @OrgPartnerEmailId IS NOT NULL
        SELECT TOP 1 @AgencyId = UserId FROM dbo.Users
        WHERE RoleId = 2 AND IsActive = 1 AND LTRIM(RTRIM(OrgPartnerId)) = LTRIM(RTRIM(@OrgPartnerEmailId))
          AND (@Category IS NULL OR SectorActivity IS NULL OR SectorActivity IN ('Both', @Category));
    IF @AgencyId IS NOT NULL SET @AllotType = 'Direct';

    IF @AgencyId IS NULL
    BEGIN
        DECLARE @LastId int = (
            SELECT TOP 1 u.Id FROM dbo.AgencyAllotmentHistory h JOIN dbo.Users u ON u.UserId = h.AgencyId
            WHERE h.AllotType = 'Auto' AND h.CertificationType = @CertificationType ORDER BY h.Id DESC);
        SELECT TOP 1 @AgencyId = UserId FROM dbo.Users
        WHERE RoleId = 2 AND DesktopVerification = 1 AND IsActive = 1 AND UserId NOT IN ('ZEDAA003', 'ZEDAA0044')
          AND (@Category IS NULL OR SectorActivity IS NULL OR SectorActivity IN ('Both', @Category))
          AND Id > ISNULL(@LastId, 0)
        ORDER BY Id;
        IF @AgencyId IS NULL
            SELECT TOP 1 @AgencyId = UserId FROM dbo.Users
            WHERE RoleId = 2 AND DesktopVerification = 1 AND IsActive = 1 AND UserId NOT IN ('ZEDAA003', 'ZEDAA0044')
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
