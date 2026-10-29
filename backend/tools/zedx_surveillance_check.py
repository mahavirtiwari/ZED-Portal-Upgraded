"""ZED-X surveillance on the local throwaway databases (ZEDV4CHK_*): migrations 0032 / 0033 run day by day.

    1. build as for zedx_e2e.py (database\\setup.ps1 -DatabasePrefix ZEDV4CHK_ -WithKawachStandIn, then
       deploy\\Invoke-ZedDatabaseScripts.ps1 -DatabasePrefix ZEDV4CHK_ -Apply
       -ApplyFixes 'main/14_zedx_levels','surveillance/08_zedx_levels', then database\\seed\\dev-zedx-e2e.sql)
    2. python -I backend/tools/zedx_surveillance_check.py

Certified ZED-X units are made directly in the tables (the assessment itself is zedx_e2e.py's), then
SP_V4_LEVEL_SURVEILLANCE_SCHEDULE runs for chosen days (@Today): notice, reminders, suspension, withdrawal, a paid round
(SP_V4_SURVEILLANCE_PAID: flags and the NIC sector-wise questionnaire), the second round, a third round (archived when it
opens) and expiry. Stops at the first surprise. No API is needed.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zedx_check import MAIN, rows, sql

SURV = MAIN.replace('ZEDCS_V2_LIVE', 'ZED_SURVEILLANCE')
assert MAIN.startswith('ZEDV4CHK_') and SURV.startswith('ZEDV4CHK_'), 'throwaway databases only'
SOURCE = 'ZEDMSME990001'  # the seed's unit, copied for each case
UNITS = {'A': 'ZEDMSME990011', 'B': 'ZEDMSME990012', 'C': 'ZEDMSME990013', 'D': 'ZEDMSME990014'}


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond:
        sys.exit(1)


def run(day):
    sql(f"EXEC dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE @Today = '{day}', @Level = 'ZEDX';")


def cert(zed, db=MAIN):
    r = rows(f"SELECT TOP 1 ZedId, CertificationPhase AS Phase, EnableSurveillance1 AS Round, AutoMailSend AS Mail, "
             f"CONVERT(varchar(10), FirstSurveDueDate, 120) AS Due1, CONVERT(varchar(10), SecondSurveDueDate, 120) AS Due2 "
             f"FROM dbo.MsmeCertifications WHERE ZedId = '{zed}' AND Certification = 'ZEDX' ORDER BY Id DESC;", db)
    return r[0] if r else {}


def mails(zed):
    return [(m['MailType'], m['SurveillanceNo']) for m in
            rows(f"SELECT MailType, SurveillanceNo FROM dbo.SurveillanceAutoMailHistory WHERE ZedId = '{zed}' ORDER BY Id;")]


def main_paid(zed):
    return rows(f"SELECT ISNULL(CAST(IsSurZEDXPaymentDone AS int), 0) AS P FROM dbo.Msme WHERE ZedId = '{zed}';")[0]['P'] == '1'


def setup():
    print('setup')
    sql("UPDATE dbo.SectionTypes SET IsEnabled = 1, SurveillanceEnabled = 1, ValidityMonths = 36, FirstSurveillanceMonths = 15, "
        "SurveillanceCount = 2, SurveillanceIntervalMonths = 12, SurveillanceNoticeMonths = 4, SurveillanceReminders = 2, "
        "SurveillanceReminderEveryMonths = 1, SurveillanceSuspendAfterMonths = 1, SurveillanceWithdrawAfterDays = 64 WHERE SectionType = 'ZEDX';")
    for zed in UNITS.values():
        ids = f"'{zed}'"
        for db in (MAIN, SURV):
            sql(f"DELETE FROM dbo.MsmeCertifications WHERE ZedId LIKE '{zed}%'; DELETE FROM dbo.MsmePaymentInfo WHERE ZedId LIKE '{zed}%';"
                f"DELETE FROM dbo.MsmeSections WHERE ZedId LIKE '{zed}%'; DELETE FROM dbo.MsmeHistory WHERE ZedId LIKE '{zed}%';"
                f"DELETE FROM dbo.MsmeBasicInformation WHERE ZedId = {ids}; DELETE FROM dbo.Msme WHERE ZedId = {ids};", db)
        sql(f"DELETE FROM dbo.SurveillanceAutoMailHistory WHERE ZedId = {ids};")
        # The unit: a copy of the seed's (NIC 24), all columns but the identity.
        for table in ('Msme', 'MsmeBasicInformation'):
            cols = rows(f"SELECT STRING_AGG(QUOTENAME(name), ',') AS C FROM sys.columns WHERE object_id = OBJECT_ID('dbo.{table}') "
                        f"AND is_identity = 0 AND is_computed = 0 AND name <> 'ZedId';")[0]['C']
            sql(f"INSERT INTO dbo.{table} (ZedId, {cols}) SELECT {ids}, {cols} FROM dbo.{table} WHERE ZedId = '{SOURCE}';")


def certify(key, day):
    """The unit's ZED-X certificate. Each case certifies its unit when it starts: the schedule runs for every unit, so a
    unit certified earlier would be moved on by the earlier cases' days."""
    zed = UNITS[key]
    sql(f"INSERT INTO dbo.MsmeCertifications (ZedId, Certification, CertificationStatus, CertificationStatusDate, SaCertificateNo, "
        f"CertificationPhase, QrCodeSeqNo) VALUES ('{zed}', 'ZEDX', 16, '{day}', 'ZEDX/M/2026/{zed[-6:]}', 'ACTIVE', 'P995X{key}');")
    return zed


def pay(zed):
    """What the surveillance payment procedure leaves (the payment, a new surveillance record, the level's whole
    questionnaire copied), then what the portal runs after it."""
    sql(f"INSERT INTO dbo.MsmePaymentInfo (ZedId, Certification, Total, CreatedDate) VALUES ('{zed}', 'ZEDX', 29500, GETDATE());"
        f"INSERT INTO dbo.MsmeCertifications (ZedId, Certification, CertificationStatus) VALUES ('{zed}', 'ZEDX', 1);"
        f"INSERT INTO dbo.MsmeSections (ZedId, SectionCode, SectionName, SectionType) VALUES "
        f"('{zed}', '1', 'Export Readiness', 'ZEDX'), ('{zed}', '2', 'IT Services', 'ZEDX');", SURV)
    sql(f"EXEC dbo.SP_V4_SURVEILLANCE_PAID @ZedId = '{zed}', @Certification = 'ZEDX';", SURV)


def case_a_not_applied():
    zed = certify('A', '2026-01-10')
    print(f'A {zed}: certified 2026-01-10, never applies (due 2027-04-10)')
    run('2026-12-09')
    check(cert(zed).get('Round') in (None, '0'), 'nothing a day before the notice (due - 4 months)')
    run('2026-12-10')
    c = cert(zed)
    check((c['Round'], c['Mail'], c['Due1']) == ('1', '1', '2027-04-10'), f'notice of surveillance 1: {c}')
    check(rows(f"SELECT COUNT(*) AS N FROM dbo.Msme WHERE ZedId = '{zed}';", SURV)[0]['N'] == '1', 'the unit is copied to ZED_SURVEILLANCE')
    run('2026-12-20')
    check(cert(zed)['Mail'] == '1', 'no reminder before a month')
    run('2027-01-10')
    check(cert(zed)['Mail'] == '2', 'reminder 1')
    run('2027-02-10')
    check(cert(zed)['Mail'] == '3', 'reminder 2')
    run('2027-03-10')
    check(cert(zed)['Mail'] == '3', 'no third reminder')
    run('2027-05-09')
    check(cert(zed)['Phase'] == 'ACTIVE', 'still active a day before suspension (due + 1 month)')
    run('2027-05-10')
    check(cert(zed)['Phase'] == 'SUSPENDED', 'suspended')
    run('2027-07-12')
    check(cert(zed)['Phase'] == 'SUSPENDED', 'still suspended 63 days later')
    run('2027-07-13')
    check(cert(zed)['Phase'] == 'WITHDRAWN', 'withdrawn 64 days after the suspension')
    run('2027-12-10')
    check(mails(zed) == [('APPLY', '1'), ('REMINDER', '1'), ('REMINDER', '1'), ('SUSPENSION', '1'), ('WITHDRAWAL', '1')],
          f'mails {mails(zed)}; nothing after the withdrawal')


def case_b_two_rounds():
    zed = certify('B', '2026-01-10')
    print(f'B {zed}: pays surveillance 1, then surveillance 2 opens (due 2028-04-10)')
    run('2026-12-10')
    pay(zed)
    check(main_paid(zed), "main's IsSurZEDXPaymentDone set")
    check(rows(f"SELECT CAST(IsZEDXPaymentDone AS int) AS P FROM dbo.Msme WHERE ZedId = '{zed}';", SURV)[0]['P'] == '1',
          "ZED_SURVEILLANCE's IsZEDXPaymentDone set")
    sections = [r['SectionCode'] for r in rows(f"SELECT SectionCode FROM dbo.MsmeSections WHERE ZedId = '{zed}' ORDER BY SectionCode;", SURV)]
    check(sections == ['1'], f'NIC 24 unit keeps section 1 only (section 2 is for NIC 62): {sections}')
    check(rows(f"SELECT TOP 1 MinimumParameters AS M FROM dbo.MsmeCertifications WHERE ZedId = '{zed}' ORDER BY Id DESC;", SURV)[0]['M'] == '1',
          'minimum parameters = the parameters the unit has')
    run('2027-01-10')
    run('2027-05-10')
    check((cert(zed)['Mail'], cert(zed)['Phase']) == ('1', 'ACTIVE'), 'applied: no reminder, no suspension')
    run('2027-12-09')
    check(cert(zed)['Round'] == '1', 'surveillance 2 not yet (its notice is at 23 months)')
    run('2027-12-10')
    c = cert(zed)
    check((c['Round'], c['Mail'], c['Due2']) == ('2', '11', '2028-04-10'), f'notice of surveillance 2: {c}')
    check(not main_paid(zed), "main's payment flag cleared for the new round")
    s = rows(f"SELECT CAST(M.IsZEDXPaymentDone AS int) AS P, B.ReSurveillance AS R, B.ReSurveillanceLevel AS L FROM dbo.Msme M "
             f"JOIN dbo.MsmeBasicInformation B ON B.ZedId = M.ZedId WHERE M.ZedId = '{zed}';", SURV)[0]
    check((s['P'], s['R'], s['L']) == (None, '1', 'ZEDX'), f'surveillance database flags as the legacy second-surveillance job: {s}')
    run('2028-01-10')
    check(cert(zed)['Mail'] == '12', 'reminder 1 of surveillance 2')
    run('2028-02-10')
    check(cert(zed)['Mail'] == '13', 'reminder 2 of surveillance 2')
    run('2028-05-10')
    check(cert(zed)['Phase'] == 'SUSPENDED', 'suspended when surveillance 2 is not applied for')
    check(mails(zed)[-1] == ('SUSPENSION', '2'), f'mails {mails(zed)}')


def case_c_three_rounds():
    zed = certify('C', '2026-01-10')
    print(f'C {zed}: the Admin sets 3 surveillances, 10 months apart (due 15, 25, 35 months)')
    sql("UPDATE dbo.SectionTypes SET SurveillanceCount = 3, SurveillanceIntervalMonths = 10 WHERE SectionType = 'ZEDX';")
    try:
        run('2026-12-10')
        pay(zed)
        sql(f"UPDATE dbo.MsmeCertifications SET CertificationStatus = 16 WHERE ZedId = '{zed}' AND Certification = 'ZEDX';", SURV)
        run('2027-10-10')
        check(cert(zed)['Round'] == '2', 'surveillance 2 opens at 25 - 4 = 21 months')
        pay(zed)   # the gateway procedure would also archive round 1 here (main EnableSurveillance1 = 2)
        run('2028-08-10')
        c = cert(zed)
        check((c['Round'], c['Mail']) == ('3', '21'), f'surveillance 3 opens at 35 - 4 = 31 months: {c}')
        archived = rows(f"SELECT COUNT(*) AS N FROM dbo.MsmeCertifications WHERE ZedId LIKE '{zed}[_]S[_]%';", SURV)[0]['N']
        current = rows(f"SELECT COUNT(*) AS N FROM dbo.MsmeCertifications WHERE ZedId = '{zed}';", SURV)[0]['N']
        check(archived != '0' and current == '0', f'earlier rounds archived ({archived}), none current until paid')
        check(rows(f"SELECT ReSurveillance AS R FROM dbo.MsmeBasicInformation WHERE ZedId = '{zed}';", SURV)[0]['R'] == '2',
              'ReSurveillance = 2 (a later surveillance)')
    finally:
        sql("UPDATE dbo.SectionTypes SET SurveillanceCount = 2, SurveillanceIntervalMonths = 12 WHERE SectionType = 'ZEDX';")


def case_d_expiry():
    zed = certify('D', '2023-01-05')
    print(f'D {zed}: certified 2023-01-05, valid 36 months')
    run('2026-01-04')
    check(cert(zed)['Phase'] != 'EXPIRED', 'not expired a day early')
    run('2026-01-05')
    check(cert(zed)['Phase'] == 'EXPIRED', 'expired after the validity')
    check(rows(f"SELECT COUNT(*) AS N FROM dbo.MsmeHistory WHERE ZedId = '{zed}' AND StatusType = 'Expired';")[0]['N'] == '1', 'history')


def bronze_untouched():
    before = rows("SELECT COUNT(*) AS N FROM dbo.MsmeCertifications WHERE Certification IN ('Bronze', 'Silver', 'Gold') AND (EnableSurveillance1 IS NOT NULL OR CertificationPhase IN ('SUSPENDED', 'WITHDRAWN', 'EXPIRED'));")[0]['N']
    run('2029-01-01')
    after = rows("SELECT COUNT(*) AS N FROM dbo.MsmeCertifications WHERE Certification IN ('Bronze', 'Silver', 'Gold') AND (EnableSurveillance1 IS NOT NULL OR CertificationPhase IN ('SUSPENDED', 'WITHDRAWN', 'EXPIRED'));")[0]['N']
    check(before == after, 'Bronze / Silver / Gold untouched')


if __name__ == '__main__':
    setup()
    case_a_not_applied()
    case_b_two_rounds()
    case_c_three_rounds()
    case_d_expiry()
    bronze_untouched()
    print('all checks passed')
