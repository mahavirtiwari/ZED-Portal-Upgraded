-- New in V4 (not part of the legacy schema). Run on ZEDCS_V2_LIVE only (MSME logins live there), after 0008.
-- Additive and safe to re-run: three new procedures on 0008's dbo.V4PasswordResets, and one purge procedure that only
-- counts unless asked. No legacy object changes.
-- MSME password reset for the portal ("Forgot password", staff "Resend Details") and the MSME app (Msme/ResetPassword),
-- replacing SP_MSME_PWD_UPDATE_TOKEN / SP_MSME_PWD_VALIDATE_CODE, which keep the codes in clear in Users.PwdCode and
-- ForgotPwdLinks, never expire them and return Users.* (SECURITY-FINDINGS #128). Links are created with
-- SP_V4_STAFF_RESET_CREATE (0008; it only knows UserIds). An MSME link cannot be used on the staff reset and the reverse.
-- The V4 database logins (portal and MSME app) need EXECUTE on SP_V4_STAFF_RESET_CREATE, SP_V4_MSME_RESET_ACCOUNT,
-- SP_V4_MSME_RESET_FIND and SP_V4_MSME_RESET_USE. SP_V4_PURGE_LEGACY_RESET_CODES is for the DBA, after decommission.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4PasswordResets', 'U') IS NULL
    THROW 50020, '0009_msme_password_reset: run 0008_staff_password_reset.sql first.', 1;
GO
-- The MSME login behind a typed ZED ID (Users.RoleId 5) with the unit's name and e-mail (the pledge e-mail, as the old
-- "Forgot password"; Users.Email when there is none); an active row first.
-- No password column.
CREATE OR ALTER PROCEDURE dbo.SP_V4_MSME_RESET_ACCOUNT
    @ZedId varchar(50)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) U.UserId AS ZedId, ISNULL(M.EnterpriseName, U.UserName) AS EnterpriseName, COALESCE(NULLIF(LTRIM(RTRIM(M.PledgeEmailId)), ''), U.Email) AS Email,
           CAST(CASE WHEN U.IsActive = 1 THEN 1 ELSE 0 END AS bit) AS IsActive
    FROM dbo.Users U
    LEFT JOIN dbo.Msme M ON M.ZedId = U.UserId
    WHERE U.UserId = @ZedId AND U.RoleId = 5
    ORDER BY CASE WHEN U.IsActive = 1 THEN 0 ELSE 1 END, U.Id DESC;
END
GO
-- The MSME of an open link (not used, not replaced, not expired, login still active); no row otherwise.
CREATE OR ALTER PROCEDURE dbo.SP_V4_MSME_RESET_FIND
    @TokenHash binary(32)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) R.UserId AS ZedId, ISNULL(M.EnterpriseName, U.UserName) AS EnterpriseName, COALESCE(NULLIF(LTRIM(RTRIM(M.PledgeEmailId)), ''), U.Email) AS Email
    FROM dbo.V4PasswordResets R
    JOIN dbo.Users U ON U.UserId = R.UserId AND U.RoleId = 5 AND U.IsActive = 1
    LEFT JOIN dbo.Msme M ON M.ZedId = U.UserId
    WHERE R.TokenHash = @TokenHash AND R.UsedAt IS NULL AND R.InvalidatedAt IS NULL AND R.ExpiresAt > SYSUTCDATETIME()
    ORDER BY U.Id DESC;
END
GO
-- Uses an open MSME link: marks it used (only one caller can), closes the account's other open links, clears its failed
-- logins and its legacy reset code (Users.PwdCode), so an older link of the old site stops working too. Returns the
-- account, or no row when the link is not open. The caller then sets the password (PasswordStore).
CREATE OR ALTER PROCEDURE dbo.SP_V4_MSME_RESET_USE
    @TokenHash binary(32)
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    DECLARE @Now datetime2(0) = SYSUTCDATETIME();
    DECLARE @Used TABLE (UserId varchar(50));

    BEGIN TRAN;
    UPDATE R SET UsedAt = @Now
    OUTPUT inserted.UserId INTO @Used
    FROM dbo.V4PasswordResets R WITH (UPDLOCK, HOLDLOCK)
    WHERE R.TokenHash = @TokenHash AND R.UsedAt IS NULL AND R.InvalidatedAt IS NULL AND R.ExpiresAt > @Now
      AND EXISTS (SELECT 1 FROM dbo.Users U WHERE U.UserId = R.UserId AND U.RoleId = 5 AND U.IsActive = 1);

    DECLARE @UserId varchar(50) = (SELECT TOP (1) UserId FROM @Used);
    IF @UserId IS NOT NULL
    BEGIN
        UPDATE dbo.V4PasswordResets SET InvalidatedAt = @Now
        WHERE UserId = @UserId AND UsedAt IS NULL AND InvalidatedAt IS NULL;
        UPDATE dbo.Users SET PwdCode = NULL WHERE UserId = @UserId AND RoleId = 5;
        IF OBJECT_ID('dbo.FailedLogins', 'U') IS NOT NULL
            EXEC sp_executesql N'DELETE FROM dbo.FailedLogins WHERE UserId = @UserId', N'@UserId varchar(50)', @UserId = @UserId;
    END
    COMMIT;

    SELECT TOP (1) U.UserId AS ZedId, ISNULL(M.EnterpriseName, U.UserName) AS EnterpriseName, COALESCE(NULLIF(LTRIM(RTRIM(M.PledgeEmailId)), ''), U.Email) AS Email
    FROM dbo.Users U
    LEFT JOIN dbo.Msme M ON M.ZedId = U.UserId
    WHERE U.UserId = @UserId AND U.RoleId = 5 AND U.IsActive = 1
    ORDER BY U.Id DESC;
END
GO
-- After the old sites are decommissioned (they need Users.PwdCode while live): removes the legacy reset codes kept in
-- clear. @Mode 'PREVIEW' (default) only counts; 'APPLY' clears Users.PwdCode and empties ForgotPwdLinks.
CREATE OR ALTER PROCEDURE dbo.SP_V4_PURGE_LEGACY_RESET_CODES
    @Mode varchar(10) = 'PREVIEW'
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @Mode NOT IN ('PREVIEW', 'APPLY') THROW 50021, 'SP_V4_PURGE_LEGACY_RESET_CODES: @Mode must be PREVIEW or APPLY.', 1;

    DECLARE @Codes int = (SELECT COUNT(*) FROM dbo.Users WHERE PwdCode IS NOT NULL);
    DECLARE @Links int = CASE WHEN OBJECT_ID('dbo.ForgotPwdLinks', 'U') IS NULL THEN 0 ELSE (SELECT COUNT(*) FROM dbo.ForgotPwdLinks) END;
    IF @Mode = 'APPLY'
    BEGIN
        BEGIN TRAN;
        UPDATE dbo.Users SET PwdCode = NULL WHERE PwdCode IS NOT NULL;
        IF OBJECT_ID('dbo.ForgotPwdLinks', 'U') IS NOT NULL DELETE FROM dbo.ForgotPwdLinks;
        COMMIT;
    END
    SELECT @Mode AS Mode, @Codes AS UsersWithResetCode, @Links AS ForgotPwdLinksRows;
END
GO
