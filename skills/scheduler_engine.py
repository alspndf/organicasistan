"""scheduler-engine skill — manages daily time-blocked schedule."""

import json
from datetime import datetime
from pathlib import Path
from anthropic import beta_tool


def _normalize_time(t: str) -> str:
    """Ensure time is always HH:MM format (e.g. '9:00' → '09:00')."""
    try:
        return datetime.strptime(t.strip(), "%H:%M").strftime("%H:%M")
    except ValueError:
        return t

DATA_DIR = Path(__file__).parent.parent / "data"
SCHEDULE_FILE = DATA_DIR / "schedule.json"


def load_schedule() -> dict:
    return (
        json.loads(SCHEDULE_FILE.read_text())
        if SCHEDULE_FILE.exists()
        else {"date": "", "blocks": [], "locked": False}
    )


def _save(schedule: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    SCHEDULE_FILE.write_text(json.dumps(schedule, indent=2))


@beta_tool
def create_schedule(blocks_json: str) -> str:
    """Save a new daily schedule with time blocks.

    Args:
        blocks_json: JSON array of blocks: [{"time":"09:00","task_id":"task_1","title":"..."}]
    """
    try:
        blocks = json.loads(blocks_json)
    except json.JSONDecodeError:
        return "Invalid JSON."

    schedule = {
        "date": datetime.now().strftime("%Y-%m-%d"),
        "blocks": [
            {
                "time": _normalize_time(b["time"]),
                "task_id": b["task_id"],
                "title": b["title"],
                "status": "pending",
            }
            for b in blocks
        ],
        "locked": False,
    }
    _save(schedule)
    return f"Schedule created with {len(blocks)} blocks."


@beta_tool
def lock_schedule() -> str:
    """Lock the schedule after user approval."""
    schedule = load_schedule()
    schedule["locked"] = True
    _save(schedule)
    return "Schedule locked."


@beta_tool
def reschedule_task(task_id: str, new_time: str) -> str:
    """Move a task block to a new time.

    Args:
        task_id: ID of the task to reschedule.
        new_time: New time in HH:MM format.
    """
    schedule = load_schedule()
    for block in schedule["blocks"]:
        if block["task_id"] == task_id:
            block["time"] = _normalize_time(new_time)
            block["status"] = "pending"
            _save(schedule)
            return f"Task '{task_id}' rescheduled to {new_time}."
    return f"Task '{task_id}' not found."


@beta_tool
def mark_block_done(task_id: str) -> str:
    """Mark a schedule block as completed.

    Args:
        task_id: ID of the task block to mark done.
    """
    schedule = load_schedule()
    for block in schedule["blocks"]:
        if block["task_id"] == task_id:
            block["status"] = "done"
            _save(schedule)
            return f"Block '{task_id}' marked done."
    return f"Task '{task_id}' not found."


def insert_block(task_id: str, title: str, time: str) -> str:
    """Insert a new block into an existing schedule (e.g. from email)."""
    schedule = load_schedule()
    schedule["blocks"].append({"time": time, "task_id": task_id, "title": title, "status": "pending"})
    schedule["blocks"].sort(key=lambda b: b["time"])
    _save(schedule)
    return f"Block '{task_id}' inserted at {time}."


def get_due_blocks(current_time: str) -> list:
    """Return pending blocks whose time <= current_time (HH:MM)."""
    schedule = load_schedule()
    return [b for b in schedule["blocks"] if b["status"] == "pending" and b["time"] <= current_time]


def get_all_blocks() -> list:
    return load_schedule().get("blocks", [])


def is_locked() -> bool:
    return load_schedule().get("locked", False)
