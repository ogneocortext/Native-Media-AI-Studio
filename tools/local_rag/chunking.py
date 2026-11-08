"""Markdown chunking for local-rag."""

import re
from dataclasses import dataclass

from .config import get_config


@dataclass
class Chunk:
    """A document chunk with metadata."""
    text: str
    tokens: int
    header_path: list[str] = None  # e.g. ["## Section", "### Subsection"]
    start_line: int = 0
    end_line: int = 0

    def __post_init__(self):
        if self.header_path is None:
            self.header_path = []


def count_tokens(text: str) -> int:
    """Estimate token count (~4 chars per token for English)."""
    return max(1, len(text) // 4)


def extract_headers(lines: list[str]) -> list[tuple[int, str, int]]:
    """Extract markdown headers from lines. Returns (line_idx, header_text, level)."""
    headers = []
    for i, line in enumerate(lines):
        match = re.match(r'^(#{1,6})\s+(.+)$', line.strip())
        if match:
            level = len(match.group(1))
            header_text = match.group(2).strip()
            headers.append((i, header_text, level))
    return headers


def get_header_context(headers: list[tuple[int, str, int]], line_idx: int) -> list[str]:
    """Get header path for a given line index."""
    context = []
    for h_line, h_text, h_level in headers:
        if h_line <= line_idx:
            context.append(f"{'#' * h_level} {h_text}")
        else:
            break
    return context


def chunk_markdown(text: str, config=None) -> list[Chunk]:
    """
    Split markdown into chunks by token count with header context.
    
    Strategy:
    1. Split by headers first
    2. Within each section, chunk by token count with overlap
    3. Preserve header path for each chunk
    """
    if config is None:
        config = get_config().chunking

    lines = text.split('\n')
    headers = extract_headers(lines)
    
    chunks = []
    current_chunk_lines = []
    current_tokens = 0
    current_start = 0
    current_header_path = []
    
    for i, line in enumerate(lines):
        line_tokens = count_tokens(line)
        header_path = get_header_context(headers, i)
        
        # Check if header changed
        if header_path != current_header_path and current_chunk_lines:
            # Flush current chunk
            chunk_text = '\n'.join(current_chunk_lines).strip()
            if chunk_text:
                chunks.append(Chunk(
                    text=chunk_text,
                    tokens=current_tokens,
                    header_path=current_header_path,
                    start_line=current_start,
                    end_line=i - 1
                ))
            
            current_chunk_lines = []
            current_tokens = 0
            current_start = i
            current_header_path = header_path
        
        # Check if adding this line would exceed chunk size
        if current_tokens + line_tokens > config.chunk_tokens and current_chunk_lines:
            chunk_text = '\n'.join(current_chunk_lines).strip()
            if chunk_text:
                chunks.append(Chunk(
                    text=chunk_text,
                    tokens=current_tokens,
                    header_path=current_header_path,
                    start_line=current_start,
                    end_line=i - 1
                ))
            
            # Start new chunk with overlap
            overlap_lines = current_chunk_lines[-config.overlap_tokens:] if config.overlap_tokens > 0 else []
            current_chunk_lines = overlap_lines + [line]
            current_tokens = sum(count_tokens(line) for line in current_chunk_lines)
            current_start = i - len(overlap_lines)
        else:
            current_chunk_lines.append(line)
            current_tokens += line_tokens
    
    # Don't forget the last chunk
    if current_chunk_lines:
        chunk_text = '\n'.join(current_chunk_lines).strip()
        if chunk_text:
            chunks.append(Chunk(
                text=chunk_text,
                tokens=current_tokens,
                header_path=current_header_path,
                start_line=current_start,
                end_line=len(lines) - 1
            ))
    
    return chunks


def chunk_to_text(chunk: Chunk, include_header: bool = True) -> str:
    """Convert chunk to text for embedding."""
    parts = []
    if include_header and chunk.header_path:
        parts.extend(chunk.header_path)
    parts.append(chunk.text)
    return '\n'.join(parts)