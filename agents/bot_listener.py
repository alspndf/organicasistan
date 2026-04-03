"""Bot Listener — processes Telegram messages, buttons, and photos."""

import json
import base64
import threading
import time
import anthropic
from datetime import datetime
from typing import List, Optional

from skills.telegram_messenger import (
    send_message, send_with_buttons, answer_callback,
    get_updates, get_text_from_update, get_callback_data,
    get_callback_query_id, get_update_id,
    is_photo_update, is_callback_update, get_photo_bytes,
)
from skills.scheduler_engine import (
    load_schedule, reschedule_task, mark_block_done,
    insert_block, get_all_blocks, lock_schedule,
)
from skills.task_manager import complete_task, create_task, get_tasks
from skills.reminder_engine import schedule_reminder

client = anthropic.Anthropic()
MODEL = "claude-opus-4-6"

# Shared event: set when user approves the schedule
approval_event = threading.Event()

# ─── System prompts ──────────────────────────────────────────────────────────

COMMAND_SYSTEM = """You are the Bot Listener for Organic Assistant. Process each incoming Telegram message and call the right tool.

Message types you handle:

1. "DONE" → user completed the pending/most recent task
   → call complete_task + mark_block_done

2. "NOT DONE" → user did not complete the task
   → call send_message asking: "Hangi saate taşıyalım? (HH:MM)"

3. Time reply like "15:30" after a NOT DONE
   → call reschedule_task for the most recently fired pending block

4. Reminder request (any language):
   e.g. "saat 16:00'da Emre ile toplantım var 10 dk önce hatırlat"
   e.g. "remind me about standup at 09:50, 10 min before"
   → calculate remind_at = event_time minus X minutes
   → call schedule_reminder with a clear message
   → call send_message confirming

5. "schedule" / "plan" / "bugün ne var"
   → call send_message with formatted schedule

6. "add task X at HH:MM" / "görev ekle: X saat HH:MM"
   → call create_task + insert_block
   → call send_message confirming

7. "move X to HH:MM" / "X'i HH:MM'ye taşı"
   → call reschedule_task + send_message confirming

8. Edit request after schedule sent (e.g. "task_2'yi 15:00'e al")
   → call reschedule_task + send_message confirming

9. Anything else
   → call send_message: "Anlayamadım. Komutlar: DONE, NOT DONE, hatırlat, görev ekle, planı göster"

NEVER give advice. ONLY execute."""

VISION_SYSTEM = """You are analyzing an image to extract tasks or action items.
Extract ALL tasks, to-dos, or planned items visible in the image.
Return ONLY a JSON array of strings, each being one task title.
Example: ["Rapor yaz", "Toplantı hazırlığı", "Mail gönder"]
If nothing is found, return: []"""

TOOLS = [
    {
        "name": "send_message",
        "description": "Send a Telegram message to the user.",
        "input_schema": {
            "type": "object",
            "properties": {"message": {"type": "string"}},
            "required": ["message"],
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
        "description": "Move a task block to a new time.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "new_time": {"type": "string", "description": "HH:MM format"},
            },
            "required": ["task_id", "new_time"],
        },
    },
    {
        "name": "schedule_reminder",
        "description": "Schedule a reminder to fire at a specific time.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "message": {"type": "string"},
                "remind_at": {"type": "string", "description": "HH:MM format"},
            },
            "required": ["task_id", "message", "remind_at"],
        },
    },
    {
        "name": "create_task",
        "description": "Create a new task.",
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
        "name": "insert_block",
        "description": "Insert a task into the schedule at a specific time.",
        "input_schema": {
            "type": "object",
            "properties": {
                "task_id": {"type": "string"},
                "title": {"type": "string"},
                "time": {"type": "string", "description": "HH:MM format"},
            },
            "required": ["task_id", "title", "time"],
        },
    },
]

TOOL_MAP = {
    "send_message": send_message,
    "complete_task": complete_task,
    "mark_block_done": mark_block_done,
    "reschedule_task": reschedule_task,
    "schedule_reminder": schedule_reminder,
    "create_task": create_task,
    "insert_block": insert_block,
}


# ─── Photo analysis ──────────────────────────────────────────────────────────

def _extract_tasks_from_photo(image_bytes: bytes) -> List[str]:
    """Use Claude Vision to extract tasks from a photo."""
    image_b64 = base64.standard_b64encode(image_bytes).decode()
    response = client.messages.create(
        model=MODEL,
        max_tokens=1024,
        messages=[{
            "role": "user",
            "content": [
                {
                    "type": "image",
                    "source": {"type": "base64", "media_type": "image/jpeg", "data": image_b64},
                },
                {
                    "type": "text",
                    "text": "Extract all tasks or action items from this image. Return ONLY a JSON array of strings.",
                },
            ],
        }],
        system=VISION_SYSTEM,
    )
    try:
        return json.loads(response.content[0].text)
    except Exception:
        return []


def _handle_photo(image_bytes: bytes) -> None:
    """Extract tasks from photo, show to user, ask for times."""
    send_message("📸 Fotoğraf analiz ediliyor...")
    tasks = _extract_tasks_from_photo(image_bytes)

    if not tasks:
        send_message("Fotoğrafta görev bulunamadı.")
        return

    lines = ["📋 Şu görevleri buldum:\n"]
    for i, t in enumerate(tasks, 1):
        lines.append(f"  {i}. {t}")
    lines.append("\nHer görev için saat belirt (örn: 1→14:00, 2→15:30)")
    lines.append("Eklemek istemiyorsan SKIP yaz.")
    send_message("\n".join(lines))

    # Store pending photo tasks for next message processing
    import pathlib, json as _json
    data_dir = pathlib.Path(__file__).parent.parent / "data"
    data_dir.mkdir(exist_ok=True)
    (data_dir / "pending_photo_tasks.json").write_text(_json.dumps(tasks))


def _apply_photo_task_times(text: str) -> None:
    """Parse time assignments like '1→14:00, 2→15:30' and add to schedule."""
    import pathlib, json as _json, re
    pending_file = pathlib.Path(__file__).parent.parent / "data" / "pending_photo_tasks.json"
    if not pending_file.exists():
        return

    tasks = _json.loads(pending_file.read_text())
    assignments = re.findall(r"(\d+)[→>:\-\s]+(\d{1,2}:\d{2})", text)

    added = []
    for idx_str, time_str in assignments:
        idx = int(idx_str) - 1
        if 0 <= idx < len(tasks):
            title = tasks[idx]
            result = create_task(title=title, description=title, priority="medium", due_date="today")
            task_id = result.split("'")[1] if "'" in result else f"photo_{idx}"
            insert_block(task_id=task_id, title=title, time=time_str)
            added.append(f"{title} → {time_str}")

    pending_file.unlink(missing_ok=True)

    if added:
        send_message("✅ Plana eklendi:\n" + "\n".join(f"  • {a}" for a in added))
    else:
        send_message("Zaman ataması anlaşılamadı. '1→14:00, 2→15:30' formatında dene.")


# ─── Command processing ───────────────────────────────────────────────────────

def _process_command(text: str) -> None:
    """Pass a text message to Claude for command processing."""
    import pathlib
    pending_file = pathlib.Path(__file__).parent.parent / "data" / "pending_photo_tasks.json"

    # If there are pending photo tasks, interpret message as time assignments
    if pending_file.exists() and text.upper() != "SKIP":
        _apply_photo_task_times(text)
        return
    if pending_file.exists() and text.upper() == "SKIP":
        pending_file.unlink(missing_ok=True)
        send_message("Fotoğraf görevleri atlandı.")
        return

    blocks = get_all_blocks()
    pending = [b for b in blocks if b["status"] == "pending"]
    context = (
        f"Şu an: {datetime.now().strftime('%H:%M')}\n"
        f"Tüm bloklar: {json.dumps(blocks)}\n"
        f"Bekleyen bloklar: {json.dumps(pending)}\n\n"
        f"Kullanıcı mesajı: '{text}'"
    )

    messages = [{"role": "user", "content": context}]
    while True:
        response = client.messages.create(
            model=MODEL, max_tokens=1024, system=COMMAND_SYSTEM, tools=TOOLS, messages=messages
        )
        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                fn = TOOL_MAP.get(block.name)
                result = fn(**block.input) if fn else f"Unknown tool: {block.name}"
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": str(result)}
                )
        if tool_results:
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})
        if response.stop_reason == "end_turn":
            return


# ─── Main listener loop ───────────────────────────────────────────────────────

def start(stop_event: threading.Event) -> None:
    """Poll Telegram continuously and handle messages, buttons, and photos."""
    offset = 0
    print("[Bot Listener] Başladı — Telegram dinleniyor...\n")

    while not stop_event.is_set():
        try:
            updates = get_updates(offset)
            for update in updates:
                offset = get_update_id(update) + 1

                # ── Button press ──────────────────────────────────────────
                if is_callback_update(update):
                    data = get_callback_data(update)
                    qid = get_callback_query_id(update)
                    answer_callback(qid)

                    if data == "APPROVED":
                        lock_schedule()
                        send_message("✅ Plan onaylandı ve kilitlendi.")
                        approval_event.set()
                        print("[Bot Listener] Plan onaylandı.")

                    elif data == "EDIT":
                        send_message("Değişikliği yaz (örn: task_1'i 15:00'e taşı):")

                    elif data.startswith("DONE:"):
                        task_id = data.split(":", 1)[1]
                        complete_task(task_id)
                        mark_block_done(task_id)
                        send_message(f"✅ Tamamlandı: {task_id}")
                        print(f"[Bot Listener] DONE: {task_id}")

                    elif data.startswith("NOTDONE:"):
                        task_id = data.split(":", 1)[1]
                        send_message("Hangi saate taşıyalım? (HH:MM formatında yaz)")

                # ── Photo ────────────────────────────────────────────────
                elif is_photo_update(update):
                    image_bytes = get_photo_bytes(update)
                    if image_bytes:
                        _handle_photo(image_bytes)

                # ── Text message ─────────────────────────────────────────
                else:
                    text = get_text_from_update(update)
                    if text:
                        print(f"[Bot Listener] Mesaj: '{text}'")
                        _process_command(text)

        except Exception as e:
            print(f"[Bot Listener] Hata: {e}")

        time.sleep(2)

    print("[Bot Listener] Durduruldu.")
