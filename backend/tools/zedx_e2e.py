"""ZED-X end to end on the local throwaway databases (ZEDV4CHK_*), through the portal's own endpoints.

    1. build:  database\\setup.ps1 -DatabasePrefix ZEDV4CHK_ -WithKawachStandIn -Force, then
               deploy\\Invoke-ZedDatabaseScripts.ps1 -DatabasePrefix ZEDV4CHK_ -Apply -ApplyFixes 'main/14_zedx_levels',
               then sqlcmd -d ZEDV4CHK_ZEDCS_V2_LIVE -i database\\seed\\dev-zedx-e2e.sql
    2. run Zed.Main.Api on http://localhost:5199 against those databases (ConnectionStrings__Main etc.)
    3. python -I backend/tools/zedx_e2e.py [first step] [last step]

Each step prints what it did and the unit's ZED-X record, and stops at the first surprise.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from zedx_check import ZED, PDF, cert, msme, png, rows, sql, staff

LEVEL = 'ZEDX'


def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond:
        print('  record:', cert())
        raise SystemExit(1)


def ok(result, what):
    status, body = result
    check(status == 200, f'{what}: {status} {json.dumps(body)[:300] if not isinstance(body, str) else body[:300]}')
    return body


def step_admin():
    a = staff('ADMINX')
    ok(a.put('/api/staff/settings/levels/ZEDX', {
        'name': 'ZED-X (Export)', 'description': 'ZED-X certification for exporters', 'comment': None, 'isEnabled': True,
        'assessmentMode': 'Site', 'validityMonths': 36, 'surveillanceEnabled': True, 'firstSurveillanceMonths': 12,
        'certNoFormat': 'ZEDX/{YYYY}/{ZEDNO}', 'certNoFormatManufacturing': 'ZEDX/M/{YYYY}/{ZEDNO}', 'certNoFormatService': 'ZEDX/S/{YYYY}/{ZEDNO}',
        'fee': 75000}), 'Admin enables ZED-X with its certificate formats')
    ok(a.multipart('/api/staff/settings/levels/ZEDX/logo', files=[('file', 'badge.png', png(), 'image/png')]), 'Admin uploads the logo')


def step_pay():
    m = msme()
    levels = ok(m.get('/api/public/levels'), 'public levels')
    check(any(l['code'] == LEVEL for l in levels), 'ZED-X shown to units')
    ok(m.post(f'/api/msme/payments/{LEVEL}/checkout', {'useReward': False, 'gstinApplicable': False, 'gstin': None, 'tdsDeductible': False,
                                                         'tds': None, 'tan': None}), 'checkout (nothing to pay after subsidy)')
    check(rows(f"SELECT IsZEDXPaymentDone FROM dbo.Msme WHERE ZedId='{ZED}'")[0]['IsZEDXPaymentDone'] == '1', 'payment flag set')
    sections = [r['SectionCode'] for r in rows(f"SELECT SectionCode FROM dbo.MsmeSections WHERE ZedId='{ZED}' AND SectionType='ZEDX'")]
    check(sections == ['1'], f'questionnaire copied for NIC 24 only: {sections}')


def evidence_ids(state):
    return [e['id'] for s in state['sections'] for r in s['requirements'] for e in r['evidences']]


def step_entry():
    m = msme()
    state = ok(m.get(f'/api/msme/entry/{LEVEL}'), 'entry page')
    check(state['editable'], 'editable')
    data = {
        'answers': {'auditsConducted': 'Yes', 'domesticCustomers': 'Tata Steel', 'internationalCustomers': 'Acme GmbH', 'rawMaterialImported': 'Yes',
                    'energySources': ['Electricity', 'Solar'], 'monthlyManufacturingCapacityUnits': 'Number', 'monthlyManufacturingCapacityValue': '1000',
                    'monthlyUtilizationUnits': 'Number', 'monthlyUtilizationValue': '800', 'outsourcedProcesses': 'Plating'},
        'products': [{'productName': 'Valve', 'exported': 'Yes', 'productPhoto': {'upload': 'p0'}, 'productDescriptionPhoto': {'upload': 'd0'}}],
        'rawMaterials': [{'rawMaterialName': 'Steel billets', 'rawMaterialPercentage': '30', 'countryName': 'Japan, Germany'}],
        'siteExteriorPhotos': [{'upload': 's0'}, {'upload': 's1'}], 'customFields': {}, 'formVersion': state['form']['version'],
        'latitude': '26.45', 'longitude': '80.33'}
    ok(m.multipart(f'/api/msme/entry/{LEVEL}/basic-info', {'data': json.dumps(data)}, [
        ('p0', 'valve.png', png((120, 120, 200)), 'image/png'), ('d0', 'label.pdf', PDF, 'application/pdf'),
        ('s0', 'site1.png', png((40, 160, 60)), 'image/png'), ('s1', 'site2.png', png((60, 60, 160)), 'image/png')]), 'basic information saved')
    for e in evidence_ids(state):
        ok(m.multipart(f'/api/msme/entry/{LEVEL}/evidences/{e}', files=[('files', 'a.png', png((200, 100, 50), (600, 800)), 'image/png'),
                                                                      ('files', 'b.png', png((50, 100, 200), (800, 600)), 'image/png')]),
           f'document {e} uploaded')
    ok(m.post(f'/api/msme/entry/{LEVEL}/final-submit'), 'final submit')
    c = cert()
    check(c['CertificationStatus'] == '2', 'status 2 (submitted)')
    check(c['CertificationBodyUserId'] == 'AGENCYX', 'auto-allotted to the Manufacturing agency')


def step_desktop():
    d = staff('DAX1')
    if not cert()['DesktopAssessorId']:
        g = staff('AGENCYX')
        ok(g.post('/api/staff/assessment/da-allotment/allot', {'zedId': ZED, 'certification': LEVEL, 'desktopAssessorId': 'DAX1'}), 'agency allots the desktop assessor')
        ok(d.post('/api/staff/assessment/da-verification/accept', {'zedId': ZED, 'certification': LEVEL}), 'assessor accepts')
    da = ok(d.get(f'/api/staff/assessment/da/{ZED}/{LEVEL}'), 'desktop assessment page')
    print('  sets:', {k: (len(v) if isinstance(v, list) else type(v).__name__) for k, v in da.items()})
    for r in da.get('requirements', []):
        ok(d.post(f"/api/staff/assessment/da/{ZED}/{LEVEL}/requirements/{r['Id']}/conformance", {'conformance': 'Yes', 'remarks': None}),
           f"requirement {r.get('RequirementCode')} conforms")
    for e in da.get('evidences', []):
        if str(e.get('ValidationRequired')).lower() not in ('true', '1'):
            continue
        ok(d.multipart(f"/api/staff/assessment/da/{ZED}/{LEVEL}/evidences/{e['Id']}/validate", {'isVerified': 'Yes', 'sourceOfValidation': 'Document'},
                       [('files', 'screenshot.pdf', PDF, 'application/pdf')]), f"evidence {e['Id']} verified")
    for p in da.get('products', []):
        ok(d.post(f"/api/staff/assessment/da/{ZED}/{LEVEL}/products/{p['Id']}/validate", {'isVerified': 'Yes', 'remarks': None}), f"product {p['Id']} verified")
    ok(d.post(f'/api/staff/assessment/da/{ZED}/{LEVEL}/site-exterior/validate', {'isVerified': 'Yes', 'remarks': None}), 'site exterior verified')
    chk = ok(d.post(f'/api/staff/assessment/da/{ZED}/{LEVEL}/final-submit/check'), 'final submit check')
    check(chk.get('allowed'), f'allowed: {chk}')
    ok(d.post(f'/api/staff/assessment/da/{ZED}/{LEVEL}/final-submit', {'remarks': 'Desktop review complete'}), 'desktop final submit')
    print('  record:', cert())


def step_qc_desktop():
    g = staff('AGENCYX')
    ok(g.post(f'/api/staff/monitoring/review/{ZED}/{LEVEL}/final-submit', {'qualityChecked': True, 'exemptionsReviewed': True}),
       'agency QC: desktop verification completed')
    print('  record:', cert())


def step_sa_allot():
    from datetime import date, timedelta
    g = staff('AGENCYX')
    lst = ok(g.get('/api/staff/site-assessment/allotments'), 'site allotment list')
    print('  assessors offered:', [a['userId'] for a in lst.get('assessors', [])])
    ok(g.post('/api/staff/site-assessment/allotments', {'zedId': ZED, 'certification': LEVEL, 'siteAssessorId': 'SAX1', 'coAssessorId': 'SAX2',
                                                         'assessmentDate': (date.today() + timedelta(days=1)).isoformat(),
                                                         'modeOfAssessment': 'Onsite Assessment'}), 'agency allots the site assessors')
    print('  record:', cert())


def step_sa_app(nc=True):
    """What the SA app's server runs (Zed.Main.MobileApi SAController): opening meeting, parameters, final submit, closing meeting.
    In an NC round (status 14, answers in) only the round's requirements are assessed again."""
    c = cert()
    check(c['SiteAssessorId'] == 'SAX1', 'lead assessor allotted')
    round_ = int(c['NcCount'] or 0)
    if round_:
        check(c['CertificationStatus'] in ('13', '14') and c[f'Nc{round_}Status'] == '2', f'NC {round_} answered, ready for the site review')
        nc = False
    def meeting(kind):
        sql(f"DECLARE @p DynamicParticipants; INSERT @p VALUES ('Owner','Proprietor'); DECLARE @ph DynamicPhotoList2; "
            f"INSERT @ph VALUES ('SAX1{kind[:2]}1','{kind} Photo','29-10-2026 10:00:00','26.45','80.33','jpg'); "
            f"EXEC dbo.SP_SA_APP_INSERT_OPEN_MEETING @RefId='e2e', @ZedId='{ZED}', @AssessorId='SAX1', @CertificationType='{LEVEL}', "
            f"@PhotoType='{kind}', @Latitude='26.45', @Longitude='80.33', @Comments='{kind} done', @ParticipantsList=@p, @PhotoList=@ph;")
    meeting('Open Meeting')
    sections = rows(f"SELECT SectionId, SectionCode FROM dbo.MsmeSections WHERE ZedId='{ZED}' AND SectionType='{LEVEL}' AND NcCount={round_}")
    # The app sends each row's own Id (SP_APP_SA_SAVE_PARAMETER matches MsmeRequirements.Id).
    reqs = rows(f"SELECT Id, SectionCode, RequirementCode FROM dbo.MsmeRequirements WHERE ZedId='{ZED}' AND SectionType='{LEVEL}' AND NcCount={round_}")
    for sct in sections:
        values = ', '.join(f"('{r['Id']}','{r['RequirementCode']}','{'No' if nc and r['RequirementCode'] == '2' else 'Yes'}',"
                           f"'{'Export register not maintained' if nc and r['RequirementCode'] == '2' else 'Seen'}')"
                           for r in reqs if r['SectionCode'] == sct['SectionCode'])
        sql(f"DECLARE @r DynamicRequirementsList; INSERT @r VALUES {values}; "
            f"EXEC dbo.SP_APP_SA_SAVE_PARAMETER @ZedId='{ZED}', @AssessorId='SAX1', @CertificationType='{LEVEL}', @ParameterId='{sct['SectionId']}', "
            f"@ParameterCode='{sct['SectionCode']}', @PhotoType='Parameters', @RequirementsList=@r;")
        sql(f"EXEC dbo.SP_APP_SA_SAVE_OFI_COMMENTS @ZedId='{ZED}', @CertificationType='{LEVEL}', @AssessorId='SAX1', @ParameterId='{sct['SectionId']}', "
            f"@OfiComments='Keep improving export records'")
    print('  site answers:', rows(f"SELECT RequirementCode, NcCount, SaConformance FROM dbo.MsmeRequirements WHERE ZedId='{ZED}' AND SectionType='{LEVEL}' AND NcCount={round_}"))
    meeting('Final Submit')
    meeting('Close Meeting')
    check(cert()['CertificationStatus'] == '13', 'status 13 after the closing meeting')


def step_site_submit():
    s1 = staff('SAX1')
    base = f'/api/staff/remote/{ZED}/{LEVEL}'
    view = ok(s1.get(base), 'lead assessor opens the onsite review (status 13)')
    chk = ok(s1.post(base + '/final-submit/check'), 'final submit check')
    print('  check:', chk)
    ok(s1.post(base + '/final-submit', {'comments': 'Site assessment complete'}), 'site final submit')
    print('  record:', cert())


def step_nc():
    m = msme()
    state = ok(m.get(f'/api/msme/entry/{LEVEL}'), 'entry page with the open NC')
    nc = state.get('nc')
    check(nc is not None and nc['number'] == 1, f"NC 1 shown: {json.dumps(nc)[:400]}")
    reqs = [r for s_ in nc['sections'] for r in s_['requirements']]
    check([r['code'] for r in reqs] == ['2'], f"the NC is on requirement 2: {[r['code'] for r in reqs]}")
    for r in reqs:
        ok(m.multipart(f"/api/msme/entry/{LEVEL}/nc/requirements/{r['id']}", {'remarks': 'Export register now maintained'},
                       [('files', 'register.pdf', PDF, 'application/pdf')]), f"answer to requirement {r['code']}")
    for p_ in nc['products']:
        ok(m.multipart(f"/api/msme/entry/{LEVEL}/nc/products/{p_['id']}", {'remarks': 'New label'},
                       [('productPhoto', 'p.png', png(), 'image/png'), ('descriptionPhoto', 'l.pdf', PDF, 'application/pdf')]), f"answer to product {p_['id']}")
    if nc['siteExterior']:
        ok(m.multipart(f'/api/msme/entry/{LEVEL}/nc/site-exterior', {'remarks': 'Retaken'}, [('files', 's.png', png(), 'image/png')]), 'answer to site exterior')
    state = ok(m.get(f'/api/msme/entry/{LEVEL}'), 'entry page after the answers')
    check(all(r['answered'] for s_ in state['nc']['sections'] for r in s_['requirements']), 'all NC items answered')
    ok(m.post(f'/api/msme/entry/{LEVEL}/final-submit'), 'NC answers submitted')
    c = cert()
    check(c['Nc1Status'] == '2', f"NC 1 answered (Nc1Status 2): {c}")


def step_certify():
    # The unit also holds a certified Bronze: ZED-X is a separate track and must not end it.
    sql(f"IF NOT EXISTS (SELECT 1 FROM dbo.MsmeCertifications WHERE ZedId='{ZED}' AND Certification='Bronze') "
        f"INSERT dbo.MsmeCertifications (ZedId, Certification, CertificationStatus, CertificationPhase, DaCertificateNo) "
        f"VALUES ('{ZED}', 'Bronze', 6, 'ACTIVE', '01012026_990001')")
    g = staff('AGENCYX')
    body = {'message': 'already certified, mailed earlier'} if cert()['CertificationStatus'] == '16' else         ok(g.post(f'/api/staff/monitoring/review/{ZED}/{LEVEL}/final-submit', {'qualityChecked': True}), 'agency QC: certify')
    c = cert()
    print('  record:', c)
    check(c['CertificationStatus'] == '16' and c['CertificationPhase'] == 'ACTIVE', 'certified (status 16, ACTIVE)')
    from datetime import date
    check(c['SaCertificateNo'] == f'ZEDX/M/{date.today().year}/990001', f"number in the Admin's Manufacturing format: {c['SaCertificateNo']}")
    check(c['QrCodeSeqNo'].startswith('P995'), f"ZED-X QR number (plant ID, 5, code): {c['QrCodeSeqNo']}")
    check(c['FirstSurveDueDate'] is not None, f"first surveillance date set: {c['FirstSurveDueDate']}")
    bronze = rows(f"SELECT CertificationStatus, CertificationPhase, RestrictMail FROM dbo.MsmeCertifications WHERE ZedId='{ZED}' AND Certification='Bronze'")[0]
    check(bronze['CertificationPhase'] == 'ACTIVE' and bronze['RestrictMail'] is None, f'Bronze untouched: {bronze}')
    check('mailed' in body['message'], body['message'])

    m = msme()
    docs = ok(m.get('/api/msme/documents'), 'My Documents')
    url = docs['Certificates'][0].get('ZEDX')
    check(bool(url), f'ZED-X certificate listed: {url}')
    status, pdf = m.get(url, raw=True)
    check(status == 200 and pdf[:4] == b'%PDF', f'certificate downloads ({len(pdf)} bytes)')
    open(r'E:\ZedChk\ZEDX-certificate.pdf', 'wb').write(pdf)
    code = c['QrCodeSeqNo']
    v = ok(staff('ADMINX').get(f'/api/verify/XC/{code}'), 'public verification of the QR code')
    check(v['details'].get('CertificateNo') == c['SaCertificateNo'], 'verification shows the certificate number')
    dash = ok(m.get('/api/msme/dashboard'), 'dashboard')
    check(str(dash['certStatus'].get('ZEDXStatus')) == '16', f"dashboard shows ZED-X certified: {dash['certStatus'].get('ZEDXStatus')}")


STEPS = ['admin', 'pay', 'entry', 'desktop', 'qc_desktop', 'sa_allot', 'sa_app', 'site_submit', 'nc', 'certify']

if __name__ == '__main__':
    first = sys.argv[1] if len(sys.argv) > 1 else STEPS[0]
    last = sys.argv[2] if len(sys.argv) > 2 else STEPS[-1]
    for s in STEPS[STEPS.index(first):STEPS.index(last) + 1]:
        print(f'== {s}')
        globals()[f'step_{s}']()
    print('record:', cert())
