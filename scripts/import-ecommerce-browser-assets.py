"""Save image bytes exported from the BrowserOS task, retaining a source manifest."""
import base64
import json
import sys
from pathlib import Path
from urllib.parse import urlparse

root = Path(__file__).resolve().parent.parent
directory = root / 'public/ecommerce-reference'
directory.mkdir(parents=True, exist_ok=True)
manifest_path = directory / 'sources.json'
manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {}
count = 0
errors = []
for filename in sys.argv[1:]:
    raw = Path(filename).read_text()
    data, _ = json.JSONDecoder().raw_decode(raw[raw.index('return:')+7:].lstrip())
    for record in data.get('value', []):
        if record.get('error'):
            errors.append({'src': record['src'], 'error': record['error']})
            continue
        name = Path(urlparse(record['src']).path).name + '.webp'
        target = directory / name
        target.write_bytes(base64.b64decode(record['data'], validate=True))
        manifest[record['src']] = {
            'path': '/ecommerce-reference/' + name,
            'width': record['width'],
            'height': record['height'],
        }
        count += 1
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
print(json.dumps({'saved': count, 'total': len(manifest), 'errors': errors}, ensure_ascii=False))
