"""Current Best Practices Research Skill Package"""

__version__ = "1.1.0"
__description__ = "Automated research for current best practices (as of current month/year)"

# This skill provides utilities for researching current best practices.
# The actual web searches are performed by the agent using the `websearch` tool.
# This module provides query generation, result formatting, and source filtering.

# Import from the research module
from current_best_practices.research import (
    get_current_context,
    get_domain_queries,
    build_search_queries,
    format_findings,
    research_via_websearch,
    DOMAIN_QUERIES,
    TRUSTED_SOURCES,
)

__all__ = [
    "get_current_context",
    "get_domain_queries",
    "build_search_queries",
    "format_findings",
    "research_via_websearch",
    "DOMAIN_QUERIES",
    "TRUSTED_SOURCES",
]