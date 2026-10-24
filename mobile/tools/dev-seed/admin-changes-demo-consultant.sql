/*
  LOCAL USE ONLY. Plays an Admin's changes on the local ZED_CONSULTANT (as Admin → App Forms and Admin → Texts would
  store them) to try the consultant app's configurable Basic Information form and Admin texts against the local
  consultancy mobile host:
    - consultant.basicInfo: a custom required text field "Export markets" in Financial Performance; the turnover
      field relabelled with a help text;
    - app.consultant.siteTour.tourInstruction: the Admin's own wording.
  Needs migrations 0016 and 0017. Rows are marked UpdatedBy = 'rn-dev-seed'; run with -v Mode=remove to take them out.

  sqlcmd -S localhost\SQLEXPRESS -E -C -d ZED_CONSULTANT -f 65001 -i admin-changes-demo-consultant.sql -v Mode=apply
*/
SET NOCOUNT ON;
IF DB_NAME() <> 'ZED_CONSULTANT'
BEGIN
    RAISERROR('Run only on a local development ZED_CONSULTANT database.', 16, 1);
    RETURN;
END

DELETE FROM dbo.V4AppFormFields WHERE UpdatedBy = 'rn-dev-seed';
DELETE FROM dbo.V4ContentBlocks WHERE UpdatedBy = 'rn-dev-seed';
IF '$(Mode)' = 'remove' RETURN;

INSERT INTO dbo.V4AppFormFields (FormKey, FieldKey, Custom, Label, Help, Type, Required, Enabled, SortOrder, Section, OptionsJson, UpdatedBy)
VALUES
    ('consultant.basicInfo', 'cf_rn_exports', 1, N'Export markets', N'Countries the unit sells to', 'text', 1, 1, 95, 'financialPerformance', NULL, 'rn-dev-seed'),
    ('consultant.basicInfo', 'financialPerformance.turnover', 0, N'Annual turnover (in lakh)', N'From the last audited accounts.', NULL, NULL, 1, NULL, NULL, NULL, 'rn-dev-seed');

INSERT INTO dbo.V4ContentBlocks (BlockKey, Enabled, BodyHtml, UpdatedBy)
VALUES
    ('app.consultant.siteTour.tourInstruction', 1, N'Capture the shop floor, stores and testing area (Admin text).', 'rn-dev-seed');
