"""memory-store skill — save and retrieve user goals and context."""

import json
from pathlib import Path
from anthropic import beta_tool

DATA_DIR = Path(__file__).parent.parent / "data"


def _load() -> dict:
    f = DATA_DIR / "memory.json"
    return json.loads(f.read_text()) if f.exists() else {"goals": {}}


def _save(data: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    (DATA_DIR / "memory.json").write_text(json.dumps(data, indent=2))


@beta_tool
def save_user_goal(goal_id: str, goal_text: str, context: str = "") -> str:
    """Save a user goal to persistent memory for later retrieval.

    Args:
        goal_id: Unique identifier for this goal, e.g. 'goal_001'.
        goal_text: The complete text of the user's goal.
        context: Optional additional context or notes about the goal.
    """
    mem = _load()
    mem["goals"][goal_id] = {"text": goal_text, "context": context}
    _save(mem)
    return f"Saved goal '{goal_id}'."


@beta_tool
def retrieve_context(goal_id: str) -> str:
    """Retrieve stored goal and context by its ID.

    Args:
        goal_id: The unique identifier of the goal to retrieve.
    """
    mem = _load()
    entry = mem.get("goals", {}).get(goal_id)
    if entry:
        return json.dumps(entry)
    return f"No entry found for '{goal_id}'."
