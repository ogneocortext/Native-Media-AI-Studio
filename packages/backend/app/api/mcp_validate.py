"""MCP tool-call validation endpoint.

Wraps :func:`app.services.mcp_validator.validate_tool_call` so the
in-repo MCP bridges (Node.js) can validate arguments over HTTP before
dispatching a tool.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from ..services.mcp_validator import ValidationError, validate_tool_call, validate_tool_result

logger = logging.getLogger(__name__)

router = APIRouter(tags=["MCP"])


class ValidateToolCallRequest(BaseModel):
    tool_name: str
    arguments: dict[str, Any] = {}


class ValidateToolCallResponse(BaseModel):
    valid: bool
    tool_name: str
    arguments: dict[str, Any]
    error: str | None = None


@router.post("/api/mcp/validate-tool", response_model=ValidateToolCallResponse)
async def validate_tool(args: ValidateToolCallRequest) -> ValidateToolCallResponse:
    """Validate an MCP tool call's arguments against the in-repo schema registry.

    Unknown tools are logged and passed through (``valid=True``) so upstream
    servers (Blender MCP, Remotion MCP) are not broken by the validator.
    """
    try:
        validated = validate_tool_call(args.tool_name, args.arguments)
        return ValidateToolCallResponse(
            valid=True,
            tool_name=args.tool_name,
            arguments=validated,
            error=None,
        )
    except ValidationError as exc:
        logger.warning("MCP tool validation failed: %s", exc)
        return ValidateToolCallResponse(
            valid=False,
            tool_name=args.tool_name,
            arguments=args.arguments,
            error=str(exc),
        )
    except Exception as exc:
        logger.error("MCP tool validation error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"validation error: {exc}") from exc


class ValidateToolResultRequest(BaseModel):
    tool_name: str
    result: Any


class ValidateToolResultResponse(BaseModel):
    valid: bool
    tool_name: str
    error: str | None = None


@router.post("/api/mcp/validate-result", response_model=ValidateToolResultResponse)
async def validate_result(args: ValidateToolResultRequest) -> ValidateToolResultResponse:
    """Validate an MCP tool *result* against the CallToolResult envelope.

    Checks the ``content`` block array, ``isError`` flag, and optional
    ``structuredContent`` — the output-side counterpart to
    ``/api/mcp/validate-tool``. Unknown tools pass through (``valid=True``).
    """
    try:
        validate_tool_result(args.tool_name, args.result)
        return ValidateToolResultResponse(valid=True, tool_name=args.tool_name)
    except ValidationError as exc:
        logger.warning("MCP tool result validation failed: %s", exc)
        return ValidateToolResultResponse(valid=False, tool_name=args.tool_name, error=str(exc))
    except Exception as exc:
        logger.error("MCP tool result validation error: %s", exc, exc_info=True)
        raise HTTPException(status_code=500, detail=f"validation error: {exc}") from exc
