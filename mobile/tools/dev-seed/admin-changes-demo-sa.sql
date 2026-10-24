/*
  LOCAL USE ONLY. Plays an Admin's changes on the local ZEDCS_V2_LIVE (as Admin → App Forms and Admin → Texts would
  store them) to try the site assessment app's configurable Basic Information form and Admin texts against the local
  Main MobileApi:
    - assessor.basicInfo: a custom required text field "Factory licence number" and an optional whole number
      "Number of shifts"; "Processes Outsourced, if any" disabled; the audits question relabelled with a help text;
    - app.assessor.siteTour.tourInstruction: the Admin's own wording.
  Needs migrations 0016 and 0017. Rows are marked UpdatedBy = 'rn-dev-seed'; run with -v Mode=remove to take them out.

  sqlcmd -S localhost\SQLEXPRESS -E -C -d ZEDCS_V2_LIVE -f 65001 -i admin-changes-demo-sa.sql -v Mode=apply
*/
SET NOCOUNT ON;
IF DB_NAME() <> 'ZEDCS_V2_LIVE'
BEGIN
    RAISERROR('Run only on a local development ZEDCS_V2_LIVE database.', 16, 1);
    RETURN;
END

DELETE FROM dbo.V4AppFormFields WHERE UpdatedBy = 'rn-dev-seed';
DELETE FROM dbo.V4ContentBlocks WHERE UpdatedBy = 'rn-dev-seed';
IF '$(Mode)' = 'remove' RETURN;

INSERT INTO dbo.V4AppFormFields (FormKey, FieldKey, Custom, Label, Help, Type, Required, Enabled, SortOrder, Section, OptionsJson, UpdatedBy)
VALUES
    ('assessor.basicInfo', 'cf_rn_licence', 1, N'Factory licence number', N'As on the licence', 'text', 1, 1, 35, 'basic', NULL, 'rn-dev-seed'),
    ('assessor.basicInfo', 'cf_rn_shifts', 1, N'Number of shifts', NULL, 'number', 0, 1, 36, 'basic', NULL, 'rn-dev-seed'),
    ('assessor.basicInfo', 'outsourcedProcesses', 0, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, 'rn-dev-seed'),
    ('assessor.basicInfo', 'auditsConducted', 0, N'Are 3rd party financial audits conducted?', N'A statutory audit counts.', NULL, NULL, 1, NULL, NULL, NULL, 'rn-dev-seed');

INSERT INTO dbo.V4ContentBlocks (BlockKey, Enabled, BodyHtml, UpdatedBy)
VALUES
    ('app.assessor.siteTour.tourInstruction', 1, N'Capture the shop floor, stores and testing area (Admin text).', 'rn-dev-seed');
