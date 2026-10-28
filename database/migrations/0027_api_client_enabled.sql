-- Run on ZEDCS_V2_LIVE. Additive and safe to re-run.
-- Administration → API Integrations: whether a partner (a row of dbo.ApiClientTokens) may call ZED's APIs, as a new
-- column of that table:
--   IsEnabled          NULL or 1 = enabled (as before V4), 0 = disabled by the Admin: its key and the tokens it already
--                      holds are refused (Zed.Portal/Features/ExternalApi/ApiClients.cs);
--   UpdatedBy / UpdatedOn  who last changed the partner on that page (switch or Edit), when (UTC).
-- Earlier V4 builds kept the switch in dbo.V4Settings ("ApiClient.{Id}.Enabled" = 'false'); those rows are copied into
-- the column and removed (one transaction). The old site is not affected: SP_API_KEY_MAKER inserts with a column list.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF COL_LENGTH('dbo.ApiClientTokens', 'IsEnabled') IS NULL ALTER TABLE dbo.ApiClientTokens ADD IsEnabled bit NULL;
IF COL_LENGTH('dbo.ApiClientTokens', 'UpdatedBy') IS NULL ALTER TABLE dbo.ApiClientTokens ADD UpdatedBy varchar(50) NULL;
IF COL_LENGTH('dbo.ApiClientTokens', 'UpdatedOn') IS NULL ALTER TABLE dbo.ApiClientTokens ADD UpdatedOn datetime2(0) NULL;
GO
SET XACT_ABORT ON;
IF OBJECT_ID('dbo.V4Settings', 'U') IS NOT NULL
   AND EXISTS (SELECT 1 FROM dbo.V4Settings WHERE SettingKey LIKE 'ApiClient.%.Enabled')
BEGIN
    BEGIN TRANSACTION;
    UPDATE c SET IsEnabled = 0, UpdatedBy = s.UpdatedBy, UpdatedOn = s.UpdatedOn
    FROM dbo.ApiClientTokens c
    JOIN dbo.V4Settings s ON s.SettingKey = CONCAT('ApiClient.', c.Id, '.Enabled')
    WHERE s.SettingValue = 'false';
    DELETE FROM dbo.V4Settings WHERE SettingKey LIKE 'ApiClient.%.Enabled';
    COMMIT;
END
GO
