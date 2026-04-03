"""reminder-engine skill — schedule and manage recurring reminders."""

import json
from datetime import datetime
from pathlib import Path
from anthropic import beta_tool

DATA_DIR = Path(__file__).parent.parent / "data"
REMINDERS_FILE = DATA_DIR / "reminders.json"


def _load() -> list:
    return json.loads(REMINDERS_FILE.read_text()) if REMINDERS_FILE.exists() else []


def _save(reminders: list) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    REMINDERS_FILE.write_text(json.dumps(reminders, indent=2))


@beta_tool
def schedule_reminder(task_id: str, message: str, remind_at: str) -> str:
    """Schedule a one-time reminder for a task.

    Args:
        task_id: ID of the task this reminder is for.
        message: Reminder message to send.
        remind_at: When to send the reminder, e.g. '2024-01-15 09:00'.
    """
    reminders = _load()
    reminder_id = f"reminder_{len(reminders) + 1}"
    reminders.append({
        "id": reminder_id,
        "task_id": task_id,
        "message": message,
        "remind_at": remind_at,
        "sent": False,
    })
    _save(reminders)
    return f"Reminder '{reminder_id}' scheduled for {remind_at}."


@beta_tool
def recurring_tasks(task_id: str, frequency: str) -> str:
    """Mark a task as recurring with a given frequency.

    Args:
        task_id: ID of the task to make recurring.
        frequency: How often to repeat — 'daily', 'weekly', or 'monthly'.
    """
    reminders = _load()
    reminder_id = f"recurring_{len(reminders) + 1}"
    reminders.append({
        "id": reminder_id,
        "task_id": task_id,
        "frequency": frequency,
        "type": "recurring",
        "created_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
    })
    _save(reminders)
    return f"Task '{task_id}' set as recurring ({frequency})."
