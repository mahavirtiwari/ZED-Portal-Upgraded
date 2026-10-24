-- New in V4 (not part of the legacy schema). Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT,
-- ZED_SURVEILLANCE). Additive and safe to re-run: one new table.
-- Admin → Texts (Zed.Core/Content/ContentBlocks.cs): the Admin's version of a disclaimer, instruction, undertaking or
-- pledge shown on the web pages or in the mobile apps: shown or hidden and, optionally, the Admin's own HTML text with
-- {{Placeholder}} fields. Keys are those of the catalogue (e.g. msme.payment.disclaimer). No row: the standard text.
-- The V4 logins need SELECT, INSERT, UPDATE and DELETE on it (zed_v4_app has them; the mobile hosts read it).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4ContentBlocks', 'U') IS NULL
CREATE TABLE dbo.V4ContentBlocks
(
    BlockKey   varchar(150)   NOT NULL CONSTRAINT PK_V4ContentBlocks PRIMARY KEY,
    Enabled    bit            NOT NULL CONSTRAINT DF_V4ContentBlocks_Enabled DEFAULT 1,
    BodyHtml   nvarchar(max)  NULL,
    UpdatedBy  varchar(50)    NULL,
    UpdatedOn  datetime2(0)   NOT NULL CONSTRAINT DF_V4ContentBlocks_UpdatedOn DEFAULT SYSUTCDATETIME()
);
GO
