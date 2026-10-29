"""Helpers for the local ZED-X end-to-end check (see database/seed/dev-zedx-e2e.sql).

Talks to a local Zed.Main.Api (http://localhost:5199) that runs against the throwaway ZEDV4CHK_ databases, and reads those
databases with sqlcmd. Never point it at the test server or production.
"""
import http.cookiejar
import io
import json
import os
import subprocess
import time
import urllib.error
import urllib.request
import uuid

BASE = os.environ.get('ZEDX_CHECK_URL', 'http://localhost:5199')
SERVER = r'localhost\SQLEXPRESS'
MAIN = 'ZEDV4CHK_ZEDCS_V2_LIVE'
PASSWORD = 'Zedx#Check2026'  # the throwaway logins of dev-zedx-e2e.sql
ZED = 'ZEDMSME990001'
assert 'localhost' in BASE or '127.0.0.1' in BASE, 'local check only'


def sql(query, db=MAIN):
    r = subprocess.run(['sqlcmd', '-S', SERVER, '-E', '-C', '-b', '-f', 'i:65001,o:65001', '-W', '-s', '|', '-d', db,
                        '-Q', 'SET NOCOUNT ON; ' + query], capture_output=True, text=True, encoding='utf-8')
    if r.returncode:
        raise RuntimeError(r.stdout + r.stderr)
    return r.stdout.strip()


def rows(query, db=MAIN):
    """Result rows as dicts (first result set)."""
    out = [l for l in sql(query, db).splitlines() if l.strip()]
    if len(out) < 2:
        return []
    head = out[0].split('|')
    return [dict(zip(head, [None if v == 'NULL' else v for v in l.split('|')])) for l in out[2:]]


class Client:
    """A browser: cookies, and the XSRF header as the Angular app sends it."""

    def __init__(self, base=None):
        self.base = base or BASE
        self.jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.jar))
        self.get('/api/auth/me')

    def _xsrf(self):
        for c in self.jar:
            if c.name == 'XSRF-TOKEN':
                return urllib.request.unquote(c.value)
        return None

    def request(self, method, path, body=None, content_type=None, raw=False):
        headers = {}
        if body is not None and content_type is None:
            body = json.dumps(body).encode()
            content_type = 'application/json'
        if content_type:
            headers['Content-Type'] = content_type
        if method != 'GET' and self._xsrf():
            headers['X-XSRF-TOKEN'] = self._xsrf()
        req = urllib.request.Request(self.base + path, data=body, method=method, headers=headers)
        try:
            with self.opener.open(req) as r:
                data = r.read()
                status = r.status
        except urllib.error.HTTPError as e:
            data = e.read()
            status = e.code
        if raw:
            return status, data
        try:
            return status, json.loads(data) if data else None
        except ValueError:
            return status, data.decode(errors='replace')

    def get(self, path, raw=False):
        return self.request('GET', path, raw=raw)

    def post(self, path, body=None):
        return self.request('POST', path, body if body is not None else {})

    def put(self, path, body):
        return self.request('PUT', path, body)

    def multipart(self, path, fields=None, files=None):
        """fields: {name: text}; files: [(name, filename, bytes, content type)]."""
        boundary = uuid.uuid4().hex
        buf = io.BytesIO()
        for k, v in (fields or {}).items():
            buf.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{k}"\r\n\r\n{v}\r\n'.encode())
        for name, filename, data, ctype in files or []:
            buf.write(f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
                      f'Content-Type: {ctype}\r\n\r\n'.encode())
            buf.write(data)
            buf.write(b'\r\n')
        buf.write(f'--{boundary}--\r\n'.encode())
        return self.request('POST', path, buf.getvalue(), f'multipart/form-data; boundary={boundary}')


_sessions = {}


def _login(path, user, base=None):
    """A signed-in browser, reused: the login endpoints allow 10 attempts a minute per address (429 after), so a
    rejected attempt is retried after a pause."""
    key = (base or BASE, path, user)
    if key not in _sessions:
        for _ in range(8):
            c = Client(base)
            s, r = c.post(path, {'userId': user, 'password': PASSWORD})
            if s != 429:
                break
            time.sleep(10)
        assert s == 200, (user, s, r)
        _sessions[key] = c
    return _sessions[key]


def staff(user, base=None):
    return _login('/api/staff/auth/login', user, base)


def msme(zed=ZED):
    return _login('/api/msme/auth/login', zed)


def png(color=(46, 202, 208), size=(400, 300)):
    from PIL import Image
    b = io.BytesIO()
    Image.new('RGB', size, color).save(b, 'PNG')
    return b.getvalue()


PDF = b'%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[]/Count 0>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF\n'


def cert(level='ZEDX', zed=ZED):
    r = rows(f"SELECT CertificationStatus, NcCount, Nc1Status, CertificationBodyUserId, DesktopAssessorId, SiteAssessorId, CoAssessorId, "
             f"DesktopAccepted, SaCertificateNo, QrCodeSeqNo, FirstSurveDueDate, CertificationPhase FROM dbo.MsmeCertifications "
             f"WHERE ZedId='{zed}' AND Certification='{level}'")
    return r[0] if r else None
