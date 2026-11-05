"""Resume an accepted live GK task; never submits or retries a paid request."""
import json
import pathlib
import time
import urllib.request

BASE = 'http://127.0.0.1:4310'
OUT = pathlib.Path('output/remake-validation')
RECEIPT = OUT / 'receipt.json'
JOB = 'remake-95493079-b507-4c26-86f7-dace131113c7'
KEY = 'remake-live-gk-full-20261030-v1'


def api(route, body=None):
    headers = {'Content-Type': 'application/json'}
    if body is not None:
        headers['X-Studio-Token'] = api('/api/bootstrap')['token']
    request = urllib.request.Request(BASE + route, headers=headers,
        data=None if body is None else json.dumps(body).encode())
    with urllib.request.urlopen(request, timeout=60) as response:
        return json.load(response)


def save(receipt):
    RECEIPT.write_text(json.dumps(receipt, ensure_ascii=False, indent=2))


receipt = json.loads(RECEIPT.read_text())
for _ in range(30):
    batch = api('/api/submissions/' + KEY)['batch']
    if not batch:
        raise RuntimeError('No accepted request exists; refusing to submit')
    attempt = batch['attempts'][-1]
    receipt['stages']['video'] = {k: attempt.get(k) for k in
        ('status', 'upstreamTaskId', 'billing', 'assetId', 'error')}
    receipt['stages']['video']['batchId'] = batch['id']
    save(receipt)
    print(json.dumps(receipt['stages']['video'], ensure_ascii=False), flush=True)
    if attempt['status'] == 'completed':
        break
    if attempt['status'] in ('failed', 'pending_verification'):
        raise RuntimeError('Task needs inspection; no paid retry performed')
    time.sleep(30)
else:
    raise RuntimeError('Wait expired; accepted task remains persisted')

detail = api('/api/video-remakes/' + JOB)
job = detail['job']
shot = job['shots'][0]
if shot.get('selectedVideoId') != attempt['assetId']:
    api('/api/video-remakes/' + JOB + '/shots/' + shot['id'] + '/select', {
        'revision': shot['revision'], 'stage': 'video',
        'assetId': attempt['assetId'], 'attemptId': attempt['id']})
job = api('/api/video-remakes/' + JOB)['job']
if not receipt.get('compositionRequested'):
    api('/api/video-remakes/' + JOB + '/compose', {
        'revision': job['revision'], 'idempotencyKey': 'remake-live-composition-20261030-v1'})
    receipt['compositionRequested'] = True
    save(receipt)
for _ in range(40):
    detail = api('/api/video-remakes/' + JOB)
    job = detail['job']
    if job['status'] == 'completed' and job['compositions']:
        break
    if job['status'] in ('failed', 'cancelled'):
        raise RuntimeError(job.get('error', 'Local composition stopped'))
    time.sleep(3)
else:
    raise RuntimeError('Local composition still pending')

composition = job['compositions'][-1]
receipt['compositionId'] = composition['id']
receipt['stages']['composition'] = composition
save(receipt)
assets = {a['id']: a for a in detail['assets']}
for name, asset_id in [('gk-segment.mp4', attempt['assetId']),
                       ('remade-final.mp4', composition['assetId'])]:
    with urllib.request.urlopen(BASE + assets[asset_id]['url']) as response:
        (OUT / name).write_bytes(response.read())
export = api('/api/video-remakes/' + JOB + '/export', {'compositionId': composition['id']})
with urllib.request.urlopen(BASE + export['url']) as response:
    (OUT / 'remade-export.zip').write_bytes(response.read())
receipt['export'] = export
receipt['balanceAfterGk'] = api('/api/provider/balance?credentialId=gk-video-3.5')['data']
save(receipt)
(OUT / 'gk-final-detail.json').write_text(json.dumps(detail, ensure_ascii=False, indent=2))
print('Real GK segment and composed candidate saved; awaiting visual inspection.', flush=True)
