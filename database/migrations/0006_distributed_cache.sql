-- New in V4. Optional: only needed when a portal runs on more than one server. Run on the database of each
-- system that does (ZEDCS_V2_LIVE, ZED_CONSULTANT, ZED_SURVEILLANCE), then set Cache:SqlServerTable = dbo.V4Cache
-- on those hosts. Holds registration sessions and payment order state that would otherwise live in one
-- server's memory (Zed.Core/Http/ZedProduction.cs). Layout required by Microsoft.Extensions.Caching.SqlServer.
-- Expired rows are removed by the hosts themselves (every 30 minutes). Safe to re-run.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4Cache', 'U') IS NULL
CREATE TABLE dbo.V4Cache
(
    Id                         nvarchar(449)  COLLATE SQL_Latin1_General_CP1_CS_AS NOT NULL CONSTRAINT PK_V4Cache PRIMARY KEY,
    Value                      varbinary(max) NOT NULL,
    ExpiresAtTime              datetimeoffset NOT NULL,
    SlidingExpirationInSeconds bigint         NULL,
    AbsoluteExpiration         datetimeoffset NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.V4Cache') AND name = 'IX_V4Cache_ExpiresAtTime')
CREATE NONCLUSTERED INDEX IX_V4Cache_ExpiresAtTime ON dbo.V4Cache (ExpiresAtTime);
GO
