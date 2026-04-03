"""Organic Assistant MVP v1 — Time-based execution with live Telegram interaction.

Threads:
  Main thread   → schedule monitor (fires tasks at their time, checks reminders)
  Listener thread → Telegram polling (processes all incoming user messages)
"""

import time
import threading
from datetime import datetime
from pathlib import Path

from agents.miro_reader import run as miro_reader_run
from agents.scheduler import build_schedule, apply_edit, approve_and_lock
from agents.executor import load_tasks, handle_done, handle_not_done
from agents.communicator import send_schedule, send_task_block, send_reminder, send_completion_notice, email_flow
import agents.bot_listener as bot_listener
from agents.bot_listener import approval_event

from skills.scheduler_engine import get_due_blocks, get_all_blocks, load_schedule, insert_block
from skills.task_manager import reset_tasks
from skills.reminder_engine import _load as load_reminders, _save as save_reminders
from skills.telegram_messenger import send_message


def now() -> str:
    return datetime.now().strftime("%H:%M")


def today() -> str:
    return datetime.now().strftime("%Y-%m-%d")


def _check_reminders() -> None:
    """Fire any scheduled reminders whose time has come."""
    current = now()
    reminders = load_reminders()
    changed = False
    for r in reminders:
        if not r.get("sent") and r.get("remind_at", "") <= current:
            send_message(f"🔔 Hatırlatma: {r['message']}")
            r["sent"] = True
            changed = True
    if changed:
        save_reminders(reminders)


def _approval_loop(stop_event: threading.Event) -> None:
    """Send schedule to Telegram and wait for user to press ONAYLA button."""
    send_schedule(get_all_blocks())
    print("\n[Scheduler] Plan Telegram'a gönderildi — ONAYLA butonunu bekliyor...\n")
    approval_event.clear()

    while not approval_event.is_set():
        if stop_event.is_set():
            return
        time.sleep(1)

    print("[Scheduler] Plan onaylandı.\n")


def schedule_monitor(stop_event: threading.Event) -> None:
    """Main loop: fires tasks at their time, checks reminders every 30s."""
    email_sent = False
    fired_blocks = set()

    print(f"[Monitor] Başladı — şu an: {now()}\n")

    while not stop_event.is_set():
        current = now()

        # Reminder check
        _check_reminders()

        # Email flow at 11:00
        if current >= "11:00" and not email_sent:
            print("[Communicator] E-posta akışı başlıyor...")
            email_flow()
            email_sent = True

        # Fire due blocks (once per block)
        due = get_due_blocks(current)
        for block in due:
            if block["task_id"] not in fired_blocks:
                fired_blocks.add(block["task_id"])
                print(f"[Monitor] Gorev atesleniyor: '{block['title']}' ({block['time']})")
                send_task_block(block)

        if not due:
            pending = [b for b in get_all_blocks() if b["status"] == "pending"]
            if pending:
                next_time = min(b["time"] for b in pending)
                print(f"[Monitor] {current} — bekliyor, sonraki gorev: {next_time}")

        # Hourly reminder for overdue pending blocks
        minute = datetime.now().minute
        if minute == 0:
            overdue = [
                b for b in get_all_blocks()
                if b["status"] == "pending" and b["time"] < current
            ]
            if overdue:
                send_reminder(overdue)

        # Check completion
        all_blocks = get_all_blocks()
        if all_blocks and all(b["status"] == "done" for b in all_blocks):
            send_completion_notice()
            print("[Monitor] Tüm görevler tamamlandı.")
            stop_event.set()
            break

        time.sleep(30)


def main():
    print("=== Organic Assistant MVP v1 ===\n")

    # Step 1: Read tasks from Miro board
    board = miro_reader_run()
    if not board["tasks"]:
        print("Görev bulunamadı. Çıkılıyor.")
        return

    # Step 2: Load into task manager
    reset_tasks()
    print("\n[Executor] Görevler yükleniyor...")
    tasks = load_tasks(board["tasks"])
    print(f"[Executor] {len(tasks)} görev hazır.\n")

    # Step 3: Build schedule
    print("[Scheduler] Günlük plan oluşturuluyor...")
    blocks = build_schedule(tasks)
    print(f"[Scheduler] {len(blocks)} zaman bloğu oluşturuldu.\n")

    # Step 5: Start listener thread BEFORE approval (needs to handle button press)
    stop_event = threading.Event()
    listener_thread = threading.Thread(
        target=bot_listener.start,
        args=(stop_event,),
        daemon=True,
    )
    listener_thread.start()

    # Step 4 (moved here): Wait for Telegram approval button
    _approval_loop(stop_event)

    # Step 6: Run schedule monitor (main thread)
    try:
        schedule_monitor(stop_event)
    except KeyboardInterrupt:
        print("\n[System] Durduruluyor...")
        stop_event.set()

    listener_thread.join(timeout=5)
    print("[System] Kapatıldı.")


if __name__ == "__main__":
    main()
