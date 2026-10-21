-- New in V4. Run on EACH database: ZEDCS_V2_LIVE, ZED_CONSULTANT and ZED_SURVEILLANCE.
--
-- SQL Server Express has no Database Mail. 25 procedures (auto-allotment, NC rejection, surveillance and
-- re-certification reminders, ...) send mail with EXEC msdb.dbo.sp_send_dbmail, and on Express those mails
-- would never leave. This script:
--   1. adds dbo.V4MailOutbox and dbo.SP_V4_SEND_DBMAIL, which takes the same parameters and queues the mail;
--   2. points every procedure of this database that calls msdb.dbo.sp_send_dbmail at dbo.SP_V4_SEND_DBMAIL
--      (CREATE OR ALTER, so permissions are kept). Re-running it is safe: already converted procedures no
--      longer match.
-- The Zed.Jobs worker sends queued mail through the portal's SMTP settings (backend/src/Zed.Jobs).
-- To undo step 2 for one procedure, replace dbo.SP_V4_SEND_DBMAIL with msdb.dbo.sp_send_dbmail again.
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
SET NOCOUNT ON;
GO
IF OBJECT_ID('dbo.V4MailOutbox', 'U') IS NULL
CREATE TABLE dbo.V4MailOutbox
(
    Id                  bigint IDENTITY(1,1) NOT NULL CONSTRAINT PK_V4MailOutbox PRIMARY KEY,
    ProfileName         nvarchar(128)  NULL,
    Recipients          nvarchar(max)  NULL,
    CopyRecipients      nvarchar(max)  NULL,
    BlindCopyRecipients nvarchar(max)  NULL,
    Subject             nvarchar(510)  NULL,
    Body                nvarchar(max)  NULL,
    BodyFormat          varchar(20)    NULL,
    CreatedAt           datetime2(0)   NOT NULL CONSTRAINT DF_V4MailOutbox_CreatedAt DEFAULT SYSDATETIME(),
    ClaimedAt           datetime2(0)   NULL,
    SentAt              datetime2(0)   NULL,
    Attempts            int            NOT NULL CONSTRAINT DF_V4MailOutbox_Attempts DEFAULT 0,
    LastError           nvarchar(1000) NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE object_id = OBJECT_ID('dbo.V4MailOutbox') AND name = 'IX_V4MailOutbox_Pending')
CREATE INDEX IX_V4MailOutbox_Pending ON dbo.V4MailOutbox (Id) WHERE SentAt IS NULL;
GO
-- Same parameter names as msdb.dbo.sp_send_dbmail (the ones the procedures use, plus the common others).
CREATE OR ALTER PROCEDURE dbo.SP_V4_SEND_DBMAIL
    @profile_name          sysname        = NULL,
    @recipients            varchar(max)   = NULL,
    @copy_recipients       varchar(max)   = NULL,
    @blind_copy_recipients varchar(max)   = NULL,
    @subject               nvarchar(255)  = NULL,
    @body                  nvarchar(max)  = NULL,
    @body_format           varchar(20)    = 'TEXT',
    @importance            varchar(6)     = 'NORMAL',
    @from_address          varchar(max)   = NULL,
    @reply_to              varchar(max)   = NULL,
    @mailitem_id           int            = NULL OUTPUT
AS
BEGIN
    SET NOCOUNT ON;
    IF NULLIF(LTRIM(RTRIM(ISNULL(@recipients, ''))), '') IS NULL
       AND NULLIF(LTRIM(RTRIM(ISNULL(@copy_recipients, ''))), '') IS NULL
       AND NULLIF(LTRIM(RTRIM(ISNULL(@blind_copy_recipients, ''))), '') IS NULL
        RETURN 1;  -- sp_send_dbmail also refuses a mail without recipients

    INSERT INTO dbo.V4MailOutbox (ProfileName, Recipients, CopyRecipients, BlindCopyRecipients, Subject, Body, BodyFormat)
    VALUES (@profile_name, @recipients, @copy_recipients, @blind_copy_recipients, @subject, @body, UPPER(ISNULL(@body_format, 'TEXT')));

    SET @mailitem_id = CONVERT(int, SCOPE_IDENTITY() % 2147483647);
    RETURN 0;
END
GO
-- Point the existing procedures at the outbox.
DECLARE @name nvarchar(300), @def nvarchar(max), @pos int, @len int, @c nchar(1), @converted int = 0, @skipped int = 0;
DECLARE procs CURSOR LOCAL FAST_FORWARD FOR
    SELECT QUOTENAME(SCHEMA_NAME(o.schema_id)) + '.' + QUOTENAME(o.name), m.definition
    FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
    WHERE o.type = 'P' AND o.name <> 'SP_V4_SEND_DBMAIL'
      AND m.definition LIKE '%msdb.dbo.sp_send_dbmail%'
      AND m.uses_ansi_nulls = 1 AND m.uses_quoted_identifier = 1;
OPEN procs;
FETCH NEXT FROM procs INTO @name, @def;
WHILE @@FETCH_STATUS = 0
BEGIN
    -- Find the CREATE keyword: skip leading whitespace, -- line comments and /* */ block comments.
    SET @pos = 1; SET @len = LEN(@def + N'x') - 1;
    WHILE @pos <= @len
    BEGIN
        SET @c = SUBSTRING(@def, @pos, 1);
        IF @c IN (N' ', CHAR(9), CHAR(10), CHAR(13)) SET @pos += 1;
        ELSE IF SUBSTRING(@def, @pos, 2) = N'--'
        BEGIN
            SET @pos = CHARINDEX(CHAR(10), @def, @pos);
            IF @pos = 0 SET @pos = @len + 1;
        END
        ELSE IF SUBSTRING(@def, @pos, 2) = N'/*'
        BEGIN
            SET @pos = CHARINDEX(N'*/', @def, @pos + 2);
            IF @pos = 0 SET @pos = @len + 1; ELSE SET @pos += 2;
        END
        ELSE BREAK;
    END

    IF UPPER(SUBSTRING(@def, @pos, 6)) = N'CREATE' AND SUBSTRING(@def, @pos + 6, 1) IN (N' ', CHAR(9), CHAR(10), CHAR(13))
    BEGIN
        SET @def = STUFF(@def, @pos, 6, N'CREATE OR ALTER');
        SET @def = REPLACE(@def, N'msdb.dbo.sp_send_dbmail', N'dbo.SP_V4_SEND_DBMAIL');
        EXEC sys.sp_executesql @def;
        SET @converted += 1;
        PRINT 'Converted ' + @name;
    END
    ELSE
    BEGIN
        SET @skipped += 1;
        PRINT 'SKIPPED (no CREATE at the start; convert by hand) ' + @name;
    END
    FETCH NEXT FROM procs INTO @name, @def;
END
CLOSE procs; DEALLOCATE procs;
DECLARE @remaining int = (SELECT COUNT(*) FROM sys.sql_modules
                          WHERE definition LIKE '%msdb.dbo.sp_send_dbmail%' AND object_id <> OBJECT_ID('dbo.SP_V4_SEND_DBMAIL'));
PRINT CONCAT('Procedures converted: ', @converted, ', skipped: ', @skipped,
             ', still calling msdb.dbo.sp_send_dbmail (convert by hand): ', @remaining);
GO
