"""Current Best Practices Research Skill Package"""

__version__ = "1.0.0"
__description__ = "Automated research for current best practices (as of current month/year)"

# This skill is primarily the SKILL.md documentation and research.py helper
# The actual research is performed via websearch tool with date-contextualized queries

def get_current_context() -> dict:
    """Get current date context for research."""
    from datetime import datetime
    now = datetime.now()
    return {
        "year": now.year,
        "month": now.month,
        "month_name": now.strftime("%B"),
        "date_string": now.strftime("%B %Y"),
    }

def get_domain_queries(domain: str = "general") -> list:
    """Get search query templates for a domain."""
    from .research import DOMAIN_QUERIES
    return DOMAIN_QUERIES.get(domain, DOMAIN_QUERIES["general"])

__all__ = [
    "get_current_context",
    "get_domain_queries",
]