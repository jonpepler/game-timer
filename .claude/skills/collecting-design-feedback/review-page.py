"""Build the local review page from manifest.json.

Usage: python3 -I review-page.py <manifest.json> <out_dir>
Copies every referenced media file into <out_dir>/media and writes
<out_dir>/index.html. Nothing is published. The optional manifest field
`check_label` renames the per-item checkbox (default "Pass"; use "Pick"
when the items are options to choose between). An item's optional `options`
list of `{id, label}` renders pick checkboxes, exported as `picks`.
"""
import html
import json
import os
import shutil
import sys

manifest_path, out_dir = sys.argv[1], sys.argv[2]
manifest = json.load(open(manifest_path))
check_label = manifest.get("check_label", "Pass")
media_dir = os.path.join(out_dir, "media")
os.makedirs(media_dir, exist_ok=True)


copied = {}


def copy_media(src):
    if not os.path.exists(src):
        raise SystemExit(f"missing media: {src}")
    if src not in copied:
        name = f"{len(copied) + 1:03d}-{os.path.basename(src)}"
        shutil.copyfile(src, os.path.join(media_dir, name))
        copied[src] = "media/" + name
    return copied[src]


def esc(s):
    return html.escape(s or "", quote=True)


def media_html(m):
    rel = copy_media(m["src"])
    cap = esc(m.get("caption", ""))
    if rel.endswith(".webm") or rel.endswith(".mp4"):
        body = f'<video src="{rel}" controls muted playsinline preload="metadata"></video>'
    else:
        body = f'<a href="{rel}" target="_blank" rel="noopener"><img src="{rel}" alt="{cap}" loading="lazy"></a>'
    kind = m.get("kind", "phone" if "phone" in rel else "wide")
    return f'<figure class="m {kind}">{body}<figcaption>{cap}</figcaption></figure>'


def list_html(items, cls):
    if not items:
        return ""
    lis = "".join(f"<li>{esc(i)}</li>" for i in items)
    return f'<ul class="{cls}">{lis}</ul>'


def picks_html(item):
    opts = item.get("options") or []
    if not opts:
        return ""
    boxes = "".join(
        f'<label class="pick"><input type="checkbox" data-pick="{esc(o["id"])}"> <b>{esc(o["id"])}</b> {esc(o["label"])}</label>'
        for o in opts
    )
    return f'<fieldset class="picks"><legend>Pick (tick one; tick more only to combine)</legend>{boxes}</fieldset>'


sections_html = []
nav = []
for section in manifest["sections"]:
    sid = esc(section["id"])
    nav.append(f'<a href="#{sid}">{esc(section["title"])}</a>')
    items_html = []
    for item in section["items"]:
        iid = esc(item["id"])
        media = "".join(media_html(m) for m in item.get("media", []))
        items_html.append(f"""
<article class="item" id="{iid}" data-id="{iid}" data-title="{esc(item['title'])}">
  <header>
    <span class="iid">{iid}</span>
    <h3>{esc(item['title'])}</h3>
  </header>
  <p class="what">{esc(item.get('summary', ''))}</p>
  {list_html(item.get('weaknesses'), 'weak')}
  {list_html(item.get('questions'), 'ask')}
  <div class="media">{media}</div>
  {picks_html(item)}
  <div class="fb">
    <label class="pass"><input type="checkbox" data-field="pass"> {esc(check_label)}</label>
    <label class="notes">Notes for {iid}
      <textarea data-field="notes" rows="3" placeholder="What should change?"></textarea>
    </label>
  </div>
</article>""")
    sections_html.append(f"""
<section id="{sid}">
  <h2>{esc(section['title'])}</h2>
  <p class="lead">{esc(section.get('summary', ''))}</p>
  {''.join(items_html)}
</section>""")

page = f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>{esc(manifest['title'])}</title>
<style>
:root {{
  --bg: #0f1211; --surface: #181c1a; --line: #2b302d; --fg: #e7ebe8;
  --muted: #9aa49f; --accent: #e8a33a; --bad: #f2948b; --ask: #8cc4f2; --good: #84c99f;
  color-scheme: dark;
}}
* {{ box-sizing: border-box; }}
body {{ margin: 0; background: var(--bg); color: var(--fg);
  font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; }}
.top {{ position: sticky; top: 0; z-index: 5; background: rgba(15,18,17,.95);
  border-bottom: 1px solid var(--line); padding: 10px 16px; display: flex; flex-wrap: wrap;
  gap: 8px 16px; align-items: center; }}
.top h1 {{ font-size: 1rem; margin: 0; }}
.top nav {{ display: flex; gap: 12px; flex-wrap: wrap; font-size: .9rem; }}
.top nav a {{ color: var(--muted); }}
.top .tools {{ margin-left: auto; display: flex; gap: 8px; align-items: center; font-size: .9rem; }}
button {{ font: inherit; font-weight: 600; background: var(--accent); color: #1a1205; border: 0;
  border-radius: 8px; padding: 8px 14px; cursor: pointer; }}
button.ghost {{ background: transparent; color: var(--fg); border: 1px solid var(--line); }}
main {{ max-width: 1200px; margin: 0 auto; padding: 24px 16px 80px; display: grid; gap: 40px; }}
.intro {{ color: var(--muted); max-width: 75ch; }}
.intro code, .what code {{ color: var(--fg); }}
h2 {{ font-size: 1.6rem; margin: 0 0 6px; border-top: 2px solid var(--fg); padding-top: 14px; }}
.lead {{ color: var(--muted); max-width: 75ch; margin: 0 0 16px; }}
.item {{ background: var(--surface); border: 1px solid var(--line); border-radius: 12px;
  padding: 16px; display: grid; gap: 10px; margin-bottom: 16px; }}
.item.passed {{ border-color: var(--good); }}
.item header {{ display: flex; gap: 10px; align-items: baseline; }}
.iid {{ font: 600 .8rem ui-monospace, Menlo, monospace; color: var(--accent); }}
.item h3 {{ margin: 0; font-size: 1.1rem; }}
.what {{ margin: 0; max-width: 80ch; }}
ul {{ margin: 0; padding-left: 1.2em; font-size: .93rem; max-width: 85ch; }}
ul.weak li::marker {{ content: "! "; color: var(--bad); }}
ul.weak {{ color: #f3c9c4; }}
ul.ask li::marker {{ content: "? "; color: var(--ask); }}
ul.ask {{ color: #cfe5f8; }}
.media {{ display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }}
figure.m {{ margin: 0; display: grid; gap: 4px; }}
figure.m.phone {{ width: min(240px, 100%); }}
figure.m.wide {{ width: min(560px, 100%); }}
figure.m img, figure.m video {{ width: 100%; border-radius: 8px; border: 1px solid var(--line);
  background: #000; display: block; }}
figcaption {{ font-size: .8rem; color: var(--muted); }}
.fb {{ display: grid; grid-template-columns: auto 1fr; gap: 12px; align-items: start;
  border-top: 1px solid var(--line); padding-top: 10px; }}
.fb .pass {{ display: flex; gap: 6px; align-items: center; font-weight: 600; padding-top: 22px; }}
.fb .pass input {{ width: 20px; height: 20px; accent-color: var(--good); }}
.picks {{ border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; display: grid; gap: 6px; }}
.picks legend {{ font-size: .8rem; color: var(--muted); padding: 0 4px; }}
.pick {{ display: flex; gap: 8px; align-items: baseline; }}
.pick input {{ width: 18px; height: 18px; accent-color: var(--accent); }}
.pick b {{ font-family: ui-monospace, Menlo, monospace; color: var(--accent); }}
.fb .notes {{ display: grid; gap: 4px; font-size: .8rem; color: var(--muted); }}
textarea {{ font: inherit; font-size: .95rem; color: var(--fg); background: #0b0d0c;
  border: 1px solid var(--line); border-radius: 8px; padding: 8px; width: 100%; resize: vertical; }}
:focus-visible {{ outline: 2px solid var(--accent); outline-offset: 2px; }}
@media (max-width: 560px) {{ .fb {{ grid-template-columns: 1fr; }} .fb .pass {{ padding-top: 0; }} }}
</style>
</head>
<body>
<div class="top">
  <h1>{esc(manifest['title'])}</h1>
  <nav>{''.join(nav)}</nav>
  <div class="tools"><span id="count"></span>
    <button class="ghost" id="clear" type="button">Clear</button>
    <button id="dl" type="button">Download feedback JSON</button></div>
</div>
<main>
<div class="intro">{manifest.get('intro_html', '')}</div>
{''.join(sections_html)}
</main>
<script>
const KEY = {json.dumps(manifest['storage_key'])};
const META = {json.dumps(manifest['meta'])};
const items = [...document.querySelectorAll('.item')];
let saved = {{}};
try {{ saved = JSON.parse(localStorage.getItem(KEY) || '{{}}'); }} catch {{}}
function persist() {{ try {{ localStorage.setItem(KEY, JSON.stringify(collect().items)); }} catch {{}} }}
function collect() {{
  const out = {{}};
  for (const el of items) {{
    out[el.dataset.id] = {{
      title: el.dataset.title,
      pass: el.querySelector('[data-field=pass]').checked,
      notes: el.querySelector('[data-field=notes]').value.trim(),
      picks: [...el.querySelectorAll('[data-pick]')].filter((b) => b.checked).map((b) => b.dataset.pick),
    }};
  }}
  return {{ ...META, exportedAt: new Date().toISOString(), items: out }};
}}
function refresh() {{
  let passed = 0, noted = 0;
  for (const el of items) {{
    const p = el.querySelector('[data-field=pass]').checked;
    el.classList.toggle('passed', p);
    if (p || el.querySelector('[data-pick]:checked')) passed++;
    if (el.querySelector('[data-field=notes]').value.trim()) noted++;
  }}
  document.getElementById('count').textContent = `${{passed}}/${{items.length}} answered, ${{noted}} with notes`;
}}
for (const el of items) {{
  const s = saved[el.dataset.id];
  if (s) {{
    el.querySelector('[data-field=pass]').checked = !!s.pass;
    el.querySelector('[data-field=notes]').value = s.notes || '';
    for (const b of el.querySelectorAll('[data-pick]')) b.checked = (s.picks || []).includes(b.dataset.pick);
  }}
  el.addEventListener('input', () => {{ persist(); refresh(); }});
}}
refresh();
document.getElementById('dl').addEventListener('click', () => {{
  const blob = new Blob([JSON.stringify(collect(), null, 2)], {{ type: 'application/json' }});
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = META.reviewId + '-feedback.json';
  a.click();
  URL.revokeObjectURL(a.href);
}});
document.getElementById('clear').addEventListener('click', () => {{
  if (!confirm('Clear all feedback on this page?')) return;
  for (const el of items) {{
    el.querySelector('[data-field=pass]').checked = false;
    el.querySelector('[data-field=notes]').value = '';
    for (const b of el.querySelectorAll('[data-pick]')) b.checked = false;
  }}
  persist(); refresh();
}});
</script>
</body>
</html>
"""
open(os.path.join(out_dir, "index.html"), "w").write(page)
print(f"wrote {out_dir}/index.html with {sum(len(s['items']) for s in manifest['sections'])} items")
