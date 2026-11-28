"""Storyboard boards API: list, load, and save canonical boards.

The store lives in ``services/storyboard_boards.py``; this router is the
thin HTTP layer over it. Saved boards are runtime state under
``storage/storyboards/``; until a board is saved, GET serves the converted
seed (the repo's authored Markdown / sequences-JSON files), so the page
always has exactly one board shape to edit.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services import storyboard_boards

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/storyboards", tags=["Storyboards"])


class SaveBoardRequest(BaseModel):
    """Body for saving a board: the full board object as edited."""

    board: dict[str, Any]


@router.get("")
async def list_storyboards() -> dict[str, Any]:
    """Summaries for every known board (saved boards shadow their seeds)."""
    return {"boards": storyboard_boards.list_boards()}


@router.get("/{slug}")
async def get_storyboard(slug: str) -> dict[str, Any]:
    """One board in canonical shape; 404 when the slug is unknown."""
    board = storyboard_boards.load_board(slug)
    if board is None:
        raise HTTPException(status_code=404, detail=f"unknown storyboard: {slug}")
    return board


@router.put("/{slug}")
async def save_storyboard(slug: str, request: SaveBoardRequest) -> dict[str, Any]:
    """Validate and store a board; 400 with the validation errors."""
    try:
        stored = storyboard_boards.save_board(slug, request.board)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return {
        "success": True,
        "slug": slug,
        "scene_count": len(stored.get("scenes") or []),
        "board": stored,
    }
