# Coding Model Benchmark

> Standardized benchmark for evaluating Ollama coding models on Python code generation, tool use, test generation, and edge-case identification.

## Quick Reference

| Field | Value |
|-------|-------|
| **Service** | `packages/backend/app/services/coding_benchmark.py` |
| **CLI** | `scripts/run_coding_benchmark.py` |
| **Output** | `output/coding-benchmarks.json` |
| **API Results** | `GET /api/integrations/ollama/coding-benchmark/results` |
| **API Run** | `POST /api/integrations/ollama/coding-benchmark/run` |
| **API Best** | `GET /api/integrations/ollama/coding-benchmark/best` |

## Why This Benchmark Exists

The project uses Ollama models for **AI test generation** (`scripts/ai-test-generator.py`) and other coding tasks. Not all models are equally capable at:

- Writing syntactically correct Python with type hints and docstrings
- Producing structured JSON for tool / function calling
- Generating runnable pytest tests that follow project fixtures
- Identifying hidden edge cases and boundary conditions

This benchmark measures those skills directly so the harness can pick the best model for the job.

## Benchmark Tasks

| Task | Weight | What It Measures |
|------|--------|------------------|
| `python_code_generation` | 30 | Regex, type hints, docstrings, None handling, valid syntax |
| `tool_use_structured` | 25 | JSON tool-call structure, required keys, correct tool name |
| `pytest_generation` | 30 | Pytest conventions, imports, exception testing, multiple tests |
| `edge_case_identification` | 15 | Boundary analysis, bug spotting, test coverage for edge cases |

### Task Details

#### 1. Python Code Generation (30 pts)

**Prompt:** Write `validate_email(email: str | None) -> bool` with regex, None handling, stripping, docstring, type hints.

**Validated rules:**
- Defines `validate_email`
- Uses type hints (`-> bool`, `str`, `None`)
- Has docstring
- Uses `re.` / `import re`
- Handles `None`
- Calls `.strip()`
- Valid Python syntax
- Reasonable length (3–30 lines)

#### 2. Tool Use / Structured Output (25 pts)

**Prompt:** Output a JSON tool call for `search_files` with `pattern`, `path`, `recursive`, `max_results`.

**Validated rules:**
- Parseable JSON
- Has `tool` key
- Has `arguments` key (object)
- `tool` == `"search_files"`

#### 3. Pytest Test Generation (30 pts)

**Prompt:** Generate pytest tests for a `divide(a, b)` function that raises `ZeroDivisionError`.

**Validated rules:**
- Valid Python syntax
- At least one `test_` function
- Imports `pytest`
- Tests zero division
- Tests normal case (`divide(2, 1)` etc.)
- Multiple tests
- Bonus: uses `pytest.raises`

#### 4. Edge Case Identification (15 pts)

**Prompt:** Analyze `get_user_badge(username, score)` for edge cases and generate tests.

**Validated rules:**
- Valid Python syntax
- At least 3 test functions
- Bonus per edge case covered:
  - `score > 1000` boundary
  - `score > 500` boundary
  - `score == 0` boundary
  - Negative score
  - Non-int input
  - `None` username

## Scoring

- Each task is scored 0–100 based on rule weights.
- Task score is normalized against the task weight to contribute to the overall score.
- Final score: weighted average across all tasks, normalized to 0–100.
- `success = true` if any task scores ≥ 40 and output is non-empty.

## Usage

### CLI

```bash
# Default: benchmark the project's standard coding models
python scripts/run_coding_benchmark.py

# Specific model
python scripts/run_coding_benchmark.py --model qwen2.5:7b

# All available models (capped at 12)
python scripts/run_coding_benchmark.py --all
```

### API

```bash
# Run benchmark
curl -X POST http://127.0.0.1:8000/api/integrations/ollama/coding-benchmark/run \
  -H "Content-Type: application/json" \
  -d '{"models": ["qwen2.5:7b", "qwen3.5:9b"]}'

# Get results
curl http://127.0.0.1:8000/api/integrations/ollama/coding-benchmark/results

# Get best model
curl http://127.0.0.1:8000/api/integrations/ollama/coding-benchmark/best
```

## Output Format

```json
{
  "updated_at": "2026-09-04T06:00:00+00:00",
  "results": {
    "qwen2.5:7b": {
      "model": "qwen2.5:7b",
      "success": true,
      "total_score": 85,
      "raw_score": 85,
      "max_score": 100,
      "total_latency_ms": 45200,
      "tasks": [
        {
          "task": "python_code_generation",
          "weight": 30,
          "success": true,
          "latency_ms": 12000,
          "validation": {
            "score": 90,
            "raw_score": 90,
            "max_score": 100,
            "passed_rules": 7,
            "total_rules": 7,
            "details": [...],
            "metrics": { "lines": 8, "chars": 320 }
          },
          "preview": "def validate_email(...): ...",
          "error": null
        }
      ],
      "timestamp": "2026-09-04T06:00:00+00:00"
    }
  }
}
```

## Interpreting Results

| Score Range | Verdict |
|-------------|---------|
| 80–100 | Excellent coding model — strong for test generation and tool use |
| 60–79 | Good — usable for test generation, review tool-use output |
| 40–59 | Fair — may need prompt engineering or post-processing |
| < 40 | Poor — avoid for automated coding tasks |

## Model Fit Warnings

- **Vision-only models** (`qwen3-vl:*`) will score near zero on text code tasks.
- **Reasoning models** (`deepseek-r1:*`) may refuse to output concise code and include long explanations, hurting structured-output tasks.
- **Small models** (`llama3.2:3b`, `qwen2.5:1.5b`) often fail syntax validation on complex tasks.

## Integration with Test Harness

Use coding benchmark scores to select the model for `scripts/ai-test-generator.py`:

```python
from app.services.coding_benchmark import get_best_model

best_coding_model = get_best_model()
if best_coding_model:
    os.environ["OLLAMA_TEST_MODEL"] = best_coding_model
```

Or via the API:

```typescript
const { best } = await getBestCodingModel();
if (best) {
  // Use best model for test generation
}
```

## Extending the Benchmark

To add a new task:

1. Add a task dict in `packages/backend/app/services/coding_benchmark.py` with `name`, `weight`, `system`, `user`, `validator`.
2. Implement the validator function `_validate_<task_name>(code: str) -> dict`.
3. Register it in the `VALIDATORS` dict.
4. Update this doc with the new task description and scoring rules.
