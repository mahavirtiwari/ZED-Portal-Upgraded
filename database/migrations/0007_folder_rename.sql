-- New in V4. Run on ZEDCS_V2_LIVE. Additive and safe to re-run.
-- Replaces the xp_cmdshell part of SP_JOB_TO_CREATE_RENAMING_BATCH_FILES (SECURITY-FINDINGS #12): the Zed.Jobs
-- service renames the folders of rejected units itself (Jobs:FolderRename, docs/JOBS.md). These procedures give it
-- the same rows the old job picked, from the same table (dbo.FolderRenameHIstory), so the switch carries on where the
-- old job stopped and the old procedure still works if you go back to it.
--   dbo.FolderRenameHIstory keeps its meaning: RenameDone = 'Yes' means done (the old job's high-water mark is the
--   largest Id with 'Yes'); NULL means waiting. Nothing else is written to it.
--   dbo.V4FolderRenameResults (new): what Zed.Jobs found and did for each row on each run.
-- The V4 job login needs EXECUTE on both procedures.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4FolderRenameResults', 'U') IS NULL
CREATE TABLE dbo.V4FolderRenameResults
(
    Id        bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_V4FolderRenameResults PRIMARY KEY,
    HistoryId int            NOT NULL,   -- dbo.FolderRenameHIstory.Id (= dbo.MsmeHistory.Id)
    ZedId     varchar(50)    NULL,       -- the archived ZED ID (ZEDMSME000123_D_45)
    Outcome   varchar(30)    NOT NULL,   -- Moved, NothingToMove, AlreadyArchived, NotArchived, Conflict, NewerFiles, InvalidId, Error, Manual
    Done      bit            NOT NULL,   -- 1: the row was marked RenameDone = 'Yes'
    Detail    nvarchar(1000) NULL,       -- per folder: what was moved or why not
    CheckedAt datetime2(0)   NOT NULL CONSTRAINT DF_V4FolderRenameResults_CheckedAt DEFAULT (SYSDATETIME())
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.V4FolderRenameResults') AND name = 'IX_V4FolderRenameResults_History')
CREATE INDEX IX_V4FolderRenameResults_History ON dbo.V4FolderRenameResults (HistoryId, CheckedAt);
GO

-- The rows waiting to be renamed. With @Collect = 1 the new rejections are first added to dbo.FolderRenameHIstory
-- exactly as the old job did (StatusType LIKE '%unit rejected%', the history's certification type, older than
-- @DelayHours, Id above the largest Id already done, and a MsmeCertifications row with that ZED ID); with
-- @Collect = 0 (Report mode) nothing is written and those rows are returned with InTable = 0.
-- Unlike the old job a row already in the table is not added twice (the old job never left rows waiting).
-- The old job collected nothing while the table had no 'Yes' row; @StartAfterId is used only in that case.
CREATE OR ALTER PROCEDURE dbo.SP_V4_FOLDER_RENAME_PENDING
(
    @CertificationTypes varchar(200) = 'Bronze',   -- comma-separated
    @DelayHours         int          = 2,
    @Collect            bit          = 0,
    @StartAfterId       int          = NULL
)
AS
BEGIN
    SET NOCOUNT ON;
    DECLARE @Types varchar(202) = ',' + REPLACE(ISNULL(@CertificationTypes, ''), ' ', '') + ',';
    DECLARE @Done int = (SELECT MAX(Id) FROM dbo.FolderRenameHIstory WHERE RenameDone = 'Yes');
    IF @Done IS NULL SET @Done = @StartAfterId;

    SELECT DISTINCT H.Id, H.ZedId, H.CertificationType
    INTO #New
    FROM dbo.MsmeCertifications C WITH (NOLOCK)
    INNER JOIN dbo.MsmeHistory H WITH (NOLOCK) ON C.ZedId = H.ZedId
    WHERE H.StatusType LIKE '%unit rejected%'
      AND CHARINDEX(',' + H.CertificationType + ',', @Types) > 0
      AND H.CreatedDate < DATEADD(HOUR, -ISNULL(@DelayHours, 2), GETDATE())
      AND @Done IS NOT NULL AND H.Id > @Done
      AND NOT EXISTS (SELECT 1 FROM dbo.FolderRenameHIstory F WHERE F.Id = H.Id);

    IF @Collect = 1
    BEGIN
        INSERT INTO dbo.FolderRenameHIstory (Id, ZedId, RenameDate, CertificationType)
        SELECT Id, ZedId, GETDATE(), CertificationType FROM #New;
        DELETE FROM #New;
    END

    ;WITH P AS
    (
        SELECT F.Id, F.ZedId, F.CertificationType, F.RenameDate, CAST(1 AS bit) AS InTable
        FROM dbo.FolderRenameHIstory F WHERE F.RenameDone IS NULL
        UNION ALL
        SELECT N.Id, N.ZedId, N.CertificationType, NULL, CAST(0 AS bit) FROM #New N
    )
    SELECT P.Id, P.ZedId, P.CertificationType, P.InTable,
           -- When the unit was rejected (the history row); the time the row was collected if that row is gone.
           DATEDIFF(MINUTE, COALESCE(H.CreatedDate, P.RenameDate), GETDATE()) AS MinutesSinceRejection,
           -- Certification rows that use the unit's own ZED ID again (a new application or another level).
           STUFF((SELECT ',' + C.Certification + ':' + ISNULL(CAST(C.CertificationStatus AS varchar(10)), '')
                  FROM dbo.MsmeCertifications C WITH (NOLOCK)
                  WHERE C.ZedId = CASE WHEN CHARINDEX('_D_', P.ZedId) > 0 THEN LEFT(P.ZedId, CHARINDEX('_D_', P.ZedId) - 1)
                                       WHEN CHARINDEX('_D', P.ZedId) > 0 THEN LEFT(P.ZedId, CHARINDEX('_D', P.ZedId) - 1)
                                       ELSE NULL END
                  FOR XML PATH(''), TYPE).value('.', 'varchar(400)'), 1, 1, '') AS BaseCertifications
    FROM P
    LEFT JOIN dbo.MsmeHistory H WITH (NOLOCK) ON H.Id = P.Id
    ORDER BY P.Id;
END
GO

-- One result per row and run; @Done = 1 also marks the row RenameDone = 'Yes'.
CREATE OR ALTER PROCEDURE dbo.SP_V4_FOLDER_RENAME_RECORD
(
    @Id      int,
    @ZedId   varchar(50),
    @Outcome varchar(30),
    @Done    bit           = 0,
    @Detail  nvarchar(1000) = NULL
)
AS
BEGIN
    SET NOCOUNT ON;
    BEGIN TRAN;
        INSERT INTO dbo.V4FolderRenameResults (HistoryId, ZedId, Outcome, Done, Detail)
        VALUES (@Id, @ZedId, @Outcome, ISNULL(@Done, 0), @Detail);
        IF @Done = 1
            UPDATE dbo.FolderRenameHIstory SET RenameDone = 'Yes'
            WHERE Id = @Id AND ZedId = @ZedId AND RenameDone IS NULL;
    COMMIT TRAN;
END
GO
