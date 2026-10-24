-- New in V4 (not part of the legacy schema). Run on each system's database (ZEDCS_V2_LIVE, ZED_CONSULTANT,
-- ZED_SURVEILLANCE). Additive and safe to re-run: two new tables.
-- Admin → App Forms (Zed.Core/Forms/AppFormCatalogue.cs): the mobile apps' Basic Information forms (msme.basicInfo,
-- assessor.basicInfo, consultant.basicInfo; docs/mobile/APP-FORMS.md).
-- V4AppFormFields: the Admin's change of a standard field (Custom = 0; NULL columns keep the catalogue's label, help,
--   required and position; type and section never change) or a field the Admin added (Custom = 1, all columns set;
--   never deleted, only disabled). A column of a row field is keyed "rows/column" (productDetailsList/productName).
--   No row: the standard field.
-- V4AppFormValues: answers to the Admin's own fields, per unit and level, written by the mobile hosts after the
--   Basic Information procedure succeeded (several answers as a JSON array of strings).
-- The V4 logins need SELECT, INSERT, UPDATE and DELETE on both (zed_v4_app has them; the mobile hosts read and write them).
SET ANSI_NULLS ON;
SET QUOTED_IDENTIFIER ON;
GO
IF OBJECT_ID('dbo.V4AppFormFields', 'U') IS NULL
CREATE TABLE dbo.V4AppFormFields
(
    FormKey      varchar(50)    NOT NULL,
    FieldKey     varchar(100)   NOT NULL,
    Custom       bit            NOT NULL CONSTRAINT DF_V4AppFormFields_Custom DEFAULT 0,
    Label        nvarchar(200)  NULL,
    Help         nvarchar(500)  NULL,
    Type         varchar(20)    NULL,
    Required     bit            NULL,
    Enabled      bit            NOT NULL CONSTRAINT DF_V4AppFormFields_Enabled DEFAULT 1,
    SortOrder    int            NULL,
    Section      varchar(50)    NULL,
    OptionsJson  nvarchar(max)  NULL,
    UpdatedBy    varchar(50)    NULL,
    UpdatedOn    datetime2(0)   NOT NULL CONSTRAINT DF_V4AppFormFields_UpdatedOn DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_V4AppFormFields PRIMARY KEY (FormKey, FieldKey)
);
GO
IF OBJECT_ID('dbo.V4AppFormValues', 'U') IS NULL
CREATE TABLE dbo.V4AppFormValues
(
    FormKey            varchar(50)    NOT NULL,
    ZedId              varchar(50)    NOT NULL,
    CertificationType  varchar(50)    NOT NULL,
    FieldKey           varchar(100)   NOT NULL,
    Value              nvarchar(max)  NULL,
    SubmittedBy        varchar(50)    NULL,
    UpdatedOn          datetime2(0)   NOT NULL CONSTRAINT DF_V4AppFormValues_UpdatedOn DEFAULT SYSUTCDATETIME(),
    CONSTRAINT PK_V4AppFormValues PRIMARY KEY (FormKey, ZedId, CertificationType, FieldKey)
);
GO
-- The staff page reads a unit's answers of every form at once.
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_V4AppFormValues_ZedId' AND object_id = OBJECT_ID('dbo.V4AppFormValues'))
CREATE INDEX IX_V4AppFormValues_ZedId ON dbo.V4AppFormValues (ZedId, CertificationType);
GO
