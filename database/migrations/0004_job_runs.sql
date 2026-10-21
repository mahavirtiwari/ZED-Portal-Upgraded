-- New in V4. Run on ZEDCS_V2_LIVE. History of the former SQL Agent jobs run by the Zed.Jobs service
-- (backend/src/Zed.Jobs); it also tells the service which runs already happened after a restart.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4JobRuns', 'U') IS NULL
CREATE TABLE dbo.V4JobRuns
(
    Id            bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_V4JobRuns PRIMARY KEY,
    JobName       nvarchar(200)  NOT NULL,
    DatabaseName  varchar(50)    NOT NULL,
    ProcedureName sysname        NOT NULL,
    StartedAt     datetime2(0)   NOT NULL,  -- in the schedule's time zone (Jobs:TimeZone)
    FinishedAt    datetime2(0)   NULL,
    Succeeded     bit            NOT NULL,
    Error         nvarchar(2000) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.V4JobRuns') AND name = 'IX_V4JobRuns_Job')
CREATE INDEX IX_V4JobRuns_Job ON dbo.V4JobRuns (JobName, StartedAt);
GO
