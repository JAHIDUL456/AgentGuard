import os, sys
from typing import List, Optional

class DataPipeline:
    def __init__(self, name: str):
        self.name = name

    def process(self, items: List[str]) -> int:
        return len(items)

def run_pipeline() -> None:
    pipeline = DataPipeline("main")
    print(pipeline.process(["a", "b"]))
