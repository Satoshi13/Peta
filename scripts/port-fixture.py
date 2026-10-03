"""Seed an isolated native capture library; never point this at a user's data directory.
Usage: python3 scripts/port-fixture.py /tmp/peta-port-data/app.peta.desktop
"""
from pathlib import Path
import sqlite3, re, json, struct, shutil, sys
from PIL import Image
root=Path(__file__).resolve().parents[1]
dir=Path(sys.argv[1]).resolve()
if not dir.is_relative_to(Path('/tmp')): raise SystemExit('Capture fixtures must be under /tmp')
dir.mkdir(parents=True,exist_ok=True)
db=sqlite3.connect(dir/'peta.db')
src=(root/'src-tauri/crates/core/src/db.rs').read_text()
for version in range(1,7):
    if db.execute('pragma user_version').fetchone()[0]<version:
        migration=re.search(r'const MIGRATION_V'+str(version)+r': &str = "(.*?)";',src,re.S)[1]
        db.executescript(migration); db.execute(f'pragma user_version={version}')
db.execute("INSERT OR REPLACE INTO meta VALUES ('display_name','Satoshi')")
for id,day,count in [('matte','2026-09-01',0),('kraft','2026-09-28',1),('holographic','2026-10-02',0)]:
    db.execute('INSERT OR REPLACE INTO material_unlocks VALUES (?,?)',(id,day+'T12:00:00Z'))
    db.execute('INSERT OR REPLACE INTO material_stock VALUES (?,?)',(id,count))
for no,key,day,mat in [(12,'cat-skateboard','2026-10-02','holographic'),(11,'coffee-cup','2026-10-01','matte'),(10,'blue-flower','2026-09-28','kraft'),(9,'fried-egg','2026-09-20','matte'),(8,'film-camera','2026-09-11','matte'),(7,'potted-plant','2026-08-30','kraft'),(6,'polaroid-mountain','2026-08-14','holographic'),(5,'good-day','2026-08-03','matte')]:
    id=f'PETA-PORT-{no:04}'
    rel=f'stickers/{id}/rendered.png'; out=dir/'assets'/rel; out.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(root/f'src/art/samples/{key}.png',out)
    im=Image.open(out); aspect=im.width/im.height
    db.execute('INSERT OR REPLACE INTO stickers (id,created_at,original_asset_path,rendered_asset_path,material_id,original_number,source_type,aspect,creator_name) VALUES (?,?,?,?,?,?,?,?,?)',(id,day+'T12:00:00Z',rel,rel,mat,no,'created',aspect,'Satoshi'))
    db.execute('INSERT OR REPLACE INTO provenance VALUES (?,0,?,?,?)',(id,'created','Satoshi',day+'T12:00:00Z'))
    if no in [11,12]: db.execute('INSERT OR REPLACE INTO placements VALUES (?,?,?,?,?,?,?,?,?)',(id,'capture-display',.68 if no==12 else .2,.5 if no==12 else .62,.13,-5 if no==12 else 4,day+'T12:00:00Z',1,no))
for id,name,key,note,mat,no in [('GIFT-PORT-NAO','Nao','cassette-tape','for your desk','kraft',42),('GIFT-PORT-YUKI','Yuki','good-day','','matte',7)]:
    png=(root/f'src/art/samples/{key}.png').read_bytes(); im=Image.open(root/f'src/art/samples/{key}.png')
    header=dict(giftId=id,**{'from':name},note=note,sentAt='2026-10-03T10:00:00Z',edition=no,origin=dict(stickerId='PETA-PORT-0000',creatorName=name,createdAt='2026-10-03T10:00:00Z',materialId=mat,aspect=im.width/im.height),pngLen=len(png),maskLen=0)
    meta=json.dumps(header).encode(); rel=f'gifts/{id}.peta'; out=dir/'assets'/rel; out.parent.mkdir(parents=True,exist_ok=True); out.write_bytes(b'PETAGIFT\x01'+struct.pack('>I',len(meta))+meta+png)
    db.execute('INSERT OR REPLACE INTO gifts_received (gift_id,from_name,note,sent_at,received_at,package) VALUES (?,?,?,?,?,?)',(id,name,note,header['sentAt'],header['sentAt'],rel))
db.commit(); db.close()
print(dir)
