// Mechanical UI screenshotter + human review artifact (#148).
// Shoots a curated table of scenarios across theme x colorScheme, then writes a
// self-contained report.html for a human to thumb-down the broken ones and copy
// out a Markdown bug report.
//
// The scenario table is deliberately NOT a full cross-product: config axes
// (comment layout, floating ToC, mobile, hamburger) only appear on the one or
// two views where they matter, so we cover features without 100s of dupes.
//
// Assumes the dev server is already up: `npm run dev` on http://localhost:8080.
// Run with: npm run ui:shots
import { chromium, type Page } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8080';
// Each run gets its own subdir so a rerun never clobbers files an already-filed
// issue points at. Nothing is deleted; old runs just accumulate under scratch/.
const runId = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
const OUT = `scratch/ui-shots/${runId}`;

const DESKTOP = { width: 1280, height: 900 };
const MOBILE = { width: 390, height: 844 };

// One light + one dark palette; enough to catch contrast bugs without all 19 schemes.
type Look = { theme: string; scheme: string };
// Full 2x2 grid, only for scenarios that are actually theme/palette-sensitive.
const GALLERY: Look[] = [
    { theme: 'reader', scheme: 'github-light' },
    { theme: 'reader', scheme: 'tokyo-night' },
    { theme: 'almanac', scheme: 'github-light' },
    { theme: 'almanac', scheme: 'tokyo-night' },
];
// Feature/layout scenarios render the same regardless of skin, so shoot them once.
// Dark palette catches the most (light-on-light, black-on-dark) in a single shot.
const CANONICAL: Look[] = [{ theme: 'reader', scheme: 'tokyo-night' }];

type Settings = { commentLayout?: 'inline' | 'rail'; tocFloat?: boolean };
type Scenario = {
    name: string;
    route: string;
    full?: boolean; // run across the full GALLERY grid instead of one CANONICAL look
    mobile?: boolean;
    settle?: number; // extra ms for async widgets (mermaid/katex/tikz)
    settings?: Settings;
    act?: (p: Page) => Promise<void>;
    note?: string; // what this shot is meant to exercise (shown in the report)
};

// Add a scenario = one line here. `full` = theme/palette-sensitive (4 shots); else 1.
const SCENARIOS: Scenario[] = [
    { name: 'landing', route: '#/', full: true, note: 'project picker' },
    { name: 'settings', route: '#/settings', full: true, note: 'settings panel' },
    { name: 'home', route: '#/demo/-/Home.md', full: true, note: 'prose, table, frontmatter, tasks link' },
    { name: 'math', route: '#/demo/-/Math.md', full: true, note: 'KaTeX + many sections (ToC)' },
    { name: 'diagrams', route: '#/demo/-/Diagrams.md', full: true, settle: 4500, note: 'mermaid + TikZ (WASM)' },
    { name: 'tasks', route: '#/demo/-/Tasks.md', note: 'task-state checkboxes + metadata' },
    { name: 'code', route: '#/demo/-/Code.md', note: 'syntax highlighting' },
    { name: 'math-tocfloat', route: '#/demo/-/Math.md', settings: { tocFloat: true }, note: 'floating ToC on' },
    { name: 'widget', route: '#/demo/-/Widget.html', note: 'embedded raw-HTML iframe' },
    { name: 'comment-inline', route: '#/demo/-/Home.md', settings: { commentLayout: 'inline' }, act: addComment, note: 'inline comment' },
    { name: 'comment-rail', route: '#/demo/-/Home.md', settings: { commentLayout: 'rail' }, act: addComment, note: 'side-rail comment' },
    { name: 'home-mobile', route: '#/demo/-/Home.md', mobile: true, note: 'mobile width' },
    { name: 'hamburger-mobile', route: '#/demo/-/Home.md', mobile: true, act: openHamburger, note: 'mobile sidebar open' },
];

async function addComment(page: Page) {
    await page.getByRole('button', { name: 'New comment' }).click({ timeout: 5000 });
    await page.locator('.glint-compose textarea').first().fill('Does this line render correctly?');
    await page.locator('.glint-compose button[type=submit]').first().click();
    await page.waitForTimeout(400);
}

async function openHamburger(page: Page) {
    await page.locator('.mobile-toggle').click({ timeout: 5000 });
    await page.waitForTimeout(300);
}

function seed(theme: string, colorScheme: string, s: Settings) {
    // Mirror app-state.ts STATE_KEY / PersistedStateV1 so loadState accepts it.
    return {
        key: 'glint-spa-state',
        value: JSON.stringify({
            version: 1,
            projects: [],
            settings: { colorScheme, theme, commentLayout: s.commentLayout ?? 'inline', paraHighlight: false, tocFloat: s.tocFloat ?? false, vimMode: true, githubPushMode: 'direct', activeProjectRoute: null },
        }),
    };
}

async function main() {
    const commit = execSync('git rev-parse --short HEAD').toString().trim();
    mkdirSync(OUT, { recursive: true }); // fresh subdir per run; never touches prior runs

    const browser = await chromium.launch();
    // Fail loud and early if the dev server isn't up.
    const probe = await browser.newPage();
    await probe.goto(BASE, { waitUntil: 'domcontentloaded' }).catch(() => {
        throw new Error(`Could not reach ${BASE}. Start the dev server first: npm run dev`);
    });
    await probe.close();

    const shots: { name: string; theme: string; scheme: string; route: string; viewport: string; note: string; file: string }[] = [];

    for (const sc of SCENARIOS) {
        for (const look of sc.full ? GALLERY : CANONICAL) {
            const context = await browser.newContext({ viewport: sc.mobile ? MOBILE : DESKTOP });
            await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), seed(look.theme, look.scheme, sc.settings ?? {}));
            const page = await context.newPage();
            await page.goto(`${BASE}/${sc.route}`, { waitUntil: 'networkidle' });
            await page.waitForTimeout(sc.settle ?? 800);
            if (sc.act) await sc.act(page).catch((e) => process.stdout.write(`    (action failed: ${e.message})\n`));
            const file = `${sc.name}-${look.theme}-${look.scheme}.png`;
            await page.screenshot({ path: join(OUT, file), fullPage: true });
            shots.push({ name: sc.name, theme: look.theme, scheme: look.scheme, route: sc.route, viewport: sc.mobile ? 'mobile' : 'desktop', note: sc.note ?? '', file });
            process.stdout.write(`  ${file}\n`);
            await context.close();
        }
    }
    await browser.close();

    writeReport(commit, shots);
    console.log(`\n${shots.length} shots. Open ${join(OUT, 'report.html')}`);
}

function writeReport(commit: string, shots: { name: string; theme: string; scheme: string; route: string; viewport: string; note: string; file: string }[]) {
    const cards = shots.map((s, i) => {
        const b64 = readFileSync(join(OUT, s.file)).toString('base64');
        return { ...s, i, localPath: `${OUT}/${s.file}`, src: `data:image/png;base64,${b64}` };
    });
    const data = JSON.stringify(cards.map(({ src, ...rest }) => rest));

    const cardHtml = cards.map((c) => `
    <div class="card ${c.viewport}" data-i="${c.i}">
      <a class="shot" href="${c.src}" target="_blank"><img src="${c.src}" loading="lazy"></a>
      <div class="meta">
        <button class="thumb" data-i="${c.i}">👎</button>
        <div><strong>${c.name}</strong> · ${c.theme} · ${c.scheme} · ${c.viewport}<br><span class="note">${c.note}</span> <code>${c.route}</code></div>
      </div>
      <textarea data-i="${c.i}" placeholder="what's broken?"></textarea>
    </div>`).join('');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Glint UI review</title>
<style>
  body{font:14px system-ui;margin:0;background:#f4f4f5;color:#18181b}
  header{position:sticky;top:0;background:#18181b;color:#fff;padding:12px 16px;z-index:2}
  header code{background:#3f3f46;padding:1px 5px;border-radius:3px}
  #grid{display:grid;grid-template-columns:repeat(2,1fr);gap:20px;padding:20px}
  .card{background:#fff;border:2px solid #e4e4e7;border-radius:8px;overflow:hidden;display:flex;flex-direction:column}
  .card.down{border-color:#dc2626}
  .shot{display:block}
  .card img{width:100%;display:block}
  /* Mobile shots are narrow but tall: cap by height and center instead of blowing up the width. */
  .card.mobile .shot{display:flex;justify-content:center;background:#e4e4e7}
  .card.mobile img{width:auto;max-height:70vh}
  .meta{display:flex;gap:10px;align-items:center;padding:10px;border-top:1px solid #e4e4e7}
  .note{color:#71717a}
  .thumb{font-size:22px;border:1px solid #d4d4d8;background:#fff;border-radius:6px;cursor:pointer;padding:2px 10px}
  .card.down .thumb{background:#fee2e2;border-color:#dc2626}
  .card textarea{width:100%;box-sizing:border-box;border:none;border-top:1px solid #e4e4e7;padding:8px;font:13px system-ui;resize:vertical;display:none}
  .card.down textarea{display:block}
  footer{position:sticky;bottom:0;background:#18181b;padding:10px 16px}
  footer textarea{width:100%;box-sizing:border-box;height:160px;font:12px ui-monospace,monospace}
  footer button{margin-top:6px;padding:6px 14px;cursor:pointer}
</style></head><body>
<header>Commit <code>${commit}</code> · thumb-down broken shots, add a note, then copy the report. Click a shot to open full size. <em>Images are transient files under ${OUT}/.</em></header>
<div id="grid">${cardHtml}</div>
<footer><textarea id="report" readonly></textarea><button id="copy">Copy report</button></footer>
<script>
const SHOTS = ${data};
const OUT = ${JSON.stringify(OUT)};
const COMMIT = ${JSON.stringify(commit)};
const down = new Set(), notes = {};
function render(){
  const picked = SHOTS.filter(s => down.has(s.i));
  let md = "## UI review @ " + COMMIT + "\\n\\n_Screenshot paths are transient files under " + OUT + "/ (regenerate with npm run ui:shots)._\\n\\n";
  md += picked.length ? picked.map(s =>
    "- **" + s.name + "** · " + s.theme + " · " + s.scheme + " · " + s.viewport + " (\`" + s.route + "\`) — " + (notes[s.i]||"(no note)") + "\\n  \`" + s.localPath + "\`"
  ).join("\\n") : "_Nothing flagged._";
  md += "\\n\\n_Next: paste into \`gh issue create\`._";
  document.getElementById('report').value = md;
}
document.querySelectorAll('.thumb').forEach(b => b.onclick = () => {
  const i = +b.dataset.i, card = b.closest('.card');
  down.has(i) ? down.delete(i) : down.add(i);
  card.classList.toggle('down', down.has(i));
  render();
});
document.querySelectorAll('.card textarea').forEach(t => t.oninput = () => { notes[+t.dataset.i] = t.value.trim(); render(); });
document.getElementById('copy').onclick = () => navigator.clipboard.writeText(document.getElementById('report').value);
render();
</script></body></html>`;
    writeFileSync(join(OUT, 'report.html'), html);
}

main().catch((e) => { console.error(e.message || e); process.exit(1); });
