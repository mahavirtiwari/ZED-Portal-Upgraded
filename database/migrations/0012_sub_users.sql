-- New in V4 (not part of the legacy schema). Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT,
-- ZED_SURVEILLANCE). Additive and safe to re-run: one new table.
-- Sub-users: logins that a MasterAdmin ("operation admins") or an agency / consultant organisation creates for its own
-- staff (Staff → Operation Admins / Sub-Users, Zed.Portal/Features/Staff/SubUsers). A sub-user signs in on the staff
-- login with its own ID and password and then works as its owner (same Users row, role, sub-roles and data), limited to
-- the screens the owner ticked (Permissions: comma-separated keys of SubUserPermissions). Sub-users are not Users
-- rows, so the legacy lists, allotment drop-downs and procedures never see them; their IDs are kept distinct from
-- Users.UserId by the portal. Passwords are V4 hashes only ("u1$" + ASP.NET Core PasswordHasher v3).
-- The V4 portal logins need SELECT, INSERT and UPDATE on it (the zed_v4_app role has them through
-- db_datareader/db_datawriter).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4SubUsers', 'U') IS NULL
CREATE TABLE dbo.V4SubUsers
(
    UserId        varchar(50)    NOT NULL CONSTRAINT PK_V4SubUsers PRIMARY KEY,
    OwnerUserId   varchar(50)    NOT NULL,   -- Users.UserId of the MasterAdmin or agency
    OwnerRoleId   int            NOT NULL,   -- the owner's Users.RoleId when the sub-user was created (7 or 2)
    UserName      nvarchar(100)  NOT NULL,
    Email         varchar(100)   NULL,
    MobileNo      varchar(15)    NULL,
    Permissions   varchar(1000)  NOT NULL CONSTRAINT DF_V4SubUsers_Permissions DEFAULT '',
    IsActive      bit            NOT NULL CONSTRAINT DF_V4SubUsers_IsActive DEFAULT 1,
    PasswordHash  varchar(256)   NULL,
    FailedLogins  int            NOT NULL CONSTRAINT DF_V4SubUsers_FailedLogins DEFAULT 0,
    LockedUntil   datetime2(0)   NULL,       -- UTC
    LastLoginAt   datetime2(0)   NULL,       -- UTC
    CreatedBy     varchar(50)    NULL,
    CreatedAt     datetime2(0)   NOT NULL CONSTRAINT DF_V4SubUsers_CreatedAt DEFAULT SYSUTCDATETIME(),
    UpdatedBy     varchar(50)    NULL,
    UpdatedAt     datetime2(0)   NULL
);
GO
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_V4SubUsers_Owner' AND object_id = OBJECT_ID('dbo.V4SubUsers'))
    CREATE INDEX IX_V4SubUsers_Owner ON dbo.V4SubUsers (OwnerUserId);
GO
