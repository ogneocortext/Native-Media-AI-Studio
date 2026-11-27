"""NSFW gate -- the ``nsfw`` media tag plus the ``show_nsfw`` user setting.

Visibility only. Nothing here moves, renames, re-encodes, or deletes a file:
the flag is an ordinary media tag (``media_tags`` / ``media_item_tags`` rows,
keyed by ``relative_path``), so it costs no new schema and survives rescans.

Two independent pieces live here:

* the per-item flag -- :func:`set_flagged`, :func:`is_flagged`,
  :func:`flagged_paths`
* the user-facing gate -- :func:`gate_enabled`, backed by ``show_nsfw`` in
  ``config/settings.json`` (default ``False``)

:func:`hidden_paths` is the one call a general list endpoint makes. It returns
the flagged paths that must be dropped from a response. The exclusion is
permanent -- :func:`gate_enabled` governs only whether the dedicated ``/nsfw``
section is served at all.
"""

from __future__ import annotations

from pathlib import Path

from .config import config
from .connection import get_db

#: Name of the tag that marks an item NSFW. Matched case-insensitively on
#: read so a tag created through the library's own tag editor ("NSFW") still
#: gates; writes always use this exact spelling.
NSFW_TAG_NAME = "nsfw"


def gate_enabled() -> bool:
    """True when the owner has turned on "Show NSFW content".

    Reads the live config object, so flipping the Settings toggle takes effect
    on the next request without a restart.
    """
    return bool(config.show_nsfw)


def _tag_id(conn) -> str | None:
    """Id of the NSFW tag, or None when no item has ever been flagged."""
    row = conn.execute(
        "SELECT id FROM media_tags WHERE lower(name) = ?",
        (NSFW_TAG_NAME,),
    ).fetchone()
    return row["id"] if row else None


def flagged_paths() -> set[str]:
    """Relative paths of every item flagged NSFW, regardless of the gate."""
    with get_db() as conn:
        tag_id = _tag_id(conn)
        if not tag_id:
            return set()
        rows = conn.execute(
            "SELECT relative_path FROM media_item_tags WHERE tag_id = ?",
            (tag_id,),
        ).fetchall()
    return {r["relative_path"] for r in rows}


def is_flagged(relative_path: str) -> bool:
    """True when this one item carries the NSFW tag."""
    with get_db() as conn:
        tag_id = _tag_id(conn)
        if not tag_id:
            return False
        row = conn.execute(
            "SELECT 1 FROM media_item_tags WHERE relative_path = ? AND tag_id = ?",
            (relative_path, tag_id),
        ).fetchone()
    return row is not None


def set_flagged(relative_path: str, *, flagged: bool) -> bool:
    """Add or remove the NSFW tag on one item. Returns the resulting state.

    Creates the tag on first use, so a fresh install needs no seeding step.
    """
    # Imported lazily: media.py is a sibling core module and this keeps the
    # tag-creation rule (name, colour, uniqueness) in one place.
    from .media import add_tag_to_item, get_or_create_tag, remove_tag_from_item

    with get_db() as conn:
        tag_id = _tag_id(conn)
    if tag_id is None:
        tag_id = get_or_create_tag(NSFW_TAG_NAME)["id"]

    if flagged:
        add_tag_to_item(relative_path, tag_id)
    else:
        remove_tag_from_item(relative_path, tag_id)
    return flagged


def hidden_paths() -> set[str]:
    """Paths every *general* list surface must exclude.

    This is unconditional, and that is the point: a flagged item leaves the
    home feed, the library and every other general list for good, whether or
    not the owner has turned NSFW display on. ``show_nsfw`` decides only
    whether the dedicated ``/nsfw`` section is served -- never whether flagged
    items are allowed back into the general surfaces.
    """
    return flagged_paths()


def _outputs_rel(path: str | Path) -> str | None:
    """output/-relative posix path for an absolute path inside output/."""
    try:
        return (
            Path(path)
            .resolve()
            .relative_to(Path(config.output_dir).resolve())
            .as_posix()
        )
    except (OSError, ValueError):
        return None


def path_is_flagged(path: str | Path, *, hidden: set[str] | None = None) -> bool:
    """True when an absolute path inside output/ resolves to a flagged item.

    For list surfaces that hold filesystem paths rather than the
    output/-relative strings :func:`hidden_paths` returns. Pass ``hidden``
    when filtering many items to avoid a DB hit per call.
    """
    hidden = flagged_paths() if hidden is None else hidden
    if not hidden:
        return False
    rel = _outputs_rel(path)
    return rel is not None and rel in hidden


def tree_is_flagged(path: str | Path, *, hidden: set[str] | None = None) -> bool:
    """True when ``path`` is flagged or contains a flagged descendant.

    For list surfaces that expose whole directories (remixes, stem sets)
    rather than individual files: hiding one flagged stem hides the set it
    belongs to, matching how the library treats the directory as one item.
    """
    hidden = flagged_paths() if hidden is None else hidden
    if not hidden:
        return False
    rel = _outputs_rel(path)
    if rel is None:
        return False
    prefix = rel + "/"
    return any(h == rel or h.startswith(prefix) for h in hidden)
