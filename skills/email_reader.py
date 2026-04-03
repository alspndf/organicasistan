"""email-reader skill — fetch and summarize emails.

In production: replace _fetch_raw() with a real IMAP/Gmail API call.
"""

import json
from anthropic import beta_tool

# Simulated inbox — replace with real API calls in production.
_MOCK_EMAILS = [
    {
        "id": "email_1",
        "from": "team@work.com",
        "subject": "Project deadline reminder",
        "body": "Reminder: the project presentation is due this Friday. Please prepare your slides.",
        "date": "2024-01-15",
        "important": True,
    },
    {
        "id": "email_2",
        "from": "newsletter@tech.com",
        "subject": "Weekly tech digest",
        "body": "This week in tech: AI updates, new frameworks, and developer tools.",
        "date": "2024-01-15",
        "important": False,
    },
    {
        "id": "email_3",
        "from": "manager@work.com",
        "subject": "Check-in on your goals",
        "body": "Hi! Just checking in on your progress. Let me know if you need any support.",
        "date": "2024-01-15",
        "important": True,
    },
]


@beta_tool
def fetch_emails(count: int = 5) -> str:
    """Fetch the most recent emails from the inbox.

    Args:
        count: Number of emails to retrieve, maximum 10.
    """
    emails = _MOCK_EMAILS[:min(count, len(_MOCK_EMAILS))]
    return json.dumps(emails, indent=2)


@beta_tool
def summarize_emails(email_json: str) -> str:
    """Extract and summarize the important emails from a fetched email list.

    Args:
        email_json: JSON string of emails as returned by fetch_emails.
    """
    try:
        emails = json.loads(email_json)
    except json.JSONDecodeError:
        return "Could not parse email data."

    important = [e for e in emails if e.get("important")]
    if not important:
        return "No important emails found."

    lines = [f"📧 {len(important)} important email(s):"]
    for e in important:
        lines.append(f"  • [{e['from']}] {e['subject']}")
    return "\n".join(lines)
