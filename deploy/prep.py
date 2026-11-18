import os, sys, json, base64, blake3, mimetypes, argparse
# Prepares a Direct Upload deployment of /workspace/cto-review/dist:
#   manifest.json + items.json (assets, for upload_missing.py) and deploy-latest.js (code for the
#   Cloudflare MCP `execute` tool) that creates the deployment WITH the login worker (_worker.bundle)
#   and _headers. Never deploy without the worker: it is the site's only access control.
ap = argparse.ArgumentParser()
ap.add_argument('--branch', default='main', help="'main' = production; anything else = preview branch")
ap.add_argument('--root', default='/workspace/cto-review/dist', help='dist directory to deploy')
a = ap.parse_args()
root = a.root
worker = os.path.join(root, '_worker.js')
if not os.path.isfile(worker) or 'export default' not in open(worker, encoding='utf-8').read():
    sys.exit('refusing: dist/_worker.js (login worker) is missing – run build.py first')
if os.path.exists(os.path.join(root, 'assets', 'replica.js')):
    sys.exit('refusing: this is a replica build (build.py --replica) – rebuild the live site with build.py first')
manifest = {}; items = []
for d, _, fs in os.walk(root):
    for f in fs:
        p = os.path.join(d, f); rel = '/' + os.path.relpath(p, root)
        if rel in ('/_headers', '/_redirects', '/_routes.json', '/_worker.js'): continue
        b64 = base64.b64encode(open(p, 'rb').read()).decode()
        ext = os.path.splitext(f)[1][1:]
        h = blake3.blake3((b64 + ext).encode()).hexdigest()[:32]
        manifest[rel] = h
        ct = mimetypes.guess_type(f)[0] or 'application/octet-stream'
        if f.endswith('.html'): ct = 'text/html'
        items.append({'key': h, 'value': b64, 'metadata': {'contentType': ct}, 'base64': True})
json.dump(manifest, open('/workspace/cto-deploy/manifest.json', 'w'))
json.dump(items, open('/workspace/cto-deploy/items.json', 'w'))
headers = open(os.path.join(root, '_headers'), encoding='utf-8').read()
code = open(worker, encoding='utf-8').read()
js = ("async () => {\n"
      f" const manifest = {json.dumps(json.dumps(manifest))};\n"
      f" const headers = {json.dumps(headers)};\n"
      f" const worker = {json.dumps(code)};\n"
      f" const branch = {json.dumps(a.branch)};\n"
      " const wb = new FormData();\n"
      " wb.append('metadata', JSON.stringify({ main_module: '_worker.js' }));\n"
      " wb.append('_worker.js', new Blob([worker], { type: 'application/javascript+module' }), '_worker.js');\n"
      " const bundle = await new Response(wb).blob();\n"
      " const form = new FormData();\n"
      " form.append('manifest', manifest);\n"
      " form.append('branch', branch);\n"
      " form.append('_headers', new Blob([headers], { type: 'text/plain' }), '_headers');\n"
      " form.append('_worker.bundle', bundle, '_worker.bundle');\n"
      " const r = await cloudflare.request({ method: 'POST', path: `/accounts/${accountId}/pages/projects/cto-review/deployments`, body: form });\n"
      " const d = r.result;\n"
      " return { id: d.id, url: d.url, env: d.environment, aliases: d.aliases, stage: d.latest_stage, created: d.created_on, uses_functions: d.uses_functions };\n"
      "}\n")
open('/workspace/cto-deploy/deploy-latest.js', 'w').write(js)
print(f"prepared {len(manifest)} assets + login worker, branch={a.branch}")
print("next: upload missing assets (upload_missing.py), then run deploy-latest.js with the Cloudflare MCP execute tool "
      "(code argument \"$file:/workspace/cto-deploy/deploy-latest.js\")")
