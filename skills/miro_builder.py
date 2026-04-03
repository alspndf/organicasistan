"""miro-builder skill — create and update a Miro-style JSON flow board."""

import json
from pathlib import Path
from anthropic import beta_tool

DATA_DIR = Path(__file__).parent.parent / "data"
BOARD_FILE = DATA_DIR / "miro_board.json"


def _load_board() -> dict:
    return json.loads(BOARD_FILE.read_text()) if BOARD_FILE.exists() else {"nodes": [], "edges": []}


def _save_board(board: dict) -> None:
    DATA_DIR.mkdir(exist_ok=True)
    BOARD_FILE.write_text(json.dumps(board, indent=2))


def reset_board() -> None:
    """Clear the board for a fresh planning session."""
    _save_board({"nodes": [], "edges": []})


def get_board() -> dict:
    """Return the full board dict."""
    return _load_board()


@beta_tool
def create_node(title: str, description: str, node_type: str = "task") -> str:
    """Create a node on the Miro flow board.

    Args:
        title: Short title for the node.
        description: What this node represents or what needs to be done.
        node_type: One of 'goal', 'milestone', or 'task'.
    """
    board = _load_board()
    node_id = f"node_{len(board['nodes']) + 1}"
    board["nodes"].append({
        "id": node_id,
        "title": title,
        "description": description,
        "type": node_type,
        "status": "pending",
    })
    _save_board(board)
    return f"Created {node_type} node '{node_id}': {title}"


@beta_tool
def connect_nodes(from_id: str, to_id: str, relationship: str = "leads_to") -> str:
    """Connect two nodes on the Miro board with a directional edge.

    Args:
        from_id: ID of the source node (e.g., 'node_1').
        to_id: ID of the target node (e.g., 'node_2').
        relationship: Type of relationship — 'leads_to', 'depends_on', or 'blocks'.
    """
    board = _load_board()
    edge_id = f"edge_{len(board['edges']) + 1}"
    board["edges"].append({
        "id": edge_id,
        "from": from_id,
        "to": to_id,
        "relationship": relationship,
    })
    _save_board(board)
    return f"Connected {from_id} → {to_id} ({relationship})"


@beta_tool
def update_board(node_id: str, status: str) -> str:
    """Update the status of a node on the Miro board.

    Args:
        node_id: The ID of the node to update (e.g., 'node_1').
        status: New status — 'pending', 'in_progress', or 'done'.
    """
    board = _load_board()
    for node in board["nodes"]:
        if node["id"] == node_id:
            node["status"] = status
            _save_board(board)
            return f"Node '{node_id}' updated to '{status}'."
    return f"Node '{node_id}' not found."
