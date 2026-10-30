"""Bronze / Silver / Gold surveillance on the V4 schedule (migrations 0037 / 0038), day by day on the local throwaway
databases (ZEDV4CHK_*), with the legacy timings that 0037 gives them.

    1. build as for zedx_surveillance_check.py (setup.ps1 -DatabasePrefix ZEDV4CHK_ -WithKawachStandIn,
       Invoke-ZedDatabaseScripts.ps1 -DatabasePrefix ZEDV4CHK_ -Apply -ApplyFixes 'main/14_zedx_levels','surveillance/08_zedx_levels',
       then database\\seed\\dev-zedx-e2e.sql)
    2. python -I backend/tools/level_surveillance_bsg_check.py

Certified units are made directly in the tables; SP_V4_LEVEL_SURVEILLANCE_SCHEDULE runs for chosen days (@Today) and
the dates are those of the legacy jobs (Bronze: notice at 14 months, reminder at 15, applied by the portal at 16, never
suspended; Silver / Gold: notice at 11, reminders at 12 and 13, suspension at 16, withdrawal 64 days later with
re-certification enabled; second round at 23, 24 and 25 months once the first is certified, never suspended). The schedule
starts on its first run: steps due before it are not caught up (listed by the dry run). Stops at the first surprise.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zedx_check import MAIN, rows, sql

SURV = MAIN.replace('ZEDCS_V2_LIVE', 'ZED_SURVEILLANCE')
assert MAIN.startswith('ZEDV4CHK_') and SURV.startswith('ZEDV4CHK_'), 'throwaway databases only'
SOURCE = 'ZEDMSME990001'  # the seed's unit, copied for each case
START = '2026-06-01'      # the schedule's first run
UNITS = {
    'BA': 'ZEDMSME991001',  # Bronze, never applies: notice, reminder, applied by the portal
    'BB': 'ZEDMSME991002',  # Bronze, since certified Silver: left alone
    'BC': 'ZEDMSME991003',  # Bronze whose notice was due before the start: not caught up
    'SA': 'ZEDMSME991011',  # Silver, never applies: notice, reminders, suspension, withdrawal
    'SB': 'ZEDMSME991012',  # Silver, pays and is certified: second round, no suspension in it
    'SC': 'ZEDMSME991013',  # Silver whose legacy second-round notice was sent (mail 4): the reminder continues it
    'SD': 'ZEDMSME991014',  # Silver with RestrictMail: left alone
    'GA': 'ZEDMSME991021',  # Gold: notice at 11 months
}


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond:
        sys.exit(1)


def run(day, level=None):
    lv = f", @Level = '{level}'" if level else ''
    sql(f"EXEC dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE @Today = '{day}'{lv};")


def dry(day):
    return rows(f"EXEC dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE @Today = '{day}', @DryRun = 1;")


def cert(zed, level):
    r = rows(f"SELECT TOP 1 CertificationPhase AS Phase, EnableSurveillance1 AS Round, AutoMailSend AS Mail, "
             f"CONVERT(varchar(10), FirstSurveDueDate, 120) AS Due1, CONVERT(varchar(10), SecondSurveDueDate, 120) AS Due2 "
             f"FROM dbo.MsmeCertifications WHERE ZedId = '{zed}' AND Certification = '{level}' ORDER BY Id DESC;")
    return r[0] if r else {}


def mails(zed):
    return [(m['MailType'], m['SurveillanceNo']) for m in
            rows(f"SELECT MailType, SurveillanceNo FROM dbo.SurveillanceAutoMailHistory WHERE ZedId = '{zed}' ORDER BY Id;")]


def setup():
    print('setup')
    sql("UPDATE dbo.SectionTypes SET SurveillanceScheduleFrom = '9999-12-31' WHERE SectionType IN ('Bronze', 'Silver', 'Gold');")
    for zed in UNITS.values():
        ids = f"'{zed}'"
        for db in (MAIN, SURV):
            sql(f"DELETE FROM dbo.MsmeCertifications WHERE ZedId LIKE '{zed}%'; DELETE FROM dbo.MsmePaymentInfo WHERE ZedId LIKE '{zed}%';"
                f"DELETE FROM dbo.MsmeHistory WHERE ZedId LIKE '{zed}%';"
                f"DELETE FROM dbo.MsmeBasicInformation WHERE ZedId = {ids}; DELETE FROM dbo.Msme WHERE ZedId = {ids};", db)
        sql(f"DELETE FROM dbo.SurveillanceAutoMailHistory WHERE ZedId = {ids};")
        for table in ('Msme', 'MsmeBasicInformation'):
            cols = rows(f"SELECT STRING_AGG(QUOTENAME(name), ',') AS C FROM sys.columns WHERE object_id = OBJECT_ID('dbo.{table}') "
                        f"AND is_identity = 0 AND is_computed = 0 AND name <> 'ZedId';")[0]['C']
            sql(f"INSERT INTO dbo.{table} (ZedId, {cols}) SELECT {ids}, {cols} FROM dbo.{table} WHERE ZedId = '{SOURCE}';")
        sql(f"UPDATE dbo.Msme SET IsSurBronzePaymentDone = NULL, IsSurSilverPaymentDone = NULL, IsSurGoldPaymentDone = NULL WHERE ZedId = {ids};"
            f"UPDATE dbo.MsmeBasicInformation SET ReCertification = NULL, IsEligibleForBenefits = 1 WHERE ZedId = {ids};")


def certify(key, level, day, **extra):
    zed = UNITS[key]
    desk = level == 'Bronze'
    cols = {'ZedId': zed, 'Certification': level, 'CertificationStatus': 6 if desk else 16, 'CertificationStatusDate': day,
            'DaCertificateNo' if desk else 'SaCertificateNo': f'{level[0]}/2025/{zed[-6:]}', 'CertificationPhase': 'ACTIVE'}
    cols.update(extra)
    names = ', '.join(cols)
    values = ', '.join('NULL' if v is None else str(v) if isinstance(v, int) else f"'{v}'" for v in cols.values())
    sql(f"INSERT INTO dbo.MsmeCertifications ({names}) VALUES ({values});")
    return zed


def main():
    setup()
    print('units')
    ba = certify('BA', 'Bronze', '2025-06-10', FirstSurveDueDate='2026-09-03')
    bb = certify('BB', 'Bronze', '2025-06-10')
    certify('BB', 'Silver', '2025-09-01')
    bc = certify('BC', 'Bronze', '2025-01-10')
    sa = certify('SA', 'Silver', '2025-08-10')
    sb = certify('SB', 'Silver', '2025-08-10', FirstSurveDueDate='2026-08-10')
    sc = certify('SC', 'Silver', '2024-08-10', EnableSurveillance1=2, AutoMailSend=4)
    sql(f"UPDATE dbo.Msme SET IsSurSilverPaymentDone = NULL WHERE ZedId = '{sc}';")
    sd = certify('SD', 'Silver', '2025-08-10', RestrictMail=1)
    ga = certify('GA', 'Gold', '2025-08-10')

    print('dry run before the first run (nothing changes)')
    plan = dry(START)
    check(any(p['ZedId'] == bc and p['Step'] == 'Notice' and p['Note'] for p in plan), f'BC: notice due 2026-03-10 listed as before the start')
    check(not any(p['ZedId'] in (bb, sd) for p in plan), 'BB (since Silver) and SD (RestrictMail) not in the plan')
    check(cert(bc, 'Bronze').get('Round') in (None, '0'), 'nothing written by the dry run')
    check(rows("SELECT CONVERT(varchar(10), SurveillanceScheduleFrom, 120) AS F FROM dbo.SectionTypes WHERE SectionType = 'Bronze';")[0]['F'] == '9999-12-31',
          'the start is not set by a dry run')

    print('first run')
    run(START)
    check(rows("SELECT CONVERT(varchar(10), SurveillanceScheduleFrom, 120) AS F FROM dbo.SectionTypes WHERE SectionType = 'Silver';")[0]['F'] == START,
          'the start is the first run')
    check(cert(bc, 'Bronze').get('Round') in (None, '0'), 'BC: no catching up (its notice was due before the start)')
    check(cert(sc, 'Silver')['Mail'] == '4', 'SC: the legacy second-round notice stays as it was')

    print('Bronze BA (certified 2025-06-10)')
    run('2026-08-09', 'Bronze')
    check(cert(ba, 'Bronze').get('Round') in (None, '0'), 'no notice a day before 14 months')
    run('2026-08-10', 'Bronze')
    c = cert(ba, 'Bronze')
    check((c['Round'], c['Mail'], c['Due1']) == ('1', '1', '2026-09-03'), f'notice at 14 months, its due date kept: {c}')
    s = rows(f"SELECT M.InsertedFor AS F, CONVERT(varchar(10), B.ZedCertifiedDate, 120) AS D FROM dbo.Msme M "
             f"JOIN dbo.MsmeBasicInformation B ON B.ZedId = M.ZedId WHERE M.ZedId = '{ba}';", SURV)
    check(s and (s[0]['F'], s[0]['D']) == ('Bronze', '2025-06-10'), f'copied as the legacy Bronze job: {s}')
    run('2026-09-10', 'Bronze')
    check(cert(ba, 'Bronze')['Mail'] == '2', 'reminder at 15 months')
    run('2026-10-10', 'Bronze')
    check(cert(ba, 'Bronze')['Mail'] == '3', 'applied by the portal at 16 months')
    check(mails(ba)[-1] == ('Auto-Applied', '1'), f'history {mails(ba)}')
    applied = rows(f"SELECT COUNT(*) AS N FROM dbo.MsmeCertifications WHERE ZedId = '{ba}' AND Certification = 'Bronze';", SURV)[0]['N']
    check(applied == '1', 'its surveillance record made (SP_APPLY_BRONZE_SURVEILLANCE_FROM_BACKEND)')
    run('2026-12-10', 'Bronze')
    check(cert(ba, 'Bronze')['Phase'] == 'ACTIVE', 'Bronze is never suspended')
    check(cert(bb, 'Bronze').get('Round') in (None, '0'), 'BB (since certified Silver): left alone')

    print('Gold GA (certified 2025-08-10)')
    run('2026-07-10', 'Gold')
    check((cert(ga, 'Gold')['Round'], cert(ga, 'Gold')['Mail']) == ('1', '1'), 'notice at 11 months')

    print('Silver SA never applies, SB pays, SC has its legacy second-round notice (in date order)')
    run('2026-07-10', 'Silver')
    check((cert(sa, 'Silver')['Round'], cert(sa, 'Silver')['Mail']) == ('1', '1'), 'SA: notice at 11 months')
    check((cert(sb, 'Silver')['Round'], cert(sb, 'Silver')['Due1']) == ('1', '2026-08-10'), 'SB: notice, its due date kept')
    sql(f"UPDATE dbo.Msme SET IsSurSilverPaymentDone = 1 WHERE ZedId = '{sb}';")
    sql(f"INSERT INTO dbo.MsmeCertifications (ZedId, Certification, CertificationStatus) VALUES ('{sb}', 'Silver', 1);", SURV)
    run('2026-08-10', 'Silver')
    check(cert(sa, 'Silver')['Mail'] == '2', 'SA: reminder 1 at 12 months')
    check(cert(sb, 'Silver')['Mail'] == '1', 'SB: paid, no reminder')
    check(cert(sc, 'Silver')['Mail'] == '12', 'SC: reminder 1 of round 2 at 24 months (legacy mail 4 = the round 2 notice)')
    run('2026-09-10', 'Silver')
    check(cert(sa, 'Silver')['Mail'] == '3', 'SA: reminder 2 at 13 months')
    run('2026-12-09', 'Silver')
    check(cert(sa, 'Silver')['Phase'] == 'ACTIVE', 'SA: active a day before 16 months')
    run('2026-12-10', 'Silver')
    check(cert(sa, 'Silver')['Phase'] == 'SUSPENDED', 'SA: suspended at 16 months')
    check(cert(sb, 'Silver')['Phase'] == 'ACTIVE', 'SB: paid, not suspended')
    check(cert(sc, 'Silver')['Phase'] == 'ACTIVE', 'SC: no suspension in the second round at 28 months (as legacy)')
    run('2027-02-11', 'Silver')
    check(cert(sa, 'Silver')['Phase'] == 'SUSPENDED', 'SA: still suspended 63 days later')
    run('2027-02-12', 'Silver')
    check(cert(sa, 'Silver')['Phase'] == 'WITHDRAWN', 'SA: withdrawn 64 days after the suspension')
    check(mails(sa)[-1] == ('WITHDRAWN', '1'), f'SA: legacy mail type: {mails(sa)}')
    r = rows(f"SELECT CAST(ReCertification AS int) AS R, ReCertificationLevel AS L FROM dbo.MsmeBasicInformation WHERE ZedId = '{sa}';")[0]
    check((r['R'], r['L']) == ('1', 'Silver'), f'SA: re-certification enabled, as the legacy withdrawal: {r}')
    check(cert(sd, 'Silver').get('Round') in (None, '0'), 'SD (RestrictMail): left alone')
    run('2027-07-10', 'Silver')
    check(cert(sb, 'Silver')['Round'] == '1', 'SB: round 2 waits until round 1 is certified')
    sql(f"UPDATE dbo.MsmeCertifications SET CertificationStatus = 16, CertificationStatusDate = '2027-01-15' "
        f"WHERE ZedId = '{sb}' AND Certification = 'Silver';", SURV)
    run('2027-07-10', 'Silver')
    c = cert(sb, 'Silver')
    check((c['Round'], c['Mail'], c['Due1'], c['Due2']) == ('2', '11', '2026-08-10', '2027-11-10'),
          f'SB: round 2 notice at 23 months; the first due date kept, the second set: {c}')
    run('2027-08-10', 'Silver')
    run('2027-09-10', 'Silver')
    check(cert(sb, 'Silver')['Mail'] == '13', 'SB: reminders at 24 and 25 months')
    run('2027-12-10', 'Silver')
    check(cert(sb, 'Silver')['Phase'] == 'ACTIVE', 'SB: no suspension in the second round (as legacy)')
    print('all checks passed')


if __name__ == '__main__':
    main()
