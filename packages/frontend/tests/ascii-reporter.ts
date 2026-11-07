/**
 * ASCII Art Playwright Reporter
 *
 * Prints the shared ASCII-art test summary (same shape as the pytest and
 * vitest reports) at the end of `playwright test`, with failure repro
 * commands agents and users can paste directly.
 */

import path from "node:path";

import type {
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";

import {
  CLIOutput,
  buildTestInsights,
  classifyFailure,
  summarizeTestResults,
  type NormalizedTestResult,
} from "../src/utils/cli-output-formatter.ts";

interface RecordedTest {
  name: string;
  file: string;
  line?: number;
  outcome: NormalizedTestResult["outcome"];
  durationMs: number;
  error?: string;
  skipNote?: string;
  code?: string;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\u001b\[[0-9;]*m/g;

function firstLine(text: string | undefined): string {
  if (!text) return "";
  const clean = text.replace(ANSI_RE, "");
  const line = clean.split("\n").find((l) => l.trim().length > 0) ?? "";
  return line.trim().slice(0, 120);
}

function relFile(file: string): string {
  const rel = path.relative(process.cwd(), file);
  return rel || file;
}

function outcomeOf(test: TestCase): NormalizedTestResult["outcome"] {
  // test.outcome() already accounts for expectation: "expected" covers both
  // normal passes and expected failures (test.fail()), so it maps to passed
  // regardless of the raw result.status.
  switch (test.outcome()) {
    case "unexpected":
      return "failed";
    case "flaky":
      return "flaky";
    case "skipped":
      return "skipped";
    default:
      return "passed";
  }
}

export default class AsciiReporter implements Reporter {
  private cli = new CLIOutput();
  private startTime = 0;
  // onTestEnd fires once per attempt (result.retry distinguishes them), so
  // keep the LAST result per test.id — a flaky pass must overwrite its
  // earlier failed attempt, not be dropped by a retry>0 filter.
  private tests = new Map<string, RecordedTest>();

  onBegin(_config: unknown, _suite: Suite): void {
    this.startTime = Date.now();
    this.tests.clear();
    console.log("");
    console.log(this.cli.formatTestSuiteStart("Playwright E2E Suite"));
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    const skipAnnotation = test.annotations.find(
      (a) => a.type === "skip" || a.type === "fixme",
    );

    const outcome = outcomeOf(test);
    this.tests.set(test.id, {
      name: test.title,
      file: relFile(test.location.file),
      line: test.location.line,
      outcome,
      durationMs: result.duration,
      error: result.error ? firstLine(result.error.message) : undefined,
      skipNote: skipAnnotation?.description,
      // Playwright distinguishes timeouts structurally; everything else is
      // classified from the error text by the shared keyword rules.
      code:
        outcome === "failed"
          ? result.status === "timedOut"
            ? "E_TIMEOUT"
            : classifyFailure(result.error?.message)
          : undefined,
    });
  }

  onEnd(result: FullResult): void {
    const durationS = (Date.now() - this.startTime) / 1000;
    const tests = [...this.tests.values()];

    const summary = summarizeTestResults(tests);
    const { passed, failed, skipped, flaky, failures, slowest, skipReasons } =
      summary;
    const errors = result.status === "interrupted" ? 1 : 0;

    let insights = buildTestInsights({
      failed,
      skipped,
      errors,
      slowest,
    });
    if (tests.length === 0 && errors === 0) {
      insights = [
        'No tests ran — check file patterns/filters before trusting this result.',
      ];
    }
    if (flaky) {
      insights.unshift(
        `${flaky} flaky test(s) — passed only after retry; investigate before trusting them.`,
      );
    }

    // Surface skip reasons so "skipped" is interpretable, not just a count.
    if (skipReasons.length) {
      const top = skipReasons
        .map(([note, n]) => `${note} (${n})`)
        .join("; ");
      insights.push(`Skip reasons: ${top}`);
    }
    if (result.status === "interrupted") {
      insights.unshift("Run interrupted — results may be incomplete.");
    }

    // Repro commands use Playwright's file + -g title filters (no -x flag).
    // Titles containing double quotes would break the -g "..." arg — escape.
    const reproLines = failures.slice(0, 5).map((f) => {
      return `    pnpm test ${f.file} -g "${f.name.replace(/"/g, '\\"')}"`;
    });
    if (failures.length > 5) {
      reproLines.push(`    ... and ${failures.length - 5} more`);
    }

    console.log("");
    console.log(
      this.cli.formatTestResults({
        passed,
        failed,
        skipped,
        errors,
        duration_s: durationS,
        suite: "playwright e2e",
        failures,
        slowest,
        insights,
        rerunHint: "pnpm test",
        reproLines: reproLines.length ? reproLines : undefined,
      }),
    );
  }
}
