/*
  verify_references.sql  -  read-only checks, run once per database, e.g.
    sqlcmd -S "localhost\SQLEXPRESS" -E -C -d ZEDCS_V2_LIVE -i verify_references.sql -W -s "|"

  Result set 1: object counts.
  Result set 2: modules (procs/views/functions) that reference an object that does not
                exist in this database, in one of the other two ZED databases, or that use a
                linked server (four-part name).
  Result set 3: modules that fail to bind (invalid column, ambiguous column, missing object
                in a view/function, ...).  Uses sp_refreshsqlmodule inside a transaction that is
                always rolled back, so nothing is changed.
*/
SET NOCOUNT ON;

SELECT DB_NAME() AS db,
       (SELECT COUNT(*) FROM sys.tables     WHERE is_ms_shipped = 0) AS tables,
       (SELECT COUNT(*) FROM sys.procedures WHERE is_ms_shipped = 0) AS procs,
       (SELECT COUNT(*) FROM sys.views      WHERE is_ms_shipped = 0) AS views,
       (SELECT COUNT(*) FROM sys.objects    WHERE type IN ('FN','IF','TF','FS','FT') AND is_ms_shipped = 0) AS functions,
       (SELECT COUNT(*) FROM sys.types      WHERE is_table_type = 1) AS table_types;

/* ---- 2. unresolved references ------------------------------------------------------- */
;WITH r AS (
    SELECT DISTINCT
           OBJECT_SCHEMA_NAME(d.referencing_id) + '.' + OBJECT_NAME(d.referencing_id) AS referencing,
           o.type_desc AS referencing_type,
           d.referenced_server_name   AS srv,
           d.referenced_database_name AS dbn,
           ISNULL(d.referenced_schema_name, 'dbo') AS sch,
           d.referenced_entity_name   AS ent,
           d.referenced_class_desc    AS cls
    FROM sys.sql_expression_dependencies d
    JOIN sys.objects o ON o.object_id = d.referencing_id
    WHERE d.referenced_id IS NULL
)
SELECT DB_NAME() AS db, referencing, referencing_type,
       CONCAT(srv + '.', dbn + '.', sch + '.', ent) AS referenced,
       CASE WHEN srv IS NOT NULL THEN 'LINKED SERVER (four-part name)'
            WHEN dbn IS NOT NULL AND DB_ID(dbn) IS NULL THEN 'MISSING DATABASE'
            ELSE 'MISSING OBJECT' END AS problem
FROM r
WHERE cls = 'OBJECT_OR_COLUMN'
  AND ent NOT LIKE '#%'
  AND ( srv IS NOT NULL
        OR (dbn IS NOT NULL AND DB_ID(dbn) IS NULL)
        OR (OBJECT_ID(QUOTENAME(ISNULL(dbn, DB_NAME())) + '.' + QUOTENAME(sch) + '.' + QUOTENAME(ent)) IS NULL
            AND TYPE_ID(QUOTENAME(sch) + '.' + QUOTENAME(ent)) IS NULL) )
ORDER BY referencing, referenced;

/* ---- 3. modules that do not bind ---------------------------------------------------- */
DECLARE @bad TABLE (referencing nvarchar(300), referencing_type nvarchar(60), error_number int, error_message nvarchar(2000));
DECLARE @id int, @name nvarchar(300), @type nvarchar(60);
DECLARE c CURSOR LOCAL FAST_FORWARD FOR
    SELECT m.object_id, QUOTENAME(OBJECT_SCHEMA_NAME(m.object_id)) + '.' + QUOTENAME(OBJECT_NAME(m.object_id)), o.type_desc
    FROM sys.sql_modules m JOIN sys.objects o ON o.object_id = m.object_id
    WHERE o.is_ms_shipped = 0 AND o.type IN ('P','V','FN','IF','TF')
    ORDER BY o.type, o.name;
OPEN c;
FETCH NEXT FROM c INTO @id, @name, @type;
WHILE @@FETCH_STATUS = 0
BEGIN
    BEGIN TRY
        BEGIN TRAN;
        EXEC sys.sp_refreshsqlmodule @name;
        ROLLBACK TRAN;
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRAN;
        INSERT @bad VALUES (@name, @type, ERROR_NUMBER(), ERROR_MESSAGE());
    END CATCH;
    FETCH NEXT FROM c INTO @id, @name, @type;
END;
CLOSE c; DEALLOCATE c;
SELECT DB_NAME() AS db, * FROM @bad ORDER BY referencing;
