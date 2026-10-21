-- New in V4 (not part of the legacy schema). Run on ALL THREE databases (ZEDCS_V2_LIVE, ZED_CONSULTANT,
-- ZED_SURVEILLANCE). Additive and safe to re-run: one new table and three new procedures; no legacy object changes.
-- Salted password hashes next to the plain Users.Password column (SECURITY-FINDINGS #2). Used by
-- Zed.Core.Security.PasswordStore; see docs/PASSWORDS.md for the modes (Security:Passwords) and the cut-over steps.
-- The V4 database logins need EXECUTE on SP_V4_GET_PASSWORD and SP_V4_SET_PASSWORD_HASH. The Surveillance hosts also
-- call SP_V4_GET_PASSWORD on ZEDCS_V2_LIVE (read-only connection ConnectionStrings:Main) for accounts copied from main.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4UserPasswords', 'U') IS NULL
CREATE TABLE dbo.V4UserPasswords
(
    UserId        varchar(50)  NOT NULL CONSTRAINT PK_V4UserPasswords PRIMARY KEY,  -- Users.UserId (same collation)
    PasswordHash  varchar(256) NOT NULL,   -- "u1$" + ASP.NET Core PasswordHasher v3 (PBKDF2-HMAC-SHA512, salted)
    HashedAt      datetime2(0) NOT NULL CONSTRAINT DF_V4UserPasswords_HashedAt DEFAULT SYSUTCDATETIME()
);
GO
-- The account V4 is about to sign in: its role, the stored Users.Password (passed back to the legacy login procedure
-- once the hash has matched) and its hash. One row; an active row first when a UserId appears more than once.
CREATE OR ALTER PROCEDURE dbo.SP_V4_GET_PASSWORD
    @UserId varchar(50)
AS
BEGIN
    SET NOCOUNT ON;
    SELECT TOP (1) U.UserId, U.RoleId, U.Password AS StoredPassword, P.PasswordHash
    FROM dbo.Users U
    LEFT JOIN dbo.V4UserPasswords P ON P.UserId = U.UserId
    WHERE U.UserId = @UserId
    ORDER BY CASE WHEN U.IsActive = 1 THEN 0 ELSE 1 END, U.Id DESC;
END
GO
-- Records a hash (when @PasswordHash is given) and/or replaces Users.Password (when @ReplacePassword is given, a random
-- "V4!..." value). Both in one transaction.
CREATE OR ALTER PROCEDURE dbo.SP_V4_SET_PASSWORD_HASH
    @UserId          varchar(50),
    @PasswordHash    varchar(256) = NULL,
    @ReplacePassword varchar(50)  = NULL
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @UserId IS NULL OR (@PasswordHash IS NULL AND @ReplacePassword IS NULL) RETURN;
    IF @ReplacePassword IS NOT NULL AND (LEN(@ReplacePassword) <> 49 OR LEFT(@ReplacePassword, 3) <> 'V4!')
        THROW 50001, 'SP_V4_SET_PASSWORD_HASH: @ReplacePassword must be a V4 replacement value.', 1;

    BEGIN TRAN;
    IF @PasswordHash IS NOT NULL
    BEGIN
        UPDATE dbo.V4UserPasswords WITH (UPDLOCK, HOLDLOCK)
            SET PasswordHash = @PasswordHash, HashedAt = SYSUTCDATETIME()
            WHERE UserId = @UserId;
        IF @@ROWCOUNT = 0
            INSERT dbo.V4UserPasswords (UserId, PasswordHash) VALUES (@UserId, @PasswordHash);
    END
    IF @ReplacePassword IS NOT NULL
        UPDATE dbo.Users SET Password = @ReplacePassword WHERE UserId = @UserId;
    COMMIT;
END
GO
-- Run by hand after the switch to Migrate / HashOnly (docs/PASSWORDS.md). PREVIEW (default) only counts.
--   @Scope 'HASHED': replace the plain value of every account that has a hash (it is no longer used).
--   @Scope 'ALL':    every account; those without a hash must then reset their password (MSME: Forgot password).
--   @ClearFailedLogins 1: also blank the typed passwords the legacy login procedures wrote into FailedLogins.
-- Never run while an old site is still live: the old sites log in against the plain value.
CREATE OR ALTER PROCEDURE dbo.SP_V4_PURGE_PLAIN_PASSWORDS
    @Mode              varchar(10) = 'PREVIEW',
    @Scope             varchar(10) = 'HASHED',
    @ClearFailedLogins bit = 1
AS
BEGIN
    SET NOCOUNT ON;
    SET XACT_ABORT ON;
    IF @Mode NOT IN ('PREVIEW', 'APPLY') OR @Scope NOT IN ('HASHED', 'ALL')
        THROW 50002, 'SP_V4_PURGE_PLAIN_PASSWORDS: @Mode is PREVIEW or APPLY, @Scope is HASHED or ALL.', 1;

    DECLARE @HasFailedLogins bit = CASE WHEN COL_LENGTH('dbo.FailedLogins', 'Password') IS NULL THEN 0 ELSE 1 END;
    DECLARE @FailedWithPassword int = 0;
    IF @HasFailedLogins = 1
        EXEC sp_executesql N'SELECT @n = COUNT(*) FROM dbo.FailedLogins WHERE Password IS NOT NULL', N'@n int OUTPUT', @n = @FailedWithPassword OUTPUT;

    SELECT
        SUM(CASE WHEN P.UserId IS NOT NULL THEN 1 ELSE 0 END) AS AccountsWithHash,
        SUM(CASE WHEN P.UserId IS NULL THEN 1 ELSE 0 END) AS AccountsWithoutHash,
        SUM(CASE WHEN U.Password IS NOT NULL AND NOT (LEN(U.Password) = 49 AND LEFT(U.Password, 3) = 'V4!')
                  AND (@Scope = 'ALL' OR P.UserId IS NOT NULL) THEN 1 ELSE 0 END) AS PlainValuesToReplace,
        @FailedWithPassword AS FailedLoginsWithPassword
    FROM dbo.Users U
    LEFT JOIN dbo.V4UserPasswords P ON P.UserId = U.UserId;

    IF @Mode <> 'APPLY' RETURN;

    BEGIN TRAN;
    -- CRYPT_GEN_RANDOM is evaluated per row: every account gets its own value.
    UPDATE U SET Password = 'V4!' + CONVERT(varchar(46), CRYPT_GEN_RANDOM(23), 2)
    FROM dbo.Users U
    LEFT JOIN dbo.V4UserPasswords P ON P.UserId = U.UserId
    WHERE U.Password IS NOT NULL AND NOT (LEN(U.Password) = 49 AND LEFT(U.Password, 3) = 'V4!')
      AND (@Scope = 'ALL' OR P.UserId IS NOT NULL);
    PRINT CONCAT('Plain values replaced: ', @@ROWCOUNT);
    IF @HasFailedLogins = 1 AND @ClearFailedLogins = 1
    BEGIN
        EXEC sp_executesql N'UPDATE dbo.FailedLogins SET Password = NULL WHERE Password IS NOT NULL;
            PRINT CONCAT(''FailedLogins passwords cleared: '', @@ROWCOUNT);';
    END
    COMMIT;
END
GO
