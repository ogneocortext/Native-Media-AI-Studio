#!/usr/bin/env python3
"""
Current Best Practices Research Automation

Usage:
    python research.py --topic "React Server Components" --domain frontend
    python research.py --topic "Zero-runtime CSS-in-TS" --domain frontend --max-results 5
    python research.py --list-domains
"""

import argparse
import json
import sys
from datetime import datetime
from typing import Dict, List, Optional

# Current date context for searches
CURRENT_DATE = datetime.now()
CURRENT_MONTH = CURRENT_DATE.strftime("%B")
CURRENT_YEAR = CURRENT_DATE.year

# Domain-specific search query templates
DOMAIN_QUERIES = {
    "frontend": [
        "{topic} best practices {year} {month}",
        "{topic} modern patterns {year}",
        "{topic} architecture {year} TypeScript React",
    ],
    "backend": [
        "{topic} best practices {year} {month}",
        "{topic} architecture {year} Python FastAPI",
        "{topic} patterns {year} async",
    ],
    "ai": [
        "{topic} best practices {year} {month} local LLM",
        "{topic} patterns {year} Ollama RAG",
        "{topic} implementation {year} embeddings",
    ],
    "devops": [
        "{topic} best practices {year} {month} CI/CD",
        "{topic} patterns {year} Kubernetes Docker",
        "{topic} observability {year} OpenTelemetry",
    ],
    "general": [
        "{topic} best practices {year} {month}",
        "{topic} modern approach {year}",
        "{topic} recommendations {year}",
    ],
}

# Trusted source domains (prioritized)
TRUSTED_SOURCES = [
    # Official docs
    "react.dev", "nextjs.org", "tailwindcss.com", "vite.dev",
    "fastapi.tiangolo.com", "pydantic.dev", "tanstack.com",
    "playwright.dev", "vitest.dev", "storybook.js.org",
    "emotion.sh", "vanilla-extract.style", "panda-css.com",
    # Major project guidelines
    "superset.apache.org", "github.com/microsoft", "github.com/vercel",
    "github.com/facebook/react", "github.com/tailwindlabs",
    # Technical blogs (recent)
    "dev.to", "css-tricks.com", "web.dev", "kentcdodds.com",
    "epicweb.dev", "joshwcomeau.com", "dangz.dev",
]

def build_search_queries(topic: str, domain: str) -> List[str]:
    """Build search queries for a topic in a domain."""
    templates = DOMAIN_QUERIES.get(domain, DOMAIN_QUERIES["general"])
    queries = []
    for template in templates:
        query = template.format(
            topic=topic,
            year=CURRENT_YEAR,
            month=CURRENT_MONTH.lower()
        )
        queries.append(query)
    return queries

def is_trusted_source(url: str) -> bool:
    """Check if URL is from a trusted source."""
    return any(source in url for source in TRUSTED_SOURCES)

def format_findings(topic: str, domain: str, raw_results: List[dict]) -> dict:
    """Format raw search results into structured findings."""
    
    # Filter and score results
    scored = []
    for r in raw_results:
        score = 0
        if is_trusted_source(r.get("url", "")):
            score += 10
        # Prefer 2026 dates
        if str(CURRENT_YEAR) in r.get("excerpts", [""])[0] if r.get("excerpts") else "":
            score += 5
        scored.append((score, r))
    
    scored.sort(key=lambda x: x[0], reverse=True)
    
    # Extract key recommendations
    recommendations = []
    sources = []
    
    for score, r in scored[:8]:
        sources.append({
            "url": r.get("url", ""),
            "title": r.get("title", ""),
            "excerpt": r.get("excerpts", [""])[0][:300] if r.get("excerpts") else "",
            "trusted": is_trusted_source(r.get("url", "")),
            "score": score
        })
        
        # Extract actionable recommendations from excerpts
        for excerpt in r.get("excerpts", [])[:2]:
            if any(keyword in excerpt.lower() for keyword in 
                   ["recommend", "best practice", "should", "use ", "avoid", "prefer", "default"]):
                recommendations.append({
                    "text": excerpt[:200],
                    "source": r.get("url", "")
                })
    
    return {
        "topic": topic,
        "domain": domain,
        "researched_at": datetime.now().isoformat(),
        "current_context": f"{CURRENT_MONTH} {CURRENT_YEAR}",
        "recommendations": recommendations[:10],
        "sources": sources,
        "summary": f"Researched {len(sources)} sources for '{topic}' in {domain} domain"
    }

def main():
    parser = argparse.ArgumentParser(description="Research current best practices")
    parser.add_argument("--topic", required=False, help="Topic to research")
    parser.add_argument("--domain", default="general", 
                       choices=list(DOMAIN_QUERIES.keys()),
                       help="Domain context")
    parser.add_argument("--max-results", type=int, default=8, help="Max sources")
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
    
    # Build queries
    queries = build_search_queries(args.topic, args.domain)
    
    print(f"Researching: '{args.topic}' in {args.domain} domain ({CURRENT_MONTH} {CURRENT_YEAR})")
    print(f"Queries: {queries}")
    
    # This would call the actual websearch tool in practice
    # For now, return the query structure
    result = {
        "topic": args.topic,
        "domain": args.domain,
        "queries": queries,
        "current_context": f"{CURRENT_MONTH} {CURRENT_YEAR}",
        "note": "This script generates search queries. In the agent environment, use the websearch tool with these queries."
    }
    
    if args.json:
        print(json.dumps(result, indent=2))
    else:
        print(json.dumps(result, indent=2))

if __name__ == "__main__":
    main()