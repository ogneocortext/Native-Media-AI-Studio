#!/usr/bin/env python3
"""
Current Best Practices Research Automation

This module provides utilities for researching current best practices.
The actual web searches are performed by the agent using the `websearch` tool.
This module generates optimized search queries and processes results.

Usage (in agent code):
    from skills.current_best_practices import (
        get_current_context,
        get_domain_queries,
        build_search_queries,
        format_findings
    )

    context = get_current_context()
    queries = build_search_queries("React Server Components", "frontend")
    # Execute queries via websearch tool...
    findings = format_findings("React Server Components", "frontend", raw_results)
"""

import argparse
import json
import operator
import sys
from datetime import datetime


def get_current_context() -> dict:
    """Get current date context for research."""
    now = datetime.now()
    return {
        "year": now.year,
        "month": now.month,
        "month_name": now.strftime("%B"),
        "month_lower": now.strftime("%B").lower(),
        "date_string": now.strftime("%B %Y"),
        "iso_date": now.date().isoformat(),
    }


def build_search_queries(topic: str, domain: str = "general") -> list[str]:
    """Build search queries for a topic in a domain."""
    templates = DOMAIN_QUERIES.get(domain, DOMAIN_QUERIES["general"])
    context = get_current_context()
    queries = []
    for template in templates:
        query = template.format(
            topic=topic,
            year=context["year"],
            month=context["month_name"],
            month_lower=context["month_lower"],
        )
        queries.append(query)
    return queries


def is_trusted_source(url: str) -> bool:
    """Check if URL is from a trusted source."""
    if not url:
        return False
    url_lower = url.lower()
    return any(source in url_lower for source in TRUSTED_SOURCES)


def extract_recommendations(excerpts: list[str]) -> list[dict]:
    """Extract actionable recommendations from excerpts."""
    recommendations = []
    keywords = ["recommend", "best practice", "should", "use ", "avoid", "prefer", "default", "adopt", "migrate"]
    for excerpt in excerpts[:3]:
        excerpt_lower = excerpt.lower()
        if any(keyword in excerpt_lower for keyword in keywords):
            # Clean up the excerpt
            clean = excerpt.strip()
            if len(clean) > 20:  # Filter out very short fragments
                recommendations.append({"text": clean[:300]})
    return recommendations[:5]


def format_findings(
    topic: str,
    domain: str,
    raw_results: list[dict],
    max_sources: int = 8,
    max_recommendations: int = 10
) -> dict:
    """
    Format raw websearch results into structured findings.

    Args:
        topic: The research topic
        domain: The domain context
        raw_results: List of results from websearch tool (each with url, title, excerpts)
        max_sources: Maximum number of sources to include
        max_recommendations: Maximum number of recommendations

    Returns:
        Structured findings dict
    """
    context = get_current_context()

    # Filter and score results
    scored = []
    for r in raw_results:
        score = 0
        url = r.get("url", "")
        if is_trusted_source(url):
            score += 10

        # Prefer results mentioning current year
        excerpt_text = ""
        if r.get("excerpts"):
            excerpt_text = " ".join(r["excerpts"][:2])
        if str(context["year"]) in excerpt_text:
            score += 5

        # Boost score for official documentation
        url_lower = url.lower()
        if any(doc in url_lower for doc in [".dev", "docs.", "documentation", "api.", "spec."]):
            score += 3

        scored.append((score, r))

    scored.sort(key=operator.itemgetter(0), reverse=True)

    # Extract sources and recommendations
    sources = []
    all_recommendations = []

    for score, r in scored[:max_sources]:
        url = r.get("url", "")
        sources.append({
            "url": url,
            "title": r.get("title", "")[:200],
            "excerpt": " ".join(r.get("excerpts", [""])[:2])[:400],
            "trusted": is_trusted_source(url),
            "score": score,
        })

        # Extract recommendations from excerpts
        if r.get("excerpts"):
            recs = extract_recommendations(r["excerpts"])
            for rec in recs:
                rec["source"] = url
                all_recommendations.append(rec)

    # Deduplicate recommendations
    seen = set()
    unique_recs = []
    for rec in all_recommendations:
        key = rec["text"][:100]
        if key not in seen:
            seen.add(key)
            unique_recs.append(rec)

    return {
        "topic": topic,
        "domain": domain,
        "researched_at": datetime.now().isoformat(),
        "current_context": context["date_string"],
        "recommendations": unique_recs[:max_recommendations],
        "sources": sources,
        "summary": f"Researched {len(sources)} sources for '{topic}' in {domain} domain",
        "context": context,
    }


def research_via_websearch(
    topic: str,
    domain: str = "general",
    max_results: int = 8,
    websearch_func: callable | None = None
) -> dict:
    """
    High-level research function that generates queries, executes them via websearch,
    and formats findings.

    Args:
        topic: Topic to research
        domain: Domain context
        max_results: Maximum number of results per query
        websearch_func: Async function to execute websearch (agent provides this)

    Returns:
        Structured findings

    Note: If websearch_func is not provided, returns queries only for manual execution.
    """
    queries = build_search_queries(topic, domain)
    context = get_current_context()

    result = {
        "topic": topic,
        "domain": domain,
        "queries": queries,
        "current_context": context["date_string"],
        "note": "Execute queries via websearch tool and pass results to format_findings()"
    }

    if websearch_func:
        # Execute all queries
        all_results = []
        for query in queries:
            try:
                search_results = websearch_func(query, max_results)
                if search_results:
                    all_results.extend(search_results)
            except Exception as e:
                print(f"Search failed for '{query}': {e}", file=sys.stderr)

        # Format findings
        findings = format_findings(topic, domain, all_results)
        result["findings"] = findings

    return result


def main():
    """CLI entry point for generating queries."""
    parser = argparse.ArgumentParser(description="Generate search queries for best practices research")
    parser.add_argument("--topic", required=False, help="Topic to research")
    parser.add_argument("--domain", default="general",
                       choices=list(DOMAIN_QUERIES.keys()),
                       help="Domain context")
    parser.add_argument("--max-results", type=int, default=8, help="Max sources per query")
    parser.add_argument("--list-domains", action="store_true", help="List available domains")
    parser.add_argument("--json", action="store_true", help="Output JSON")

    args = parser.parse_args()

    if args.list_domains:
        print("Available domains:")
        for d in DOMAIN_QUERIES:
            print(f"  - {d}")
        return

    if not args.topic:
        parser.error("--topic is required (or use --list-domains)")

    queries = build_search_queries(args.topic, args.domain)
    context = get_current_context()

    result = {
        "topic": args.topic,
        "domain": args.domain,
        "queries": queries,
        "current_context": context["date_string"],
        "note": "Execute these queries via websearch tool, then pass results to format_findings()"
    }

    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()


# Domain-specific search query templates
DOMAIN_QUERIES = {
    "frontend": [
        "{topic} best practices {year} {month_lower}",
        "{topic} modern patterns {year}",
        "{topic} architecture {year} TypeScript React",
        "{topic} {year} {month_lower} guide",
    ],
    "backend": [
        "{topic} best practices {year} {month_lower}",
        "{topic} architecture {year} Python FastAPI",
        "{topic} patterns {year} async",
        "{topic} {year} {month_lower} guide",
    ],
    "ai": [
        "{topic} best practices {year} {month_lower} local LLM",
        "{topic} patterns {year} Ollama RAG",
        "{topic} implementation {year} embeddings",
        "{topic} {year} {month_lower} tutorial",
    ],
    "devops": [
        "{topic} best practices {year} {month_lower} CI/CD",
        "{topic} patterns {year} Kubernetes Docker",
        "{topic} observability {year} OpenTelemetry",
        "{topic} {year} {month_lower} deployment",
    ],
    "general": [
        "{topic} best practices {year} {month_lower}",
        "{topic} modern approach {year}",
        "{topic} recommendations {year}",
    ],
}


def get_domain_queries(domain: str = "general") -> list[list[str]]:
    """Get search query templates for a domain."""
    return DOMAIN_QUERIES.get(domain, DOMAIN_QUERIES["general"])


# Trusted source domains (prioritized)
TRUSTED_SOURCES = [
    # Official docs
    "react.dev", "nextjs.org", "tailwindcss.com", "vite.dev",
    "fastapi.tiangolo.com", "pydantic.dev", "tanstack.com",
    "playwright.dev", "vitest.dev", "storybook.js.org",
    "zod.dev", "vanilla-extract.style", "panda-css.com",
    "hono.dev", "sqlalchemy.org", "drizzle.team",
    "ollama.ai", "github.com/ollama",
    # Major project guidelines
    "superset.apache.org", "github.com/vercel", "github.com/facebook/react",
    "github.com/tailwindlabs", "github.com/microsoft",
    # Authoritative technical sources
    "web.dev", "kentcdodds.com", "epicweb.dev", "joshwcomeau.com",
    "developer.mozilla.org", "spec.whatwg.org", "tc39.es",
]
