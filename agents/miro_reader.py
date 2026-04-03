"""Miro Reader Agent — reads tasks from Miro board. No planning, no ideas."""

import json
from pathlib import Path
from skills.miro_builder import get_board, reset_board, create_node

DATA_DIR = Path(__file__).parent.parent / "data"


def run() -> dict:
    """Read tasks from Miro board. If board is empty, ask user for tasks.

    Returns:
        {"tasks": [...]}
    """
    board = get_board()
    tasks = [n for n in board.get("nodes", []) if n.get("type") == "task"]

    if not tasks:
        print("\n[Miro Reader] Board is empty. Enter tasks one per line.")
        print("  (Press Enter on an empty line when done)\n")

        reset_board()
        index = 1
        while True:
            line = input(f"  Task {index}: ").strip()
            if not line:
                break
            result = create_node(title=line, description=line, node_type="task")
            print(f"  → {result}")
            index += 1

        board = get_board()
        tasks = [n for n in board.get("nodes", []) if n.get("type") == "task"]

    print(f"\n[Miro Reader] {len(tasks)} task(s) loaded from board.")
    return {"tasks": tasks}
