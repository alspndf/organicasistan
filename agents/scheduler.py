"""Scheduler Agent — distributes tasks into time blocks. No strategy."""

import json
import anthropic
from skills.scheduler_engine import (
    create_schedule,
    lock_schedule,
    reschedule_task,
    load_schedule,
    get_all_blocks,
)

client = anthropic.Anthropic()
MODEL = "claude-opus-4-6"

SYSTEM = """You are the Scheduler Agent. You ONLY assign tasks to time slots.

Rules:
- Start at 09:00, end at 22:00
- Distribute tasks evenly across the day
- Each task gets exactly one time slot (HH:MM)
- Do NOT change, add, or remove tasks
- Do NOT prioritize or optimize
- Just spread them out and call create_schedule"""

BUILD_TOOLS = [
    {
        "name": "create_schedule",
        "description": "Save the daily schedule with time blocks.",
        "input_schema": {
            "type": "object",
            "properties": {
                "blocks_json": {
                    "type": "string",
                    "description": 'JSON array: [{"time":"09:00","task_id":"task_1","title":"..."}]',
                }
            },
            "required": ["blocks_json"],
        },
    }
]

EDIT_TOOLS = [
    {
        "name": "reschedule_task",
        "description": "Move a task to a new time slot.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "new_time": {"type": "string", "description": "HH:MM format"},
            },
            "required": ["task_id", "new_time"],
        },
    }
]


def _run(tools: list, tool_map: dict, prompt: str) -> None:
    messages = [{"role": "user", "content": prompt}]
    while True:
        response = client.messages.create(
            model=MODEL, max_tokens=2048, system=SYSTEM, tools=tools, messages=messages
        )
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                fn = tool_map.get(block.name)
                result = fn(**block.input) if fn else f"Unknown tool: {block.name}"
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": result}
                )
        if tool_results:
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
        if response.stop_reason == "end_turn":
            return


def build_schedule(tasks: list) -> list:
    """Distribute tasks into time blocks. Returns list of blocks."""
    _run(
        BUILD_TOOLS,
        {"create_schedule": create_schedule},
        f"Distribute these tasks into time slots from 09:00 to 22:00.\n\n"
        f"Tasks:\n{json.dumps(tasks, indent=2)}\n\n"
        f"Call create_schedule with the result.",
    )
    return get_all_blocks()


def apply_edit(edit: str) -> str:
    """Apply a user schedule edit (e.g. 'Move task_1 to 15:00')."""
    blocks = get_all_blocks()
    _run(
        EDIT_TOOLS,
        {"reschedule_task": reschedule_task},
        f"Current schedule:\n{json.dumps(blocks, indent=2)}\n\n"
        f"Apply this edit: '{edit}'",
    )
    return "Edit applied."


def approve_and_lock() -> None:
    lock_schedule()
