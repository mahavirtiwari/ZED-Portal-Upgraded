"""ZED-X surveillance end to end on the local throwaway databases (ZEDV4CHK_*), through the portals' own endpoints.

    1. as zedx_e2e.py, up to its last step (the unit ZEDMSME990001 certified for ZED-X)
    2. also run Zed.Surveillance.Api on http://localhost:5198 against the same databases (ConnectionStrings__Main and
       __Surveillance, Database__Prefix=ZEDV4CHK_, the same Portal__StorageRoot as main)
    3. python -I backend/tools/zedx_surveillance_e2e.py [first step] [last step]

open      the daily schedule (SP_V4_LEVEL_SURVEILLANCE_SCHEDULE, run for the notice day) opens surveillance 1; the
          dashboard shows SURVEILLANCE and the payment page accepts ZED-X
fees      Gold's surveillance fee rows as on production (local copies have none), then migration 0033's copy to ZEDX
pay       the unit pays on main through the gateway; the gateway's reply is built here (local dummy working key of
          appsettings.Development.json, never CCAvenue) and posted to the portal's callback
users     the agency and the assessors in ZED_SURVEILLANCE's Users (copied from main's seed)
allot     the agency allots the lead / co assessor and the meeting link on the surveillance portal
assess    the lead assessor works the remote page: open meeting, every requirement, final submit
certify   the agency certifies on the surveillance portal; the surveillance certificate (round 1) and its download on main
"""
import json
import os
import subprocess
import sys
from datetime import date

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import base64
import io

from PIL import Image

from zedx_check import MAIN, ZED, Client, msme, png, rows, sql, staff

SURV = MAIN.replace('ZEDCS_V2_LIVE', 'ZED_SURVEILLANCE')
SURV_BASE = os.environ.get('ZEDX_SURV_URL', 'http://localhost:5198')
assert 'localhost' in SURV_BASE and MAIN.startswith('ZEDV4CHK_'), 'local check only'
LEVEL = 'ZEDX'
WORKING_KEY = 'LOCAL0DEV0KEY0NOT0A0SECRET000000'   # Zed.Main.Api appsettings.Development.json: a dummy, local only
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond:
        print('  main:', main_cert())
        print('  surveillance:', surv_cert())
        raise SystemExit(1)


def ok(result, what):
    status, body = result
    check(status == 200, f'{what}: {status} {json.dumps(body)[:300] if not isinstance(body, str) else body[:300]}')
    return body


def main_cert():
    r = rows(f"SELECT CertificationStatus, CertificationPhase, EnableSurveillance1, AutoMailSend, CONVERT(varchar(10), CertificationStatusDate, 120) AS Certified, "
             f"CONVERT(varchar(10), FirstSurveDueDate, 120) AS Due1 FROM dbo.MsmeCertifications WHERE ZedId='{ZED}' AND Certification='{LEVEL}'")
    return r[0] if r else None


def surv_cert():
    r = rows(f"SELECT TOP 1 Id, CertificationStatus, CertificationBodyUserId, SiteAssessorId, CoAssessorId, MinimumParameters, NcCount, SaCertificateNo, "
             f"QrCodeSeqNo, ModeOfAssessment FROM dbo.MsmeCertifications WHERE ZedId='{ZED}' AND Certification='{LEVEL}' ORDER BY Id DESC", SURV)
    return r[0] if r else None


def surv_staff(user):
    return staff(user, SURV_BASE)


def encrypt(plain):
    """CcAvenueCrypto.Encrypt: AES-128-CBC, key MD5(working key), IV 00..0F, lower-case hex (with .NET: no Python AES here)."""
    script = ("$k=[Security.Cryptography.MD5]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes($env:K));"
              "$a=[Security.Cryptography.Aes]::Create();$a.Key=$k;$a.IV=[byte[]](0..15);"
              "$b=[Text.Encoding]::UTF8.GetBytes($env:P);$e=$a.CreateEncryptor().TransformFinalBlock($b,0,$b.Length);"
              "-join ($e | ForEach-Object { $_.ToString('x2') })")
    r = subprocess.run(['powershell', '-NoProfile', '-Command', script], capture_output=True, text=True, env={**os.environ, 'K': WORKING_KEY, 'P': plain})
    assert r.returncode == 0, r.stderr
    return r.stdout.strip()


def step_open():
    c = main_cert()
    check(c and c['CertificationStatus'] == '16', f'ZED-X certified on main: {c}')
    notice = rows(f"SELECT CONVERT(varchar(10), DATEADD(MONTH, -4, FirstSurveDueDate), 120) AS D FROM dbo.MsmeCertifications WHERE ZedId='{ZED}' AND Certification='{LEVEL}'")[0]['D']
    sql(f"EXEC dbo.SP_V4_LEVEL_SURVEILLANCE_SCHEDULE @Today = '{notice}', @Level = '{LEVEL}';")
    c = main_cert()
    check((c['EnableSurveillance1'], c['AutoMailSend']) == ('1', '1'), f'surveillance 1 opened on the notice day {notice}: {c}')
    check(rows(f"SELECT COUNT(*) AS N FROM dbo.Msme WHERE ZedId='{ZED}'", SURV)[0]['N'] == '1', 'unit copied to ZED_SURVEILLANCE')
    m = msme()
    dash = ok(m.get('/api/msme/dashboard'), 'dashboard')['msme']
    check((dash.get('ZEDXDashboardSurStatus'), dash.get('IsSurZEDXPaymentDone')) == (1, 0), f'SURVEILLANCE box, not paid: {dash.get("ZEDXDashboardSurStatus")}')
    st = ok(m.get(f'/api/msme/surveillance-payments/{LEVEL}/status'), 'surveillance payment page')
    check(st['eligible'] is True, f'eligible: {st}')


def step_fees():
    # As production's Gold surveillance fee (Rs. 25,000 + GST), then 0033's copy block, run as the migration does.
    sql("DELETE FROM dbo.AssessmentFee WHERE Certification IN ('Gold', 'ZEDX');"
        "INSERT dbo.AssessmentFee (EnterpriseTypee, Certification, AssessmentFee, Gst, Total, Coupon, AssessmentFeeAfterCoupon, GstAfterCoupon, "
        "TotalAfterCoupon, SubsidyPer, SubsidyAmount, GstAfterSubsidy, ApplicantContributionAfterSubsidy, Tds15, Tds75, NetPaybleTds15, NetPaybleTds75, "
        "IsActive, SpecialCategory, SubsidyPercentage) VALUES "
        # Per category one row without and one with the joining-reward coupon (SP_MSME_GET_PAYMENT_DETAILS reads both).
        "('Micro', 'Gold', 25000, 4500, 29500, NULL, 25000, 4500, 29500, 80, 20000, 900, 5900, 75, 375, 5825, 5525, 1, 0, 80),"
        "('Micro', 'Gold', 25000, 4500, 29500, 2000, 23000, 4140, 27140, 80, 18400, 828, 5428, 69, 345, 5359, 5083, 1, 0, 80),"
        "('Micro', 'Gold', 25000, 4500, 29500, NULL, 25000, 4500, 29500, 80, 20000, 900, 5900, 75, 375, 5825, 5525, 1, 1, 80),"
        "('Micro', 'Gold', 25000, 4500, 29500, 2000, 23000, 4140, 27140, 80, 18400, 828, 5428, 69, 345, 5359, 5083, 1, 1, 80);", SURV)
    migration = open(os.path.join(ROOT, 'database', 'migrations', '0033_level_surveillance.sql'), encoding='utf-8').read()
    start = migration.index("IF OBJECT_ID('dbo.AssessmentFee', 'U') IS NOT NULL")
    block = migration[start:migration.index('\nGO', start)]
    sql(block, SURV)
    fees = rows("SELECT Certification, AssessmentFee, Total, ApplicantContributionAfterSubsidy AS Pay FROM dbo.AssessmentFee WHERE Certification='ZEDX'", SURV)
    check(len(fees) == 4 and fees[0]['AssessmentFee'].startswith('25000'), f"ZED-X surveillance fee as Gold's: {fees}")


def step_pay():
    m = msme()
    opt = ok(m.get(f'/api/msme/surveillance-payments/{LEVEL}/options'), 'fee summary')
    print('  fee:', {k: opt['withoutReward'].get(k) for k in ('Total', 'SubsidyLabel', 'ApplicantContributionAfterSubsidy')})
    out = ok(m.post(f'/api/msme/surveillance-payments/{LEVEL}/checkout', {'useReward': False, 'gstinApplicable': False, 'gstin': None,
                                                                           'tdsDeductible': False, 'tds': None, 'tan': None}), 'checkout')
    check(out.get('status') == 'gateway', f"to the gateway: {out.get('status')}")
    order = rows(f"SELECT TOP 1 TransactionId, Amount FROM dbo.PaymentGatewayTransactions WHERE ZedId='{ZED}' AND Certification='{LEVEL}' ORDER BY Id DESC", SURV)[0]
    print('  order:', order)
    reply = (f"order_id={order['TransactionId']}&tracking_id=112233445566&bank_ref_no=E2E1&order_status=Success&payment_mode=Net Banking&"
             f"amount={order['Amount']}&merchant_param1={ZED}&merchant_param2={LEVEL}&merchant_param3=Surveillance 1")
    gateway = Client()
    status, body = gateway.request('POST', '/api/payments/ccavenue/surveillance-response', f'encResp={encrypt(reply)}'.encode(),
                                   'application/x-www-form-urlencoded')
    print('  callback:', status, str(body)[:200])
    s = surv_cert()
    check(s is not None and s['CertificationStatus'] == '8', f'surveillance record at 8 (paid, with the agency): {s}')
    check(s['CertificationBodyUserId'] == 'AGENCYX', 'the certifying agency')
    sections = [r['SectionCode'] for r in rows(f"SELECT SectionCode FROM dbo.MsmeSections WHERE ZedId='{ZED}' AND SectionType='{LEVEL}'", SURV)]
    check(sections == ['1'], f"the unit's parameters marked for surveillance: {sections}")
    check(s['MinimumParameters'] == '1', f"minimum parameters set (SP_V4_SURVEILLANCE_PAID): {s['MinimumParameters']}")
    flags = (rows(f"SELECT CAST(IsZEDXPaymentDone AS int) AS P FROM dbo.Msme WHERE ZedId='{ZED}'", SURV)[0]['P'],
             rows(f"SELECT CAST(IsSurZEDXPaymentDone AS int) AS P FROM dbo.Msme WHERE ZedId='{ZED}'")[0]['P'])
    check(flags == ('1', '1'), f'payment flags (surveillance, main): {flags}')
    dash = ok(m.get('/api/msme/dashboard'), 'dashboard')['msme']
    check(dash.get('IsSurZEDXPaymentDone') == 1, 'dashboard: surveillance paid')
    details = ok(m.get('/api/msme/certifications/ZEDXSurveillance'), 'ZED-X surveillance details page')
    print('  details status:', {k: v for k, v in details['status'].items() if v})


def step_users():
    cols = rows(f"SELECT STRING_AGG(QUOTENAME(s.name), ',') AS C FROM sys.columns s JOIN {MAIN}.sys.columns m ON m.name = s.name "
                f"AND m.object_id = OBJECT_ID('{MAIN}.dbo.Users') WHERE s.object_id = OBJECT_ID('dbo.Users') AND s.is_identity = 0 AND s.is_computed = 0", SURV)[0]['C']
    sql(f"DELETE FROM dbo.Users WHERE UserId IN ('AGENCYX','SAX1','SAX2','MADMINX');"
        f"INSERT dbo.Users ({cols}) SELECT {cols} FROM {MAIN}.dbo.Users WHERE UserId IN ('AGENCYX','SAX1','SAX2','MADMINX');", SURV)
    for u in ('AGENCYX', 'SAX1'):
        surv_staff(u)
    print('  ok   agency and assessors sign in to the surveillance portal')


def step_allot():
    g = surv_staff('AGENCYX')
    lst = ok(g.get('/api/staff/site-assessment/allotments'), 'surveillance site allotment list')
    check(any(u['ZedId'] == ZED and u['Certification'] == LEVEL for u in lst['units']), 'the ZED-X unit is listed')
    ok(g.post('/api/staff/site-assessment/allotments', {'zedId': ZED, 'certification': LEVEL, 'siteAssessorId': 'SAX1', 'coAssessorId': 'SAX2',
                                                         'assessmentDate': date.today().isoformat(), 'modeOfAssessment': 'Onsite Assessment',
                                                         'meetingLink': 'https://meet.example.test/zedx-e2e'}), 'agency allots the assessors and the meeting')
    s = surv_cert()
    check((s['CertificationStatus'], s['SiteAssessorId'], s['CoAssessorId']) == ('9', 'SAX1', 'SAX2'), f'allotted (9): {s}')


def step_assess():
    a = surv_staff('SAX1')
    base = f'/api/staff/remote/{ZED}/{LEVEL}'
    view = ok(a.get(base), 'the remote page')
    check(view.get('usesMeetingLink') and view.get('meetingLink') == 'https://meet.example.test/zedx-e2e', 'held on the agency meeting link')
    jpg = io.BytesIO()
    Image.new('RGB', (640, 480), (90, 140, 200)).save(jpg, 'JPEG')
    frame = 'data:image/jpeg;base64,' + base64.b64encode(jpg.getvalue()).decode()   # the surveillance page takes JPEG frames
    for kind, target in (('openMeeting', 'OpenMeeting'), ('closeMeeting', 'CloseMeeting')):
        meeting = view[kind]['id']
        ok(a.post(f'{base}/meetings/{meeting}/comments', {'comments': f'{target} held on the meeting link'}), f'{target} comments')
        ok(a.post(f'{base}/meetings/{meeting}/participants', {'name': 'Owner', 'designation': 'Proprietor'}), f'{target} participant')
        if not view[kind]['photos']:   # one photo per meeting (a re-run keeps the first)
            ok(a.post(f'{base}/photos', {'target': target, 'targetId': meeting, 'name': f'{target}.jpg', 'image': frame}), f'{target} photo')
    if not view['selfies']:
        ok(a.post(f'{base}/photos', {'target': 'Selfie', 'name': 'selfie.jpg', 'image': frame}), 'selfie on site')
    ok(a.post(f"{base}/meetings/{view['closeMeeting']['id']}/recording-links", {'link': 'https://meet.example.test/recordings/zedx-e2e'}),
       'meeting recording link')
    for r in rows(f"SELECT Id, RequirementCode FROM dbo.MsmeRequirements WHERE ZedId='{ZED}' AND SectionType='{LEVEL}' AND NcCount=0", SURV):
        ok(a.post(f"{base}/requirements/{r['Id']}/conformance", {'conformance': 'Yes', 'remarks': 'Seen in the meeting'}),
           f"requirement {r['RequirementCode']} conforms")
    for s_ in rows(f"SELECT Id FROM dbo.MsmeSections WHERE ZedId='{ZED}' AND SectionType='{LEVEL}' AND NcCount=0", SURV):
        ok(a.post(f"{base}/sections/{s_['Id']}/ofi", {'comments': 'Keep the export register current'}), 'OFI comments')
    chk = ok(a.post(base + '/final-submit/check'), 'final submit check')
    print('  check:', chk)
    check(chk.get('allowed'), f'allowed: {chk}')
    ok(a.post(base + '/final-submit', {'comments': 'Surveillance assessment complete'}), 'assessor final submit')
    s = surv_cert()
    check(s['CertificationStatus'] == '15', f'quality check (15), no NC: {s}')


def step_certify():
    g = surv_staff('AGENCYX')
    body = ok(g.post(f'/api/staff/monitoring/review/{ZED}/{LEVEL}/final-submit', {'qualityChecked': True}), 'agency certifies the surveillance')
    print('  ', body.get('message'))
    s, c = surv_cert(), main_cert()
    print('  surveillance:', s)
    print('  main:', c)
    check(s['CertificationStatus'] == '16', 'surveillance certified (16)')
    check(c['CertificationStatus'] == '16' and c['CertificationPhase'] == 'ACTIVE', 'main ZED-X certificate stays ACTIVE')
    pdf_path = os.path.join(r'E:\ZedChk\storage', 'Surveillance', 'Certificates', 'SA', ZED, 'ZEDX.pdf')
    check(os.path.exists(pdf_path), f'surveillance certificate written: {pdf_path}')
    m = msme()
    status, pdf = m.get(f'/api/msme/certification-documents/{LEVEL}Surveillance/certificate', raw=True)
    check(status == 200 and pdf[:4] == b'%PDF', f'the unit downloads it on main ({len(pdf)} bytes)')
    open(r'E:\ZedChk\ZEDX-surveillance-certificate.pdf', 'wb').write(pdf)
    dash = ok(m.get('/api/msme/dashboard'), 'dashboard')['msme']
    print('  dashboard:', {k: dash.get(k) for k in ('ZEDXDashboardSurStatus', 'IsSurZEDXPaymentDone')})


STEPS = ['open', 'fees', 'pay', 'users', 'allot', 'assess', 'certify']

if __name__ == '__main__':
    first = sys.argv[1] if len(sys.argv) > 1 else STEPS[0]
    last = sys.argv[2] if len(sys.argv) > 2 else STEPS[-1]
    for s in STEPS[STEPS.index(first):STEPS.index(last) + 1]:
        print(f'== {s}')
        globals()[f'step_{s}']()
    print('main:', main_cert())
    print('surveillance:', surv_cert())
