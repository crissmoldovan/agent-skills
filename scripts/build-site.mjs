#!/usr/bin/env node
/**
 * Builds the pack's site: one page that lists every skill and reads every
 * document in the repository.
 *
 * The site is generated, never hand-written, and it is generated from the
 * skills themselves — a skill's description is the one in its own frontmatter,
 * because that is the text a runtime matches on, and an example ask is the
 * skill's own, verbatim. A skill that publishes no examples is shown without
 * any rather than given invented ones.
 *
 * Output (default `site/dist`, which is not committed):
 *   index.html      the shell; its renderer is marked, from a CDN
 *   manifest.json   the catalogue the shell reads
 *   content/**.md   every skill, reference and document, copied unchanged
 *
 * Usage:
 *   node scripts/build-site.mjs [--out <dir>]
 *   npx http-server site/dist      # or any static server, to read it locally
 */

import { realpathSync } from 'node:fs';
import { copyFile, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

const MARKED = 'https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js';

const ROOT_DOCUMENTS = ['README.md', 'CONTRIBUTING.md', 'CHANGELOG.md', 'SECURITY.md'];

/** Reads a file, or returns null when it is not there. */
async function readMaybe(file) {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

/** Every `.md` under `dir`, deepest paths included, relative to `root`. */
async function markdownUnder(root, dir) {
  const found = [];
  const walk = async (current) => {
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) await walk(full);
      else if (entry.name.endsWith('.md')) found.push(path.relative(root, full));
    }
  };
  await walk(dir);
  return found;
}

/** The value of one frontmatter key, with folded lines joined into a sentence. */
function frontmatterValue(source, key) {
  const block = source.match(/^---\n([\s\S]*?)\n---/);
  if (!block) return '';
  const lines = block[1].split('\n');
  const start = lines.findIndex((line) => line.startsWith(`${key}:`));
  if (start === -1) return '';
  let value = lines[start].slice(key.length + 1).trim();
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\S+:/.test(lines[i])) break;
    value += ` ${lines[i].trim()}`;
  }
  return value.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ').trim();
}

/**
 * The fenced blocks of one language under a skill's own `## Usage Examples`,
 * verbatim.
 *
 * A `text` block is a prompt somebody types; a `bash` block is a command they
 * run. Anything else under that heading is illustrative output — release-notes
 * shows a sample note in a `markdown` block — and is not an ask, so it is not
 * presented as one.
 *
 * The walk tracks fences rather than splitting on headings: a sample inside a
 * fence can begin with `## `, and splitting there truncated the section.
 */
function usageBlocks(source, language) {
  const lines = source.split('\n');
  let index = lines.findIndex((line) => /^## Usage Examples\s*$/.test(line));
  if (index === -1) return [];
  const found = [];
  let fence = null;
  let current = null;
  for (index += 1; index < lines.length; index += 1) {
    const line = lines[index];
    const open = line.match(/^(```+|~~~+)([a-z]*)\s*$/);
    if (open && !fence) {
      fence = open[1];
      current = open[2] === language ? [] : null;
      continue;
    }
    if (fence && line.startsWith(fence)) {
      if (current) found.push(current.join('\n').trim());
      fence = null;
      current = null;
      continue;
    }
    if (!fence && /^## /.test(line)) break;
    if (current) current.push(line);
  }
  return found;
}

/**
 * A markdown document without its YAML frontmatter.
 *
 * A renderer has no idea what frontmatter is: the opening `---` makes the
 * `name:` line a heading, and a skill's page opened with its own metadata drawn
 * as its first heading. The card above the body already states what the
 * frontmatter says, so the body drops it.
 *
 * This function is injected into the page verbatim, so the suite and the
 * reader's browser run the same code.
 */
export function stripFrontmatter(md) {
  var text = String(md).replace(/^\uFEFF/, '');
  if (text.slice(0, 4) !== '---\n') return text;
  var end = text.indexOf('\n---', 3);
  if (end === -1) return text;
  var after = text.indexOf('\n', end + 1);
  return after === -1 ? '' : text.slice(after + 1).replace(/^\s+/, '');
}

/**
 * The install steps for one skill: the `npx skills add` line for that skill,
 * plus any second step the README states for it — the README is where a step
 * beyond the install itself is written down, so the site does not invent one.
 */
function installSteps(name, readme) {
  const first = `npx skills add crissmoldovan/agent-skills --skill ${name}`;
  const entry = readme?.split(new RegExp(`^### \`${name}\`\\s*$`, 'm'))[1];
  if (!entry) return [first];
  const block = entry.split(/^### /m)[0].match(/```bash\n([\s\S]*?)```/);
  if (!block) return [first];
  const steps = block[1]
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  return steps.some((step) => step.includes(`--skill ${name}`)) ? steps : [first];
}

/** Every skill in the pack, described by its own files. */
export async function collectSkills({ root }) {
  const readme = await readMaybe(path.join(root, 'README.md'));
  const dirs = (await readdir(path.join(root, 'skills'), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  const skills = [];
  for (const name of dirs) {
    const dir = path.join(root, 'skills', name);
    const source = await readFile(path.join(dir, 'SKILL.md'), 'utf8');
    const fit = JSON.parse((await readMaybe(path.join(dir, 'references/fit.json'))) ?? '{}');
    const documents = (await markdownUnder(root, dir)).map((file) => ({
      path: file,
      title: path.basename(file) === 'SKILL.md' ? 'The skill' : path.basename(file, '.md'),
    }));
    skills.push({
      name,
      description: frontmatterValue(source, 'description'),
      kind: fit.kind ?? null,
      useWhen: fit.useWhen ?? null,
      install: installSteps(name, readme),
      examples: usageBlocks(source, 'text'),
      commands: usageBlocks(source, 'bash'),
      documents: [
        ...documents.filter((doc) => doc.title === 'The skill'),
        ...documents.filter((doc) => doc.title !== 'The skill'),
      ],
    });
  }
  return skills;
}

/** The repository's own documents: the docs tree and the pages at its root. */
async function collectDocuments({ root }) {
  const docs = await markdownUnder(root, path.join(root, 'docs'));
  const rootDocs = [];
  for (const file of ROOT_DOCUMENTS) {
    if ((await readMaybe(path.join(root, file))) !== null) rootDocs.push(file);
  }
  return [...rootDocs, ...docs].map((file) => ({
    path: file,
    title: file.replace(/\.md$/, '').replace(/^docs\//, ''),
  }));
}

function page(manifest) {
  // Nothing in the manifest may close this script element early.
  const payload = JSON.stringify(manifest).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Skills</title>
<meta name="description" content="${manifest.skills.length} verified agent skills: what each one is for, how to install it, and what to ask it.">
<style>
  :root{
    --bg:#fbfbfc; --panel:#ffffff; --fg:#14161a; --muted:#61687a; --line:#e3e6ec;
    --accent:#2b59ff; --accent-soft:#eef2ff; --code:#f2f4f8; --shadow:0 1px 2px rgba(16,20,32,.05);
  }
  @media (prefers-color-scheme: dark){
    :root:not([data-theme="light"]){
      --bg:#0f1115; --panel:#151821; --fg:#e7eaf1; --muted:#98a0b2; --line:#252a35;
      --accent:#89a7ff; --accent-soft:#1a2135; --code:#1b1f29; --shadow:none;
    }
  }
  :root[data-theme="dark"]{
    --bg:#0f1115; --panel:#151821; --fg:#e7eaf1; --muted:#98a0b2; --line:#252a35;
    --accent:#89a7ff; --accent-soft:#1a2135; --code:#1b1f29; --shadow:none;
  }
  *{box-sizing:border-box}
  html,body{margin:0}
  body{background:var(--bg); color:var(--fg);
    font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,Helvetica,Arial,sans-serif;
    -webkit-font-smoothing:antialiased}
  a{color:var(--accent)}
  .wrap{display:flex; min-height:100vh}
  aside{width:300px; flex:0 0 300px; border-right:1px solid var(--line); background:var(--panel);
    position:sticky; top:0; height:100vh; overflow-y:auto; padding:22px 0 60px}
  aside .brand{padding:0 20px 14px}
  aside .brand strong{display:block; font-size:17px}
  aside .brand span{font-size:12.5px; color:var(--muted)}
  aside .search{padding:0 16px 10px}
  aside input{width:100%; padding:8px 11px; font:inherit; font-size:14px; color:var(--fg);
    background:var(--bg); border:1px solid var(--line); border-radius:8px}
  aside .grp{font-size:11.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted);
    margin:16px 20px 6px; font-weight:600}
  aside a.item{display:block; padding:6px 20px; text-decoration:none; color:var(--fg); font-size:14.5px;
    border-left:3px solid transparent}
  aside a.item:hover{background:var(--accent-soft)}
  aside a.item.on{background:var(--accent-soft); border-left-color:var(--accent); font-weight:600}
  aside a.item .k{display:block; font-size:11.5px; color:var(--muted); font-weight:400}
  main{flex:1 1 auto; min-width:0; padding:36px 46px 120px; max-width:940px}
  .bar{display:flex; gap:10px; align-items:center; flex-wrap:wrap; margin-bottom:26px}
  .bar button{font:inherit; font-size:13.5px; padding:6px 12px; border:1px solid var(--line);
    background:var(--panel); color:var(--fg); border-radius:7px; cursor:pointer; box-shadow:var(--shadow)}
  .bar button:hover{border-color:var(--accent); color:var(--accent)}
  .bar .where{margin-left:auto; font-size:12.5px; color:var(--muted);
    font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .hero h1{font-size:30px; margin:0 0 10px}
  .hero p{color:var(--muted); max-width:62ch}
  .card{background:var(--panel); border:1px solid var(--line); border-radius:12px;
    padding:18px 20px; margin:18px 0; box-shadow:var(--shadow)}
  .card h2{margin:0 0 6px; font-size:19px; font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
  .card .kind{font-size:11.5px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted)}
  .card p.desc{margin:8px 0 12px}
  .card p.lead{margin:14px 0 4px; font-size:12px; letter-spacing:.05em; text-transform:uppercase;
    color:var(--muted); font-weight:600}
  .asks{margin:6px 0 0; padding-left:18px}
  .asks li{color:var(--muted); font-style:italic; margin:4px 0}
  pre{background:var(--code); padding:13px 15px; border-radius:9px; overflow-x:auto; margin:10px 0}
  pre code, code{font:13.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace}
  code{background:var(--code); padding:2px 5px; border-radius:4px}
  pre code{background:none; padding:0}
  .doclinks{margin-top:12px; font-size:13.5px; color:var(--muted)}
  article h1{font-size:27px; margin:0 0 16px}
  article h2{font-size:20px; margin:32px 0 12px; padding-bottom:6px; border-bottom:1px solid var(--line)}
  article h3{font-size:17px; margin:24px 0 8px}
  article blockquote{margin:16px 0; padding:2px 0 2px 16px; border-left:3px solid var(--line); color:var(--muted)}
  article table{border-collapse:collapse; width:100%; margin:16px 0; font-size:14.5px; display:block; overflow-x:auto}
  article th,article td{border:1px solid var(--line); padding:8px 10px; text-align:left; vertical-align:top}
  article th{background:var(--code)}
  article hr{border:0; border-top:1px solid var(--line); margin:28px 0}
  pre.raw{white-space:pre-wrap}
  .note{font-size:13.5px; color:var(--muted); border:1px dashed var(--line); border-radius:9px;
    padding:11px 13px; margin:0 0 20px}
  .burger{display:none}
  @media (max-width:860px){
    .wrap{display:block}
    aside{position:static; width:auto; height:auto; border-right:0; border-bottom:1px solid var(--line)}
    aside.hide{display:none}
    main{padding:22px 16px 80px; max-width:none}
    .burger{display:inline-block}
  }
</style>
</head>
<body>
<div class="wrap">
  <aside id="side"></aside>
  <main>
    <div class="bar">
      <button class="burger" id="menu">☰ Skills</button>
      <button id="home">All skills</button>
      <button id="theme">Dark / light</button>
      <span class="where" id="where"></span>
    </div>
    <div class="note" id="fallback" hidden></div>
    <article id="view"></article>
  </main>
</div>
<script id="manifest" type="application/json">${payload}</script>
<script src="${MARKED}" async></script>
<script>
(function(){
  var M = JSON.parse(document.getElementById('manifest').textContent);
  var side = document.getElementById('side'), view = document.getElementById('view');
  var where = document.getElementById('where'), fallback = document.getElementById('fallback');
  var esc = function(s){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); };
  ${stripFrontmatter.toString()}
  var cache = {};

  function sidebar(filter){
    var q = (filter || '').trim().toLowerCase();
    var hit = function(s){
      return !q || (s.name + ' ' + s.description + ' ' + (s.useWhen||'')).toLowerCase().indexOf(q) > -1;
    };
    var html = '<div class="brand"><strong>Agent Skills</strong>' +
      '<span>' + M.skills.length + ' skills · crissmoldovan/agent-skills</span></div>' +
      '<div class="search"><input id="q" type="search" placeholder="Search skills" value="' +
      esc(filter || '') + '"></div>' +
      '<div class="grp">Skills</div>';
    M.skills.filter(hit).forEach(function(s){
      html += '<a class="item" href="#skill/' + s.name + '">' + esc(s.name) +
        (s.kind ? '<span class="k">' + esc(s.kind) + '</span>' : '') + '</a>';
    });
    html += '<div class="grp">Documents</div>';
    M.documents.forEach(function(d){
      html += '<a class="item" href="#doc/' + encodeURIComponent(d.path) + '">' + esc(d.title) + '</a>';
    });
    side.innerHTML = html;
    var input = document.getElementById('q');
    input.oninput = function(){ sidebar(this.value); document.getElementById('q').focus(); };
    mark();
  }

  function mark(){
    var h = location.hash || '';
    [].forEach.call(side.querySelectorAll('a.item'), function(a){
      a.classList.toggle('on', a.getAttribute('href') === h);
    });
  }

  function render(source, el){
    var md = stripFrontmatter(source);
    if (window.marked){ el.innerHTML = window.marked.parse(md); fallback.hidden = true; }
    else {
      el.innerHTML = '<pre class="raw">' + esc(md) + '</pre>';
      fallback.hidden = false;
      fallback.textContent = 'The markdown formatter could not load, so the text is shown exactly as ' +
        'it is in the file. Everything is still readable.';
    }
  }

  function get(p, then){
    if (cache[p] !== undefined) return then(cache[p]);
    fetch('content/' + p).then(function(r){
      if (!r.ok) throw new Error(r.status);
      return r.text();
    }).then(function(t){ cache[p] = t; then(t); }).catch(function(){
      fallback.hidden = false;
      fallback.textContent = 'Could not read content/' + p + '. This page reads the markdown beside ' +
        'it, so it needs to be served over http — open the hosted site, or run a static server in ' +
        'this folder.';
      then(null);
    });
  }

  function card(s){
    var html = '<div class="card"><h2>' + esc(s.name) + '</h2>' +
      (s.kind ? '<div class="kind">' + esc(s.kind) + '</div>' : '') +
      '<p class="desc">' + esc(s.description) + '</p>' +
      '<pre><code>' + s.install.map(esc).join('\\n') + '</code></pre>';
    if (s.examples.length){
      html += '<p class="lead">Ask it:</p><ul class="asks">' + s.examples.map(function(e){
        return '<li>' + esc(e) + '</li>';
      }).join('') + '</ul>';
    }
    if (s.commands.length){
      html += '<p class="lead">Run it:</p><pre><code>' +
        s.commands.map(esc).join('\\n\\n') + '</code></pre>';
    }
    html += '<div class="doclinks">' + s.documents.map(function(d){
      return '<a href="#doc/' + encodeURIComponent(d.path) + '">' + esc(d.title) + '</a>';
    }).join(' · ') + '</div></div>';
    return html;
  }

  function home(){
    where.textContent = M.skills.length + ' skills';
    view.innerHTML = '<div class="hero"><h1>Agent Skills</h1>' +
      '<p>' + M.skills.length + ' skills an agent picks up by its description. Every entry below ' +
      'carries that description, its install command, and the asks the skill itself publishes. ' +
      'Nothing here is written for the site: it is generated from the skills.</p></div>' +
      M.skills.map(card).join('');
  }

  function skill(name){
    var s = M.skills.filter(function(x){ return x.name === name; })[0];
    if (!s) return home();
    where.textContent = 'skills/' + name + '/SKILL.md';
    view.innerHTML = card(s) + '<article id="body"></article>';
    get('skills/' + name + '/SKILL.md', function(md){
      if (md !== null) render(md, document.getElementById('body'));
    });
  }

  function document_(p){
    where.textContent = p;
    view.innerHTML = '<article id="body"></article>';
    get(p, function(md){ if (md !== null) render(md, document.getElementById('body')); });
  }

  function route(){
    var h = (location.hash || '').slice(1);
    if (h.indexOf('skill/') === 0) skill(h.slice(6));
    else if (h.indexOf('doc/') === 0) document_(decodeURIComponent(h.slice(4)));
    else home();
    mark();
    window.scrollTo(0, 0);
    if (window.innerWidth <= 860) side.classList.add('hide');
  }

  window.addEventListener('hashchange', route);
  document.getElementById('home').onclick = function(){ location.hash = ''; route(); };
  document.getElementById('menu').onclick = function(){ side.classList.toggle('hide'); };
  document.getElementById('theme').onclick = function(){
    var dark = document.documentElement.getAttribute('data-theme') === 'dark';
    document.documentElement.setAttribute('data-theme', dark ? 'light' : 'dark');
  };
  // The renderer is loaded async; re-render once it lands.
  var wait = setInterval(function(){ if (window.marked){ clearInterval(wait); route(); } }, 60);
  setTimeout(function(){ clearInterval(wait); }, 8000);

  sidebar('');
  route();
})();
</script>
</body>
</html>
`;
}

/** Generates the site into `out`. Returns what it wrote. */
export async function buildSite({ root, out }) {
  const skills = await collectSkills({ root });
  const documents = await collectDocuments({ root });
  const manifest = { generated: new Date().toISOString().slice(0, 10), skills, documents };

  const files = [
    ...new Set([
      ...skills.flatMap((skill) => skill.documents.map((doc) => doc.path)),
      ...documents.map((doc) => doc.path),
    ]),
  ];
  for (const file of files) {
    const target = path.join(out, 'content', file);
    await mkdir(path.dirname(target), { recursive: true });
    await copyFile(path.join(root, file), target);
  }

  await mkdir(out, { recursive: true });
  await writeFile(path.join(out, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(out, 'index.html'), page(manifest));
  // GitHub Pages must not run Jekyll over the content.
  await writeFile(path.join(out, '.nojekyll'), '');

  return { skills: skills.length, documents: documents.length, files: files.length, out };
}

/**
 * Whether this file was run, rather than imported.
 *
 * This is the pack's guard, kept identical to its copies and swept by
 * `test/entrypoint-guard.test.mjs`. `process.argv[1]` keeps a symlinked path as
 * typed while `import.meta.url` is the file Node resolved it to, so comparing
 * them unresolved is false whenever the pack is reached through a link — which
 * is how the Skills CLI installs it. BOTH sides are resolved, because
 * `--preserve-symlinks-main` moves the unresolved path to the other side.
 * `realpathSync.native` also returns the on-disk case, which a case-insensitive
 * volume would otherwise make compare unequal; it can throw, so a failure falls
 * back to the unresolved comparison rather than crashing an importer.
 */
function isEntrypoint(moduleUrl) {
  const invoked = process.argv[1];
  if (!invoked) return false;
  const modulePath = fileURLToPath(moduleUrl);
  try {
    return realpathSync.native(invoked) === realpathSync.native(modulePath);
  } catch {
    return path.resolve(invoked) === modulePath;
  }
}

if (isEntrypoint(import.meta.url)) {
  const flag = process.argv.indexOf('--out');
  // fileURLToPath, not the URL's pathname: a checkout under a path with a space
  // or a `#` arrives percent-encoded and nothing would be found.
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const out = flag > -1 ? path.resolve(process.argv[flag + 1]) : path.join(root, 'site/dist');
  const result = await buildSite({ root, out });
  console.log(
    `Site built: ${result.skills} skills, ${result.documents} documents, ` +
      `${result.files} markdown files copied into ${path.relative(root, out)}/content.`,
  );
}
