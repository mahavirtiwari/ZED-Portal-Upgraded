-- Run on ZED_SURVEILLANCE (after 0068 on ZEDCS_V2_LIVE and here). Safe to re-run (every deploy runs it).
--
-- Professional verification (2026-11-13): the PAN an agency enters when it adds an assessor on the main portal is kept in
-- ZEDCS_V2_LIVE.dbo.Users.PanNo (0068). Main's SP_INSERT_USER also writes the assessor's row here, and the portal now
-- copies the PAN to it straight after; this copies the PANs that are not here yet (assessors added before, or a copy that
-- failed). Only empty PANs are filled: nothing here is overwritten.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF DB_NAME() <> N'ZED_SURVEILLANCE'
    THROW 50069, '0069 runs on ZED_SURVEILLANCE.', 1;
GO
IF COL_LENGTH('dbo.Users', 'PanNo') IS NULL
    PRINT CONCAT(DB_NAME(), N'.dbo.Users.PanNo: missing (0068 not applied), skipped.');
ELSE IF NOT EXISTS (SELECT 1 FROM ZEDCS_V2_LIVE.sys.columns WHERE object_id = OBJECT_ID('ZEDCS_V2_LIVE.dbo.Users') AND name = 'PanNo')
    PRINT N'ZEDCS_V2_LIVE.dbo.Users.PanNo: missing (0068 not applied there), skipped.';
ELSE
BEGIN
    DECLARE @n int;
    EXEC sys.sp_executesql N'
        UPDATE s SET PanNo = LTRIM(RTRIM(m.PanNo))
        FROM dbo.Users s
        JOIN ZEDCS_V2_LIVE.dbo.Users m ON m.UserId = s.UserId AND m.RoleId = s.RoleId
        WHERE s.RoleId = 3 AND NULLIF(LTRIM(RTRIM(s.PanNo)), '''') IS NULL AND NULLIF(LTRIM(RTRIM(m.PanNo)), '''') IS NOT NULL;
        SET @n = @@ROWCOUNT;', N'@n int OUTPUT', @n = @n OUTPUT;
    PRINT CONCAT(DB_NAME(), N'.dbo.Users.PanNo: ', @n, N' assessor(s) copied from ZEDCS_V2_LIVE.');
END
GO
