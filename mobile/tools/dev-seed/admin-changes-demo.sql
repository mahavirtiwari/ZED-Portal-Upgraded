/*
  LOCAL USE ONLY. Plays an Admin's changes on the local ZED_SURVEILLANCE (as Admin → App Forms and Admin → Texts
  would store them) to try the app's configurable Basic Information form and Admin texts against the local MobileApi:
    - msme.basicInfo: a custom required text field "GST number" and an optional whole number "Number of employees";
      "Processes Outsourced, if any" disabled; the audits question relabelled with a help text;
    - app.msme.evidences.finalSubmit.confirm and app.msme.offline.note: the Admin's own wording.
  Needs migrations 0016 and 0017. Rows are marked UpdatedBy = 'rn-dev-seed'; run with -v Mode=remove to take them out.

  sqlcmd -S localhost\SQLEXPRESS -E -C -d ZED_SURVEILLANCE -f 65001 -i admin-changes-demo.sql -v Mode=apply
*/
SET NOCOUNT ON;
IF DB_NAME() <> 'ZED_SURVEILLANCE'
BEGIN
    RAISERROR('Run only on a local development ZED_SURVEILLANCE database.', 16, 1);
    RETURN;
END

DELETE FROM dbo.V4AppFormFields WHERE UpdatedBy = 'rn-dev-seed';
DELETE FROM dbo.V4ContentBlocks WHERE UpdatedBy = 'rn-dev-seed';
IF '$(Mode)' = 'remove' RETURN;

INSERT INTO dbo.V4AppFormFields (FormKey, FieldKey, Custom, Label, Help, Type, Required, Enabled, SortOrder, Section, OptionsJson, UpdatedBy)
VALUES
    ('msme.basicInfo', 'cf_rn_gst', 1, N'GST number', N'As on the GST certificate', 'text', 1, 1, 35, 'basic', NULL, 'rn-dev-seed'),
    ('msme.basicInfo', 'cf_rn_staff', 1, N'Number of employees', NULL, 'number', 0, 1, 36, 'basic', NULL, 'rn-dev-seed'),
    ('msme.basicInfo', 'outsourcedProcesses', 0, NULL, NULL, NULL, NULL, 0, NULL, NULL, NULL, 'rn-dev-seed'),
    ('msme.basicInfo', 'auditsConducted', 0, N'Are 3rd party financial audits conducted?', N'A statutory audit counts.', NULL, NULL, 1, NULL, NULL, NULL, 'rn-dev-seed');

INSERT INTO dbo.V4ContentBlocks (BlockKey, Enabled, BodyHtml, UpdatedBy)
VALUES
    ('app.msme.evidences.finalSubmit.confirm', 1, N'I confirm that the information and photos are of this unit only (Admin text).', 'rn-dev-seed'),
    ('app.msme.offline.note', 1, N'Offline (Admin text): sync once you are connected again.', 'rn-dev-seed');
