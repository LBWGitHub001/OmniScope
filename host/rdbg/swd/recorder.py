"""Session JSONL recorder for SWD samples."""

from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import List, Optional


class Recorder:
    def __init__(self, directory: Path) -> None:
        self.directory = directory
        self.lock = threading.Lock()
        self.file = None
        self.path: Optional[Path] = None
        self.active = False
        self.hold = False

    def ensure_started(self) -> None:
        with self.lock:
            if self.hold or self.active:
                return
            self.directory.mkdir(parents=True, exist_ok=True)
            existing = sorted(self.directory.glob("*.jsonl"), key=lambda p: p.stat().st_mtime, reverse=True)
            for old in existing[19:]:
                try:
                    old.unlink()
                except OSError:
                    pass
            self.path = self.directory / time.strftime("session-%Y%m%d-%H%M%S.jsonl")
            self.file = self.path.open("a", encoding="utf-8")
            self.active = True

    def stop(self) -> None:
        with self.lock:
            self.hold = True
            self.active = False
            if self.file is not None:
                self.file.flush()
                self.file.close()
                self.file = None

    def resume(self) -> None:
        with self.lock:
            self.hold = False
        self.ensure_started()

    def write(self, row: dict) -> None:
        line = json.dumps(row, ensure_ascii=False) + "\n"
        with self.lock:
            if not self.active or self.file is None:
                return
            self.file.write(line)
            self.file.flush()

    def names(self) -> List[str]:
        if not self.directory.is_dir():
            return []
        return sorted((path.name for path in self.directory.glob("*.jsonl")), reverse=True)
