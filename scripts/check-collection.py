#!/usr/bin/env python3
"""Exercise naming permissions and display assignment with the real Collection UI and a Tauri fixture."""
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from threading import Thread
from functools import partial
from playwright.sync_api import sync_playwright

ROOT = Path(__file__).resolve().parents[1]
BRIDGE = r"""
(() => {
 const f = window.collectionFixture = {
   handlers: {}, calls: [], failRename: false,
   entries: [
     {stickerId:'original',name:null,canRename:true,date:'2026-10-06',originalNumber:1,sourceType:'created',onDesktop:true},
     {stickerId:'gift',name:'Author’s cat',canRename:false,date:'2026-10-06',sourceType:'gift',onDesktop:false},
     {stickerId:'pack',name:null,canRename:false,date:'2026-10-06',sourceType:'pack',onDesktop:false},
   ], placement:{displayId:'Old display',relativeX:.5,relativeY:.5},
 };
 window.__TAURI__ = {
   event: {listen:async(name,handler)=>{f.handlers[name]=handler;return()=>{};}},
   core: {invoke: async(name,args)=>{
     f.calls.push({name,args});
     if(name==='profile_get')return {displayName:'Me'};
     if(name==='daily_status')return {canCreate:true};
     if(name==='book_index')return [{year:2026,month:10,count:3}];
     if(name==='book_page')return structuredClone(f.entries);
     if(name==='sticker_asset')return new Uint8Array(await (await fetch('art/samples/cat-skateboard.png')).arrayBuffer());
     if(name==='sticker_back')return null;
     if(name==='display_choices')return [{id:'macos:A',name:'Same Monitor',isPrimary:true},{id:'macos:B',name:'Same Monitor',isPrimary:false}];
     if(name==='sticker_placement')return args.stickerId==='original'?structuredClone(f.placement):null;
     if(name==='sticker_rename'){
       if(f.failRename)throw 'test_save_failed';
       const entry=f.entries.find(e=>e.stickerId===args.stickerId);
       if(!entry.canRename)throw 'name is fixed';
       entry.name=args.name.trim()||null;
       f.handlers['stickers-changed']?.();
       return structuredClone(entry);
     }
     if(name==='gift_send'){
       f.entries.find(e=>e.stickerId===args.stickerId).canRename=false;
       return {edition:1,savedTo:'gift.peta'};
     }
     if(name==='sticker_set_display'){
       f.placement.displayId=args.displayId;
       f.handlers['placements-changed']?.();
       return null;
     }
     throw new Error('Unmocked command '+name);
   }},
 };
})();
"""

class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_):
        pass

server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(ROOT / 'src')))
Thread(target=server.serve_forever, daemon=True).start()
errors = []
try:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch(executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = browser.new_page(viewport={'width':1040,'height':740})
        page.on('pageerror', lambda error: errors.append(str(error)))
        page.add_init_script(BRIDGE)
        page.goto(f'http://127.0.0.1:{server.server_port}/collection.html')
        page.locator('[data-sticker-id="original"]').click()
        page.wait_for_selector('#display-form:not([hidden])')
        assert not page.locator('#sticker-name').get_attribute('readonly')
        assert page.locator('#sticker-name-save').is_visible()
        page.locator('#sticker-name').fill('  猫 🐈 <script>  ')
        page.locator('#sticker-name-save').click()
        page.wait_for_function("document.querySelector('#sticker-name-status').textContent==='Saved'")
        page.wait_for_function("document.querySelector('[data-sticker-id=original] small').textContent.includes('猫 🐈 <script>')")
        assert page.locator('#sticker-name').input_value() == '猫 🐈 <script>'
        assert page.locator('script:not([src])').count() == 0
        page.locator('#detail-close').click()
        page.locator('[data-sticker-id="original"]').click()
        page.wait_for_function("document.querySelector('#sticker-name').value==='猫 🐈 <script>'")
        count = page.evaluate("collectionFixture.calls.filter(c=>c.name==='sticker_rename').length")
        page.locator('#sticker-name').fill('猫' * 81)
        page.locator('#sticker-name-save').click()
        page.wait_for_function("document.querySelector('#sticker-name-status').textContent.includes('80 characters')")
        assert page.evaluate("collectionFixture.calls.filter(c=>c.name==='sticker_rename').length") == count
        page.evaluate('collectionFixture.failRename=true')
        page.locator('#sticker-name').fill('Failed name')
        page.locator('#sticker-name-save').click()
        page.wait_for_function("document.querySelector('#sticker-name-status').textContent==='test_save_failed'")
        assert not page.locator('#sticker-name-save').is_disabled()
        page.evaluate('collectionFixture.failRename=false')
        page.locator('#sticker-name').fill(' ')
        page.locator('#sticker-name-save').click()
        page.wait_for_function("document.querySelector('#sticker-name-status').textContent==='Name cleared'")
        page.locator('#sticker-name').fill('Fixed cat')
        page.locator('#sticker-name-save').click()
        page.wait_for_function("document.querySelector('#sticker-name-status').textContent==='Saved'")
        page.locator('#sticker-display').select_option('macos:B')
        page.locator('#display-save').click()
        page.wait_for_function("collectionFixture.placement.displayId==='macos:B'")
        page.locator('#act-gift').click()
        page.locator('#gift-to').fill('Nao')
        page.locator('#sticker-name').fill('Unsaved draft')
        page.locator('#gift-send').click()
        page.wait_for_function("document.querySelector('#msg').textContent.includes('Save the sticker name')")
        assert page.evaluate("collectionFixture.calls.filter(c=>c.name==='gift_send').length") == 0
        page.locator('#sticker-name').fill('Fixed cat')
        page.locator('#gift-send').click()
        page.wait_for_function("document.querySelector('#sticker-name').readOnly")
        assert page.locator('#sticker-name-save').is_hidden()
        assert page.locator('#sticker-name').input_value() == 'Fixed cat'
        for sticker_id in ['gift','pack']:
            page.locator(f'[data-sticker-id="{sticker_id}"]').click()
            page.wait_for_function("document.querySelector('#sticker-name').readOnly")
            assert page.locator('#sticker-name-save').is_hidden()
        assert not errors, errors
        browser.close()
    print('PASS: rename/clear/reopen, Unicode/plain-text titles, length validation, save errors, Gift freeze, received Gift/Pack locks, and display assignment.')
finally:
    server.shutdown()
    server.server_close()
