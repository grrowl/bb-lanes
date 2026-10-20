// Check group summaries during names-column resizing in a browser-only preview.
// PLAYWRIGHT_DIR=/tmp/lanes-qa-tools node scripts/qa/group-headers.mjs
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { BB, launch } from './browser.mjs';

const out=process.argv[2]??'docs/fidelity/live/group-headers';
mkdirSync(out,{recursive:true});
const results=[], measurements=[];
const browser=await launch();
const scan=page=>page.evaluate(()=>{
  const root=document.querySelector('.bl');
  const samples=[];
  for(let width=140;width<=360;width+=2) {
    root.style.setProperty('--bl-names-w',`${width}px`);
    const partial=[];
    for(const summary of root.querySelectorAll('.lanes-group .lanes-summary')) {
      const box=summary.getBoundingClientRect();
      for(const part of summary.children) {
        const rect=part.getBoundingClientRect();
        const visible=Math.min(rect.bottom,box.bottom)-Math.max(rect.top,box.top);
        const visibleWidth=Math.min(rect.right,box.right)-Math.max(rect.left,box.left);
        if(visibleWidth>0.5 && visible>0.5 && visible<rect.height-0.5) partial.push({visible,height:rect.height,visibleWidth});
      }
    }
    samples.push({width,partial});
  }
  return samples;
});
async function shot(page,width,path) {
  await page.locator('.bl').evaluate((root,width)=>root.style.setProperty('--bl-names-w',`${width}px`),width);
  const clip=await page.locator('.bl-names').evaluate(el=>{
    const box=el.getBoundingClientRect();
    const groups=[...el.querySelectorAll('.lanes-group')].map(el=>el.getBoundingClientRect());
    return {x:box.x,y:groups[0].top,width:box.width,height:groups.at(-1).bottom-groups[0].top};
  });
  await page.screenshot({path,clip});
}
try {
  for(const scheme of ['light','dark']) {
    const page=await browser.newPage({viewport:{width:1440,height:900},colorScheme:scheme,deviceScaleFactor:2});
    page.setDefaultTimeout(20000);
    await page.route('**/api/v1/plugin-app-assets/*/app.*',async route=>{
      const response=await route.fetch();
      const body=await response.text();
      const js=route.request().url().endsWith('/app.js');
      const lanes=js?body.includes('Pan back and forth')&&body.includes('Window span'):body.includes('.lanes-tray');
      await route.fulfill(lanes?{response,body:readFileSync(`dist/app.${js?'js':'css'}`,'utf8')}:{response});
    });
    await page.goto(`${BB}/plugins/agent-lanes/lanes`,{waitUntil:'networkidle'});
    await page.evaluate(dark=>document.documentElement.classList.toggle('dark',dark),scheme==='dark');
    await page.getByRole('radio',{name:'All',exact:true}).click();
    await page.getByRole('button',{name:/^Group by/}).click();
    const collapse=page.getByRole('menuitem',{name:'Collapse all groups'});
    await collapse.click();
    await page.getByRole('menu').waitFor({state:'detached'});
    await page.waitForFunction(()=>!document.querySelector('.bl[data-reflow]'));
    const original=await page.addStyleTag({content:'.lanes-group .lanes-summary::before { height: auto; }'});
    const before=await scan(page);
    const failing=before.filter(sample=>sample.partial.length>0).sort((a,b)=>
      Math.max(...b.partial.map(p=>p.visibleWidth))-Math.max(...a.partial.map(p=>p.visibleWidth)))[0];
    assert(failing,'Reproduces the partial second-line summary');
    await shot(page,failing.width,join(out,`before-${scheme}.png`));
    await original.evaluate(el=>el.remove());
    const after=await scan(page);
    assert(after.every(sample=>sample.partial.length===0),'Every count is either fully visible or fully hidden');
    await shot(page,failing.width,join(out,`after-${scheme}.png`));
    measurements.push({scheme,width:failing.width,before,after});
    results.push({name:`${scheme}: all group-summary parts stay whole across column widths 140–360px`,status:'passed'});
    await page.close();
  }
} finally {
  writeFileSync(join(out,'results.json'),JSON.stringify(results,null,2));
  writeFileSync(join(out,'measurements.json'),JSON.stringify(measurements,null,2));
  await browser.close();
}
