// Mechanical UI screenshotter + human review artifact (#148).
// Shoots each view across the theme × colorScheme matrix, then writes a
// self-contained report.html for a human to thumb-down the broken ones and
// copy out a Markdown bug report.
//
// Assumes the dev server is already up: `npm run dev` on http://localhost:8080.
// Run with: npm run ui:shots
import { chromium } from 'playwright';
import { execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:8080';
const OUT = 'scratch/ui-shots';

// Add a view = one line here.
const VIEWS = [
    { name: 'demo', route: '#/demo' },
    { name: 'settings', route: '#/settings' },
    { name: 'landing', route: '#/' },
];

const THEMES = ['reader', 'almanac'] as const;

function seed(theme: string, colorScheme: string) {
    // Mirror app-state.ts STATE_KEY / PersistedStateV1 so loadState accepts it.
    return {
        key: 'glint-spa-state',
        value: JSON.stringify({
            version: 1,
            projects: [],
            settings: { colorScheme, theme, commentLayout: 'inline', paraHighlight: false, tocFloat: false, vimMode: true, githubPushMode: 'direct', activeProjectRoute: null },
        }),
    };
}

async function main() {
    const commit = execSync('git rev-parse --short HEAD').toString().trim();
    rmSync(OUT, { recursive: true, force: true });
    mkdirSync(OUT, { recursive: true });

    const browser = await chromium.launch();

    // Enumerate colorSchemes off the live settings page so new ones are picked up for free.
    const probe = await browser.newPage();
    await probe.goto(`${BASE}/#/settings`, { waitUntil: 'networkidle' }).catch(() => {
        throw new Error(`Could not reach ${BASE}. Start the dev server first: npm run dev`);
    });
    const colorSchemes = await probe.$$eval('[data-color-scheme] option', (els) => els.map((e) => (e as HTMLOptionElement).value));
    await probe.close();
    if (colorSchemes.length === 0) throw new Error('No color schemes found on the settings page.');

    const shots: { view: string; theme: string; colorScheme: string; route: string; file: string }[] = [];

    for (const theme of THEMES) {
        for (const colorScheme of colorSchemes) {
            const s = seed(theme, colorScheme);
            const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
            await context.addInitScript(({ key, value }) => localStorage.setItem(key, value), s);
            const page = await context.newPage();
            for (const view of VIEWS) {
                await page.goto(`${BASE}/${view.route}`, { waitUntil: 'networkidle' });
                await page.waitForTimeout(700); // let async widget rendering (mermaid/katex/tikz) settle
                const file = `${view.name}-${theme}-${colorScheme}.png`;
                await page.screenshot({ path: join(OUT, file), fullPage: true });
                shots.push({ view: view.name, theme, colorScheme, route: view.route, file });
                process.stdout.write(`  ${file}\n`);
            }
            await context.close();
        }
    }
    await browser.close();

    writeReport(commit, shots);
    console.log(`\n${shots.length} shots. Open ${join(OUT, 'report.html')}`);
}

function writeReport(commit: string, shots: { view: string; theme: string; colorScheme: string; route: string; file: string }[]) {
    const cards = shots.map((s, i) => {
        const b64 = readFileSync(join(OUT, s.file)).toString('base64');
        const localPath = `${OUT}/${s.file}`;
        return { ...s, i, localPath, src: `data:image/png;base64,${b64}` };
    });
    const data = JSON.stringify(cards.map(({ src, ...rest }) => rest));

    const cardHtml = cards.map((c) => `
    <div class="card" data-i="${c.i}">
      <img src="${c.src}" loading="lazy">
      <div class="meta">
        <button class="thumb" data-i="${c.i}">👎</button>
        <div><strong>${c.view}</strong> · ${c.theme} · ${c.colorScheme}<br><code>${c.route}</code></div>
      </div>
      <textarea data-i="${c.i}" placeholder="what's broken?"></textarea>
    </div>`).join('');

    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Glint UI review</title>
<style>
  body{font:14px system-ui;margin:0;background:#f4f4f5;color:#18181b}
  header{position:sticky;top:0;background:#18181b;color:#fff;padding:12px 16px;z-index:2}
  header code{background:#3f3f46;padding:1px 5px;border-radius:3px}
  #grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:16px;padding:16px}
  .card{background:#fff;border:2px solid #e4e4e7;border-radius:8px;overflow:hidden}
  .card.down{border-color:#dc2626}
  .card img{width:100%;display:block;border-bottom:1px solid #e4e4e7}
  .meta{display:flex;gap:10px;align-items:center;padding:8px}
  .thumb{font-size:20px;border:1px solid #d4d4d8;background:#fff;border-radius:6px;cursor:pointer;padding:2px 8px}
  .card.down .thumb{background:#fee2e2;border-color:#dc2626}
  .card textarea{width:100%;box-sizing:border-box;border:none;border-top:1px solid #e4e4e7;padding:8px;font:13px system-ui;resize:vertical;display:none}
  .card.down textarea{display:block}
  footer{position:sticky;bottom:0;background:#18181b;padding:10px 16px}
  footer textarea{width:100%;box-sizing:border-box;height:160px;font:12px ui-monospace,monospace}
  footer button{margin-top:6px;padding:6px 14px;cursor:pointer}
</style></head><body>
<header>Commit <code>${commit}</code> · thumb-down broken shots, add a note, then copy the report below. <em>Images are transient files under ${OUT}/.</em></header>
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
    "- **" + s.view + "** · " + s.theme + " · " + s.colorScheme + " (\`" + s.route + "\`) — " + (notes[s.i]||"(no note)") + "\\n  \`" + s.localPath + "\`"
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
