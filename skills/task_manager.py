"""task-manager skill — create, update, and complete daily tasks."""

import json
from pathlib import Path
from anthropic import beta_tool

DATA_DIR = Path(__file__).parent.parent / "data"
TASKS_FILE = DATA_DIR / "tasks.json"


def _load_tasks() -> list:
    return json.loads(TASKS_FILE.read_text()) if TASKS_FILE.exists() else []


def _save_tasks(tasks: list) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    TASKS_FILE.write_text(json.dumps(tasks, indent=2))


def reset_tasks() -> None:
    """Clear all tasks for a new session."""
    _save_tasks([])


def get_tasks() -> list:
    return _load_tasks()


def get_incomplete_tasks() -> list:
    return [t for t in _load_tasks() if t["status"] != "done"]


@beta_tool
def create_task(title: str, description: str, priority: str = "medium", due_date: str = "today") -> str:
    """Create a new daily task in the task manager.

    Args:
        title: Short title for the task.
        description: Detailed description of what needs to be done.
        priority: Task priority — 'high', 'medium', or 'low'.
        due_date: When the task should be completed, e.g. 'today' or '2024-01-15'.
    """
    tasks = _load_tasks()
    task_id = f"task_{len(tasks) + 1}"
    tasks.append({
        "id": task_id,
        "title": title,
        "description": description,
        "priority": priority,
        "due_date": due_date,
        "status": "pending",
        "notes": "",
    })
    _save_tasks(tasks)
    return f"Created task '{task_id}': {title} (priority: {priority})"


@beta_tool
def update_task(task_id: str, status: str, notes: str = "") -> str:
    """Update the status or notes of an existing task.

    Args:
        task_id: The ID of the task to update (e.g., 'task_1').
        status: New status — 'pending', 'in_progress', or 'blocked'.
        notes: Optional progress notes or blockers to record.
    """
    tasks = _load_tasks()
    for task in tasks:
        if task["id"] == task_id:
            task["status"] = status
            if notes:
                task["notes"] = notes
            _save_tasks(tasks)
            return f"Task '{task_id}' updated to '{status}'."
    return f"Task '{task_id}' not found."


@beta_tool
def complete_task(task_id: str) -> str:
    """Mark a task as completed.

    Args:
        task_id: The ID of the task to mark as done (e.g., 'task_1').
    """
    tasks = _load_tasks()
    for task in tasks:
        if task["id"] == task_id:
            task["status"] = "done"
            _save_tasks(tasks)
            return f"Task '{task_id}' marked as done."
    return f"Task '{task_id}' not found."
