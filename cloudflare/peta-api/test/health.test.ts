import {SELF} from 'cloudflare:test';
import {expect,it} from 'vitest';
it('health is public and JSON',async()=>{const r=await SELF.fetch('https://peta.test/v1/health');expect(r.status).toBe(200);expect(await r.json()).toEqual({ok:true});});
