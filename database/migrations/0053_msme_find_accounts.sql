-- Run on ZEDCS_V2_LIVE. Safe to re-run.
--
-- "Forgot password" by ZED ID, PAN or e-mail (MSME login, web and the ZED MSME app, 2026-11-07). The applicant who no
-- longer knows the ZED ID enters the enterprise's PAN or an e-mail address; the units found are listed (unit name,
-- district, state and a partly hidden ZED ID, never the e-mail or the full ZED ID), the applicant picks one and the reset
-- link goes to that unit's registered e-mail (SP_V4_MSME_RESET_ACCOUNT, migration 0009), which shows the full ZED ID.
--
-- dbo.SP_V4_MSME_FIND_ACCOUNTS: the MSME logins (Users.RoleId 5) of one ZED ID, of a PAN (MsmeBasicInformation.PanNo)
-- or of an e-mail address (the pledge e-mail, the login's e-mail or the Udyam e-mail), at most 20, with the plant's
-- unit name, district and state. No password or e-mail column. Exactly one of the three parameters is given.
-- The V4 database login of the main portal needs EXECUTE on it.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZEDCS_V2_LIVE'
    THROW 50053, '0053 runs on ZEDCS_V2_LIVE only.', 1;
GO
CREATE OR ALTER PROCEDURE dbo.SP_V4_MSME_FIND_ACCOUNTS
    @ZedId varchar(50) = NULL,
    @PanNo varchar(20) = NULL,
    @Email varchar(100) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET @ZedId = NULLIF(LTRIM(RTRIM(@ZedId)), '');
    SET @PanNo = NULLIF(UPPER(LTRIM(RTRIM(@PanNo))), '');
    SET @Email = NULLIF(LTRIM(RTRIM(@Email)), '');
    IF (CASE WHEN @ZedId IS NULL THEN 0 ELSE 1 END + CASE WHEN @PanNo IS NULL THEN 0 ELSE 1 END
        + CASE WHEN @Email IS NULL THEN 0 ELSE 1 END) <> 1
        THROW 50053, 'Give exactly one of @ZedId, @PanNo and @Email.', 1;

    DECLARE @Found TABLE (ZedId varchar(50) COLLATE DATABASE_DEFAULT PRIMARY KEY);
    IF @ZedId IS NOT NULL
        INSERT @Found SELECT @ZedId;
    ELSE IF @PanNo IS NOT NULL
        INSERT @Found SELECT DISTINCT B.ZedId FROM dbo.MsmeBasicInformation B
        WHERE B.ZedId IS NOT NULL AND UPPER(LTRIM(RTRIM(B.PanNo))) = @PanNo;
    ELSE
        INSERT @Found
        SELECT ZedId FROM dbo.Msme WHERE ZedId IS NOT NULL AND (LTRIM(RTRIM(PledgeEmailId)) = @Email OR LTRIM(RTRIM(EmailId)) = @Email)
        UNION
        SELECT UserId FROM dbo.Users WHERE RoleId = 5 AND UserId IS NOT NULL AND LTRIM(RTRIM(Email)) = @Email
        UNION
        SELECT ZedId FROM dbo.MsmeBasicInformation WHERE ZedId IS NOT NULL AND LTRIM(RTRIM(EmailId)) = @Email;

    SELECT TOP (20)
        U.UserId AS ZedId,
        COALESCE(NULLIF(LTRIM(RTRIM(M.PUnitName)), ''), NULLIF(LTRIM(RTRIM(M.EnterpriseName)), ''), U.UserName) AS UnitName,
        LTRIM(RTRIM(ISNULL(M.PDistrictName, ''))) AS DistrictName,
        LTRIM(RTRIM(ISNULL(M.PStateName, ''))) AS StateName,
        CAST(CASE WHEN U.IsActive = 1 THEN 1 ELSE 0 END AS bit) AS IsActive
    FROM @Found F
    CROSS APPLY (SELECT TOP (1) * FROM dbo.Users X WHERE X.UserId = F.ZedId AND X.RoleId = 5
                 ORDER BY CASE WHEN X.IsActive = 1 THEN 0 ELSE 1 END, X.Id DESC) U
    OUTER APPLY (SELECT TOP (1) * FROM dbo.Msme Y WHERE Y.ZedId = F.ZedId) M
    ORDER BY U.UserId;
END
GO
