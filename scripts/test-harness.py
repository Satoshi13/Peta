#!/usr/bin/env python3
"""Run every Rust harness in tests/*.rs: production code against a fake Tauri, without GTK or macOS.

Each harness has its own runner (it needs a different set of real crates); this runs them all and fails on the first failure.
"""
from pathlib import Path
import os
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[1]
rustc = os.environ.get("RUSTC", "rustc")


def run(*command):
    print("+", " ".join(str(c) for c in command), flush=True)
    subprocess.run([str(c) for c in command], cwd=root, check=True)


def main():
    run(sys.executable, "scripts/check-arrival-threading.py")
    run(sys.executable, "scripts/check-pack-rewards-runtime.py")
    with tempfile.TemporaryDirectory(prefix="peta-reflection-") as directory:
        binary = Path(directory) / "reflection-coordinates"
        run(rustc, "--edition=2021", "--test", "tests/reflection-coordinates.rs", "-o", binary)
        run(binary)


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as error:
        sys.exit(error.returncode or 1)
