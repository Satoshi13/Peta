#!/usr/bin/env python3
"""Build real core and run production pack commands using a minimal Tauri adapter."""
from pathlib import Path
import json,subprocess,sys,tempfile
root=Path(__file__).resolve().parents[1]
build=subprocess.run(['cargo','build','--manifest-path','src-tauri/Cargo.toml','-p','peta-core','--offline','--message-format=json'],cwd=root,check=True,text=True,stdout=subprocess.PIPE)
libraries={}
for line in build.stdout.splitlines():
 message=json.loads(line)
 if message.get('reason')=='compiler-artifact':
  for filename in message['filenames']:
   if filename.endswith('.rlib'):libraries[message['target']['name']]=filename
deps=root/'src-tauri/target/debug/deps'
suffix='.dylib' if sys.platform=='darwin' else '.so'
with tempfile.TemporaryDirectory(prefix='peta-pack-runtime-') as directory:
 output=Path(directory);macros=output/('libtauri_test_macros'+suffix);binary=output/'pack-runtime'
 subprocess.run(['rustc','--crate-name','tauri_test_macros','--crate-type','proc-macro','tests/support/tauri-command.rs','-o',str(macros)],cwd=root,check=True)
 command=['rustc','--edition=2021','--test','tests/pack-rewards-runtime.rs','-L',f'dependency={deps}','--extern',f'tauri_test_macros={macros}','-o',str(binary)]
 for crate in ['peta_core','serde','image','rusqlite']:
  library=libraries[crate]
  command+=['--extern',f'{crate}={library}']
 subprocess.run(command,cwd=root,check=True)
 subprocess.run([str(binary)],cwd=root,check=True)
