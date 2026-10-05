#!/usr/bin/env python3
"""Exercise the production arrival watcher with a fake main-thread event loop."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
rustc = os.environ.get("RUSTC", "rustc")
suffix = ".dylib" if sys.platform == "darwin" else ".dll" if sys.platform == "win32" else ".so"
with tempfile.TemporaryDirectory(prefix="peta-arrival-test-") as directory:
    output = Path(directory)
    macros = output / ("libtauri_test_macros" + suffix)
    binary = output / ("arrival-threading.exe" if sys.platform == "win32" else "arrival-threading")
    subprocess.run([rustc, "--crate-name", "tauri_test_macros", "--crate-type", "proc-macro",
                    "tests/support/tauri-command.rs", "-o", str(macros)], cwd=root, check=True)
    subprocess.run([rustc, "--edition=2021", "--test", "tests/arrival-threading.rs",
                    "--extern", f"tauri_test_macros={macros}", "-o", str(binary)], cwd=root, check=True)
    subprocess.run([str(binary)], cwd=root, check=True)
