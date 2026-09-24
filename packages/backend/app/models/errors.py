"""Shared API response and error models."""

from typing import Any

from pydantic import BaseModel, Field


class ErrorDetail(BaseModel):
    """Uniform error details returned by the backend."""

    code: str = Field(examples=["VALIDATION_ERROR"])
    message: str = Field(examples=["Request validation failed"])
    details: Any | None = None


class ErrorResponse(BaseModel):
    """Uniform error response envelope."""

    error: ErrorDetail
