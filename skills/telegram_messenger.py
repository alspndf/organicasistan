"""telegram-messenger skill — real Telegram Bot API integration."""

import os
import urllib.request
import json
from typing import Optional
from anthropic import beta_tool

BOT_TOKEN = os.environ.get("TELEGRAM_BOT_TOKEN", "")
CHAT_ID = os.environ.get("TELEGRAM_CHAT_ID", "")
BASE_URL = f"https://api.telegram.org/bot{BOT_TOKEN}"


def _post(endpoint: str, payload: dict) -> dict:
    url = f"{BASE_URL}/{endpoint}"
    data = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            return json.loads(resp.read())
    except Exception as e:
        return {"ok": False, "description": str(e)}


def _get_url(url: str, timeout: int = 10) -> bytes:
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def _get(endpoint: str, timeout: int = 10) -> dict:
    try:
        data = _get_url(f"{BASE_URL}/{endpoint}", timeout=timeout)
        return json.loads(data)
    except Exception as e:
        return {"ok": False, "description": str(e)}


@beta_tool
def send_message(message: str, recipient: str = "user") -> str:
    """Send a plain Telegram message to the user.

    Args:
        message: The message text to send.
        recipient: Ignored — always sends to TELEGRAM_CHAT_ID.
    """
    if not BOT_TOKEN or not CHAT_ID:
        return "Error: TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID not set."
    result = _post("sendMessage", {"chat_id": CHAT_ID, "text": message})
    if result.get("ok"):
        return "Message sent."
    return f"Failed: {result.get('description', 'unknown error')}"


def send_with_buttons(message: str, buttons: list[dict]) -> str:
    """Send a message with inline keyboard buttons.

    buttons: [{"text": "Label", "callback_data": "value"}, ...]
    """
    keyboard = {"inline_keyboard": [buttons]}
    result = _post("sendMessage", {
        "chat_id": CHAT_ID,
        "text": message,
        "reply_markup": json.dumps(keyboard),
    })
    if result.get("ok"):
        return "Message with buttons sent."
    return f"Failed: {result.get('description', 'unknown error')}"


def answer_callback(callback_query_id: str, text: str = "") -> None:
    """Acknowledge a button press (removes loading spinner)."""
    _post("answerCallbackQuery", {"callback_query_id": callback_query_id, "text": text})


def get_updates(offset: int = 0) -> list:
    """Poll for new Telegram updates."""
    if not BOT_TOKEN:
        return []
    result = _get(f"getUpdates?offset={offset}&timeout=5", timeout=10)
    return result.get("result", []) if result.get("ok") else []


def get_photo_bytes(update: dict) -> Optional[bytes]:
    """Download the highest-res photo from an update. Returns None if no photo."""
    photos = update.get("message", {}).get("photo", [])
    if not photos:
        return None
    file_id = photos[-1]["file_id"]
    result = _get(f"getFile?file_id={file_id}")
    if not result.get("ok"):
        return None
    file_path = result["result"]["file_path"]
    try:
        return _get_url(f"https://api.telegram.org/file/bot{BOT_TOKEN}/{file_path}")
    except Exception:
        return None


def get_text_from_update(update: dict) -> str:
    return update.get("message", {}).get("text", "")


def get_callback_data(update: dict) -> str:
    return update.get("callback_query", {}).get("data", "")


def get_callback_query_id(update: dict) -> str:
    return update.get("callback_query", {}).get("id", "")


def get_update_id(update: dict) -> int:
    return update.get("update_id", 0)


def is_photo_update(update: dict) -> bool:
    return bool(update.get("message", {}).get("photo"))


def is_callback_update(update: dict) -> bool:
    return "callback_query" in update
