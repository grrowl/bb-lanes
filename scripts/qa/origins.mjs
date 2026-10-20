// Preview origin markers and tool-group tooltips without changing the installed plugin.
// Explicit attribution for live data is checked against each recorded input event.
// PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/origins.mjs
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BB, HARNESS, launch } from './browser.mjs';

const out = process.argv[2] ?? 'docs/fidelity/live/origins';
mkdirSync(out, { recursive: true });
const results = [], styles = [], errors = [];
const requests = new Map();
const browser = await launch();
const markerStyle = el => {
  const dot=getComputedStyle(el,'::after');
  const probe=document.createElement('span');
  probe.style.color=el.dataset.origin==='system'?'var(--bl-danger-fg)':'var(--bl-run-fg)';
  el.append(probe);
  const palette=getComputedStyle(probe).color;
  probe.remove();
  return {width:dot.width,height:dot.height,border:dot.borderColor,left:dot.left,background:dot.backgroundColor,palette};
};
function confirmed(block) {
  if (typeof block.seq !== 'number' || block.seq < 1) return false;
  const key = `${block.threadId}:${block.seq}`;
  if (!requests.has(key)) {
    let initiator = null;
    try {
      const events = JSON.parse(execFileSync('bb', ['thread', 'messages', block.threadId, '--after-seq', String(block.seq - 1), '--limit', '1', '--json'], {encoding:'utf8', stdio:['ignore','pipe','ignore']}));
      const request = events.find(e => e.seq === block.seq && e.type === 'client/turn/requested');
      if (['user','agent','system'].includes(request?.data?.initiator)) initiator = request.data.initiator;
    } catch { /* Unreadable inputs stay unconfirmed. */ }
    requests.set(key, initiator);
  }
  return requests.get(key) === block.initiator;
}
function annotate(value) {
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value.blocks)) for (const block of value.blocks) block.initiatorConfirmed = confirmed(block);
  for (const child of Object.values(value)) if (!Array.isArray(child)) annotate(child);
}
async function checkTools(page, label) {
  const tools = page.locator('.bl-tools').filter({visible:true}).first();
  await tools.hover({force:true});
  const tip = page.getByRole('tooltip');
  await tip.waitFor();
  assert.match(await tip.innerText(), /Commands|Edits|Tools|Delegation|Web|MCP|Skills/);
  await page.screenshot({path:join(out,`${label}-tools.png`)});
  await page.keyboard.press('Escape');
  await tip.waitFor({state:'detached'});
  const turn = tools.locator('xpath=ancestor::button[1]');
  await page.keyboard.press('Tab');
  await turn.focus();
  await tip.waitFor();
  await page.keyboard.press('Escape');
  await tip.waitFor({state:'detached'});
  assert(await turn.evaluate(el=>el===document.activeElement),'Escape keeps focus on the turn');
  results.push({name:`${label}: group tooltip on hover and keyboard focus; Escape keeps focus`,status:'passed'});
}
try {
  for (const scheme of ['light','dark']) {
    const page = await browser.newPage({viewport:{width:1440,height:900},colorScheme:scheme});
    page.setDefaultTimeout(20000);
    page.on('pageerror', e=>errors.push({scheme,message:e.message}));
    await page.route('**/api/v1/plugin-app-assets/*/app.*', async route=>{
      const response=await route.fetch();
      const body=await response.text();
      const js=route.request().url().endsWith('/app.js');
      const lanes=js?body.includes('Pan back and forth')&&body.includes('Window span'):body.includes('.lanes-tray');
      await route.fulfill(lanes?{response,body:readFileSync(`dist/app.${js?'js':'css'}`,'utf8')}:{response});
    });
    await page.route('**/plugins/agent-lanes/rpc/lanes_window',async route=>{
      const response=await route.fetch();
      const body=await response.json();
      annotate(body);
      await route.fulfill({response,json:body});
    });
    await page.goto(`${BB}/plugins/agent-lanes/lanes`,{waitUntil:'networkidle'});
    await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),scheme==='dark');
    await page.locator('.lanes-tray').click({position:{x:500,y:12}});
    await page.keyboard.press('1');
    await page.waitForFunction(()=>!document.querySelector('.bl[data-moving]'));
    const user = page.locator('.bl-slot[data-origin=user]').first();
    await user.waitFor();
    const measurement=await user.evaluate(markerStyle);
    assert.equal(measurement.width,'7px');
    assert.equal(measurement.height,'7px');
    assert.equal(measurement.left,'0px');
    assert.equal(measurement.border,measurement.palette);
    styles.push({scheme,surface:'live',...measurement});
    await page.screenshot({path:join(out,`live-${scheme}.png`)});
    results.push({name:`${scheme}: live user markers are confirmed against recorded inputs`,status:'passed'});
    await checkTools(page,`live-${scheme}`);

    await page.goto(`${HARNESS}?elapsed=2&speed=0&span=1h&origins=1&theme=${scheme}`,{waitUntil:'networkidle'});
    const human=page.locator('[data-block=c2]');
    assert.equal(await human.locator('..').getAttribute('data-origin'),'user');
    const agent=page.locator('[data-block=e1]');
    assert.equal(await agent.locator('..').getAttribute('data-origin'),null);
    const bb=page.locator('[data-block=m3]');
    assert.equal(await bb.locator('..').getAttribute('data-origin'),'system');
    const red=await bb.locator('..').evaluate(markerStyle);
    assert.equal(red.border,red.palette);
    styles.push({scheme,surface:'bb-fixture',...red});
    assert.equal(await page.locator('[data-block=r2]').locator('..').getAttribute('data-origin'),null);
    assert.equal(await page.locator('.bl-curve[data-kind=tell][data-color=blue]').count()>0,true);
    const origin=human.locator('.bl-origin-hit');
    await origin.hover({force:true});
    await page.getByRole('tooltip').filter({hasText:'Started by you'}).waitFor();
    await page.screenshot({path:join(out,`harness-${scheme}.png`)});
    await page.keyboard.press('Escape');
    await page.getByRole('tooltip').waitFor({state:'detached'});
    await page.mouse.move(0,0);
    await page.locator('.lanes-card').screenshot({path:join(out,`overview-${scheme}.png`)});
    results.push({name:`${scheme}: user origins have standalone rings; spawned/message turns keep their hand-offs`,status:'passed'});
    await checkTools(page,`harness-${scheme}`);
    await page.close();
  }
  assert.equal(errors.length,0,'No browser errors');
} finally {
  writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2));
  writeFileSync(join(out,'styles.json'),JSON.stringify(styles,null,2));
  writeFileSync(join(out,'errors.json'),JSON.stringify(errors,null,2));
  await browser.close();
}
