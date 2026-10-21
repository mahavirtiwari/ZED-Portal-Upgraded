-- New in V4 (not part of the legacy schema). Run on ALL THREE databases (ZEDCS_V2_LIVE, ZED_CONSULTANT,
-- ZED_SURVEILLANCE): each portal resets the staff accounts of its own Users table. Additive and safe to re-run: one new
-- table and four new procedures; no legacy object changes.
-- Self-service and administrator-initiated password reset for staff accounts (every Users row that is not an MSME),
-- used by Zed.Portal.Features.Staff.PasswordReset (docs/PASSWORDS.md, "Staff password reset"). Only the SHA-256 of the
-- reset token is stored; the token itself is only in the e-mail. The MSME reset (Users.PwdCode) is not touched.
-- The V4 database logins need EXECUTE on SP_V4_STAFF_RESET_ACCOUNT, SP_V4_STAFF_RESET_CREATE, SP_V4_STAFF_RESET_FIND
-- and SP_V4_STAFF_RESET_USE.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4PasswordResets', 'U') IS NULL
CREATE TABLE dbo.V4PasswordResets
(
    Id            bigint IDENTITY(1, 1) NOT NULL CONSTRAINT PK_V4PasswordResets PRIMARY KEY,
    UserId        varchar(50)  NOT NULL,   -- Users.UserId
    TokenHash     binary(32)   NOT NULL,   -- SHA-256 of the token in the link
    CreatedAt     datetime2(0) NOT NULL CONSTRAINT DF_V4PasswordResets_CreatedAt DEFAULT SYSUTCDATETIME(),
    ExpiresAt     datetime2(0) NOT NULL,
    UsedAt        datetime2(0) NULL,
    InvalidatedAt datetime2(0) NULL,       -- a newer link was sent, or another link of the account was used
    RequestedBy   varchar(50)  NULL,       -- NULL: the user ("Forgot password?"); else the administrator who sent it
    RequestIp     varchar(45)  NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'UX_V4PasswordResets_TokenHash' AND object_id = OBJECT_ID('dbo.V4PasswordResets'))
    CREATE UNIQUE INDEX UX_V4PasswordResets_TokenHash ON dbo.V4PasswordResets (TokenHash);
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_V4PasswordResets_UserId' AND object_id = OBJECT_ID('dbo.V4PasswordResets'))
    CREATE INDEX IX_V4PasswordResets_UserId ON dbo.V4PasswordResets (UserId, CreatedAt);
GO
-- The staff account behind a typed User ID (never an MSME): one row, an active row first when a UserId appears more
-- than once (as SP_V4_GET_PASSWORD). No password column.
CREATE OR ALTER PROCEDURE dbo.SP_V4_STAFF_RESET_ACCOUNT
    @UserId varchar(50)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) U.UserId, U.UserName, U.RoleId, U.Email, CAST(CASE WHEN U.IsActive = 1 THEN 1 ELSE 0 END AS bit) AS IsActive
    FROM dbo.Users U
    WHERE U.UserId = @UserId AND ISNULL(U.RoleId, 0) <> 5
    ORDER BY CASE WHEN U.IsActive = 1 THEN 0 ELSE 1 END, U.Id DESC;
END
GO
-- Records a new reset link. Every earlier open link of the account stops working. A self-service request
-- (@RequestedBy NULL) is refused (Created = 0, nothing written) when the account already had @MaxPerHour self-service
-- requests in the last hour; links sent by an administrator are not counted.
CREATE OR ALTER PROCEDURE dbo.SP_V4_STAFF_RESET_CREATE
    @UserId       varchar(50),
    @TokenHash    binary(32),
    @ValidMinutes int,
    @MaxPerHour   int,
    @RequestedBy  varchar(50) = NULL,
    @RequestIp    varchar(45) = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @UserId IS NULL OR @TokenHash IS NULL OR @ValidMinutes NOT BETWEEN 1 AND 1440
        THROW 50011, 'SP_V4_STAFF_RESET_CREATE: @UserId, @TokenHash and @ValidMinutes (1-1440) are required.', 1;

    DECLARE @Now datetime2(0) = SYSUTCDATETIME();
    BEGIN TRAN;
    IF @RequestedBy IS NULL AND (
        SELECT COUNT(*) FROM dbo.V4PasswordResets WITH (UPDLOCK, HOLDLOCK)
        WHERE UserId = @UserId AND RequestedBy IS NULL AND CreatedAt > DATEADD(HOUR, -1, @Now)) >= @MaxPerHour
    BEGIN
        COMMIT;
        SELECT CAST(0 AS bit) AS Created;
        RETURN;
    END

    UPDATE dbo.V4PasswordResets SET InvalidatedAt = @Now
    WHERE UserId = @UserId AND UsedAt IS NULL AND InvalidatedAt IS NULL;

    INSERT dbo.V4PasswordResets (UserId, TokenHash, CreatedAt, ExpiresAt, RequestedBy, RequestIp)
    VALUES (@UserId, @TokenHash, @Now, DATEADD(MINUTE, @ValidMinutes, @Now), @RequestedBy, @RequestIp);
    COMMIT;
    SELECT CAST(1 AS bit) AS Created;
END
GO
-- The account of an open link (not used, not replaced, not expired, account still active); no row otherwise.
CREATE OR ALTER PROCEDURE dbo.SP_V4_STAFF_RESET_FIND
    @TokenHash binary(32)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) R.UserId, U.UserName, U.RoleId, U.Email, R.RequestedBy
    FROM dbo.V4PasswordResets R
    JOIN dbo.Users U ON U.UserId = R.UserId AND ISNULL(U.RoleId, 0) <> 5 AND U.IsActive = 1
    WHERE R.TokenHash = @TokenHash AND R.UsedAt IS NULL AND R.InvalidatedAt IS NULL AND R.ExpiresAt > SYSUTCDATETIME()
    ORDER BY U.Id DESC;
END
GO
-- Uses an open link: marks it used (only one caller can), closes the account's other open links and clears its failed
-- logins (the legacy login procedures lock an account after more than 10 failures in 30 minutes). Returns the account,
-- or no row when the link is not open. The caller then sets the password (PasswordStore).
CREATE OR ALTER PROCEDURE dbo.SP_V4_STAFF_RESET_USE
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
      AND EXISTS (SELECT 1 FROM dbo.Users U WHERE U.UserId = R.UserId AND ISNULL(U.RoleId, 0) <> 5 AND U.IsActive = 1);

    DECLARE @UserId varchar(50) = (SELECT TOP (1) UserId FROM @Used);
    IF @UserId IS NOT NULL
    BEGIN
        UPDATE dbo.V4PasswordResets SET InvalidatedAt = @Now
        WHERE UserId = @UserId AND UsedAt IS NULL AND InvalidatedAt IS NULL;
        IF OBJECT_ID('dbo.FailedLogins', 'U') IS NOT NULL
            EXEC sp_executesql N'DELETE FROM dbo.FailedLogins WHERE UserId = @UserId', N'@UserId varchar(50)', @UserId = @UserId;
    END
    COMMIT;

    SELECT TOP (1) U.UserId, U.UserName, U.RoleId, U.Email
    FROM dbo.Users U
    WHERE U.UserId = @UserId AND ISNULL(U.RoleId, 0) <> 5 AND U.IsActive = 1
    ORDER BY U.Id DESC;
END
GO
