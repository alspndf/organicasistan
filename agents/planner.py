"""Planner Agent — analyzes user goals and creates Miro flow maps."""

import json
import anthropic
from skills.miro_builder import create_node, connect_nodes, reset_board, get_board
from skills.memory_store import save_user_goal

client = anthropic.Anthropic()
MODEL = "claude-opus-4-6"

SYSTEM = """You are the Planner Agent. Your ONLY job is to:
1. Analyze the user's goal
2. Break it into actionable steps (goal node → milestone nodes → task nodes)
3. Create a Miro-style flow map using create_node and connect_nodes
4. Save the goal to memory

Rules:
- Create exactly 1 goal node, 2-3 milestone nodes, and 3-5 task nodes
- Connect all nodes logically
- Save the goal with goal_id 'goal_001'
- Do NOT plan beyond creating the map"""

TOOLS = [
    {
        "name": "create_node",
        "description": "Create a node on the Miro flow board.",
        "input_schema": {
            "type": "object",
            "properties": {
                "title": {"type": "string", "description": "Short title for the node."},
                "description": {"type": "string", "description": "What this node represents."},
                "node_type": {
                    "type": "string",
                    "enum": ["goal", "milestone", "task"],
                    "description": "Type of node.",
                },
            },
            "required": ["title", "description"],
        },
    },
    {
        "name": "connect_nodes",
        "description": "Connect two nodes with a directional edge.",
        "input_schema": {
            "type": "object",
            "properties": {
                "from_id": {"type": "string", "description": "Source node ID, e.g. 'node_1'."},
                "to_id": {"type": "string", "description": "Target node ID, e.g. 'node_2'."},
                "relationship": {
                    "type": "string",
                    "enum": ["leads_to", "depends_on", "blocks"],
                },
            },
            "required": ["from_id", "to_id"],
        },
    },
    {
        "name": "save_user_goal",
        "description": "Save the user's goal to persistent memory.",
        "input_schema": {
            "type": "object",
            "properties": {
                "goal_id": {"type": "string", "description": "Unique ID, e.g. 'goal_001'."},
                "goal_text": {"type": "string", "description": "The complete goal text."},
                "context": {"type": "string", "description": "Additional context."},
            },
            "required": ["goal_id", "goal_text"],
        },
    },
]

TOOL_MAP = {
    "create_node": create_node,
    "connect_nodes": connect_nodes,
    "save_user_goal": save_user_goal,
}


def run(user_goal: str) -> dict:
    """Run the planner on a user goal. Returns structured plan dict."""
    reset_board()

    messages = [
        {
            "role": "user",
            "content": (
                f"User goal: {user_goal}\n\n"
                "Create a complete Miro flow map with nodes and edges, then save the goal."
            ),
        }
    ]

    while True:
        response = client.messages.create(
            model=MODEL,
            max_tokens=4096,
            system=SYSTEM,
            tools=TOOLS,
            messages=messages,
        )

        tool_results = []
        for block in response.content:
            if block.type == "tool_use":
                fn = TOOL_MAP.get(block.name)
                result = fn(**block.input) if fn else f"Unknown tool: {block.name}"
                tool_results.append(
                    {"type": "tool_result", "tool_use_id": block.id, "content": result}
                )

        if tool_results:
            messages.append({"role": "assistant", "content": response.content})
            messages.append({"role": "user", "content": tool_results})

        if response.stop_reason == "end_turn":
            board = get_board()
            tasks = [n for n in board["nodes"] if n.get("type") == "task"]
            return {
                "nodes": board["nodes"],
                "edges": board["edges"],
                "tasks": tasks,
            }
