#!/usr/bin/env python3
"""Validate the P1 catalogue and smoke-test current app visuals with a Tauri fixture."""
from pathlib import Path
import ast
import json
from functools import partial
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from threading import Thread
from playwright.sync_api import sync_playwright

ROOT=Path(__file__).resolve().parents[1]
ART=ROOT/'src/art'
SHOTS=ROOT/'docs/art-stage2'
SHOTS.mkdir(parents=True,exist_ok=True)
manifest=json.loads((ART/'manifest.json').read_text())
class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *args): pass
server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,directory=str(ROOT)))
Thread(target=server.serve_forever,daemon=True).start()
base=f'http://127.0.0.1:{server.server_port}/src/'
# Reuse the mock transport, not runtime app code. Include current inventory contract fields.
tree=ast.parse((ROOT/'scripts/art-browser-check.py').read_text())
bridge=next(ast.literal_eval(n.value) for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='BRIDGE' for t in n.targets))
for rarity in ['common','uncommon','rare']:
    bridge=bridge.replace(f'rarity:"{rarity}",recipe:',f'rarity:"{rarity}",count:1,unlimited:{"true" if rarity=="common" else "false"},recipe:')

with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path='/usr/bin/chromium',args=['--no-sandbox'])
    errors=[]
    for scheme in ['light','dark']:
        context=browser.new_context(viewport={'width':1280,'height':900},color_scheme=scheme)
        page=context.new_page()
        page.on('pageerror',lambda e:errors.append(str(e)))
        page.goto(base+'art/preview.html')
        page.locator('img').evaluate_all("items=>items.forEach(i=>i.loading='eager')")
        page.wait_for_function('Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)')
        assert page.locator('figure').count()==len(manifest['assets'])
        page.get_by_label('P1',exact=True).check()
        assert page.locator('figure:visible').count()==44
        if scheme=='dark': page.get_by_label('ダーク',exact=True).check()
        assert page.locator('.canvas:visible').first.evaluate("e=>getComputedStyle(e).backgroundColor")==('rgb(35, 39, 45)' if scheme=='dark' else 'rgb(245, 240, 230)')
        # Keep legible contact sheets rather than one very tall catalogue screenshot.
        for name,groups in [('samples',['samples/']),('paper-and-book',['back/','book/']),('delivery',['print/','fx/','arrival/','gift/','empty/','onboarding/'])]:
            page.locator('figure').evaluate_all('(items,groups)=>items.forEach(e=>e.style.display=groups.some(g=>e.dataset.file.startsWith(g))?"":"none")',groups)
            page.locator('main').screenshot(path=str(SHOTS/f'{name}-{scheme}.jpg'),type='jpeg',quality=88)
        page.locator('figure').evaluate_all('items=>items.forEach(e=>e.style.display="")')
        page.get_by_label('壁紙風',exact=True).check()
        assert 'linear-gradient' in page.locator('.canvas:visible').first.evaluate('e=>getComputedStyle(e).backgroundImage')
        page.get_by_label('P0',exact=True).check()
        assert page.locator('figure:visible').count()==sum(x['priority']=='P0' for x in manifest['assets'])
        page.get_by_label('すべて',exact=True).check()
        assert page.locator('figure:visible').count()==len(manifest['assets'])
        # Actual Today and Creator HTML/JS, with only native IPC mocked.
        page.add_init_script(bridge)
        page.set_viewport_size({'width':560,'height':1120})
        page.goto(base+'today.html')
        page.wait_for_selector('#stage-envelope:not([hidden])')
        page.locator('#open-material').click()
        page.wait_for_selector('#stage-choose:not([hidden])')
        page.wait_for_function("!document.body.classList.contains('art-opening')")
        page.wait_for_timeout(750)
        assert page.locator('#material-picker .chip').count()==3
        assert page.locator('[data-art="envelope"]').evaluate("e=>getComputedStyle(e,'::before').content")=='none'
        assert page.evaluate("Array.from(document.images).filter(i=>i.getAttribute('src')).every(i=>i.complete&&i.naturalWidth>0)")
        page.screenshot(path=str(SHOTS/f'today-{scheme}.jpg'),type='jpeg',quality=88,full_page=True)
        page.set_viewport_size({'width':1140,'height':720})
        page.goto(base+'creator.html')
        page.wait_for_function("document.getElementById('img-sticker').naturalWidth>0")
        assert page.locator('#mat').evaluate('e=>getComputedStyle(e).borderTopStyle')=='none'
        assert page.locator('[data-art="cutting-progress"]').evaluate("e=>getComputedStyle(e,'::before').content")=='none'
        assert not page.locator('#error').is_visible()
        page.screenshot(path=str(SHOTS/f'creator-{scheme}.jpg'),type='jpeg',quality=88)
        context.close()
    browser.close()
    assert not errors,errors
server.shutdown()
server.server_close()
print('PASS: all catalogue images decoded; 44 P1 assets; background/priority controls; current Today and Creator light/dark visual smoke checks.')
