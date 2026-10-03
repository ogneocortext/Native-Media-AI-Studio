"""Tokenised, ranked documentation search.

Why this exists: `/api/docs/search` scored documents with substring matching
(`query in text`), which on this corpus produced confidently wrong results. A
search for `og` matched unrelated docs because it occurs inside "log"/"dialog";
`vr` matched "VRAM" and "over"; `jobid` matched "video". Each ranked *above* real
matches, because a rare substring scores higher than a common exact token.

It also re-read every markdown file on every request - 155 files / 1.8 MB, and a
measured 547 ms per query. This builds the corpus into an inverted index once.

Design notes:

- **Pure stdlib, no new dependencies.** `transformers`, `sklearn` and `numpy` are
  installed, but no embedding model is cached locally and none is needed: the
  corpus is 155 short technical documents whose queries are overwhelmingly
  *lexical* (identifiers, file paths, exact error strings). BM25 with a real
  tokenizer beats substring matching here, is reproducible in tests, and needs no
  model download and no network at query time.
- **BM25 (Okapi) rather than raw term frequency**, so a term appearing 50 times in
  one document stops outranking a term appearing once in every document.
- **CamelCase and snake_case are split.** `queue_manager.py` must be findable by
  `queue manager`; `is_runnable` by `runnable`.
- **Field weighting.** A hit in the title or path outranks one buried in prose.
- **Matched terms are returned**, so a result can be explained rather than merely
  ranked.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter, defaultdict
from dataclasses import dataclass, field

#: Matches one word: an alphanumeric run with optional internal underscores.
#: Case is preserved so ``ComfyUIAdapter`` reaches the camelCase splitter in
#: ``_split_identifier``; a lowercase-only pattern silently defeated it.
_WORD_RE = re.compile(r"[A-Za-z0-9]+(?:_[A-Za-z0-9]+)*")

#: Terms carrying no retrieval signal here. Deliberately short: an aggressive list
#: starts eating real queries ("can", "use", "get").
STOPWORDS = frozenset("""
a an the and or of to in on for with is are was were be been this that these those
it as at by from not no but if then than so such can could should would will may
might must do does did done have has had having you your we our they their he she
i me my us them what which who whom when where why how all any both each few more
most other some only own same too very s t just don now
""".split())

#: BM25 parameters: k1 controls term-frequency saturation, b the length
#: normalisation. Standard defaults, known to work well for short documents.
_K1 = 1.5
_B = 0.75


def _split_identifier(token: str) -> list[str]:
    """Split ``queue_manager`` into ``[queue_manager, queue, manager]``.

    The whole token is kept so an exact match on the full name still wins; the
    parts are added so a partial query can still find it.
    """
    if "_" in token and len(token) > 4:
        parts = [p for p in token.split("_") if len(p) > 1]
        if parts:
            return [token, *parts]
        return [token]
    if len(token) > 6:
        # CamelCase: comfyuiClient -> comfyui, client
        pieces = re.findall(r"[A-Z]+(?![a-z])|[A-Z][a-z]+|[a-z]+", token)
        if len(pieces) > 1:
            extra = [p.lower() for p in pieces if len(p) > 1]
            if extra:
                return [token, *extra]
    return [token]


def tokenize(text: str) -> list[str]:
    """Lowercase, strip accents, split identifiers, drop stopwords.

    CamelCase splitting happens *before* lowercasing: once ``ComfyUIAdapter`` is
    folded to ``comfyuiadapter`` the boundaries are gone and the class name stays
    one opaque token, which is what made identifier search silently useless.
    """
    text = unicodedata.normalize("NFKD", text)
    text = "".join(c for c in text if not unicodedata.combining(c))
    out: list[str] = []
    for raw in _WORD_RE.findall(text):
        if raw.lower() in STOPWORDS or len(raw) < 2:
            continue
        for piece in _split_identifier(raw):
            low = piece.lower()
            if low in STOPWORDS or len(low) < 2:
                continue
            out.append(low)
    return out


@dataclass
class IndexedDoc:
    """One indexed document and its term statistics."""

    path: str
    title: str
    tags: tuple[str, ...]
    aliases: tuple[str, ...]
    in_vault: bool
    file_type: str
    #: Boosted fields: title + path + tags + aliases.
    head_terms: Counter = field(default_factory=Counter)
    all_terms: Counter = field(default_factory=Counter)
    length: int = 0


class DocIndex:
    """An inverted index over the documentation corpus."""

    def __init__(self) -> None:
        self._docs: dict[str, IndexedDoc] = {}
        self._postings: dict[str, list[tuple[str, int]]] = defaultdict(list)
        self._avg_len: float = 0.0

    def add(
        self,
        path: str,
        title: str,
        tags: list[str] | tuple[str, ...],
        aliases: list[str] | tuple[str, ...],
        in_vault: bool,
        file_type: str,
        body: str,
        *,
        title_weight: int = 4,
        tag_weight: int = 3,
        alias_weight: int = 3,
        path_weight: int = 2,
    ) -> None:
        body_terms = tokenize(body)
        head: Counter = Counter()
        for field_text, weight in (
            (title, title_weight),
            (" ".join(tags), tag_weight),
            (" ".join(aliases), alias_weight),
            (path.replace("/", " ").replace("_", " ").replace("-", " "), path_weight),
        ):
            for t in tokenize(field_text):
                head[t] += weight

        # Head terms also count toward length; otherwise a heavily-boosted title
        # would make the document look artificially short to length normalisation.
        all_terms = Counter(body_terms)
        all_terms.update(head)
        doc = IndexedDoc(
            path=path,
            title=title,
            tags=tuple(tags),
            aliases=tuple(aliases),
            in_vault=in_vault,
            file_type=file_type,
            head_terms=head,
            all_terms=all_terms,
            length=len(body_terms) + sum(head.values()),
        )
        self._docs[path] = doc
        for term, count in doc.all_terms.items():
            self._postings[term].append((path, count))

    def finalize(self) -> None:
        if self._docs:
            self._avg_len = sum(d.length for d in self._docs.values()) / len(self._docs)
        else:
            self._avg_len = 0.0

    def __len__(self) -> int:
        return len(self._docs)

    @property
    def doc_count(self) -> int:
        return len(self._docs)

    @property
    def term_count(self) -> int:
        return len(self._postings)

    def search(
        self,
        query: str,
        *,
        limit: int = 20,
        vault_only: bool = False,
    ) -> list[dict]:
        """Rank documents for ``query``.

        Returns the score *and* the terms that actually matched, so a result can
        be explained rather than merely ranked.
        """
        q_terms = tokenize(query)
        if not q_terms:
            return []
        n = max(1, self.doc_count)
        scores: dict[str, float] = defaultdict(float)
        matched: dict[str, set[str]] = defaultdict(set)
        head_matched: dict[str, set[str]] = defaultdict(set)

        for term in set(q_terms):
            postings = self._postings.get(term)
            if not postings:
                continue
            df = len(postings)
            # BM25 IDF with the +1 that keeps it non-negative for common terms.
            idf = math.log(1.0 + (n - df + 0.5) / (df + 0.5))
            if idf <= 0:
                continue
            for path, tf in postings:
                doc = self._docs[path]
                denom = tf + _K1 * (1 - _B + _B * (doc.length / (self._avg_len or 1.0)))
                scores[path] += idf * (tf * (_K1 + 1)) / denom
                matched[path].add(term)
                if term in doc.head_terms:
                    head_matched[path].add(term)

        results = []
        for path, score in scores.items():
            doc = self._docs[path]
            if vault_only and not doc.in_vault:
                continue
            # A term in the title/path/tags is a much stronger relevance signal
            # than the same term buried in prose.
            score *= 1.0 + 0.5 * len(head_matched[path])
            results.append(
                {
                    "path": doc.path,
                    "vault_path": doc.path,
                    "title": doc.title,
                    "tags": list(doc.tags),
                    "in_vault": doc.in_vault,
                    "file_type": doc.file_type,
                    "score": round(score, 3),
                    "matched_terms": sorted(matched[path]),
                    "matched_in_head": sorted(head_matched[path]),
                }
            )
        results.sort(key=lambda r: (-r["score"], r["path"]))
        return results[:limit]
