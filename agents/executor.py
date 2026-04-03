"""Executor Agent — fires tasks at scheduled time, tracks completion."""

import json
import anthropic
from skills.task_manager import create_task, complete_task, get_tasks
from skills.scheduler_engine import mark_block_done, reschedule_task

client = anthropic.Anthropic()
MODEL = "claude-opus-4-6"

SYSTEM = """You are the Executor Agent. Rules (STRICT):
- NEVER give advice or suggestions
- NEVER create new tasks or change existing ones
- When user says DONE → call complete_task + mark_block_done
- When user says NOT DONE → call reschedule_task with the new time
- That is all."""

TOOLS = [
    {
        "name": "create_task",
        "description": "Create a task entry from a scheduled block.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string"},
                "description": {"type": "string"},
                "priority": {"type": "string", "enum": ["high", "medium", "low"]},
                "due_date": {"type": "string"},
            },
            "required": ["title", "description"],
        },
    },
    {
        "name": "complete_task",
        "description": "Mark a task as completed.",
        "input_schema": {
            "type": "object",
            "properties": {"task_id": {"type": "string"}},
            "required": ["task_id"],
        },
    },
    {
        "name": "mark_block_done",
        "description": "Mark a schedule block as done.",
        "input_schema": {
            "type": "object",
            "properties": {"task_id": {"type": "string"}},
            "required": ["task_id"],
        },
    },
    {
        "name": "reschedule_task",
        "description": "Move a task to a new time.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "new_time": {"type": "string", "description": "HH:MM format"},
            },
            "required": ["task_id", "new_time"],
        },
    },
]

TOOL_MAP = {
    "create_task": create_task,
    "complete_task": complete_task,
    "mark_block_done": mark_block_done,
    "reschedule_task": reschedule_task,
}


def _run(prompt: str) -> str:
    messages = [{"role": "user", "content": prompt}]
    last_text = ""
    while True:
        response = client.messages.create(
            model=MODEL, max_tokens=512, system=SYSTEM, tools=TOOLS, messages=messages
        )
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                fn = TOOL_MAP.get(block.name)
                result = fn(**block.input) if fn else f"Unknown tool: {block.name}"
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": result}
                )
            elif hasattr(block, "text"):
                last_text = block.text
        if tool_results:
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
        if response.stop_reason == "end_turn":
            return last_text


def load_tasks(miro_tasks: list) -> list:
    """Create task manager entries from Miro nodes."""
    _run(
        f"Create a task for each item. Use priority 'medium', due_date 'today'.\n"
        f"Items:\n{json.dumps(miro_tasks, indent=2)}"
    )
    return get_tasks()


def handle_done(block: dict) -> str:
    """Mark block and task as done."""
    return _run(
        f"Block: {json.dumps(block)}\n"
        f"User said DONE. Call complete_task (task_id='{block['task_id']}') "
        f"and mark_block_done (task_id='{block['task_id']}')."
    )


def handle_not_done(block: dict, new_time: str) -> str:
    """Reschedule block to new_time."""
    return _run(
        f"Block: {json.dumps(block)}\n"
        f"User said NOT DONE. Reschedule task_id='{block['task_id']}' to {new_time}."
    )
