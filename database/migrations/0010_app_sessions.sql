-- New in V4 (not part of the legacy schema). Run on ZED_CONSULTANT. Additive and safe to re-run: one new table.
-- Sign-ins of the consultant app (com.qci.zed.consultancy) that V4 accepted, per user and unit. The app's technology
-- upgradation screens call the consultancy web site's FinancialAssistance/GetDetails, ValidateEvidence, FinalSubmit
-- and updatetechnology without any user name, password or token (app source, 2026-10-22); the old site served them to
-- anyone (SECURITY-FINDINGS #88). V4 serves them only for a unit whose allotted DFO signed in to the app for that unit
-- recently (Consultancy:TuApp:LoginHours), using these rows. Written by the consultant app's SA/Login (consultancy
-- mobile deployment), read by the consultancy portal. Rows older than 30 days are removed when a user signs in again.
-- The V4 logins need INSERT, DELETE and SELECT on it (the zed_v4_app role has them through db_datareader/db_datawriter).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4AppSessions', 'U') IS NULL
CREATE TABLE dbo.V4AppSessions
(
    Id            bigint IDENTITY(1, 1) NOT NULL CONSTRAINT PK_V4AppSessions PRIMARY KEY,
    AppKind       varchar(20)  NOT NULL,   -- 'Consultant' (consultant / DFO app)
    UserId        varchar(50)  NOT NULL,   -- Users.UserId that signed in
    ZedId         varchar(50)  NOT NULL,   -- unit the sign-in was for (the app signs in per unit)
    Certification varchar(50)  NULL,
    Ip            varchar(50)  NULL,
    SignedInAt    datetime2(0) NOT NULL CONSTRAINT DF_V4AppSessions_SignedInAt DEFAULT SYSUTCDATETIME()
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_V4AppSessions_Unit' AND object_id = OBJECT_ID('dbo.V4AppSessions'))
    CREATE INDEX IX_V4AppSessions_Unit ON dbo.V4AppSessions (ZedId, UserId, AppKind, SignedInAt);
GO
