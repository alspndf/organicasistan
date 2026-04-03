"""Communicator Agent — Telegram messages and email summaries."""

import json
import anthropic
from skills.telegram_messenger import send_message, send_with_buttons
from skills.email_reader import fetch_emails, summarize_emails
from skills.reminder_engine import schedule_reminder

client = anthropic.Anthropic()
MODEL = "claude-opus-4-6"

SYSTEM = """You are the Communicator Agent. Your ONLY job:
1. Send messages via Telegram
2. Fetch and categorize emails as IMPORTANT or MEDIUM
3. Send reminders

Do NOT plan, execute, or suggest. Only communicate."""

TOOLS = [
    {
        "name": "send_message",
        "description": "Send a Telegram message.",
        "input_schema": {
            "type": "object",
            "properties": {
                "message": {"type": "string"},
                "recipient": {"type": "string"},
            },
            "required": ["message"],
        },
    },
    {
        "name": "fetch_emails",
        "description": "Fetch recent emails.",
        "input_schema": {
            "type": "object",
            "properties": {"count": {"type": "integer"}},
            "required": [],
        },
    },
    {
        "name": "summarize_emails",
        "description": "Summarize important emails.",
        "input_schema": {
            "type": "object",
            "properties": {"email_json": {"type": "string"}},
            "required": ["email_json"],
        },
    },
    {
        "name": "schedule_reminder",
        "description": "Schedule a reminder.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "message": {"type": "string"},
                "remind_at": {"type": "string"},
            },
            "required": ["task_id", "message", "remind_at"],
        },
    },
]

TOOL_MAP = {
    "send_message": send_message,
    "fetch_emails": fetch_emails,
    "summarize_emails": summarize_emails,
    "schedule_reminder": schedule_reminder,
}


def _run(prompt: str) -> str:
    messages = [{"role": "user", "content": prompt}]
    last_text = ""
    while True:
        response = client.messages.create(
            model=MODEL, max_tokens=1024, system=SYSTEM, tools=TOOLS, messages=messages
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


def send_schedule(blocks: list) -> None:
    """Send full daily schedule to Telegram with approval buttons."""
    lines = ["📅 Günlük Plan\n"]
    for b in sorted(blocks, key=lambda x: x["time"]):
        icon = "✅" if b.get("status") == "done" else "⏳"
        lines.append(f"  {icon} {b['time']} — {b['title']}")
    lines.append("\nPlanı onaylıyor musun?")
    send_with_buttons(
        "\n".join(lines),
        [
            {"text": "✅ Onayla", "callback_data": "APPROVED"},
            {"text": "✏️ Değiştir", "callback_data": "EDIT"},
        ],
    )


def send_task_block(block: dict) -> None:
    """Send a single task notification to Telegram with DONE/NOT DONE buttons."""
    msg = f"⏰ {block['time']} — {block['title']}\n\nBu gorevi tamamladin mi?"
    result = send_with_buttons(
        msg,
        [
            {"text": "✅ DONE", "callback_data": f"DONE:{block['task_id']}"},
            {"text": "❌ NOT DONE", "callback_data": f"NOTDONE:{block['task_id']}"},
        ],
    )
    print(f"[Communicator] Gorев gonderildi: {block['title']} — {result}")


def send_reminder(incomplete_blocks: list) -> None:
    """Send reminder for incomplete tasks."""
    lines = ["🔔 *Reminder — Incomplete Tasks*\n"]
    for b in incomplete_blocks:
        lines.append(f"  • {b['time']} — {b['title']}")
    send_message("\n".join(lines))


def send_completion_notice() -> None:
    send_message("✅ All tasks completed for today. Well done.")


def email_flow() -> dict:
    """Fetch emails, categorize, send summary. Returns categorized emails."""
    _run(
        "Fetch the user's emails. Categorize each as IMPORTANT or MEDIUM based on importance. "
        "Send a summary to Telegram formatted as:\n"
        "📧 Email Summary\n\nIMPORTANT:\n- ...\n\nMEDIUM:\n- ...\n\n"
        "At the end ask: 'Reply ADD [subject] AT [HH:MM] to add any email as a task.'"
    )
    return {}
