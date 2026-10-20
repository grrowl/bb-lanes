// Check All/project layout with real bb data, previewing the local build only.
// PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/scale.mjs
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BB, launch } from './browser.mjs';

const out = process.argv[2] ?? 'docs/fidelity/live/scale';
mkdirSync(out, {recursive: true});
const results = [], samples = [], errors = [];
const browser = await launch();
try {
  for (const scheme of ['light', 'dark']) {
    const page = await browser.newPage({viewport:{width:1440,height:900}, colorScheme:scheme});
    page.setDefaultTimeout(20000);
    page.on('pageerror', e => errors.push({scheme, message:e.message}));
    page.on('console', m => { if(m.type()==='error') errors.push({scheme,message:m.text()}); });
    await page.route('**/api/v1/plugin-app-assets/*/app.*', async route => {
      const response = await route.fetch();
      const body = await response.text();
      const js = route.request().url().endsWith('/app.js');
      const lanes = js ? body.includes('Pan back and forth') && body.includes('Window span') : body.includes('.lanes-tray');
      await route.fulfill(lanes ? {response, body:readFileSync(`dist/app.${js?'js':'css'}`, 'utf8')} : {response});
    });
    await page.goto(`${BB}/plugins/agent-lanes/lanes`,{waitUntil:'networkidle'});
    await page.evaluate(dark => document.documentElement.classList.toggle('dark',dark),scheme==='dark');
    await page.getByRole('button',{name:'Keyboard shortcuts',exact:true}).click();
    const help=page.getByRole('dialog',{name:'Keyboard shortcuts',exact:true});
    const preference=help.getByRole('checkbox',{name:'Open to the side by default'});
    const before=(await help.boundingBox()).width;
    await preference.click();
    const after=(await help.boundingBox()).width;
    assert(Math.abs(before-after)<0.5,'Help width stays fixed when the preference changes');
    await help.screenshot({path:join(out,`help-${scheme}.png`)});
    await page.keyboard.press('Escape');
    await help.waitFor({state:'detached'});
    results.push({name:`${scheme}: opening preference does not resize help`,status:'passed'});

    await page.getByRole('radio',{name:'All',exact:true}).click();
    await page.getByRole('button',{name:/^Group by/}).click();
    await page.getByRole('menuitemradio',{name:/^Project/}).click();
    await page.getByRole('menu').waitFor({state:'detached'});
    await page.waitForFunction(()=>!document.querySelector('.bl[data-reflow]'));
    const measure=()=>page.evaluate(()=>{
      const root=document.querySelector('.bl');
      const scroller=root.querySelector('.bl-scroller');
      const canvas=root.querySelector('.bl-canvas');
      const key=Object.keys(root).find(k=>k.startsWith('__reactFiber$'));
      let fiber=root[key];
      while(fiber && !Array.isArray(fiber.memoizedProps?.rows)) fiber=fiber.return;
      const rows=fiber?.memoizedProps.rows??[];
      const rendered=[...root.querySelectorAll('.bl-name')].map(el=>({id:el.dataset.row,top:el.getBoundingClientRect().top}));
      return {totalRows:rows.length,groups:rows.filter(r=>r.kind==='group').length,lanes:rows.filter(r=>r.kind==='lane').length,
        viewport:innerHeight,rootHeight:root.clientHeight,scrollerHeight:scroller.clientHeight,scrollHeight:scroller.scrollHeight,scrollTop:scroller.scrollTop,
        renderedRows:rendered.length,blocks:root.querySelectorAll('.bl-item').length,canvasHeight:canvas.clientHeight,
        firstRow:rows[0]?.id,lastRow:rows.at(-1)?.id,rendered};
    });
    const top=await measure();
    assert(top.totalRows>0,'All/project has rows');
    assert(top.scrollerHeight<top.viewport,'Rows scroll within the pane');
    await page.screenshot({path:join(out,`all-top-${scheme}.png`)});
    for(const fraction of [0.5,1]) {
      await page.locator('.bl-scroller').evaluate((el,f)=>{el.scrollTop=(el.scrollHeight-el.clientHeight)*f;},fraction);
      await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
      samples.push({scheme,position:fraction,...await measure()});
    }
    const bottom=await measure();
    assert(bottom.rendered.some(r=>r.id===bottom.lastRow),'The last row renders after scrolling to the bottom');
    await page.screenshot({path:join(out,`all-bottom-${scheme}.png`)});
    results.push({name:`${scheme}: All/project renders and scrolls ${top.lanes} threads in ${top.groups} groups`,status:'passed'});
    samples.push({scheme,position:0,helpWidthBefore:before,helpWidthAfter:after,...top});

    await page.goto(`http://localhost:5199/?scenario=stress&span=7d&theme=${scheme}`,{waitUntil:'networkidle'});
    await page.locator('.bl-scroller').waitFor();
    const stress=await measure();
    assert.equal(stress.lanes,200);
    const frames=await page.evaluate(()=>new Promise(resolve=>{
      const el=document.querySelector('.bl-scroller');
      const times=[];
      let start=null, previous=null;
      function tick(now) {
        start??=now;
        if(previous!==null) times.push(now-previous);
        previous=now;
        el.scrollTop=(el.scrollHeight-el.clientHeight)*Math.min(1,(now-start)/2000);
        if(now-start<2000) requestAnimationFrame(tick);
        else resolve(times);
      }
      requestAnimationFrame(tick);
    }));
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const stressBottom=await measure();
    assert(stressBottom.rendered.some(r=>r.id===stressBottom.lastRow),'Stress fixture renders the last lane');
    samples.push({scheme,scenario:'stress',frameIntervals:frames,...stressBottom});
    await page.screenshot({path:join(out,`stress-bottom-${scheme}.png`)});
    results.push({name:`${scheme}: 200-thread, seven-day fixture scrolls to the last row`,status:'passed'});
    await page.close();
  }
} finally {
  writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2));
  writeFileSync(join(out,'layout.json'),JSON.stringify(samples,null,2));
  writeFileSync(join(out,'errors.json'),JSON.stringify(errors,null,2));
  await browser.close();
}
