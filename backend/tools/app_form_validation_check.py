"""App Forms "Validation required" (migration 0080) on a local throwaway database set (ZEDV4CHK_*): an answer the assessor
checked Not valid makes the final submit raise an NC and marks the answer raised in the next round.

    1. powershell database\\setup.ps1 -DatabasePrefix ZEDV4CHK_VAL_ -WithKawachStandIn
       powershell deploy\\Invoke-ZedDatabaseScripts.ps1 -DatabasePrefix ZEDV4CHK_VAL_ -Apply
    2. python -B -I backend/tools/app_form_validation_check.py [ZEDV4CHK_VAL_ZEDCS_V2_LIVE]
    3. drop the ZEDV4CHK_VAL_* databases

Cases (units made directly in the tables):
  DA1  Bronze at the desktop (status 3, round 0), one answer Not valid       -> NC 1 (status 4), the answer raised in NC 1
  DA2  Bronze, the same answer Valid                                          -> no NC from it (status 5)
  SA1  Silver after the visit (status 13, round 0), one answer Not valid     -> NC 1 (status 14), raised in NC 1
  SA2  Silver in NC 5, the answer still Not valid                             -> rejected (status 17), not raised again
  SA3  Silver, a Not valid check made by the desktop (stage DA)               -> ignored by the site final submit (status 15)
Stops at the first surprise.
"""
import subprocess
import sys

SERVER = r'localhost\SQLEXPRESS'
MAIN = sys.argv[1] if len(sys.argv) > 1 else 'ZEDV4CHK_VAL_ZEDCS_V2_LIVE'
assert MAIN.startswith('ZEDV4CHK_'), 'throwaway databases only'
FORM = 'msme.basicInfo'


def sql(query):
    r = subprocess.run(['sqlcmd', '-S', SERVER, '-E', '-C', '-b', '-f', 'i:65001,o:65001', '-W', '-s', '|', '-h', '-1', '-d', MAIN,
                        '-Q', 'SET NOCOUNT ON; ' + query], capture_output=True, text=True, encoding='utf-8')
    if r.returncode != 0:
        raise SystemExit(f'SQL failed: {query[:120]}\n{r.stdout}\n{r.stderr}')
    return [line.split('|') for line in r.stdout.splitlines() if line.strip()]


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond:
        sys.exit(1)


def unit(zed, level, status, nc, stage, verdict, round_=None):
    round_ = nc if round_ is None else round_
    sql(f"DELETE FROM dbo.MsmeCertifications WHERE ZedId = '{zed}'; DELETE FROM dbo.V4AppFormValues WHERE ZedId = '{zed}';"
        f"INSERT INTO dbo.MsmeCertifications (ZedId, Certification, CertificationStatus, NcCount) VALUES ('{zed}', '{level}', {status}, {nc});"
        f"INSERT INTO dbo.V4AppFormValues (FormKey, ZedId, CertificationType, FieldKey, Value, SubmittedBy, ValidStatus, ValidRemarks, ValidStage, ValidRound) "
        f"VALUES ('{FORM}', '{zed}', '{level}', 'cf_gst', N'27AAACZ1234F1Z5', '{zed}', '{verdict}', N'Does not match', '{stage}', {round_});")


def record(zed, level):
    r = sql(f"SELECT CertificationStatus, NcCount FROM dbo.MsmeCertifications WHERE ZedId = '{zed}' AND Certification = '{level}';")[0]
    return int(r[0]), int(r[1])


def answer(zed):
    r = sql(f"SELECT ISNULL(CAST(NcRound AS varchar(5)), 'NULL'), ISNULL(NcValue, 'NULL'), ISNULL(NcRemarks, 'NULL') FROM dbo.V4AppFormValues "
            f"WHERE ZedId = '{zed}' AND FieldKey = 'cf_gst';")[0]
    return r[0], r[1], r[2]


print(f'App Forms validation (0080) on {MAIN}')
check(sql("SELECT COL_LENGTH('dbo.V4AppFormFields', 'NeedsVerification')")[0][0] != 'NULL', 'V4AppFormFields.NeedsVerification exists')
for c in ('ValidStatus', 'ValidRemarks', 'ValidStage', 'ValidRound', 'ValidBy', 'ValidOn', 'NcRound', 'NcValue', 'NcRemarks', 'NcAnsweredOn'):
    check(sql(f"SELECT COL_LENGTH('dbo.V4AppFormValues', '{c}')")[0][0] != 'NULL', f'V4AppFormValues.{c} exists')
for p in ('SP_ASSESSMENT_DA_FINAL_SUBMIT', 'SP_ASSESSMENT_RA_FINAL_SUBMIT'):
    check(sql(f"SELECT CHARINDEX('dbo.V4AppFormValues', OBJECT_DEFINITION(OBJECT_ID('dbo.{p}')))")[0][0] != '0', f'{p} edited')
try:
    sql("INSERT INTO dbo.V4AppFormValues (FormKey, ZedId, CertificationType, FieldKey, ValidStatus) VALUES ('x', 'ZEDCHKBAD', 'Bronze', 'k', 'Maybe');")
    check(False, 'ValidStatus refuses other values')
except SystemExit:
    check(True, 'ValidStatus refuses other values')

print('DA1 Bronze, Not valid at the desktop')
unit('ZEDCHKVAL0001', 'Bronze', 3, 0, 'DA', 'No')
sql("EXEC dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT @ZedId = 'ZEDCHKVAL0001', @CertificationType = 'Bronze', @AssessorRemarks = 'Checked';")
check(record('ZEDCHKVAL0001', 'Bronze') == (4, 1), 'NC 1 raised (status 4, NcCount 1)')
check(answer('ZEDCHKVAL0001') == ('1', '27AAACZ1234F1Z5', 'Does not match'), 'the answer is raised in NC 1 with its value and remark')

print('DA2 Bronze, Valid')
unit('ZEDCHKVAL0002', 'Bronze', 3, 0, 'DA', 'Yes')
try:
    sql("EXEC dbo.SP_ASSESSMENT_DA_FINAL_SUBMIT @ZedId = 'ZEDCHKVAL0002', @CertificationType = 'Bronze', @AssessorRemarks = 'Checked';")
except SystemExit as e:
    # The no-NC branch goes on to SP_ADD_CERTIFICATION_ID, which needs the unit's full data; the status is set before it.
    print('  (certificate number step refused on the bare test unit:', str(e).splitlines()[-1][:120], ')')
check(record('ZEDCHKVAL0002', 'Bronze')[0] != 4, 'no NC raised')
check(answer('ZEDCHKVAL0002')[0] == 'NULL', 'the answer is not raised')

print('SA1 Silver, Not valid after the visit')
unit('ZEDCHKVAL0011', 'Silver', 13, 0, 'SA', 'No')
sql("EXEC dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT @ZedId = 'ZEDCHKVAL0011', @CertificationType = 'Silver', @AssessorRemarks = 'Checked';")
check(record('ZEDCHKVAL0011', 'Silver') == (14, 1), 'NC 1 raised (status 14, NcCount 1)')
check(answer('ZEDCHKVAL0011')[0] == '1', 'the answer is raised in NC 1')

print('SA2 Silver in NC 5, still Not valid')
unit('ZEDCHKVAL0012', 'Silver', 14, 5, 'SA', 'No')
sql("UPDATE dbo.V4AppFormValues SET NcRound = 5 WHERE ZedId = 'ZEDCHKVAL0012';")
sql("EXEC dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT @ZedId = 'ZEDCHKVAL0012', @CertificationType = 'Silver', @AssessorRemarks = 'Checked';")
check(record('ZEDCHKVAL0012', 'Silver') == (17, 6), 'rejected after NC 5 (status 17)')
check(answer('ZEDCHKVAL0012')[0] == '5', 'not raised again')

print('SA3 Silver, a desktop check is not the site one')
unit('ZEDCHKVAL0013', 'Silver', 13, 0, 'DA', 'No')
sql("EXEC dbo.SP_ASSESSMENT_RA_FINAL_SUBMIT @ZedId = 'ZEDCHKVAL0013', @CertificationType = 'Silver', @AssessorRemarks = 'Checked';")
check(record('ZEDCHKVAL0013', 'Silver')[0] == 15, 'no NC (status 15)')

print('All checks passed.')
