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
  type SlowTest,
  type TestFailure,
} from "../src/utils/cli-output-formatter";

interface RecordedTest {
  name: string;
  file: string;
  line?: number;
  outcome: "passed" | "failed" | "skipped" | "flaky";
  durationMs: number;
  error?: string;
  skipNote?: string;
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

function outcomeOf(test: TestCase, result: TestResult): RecordedTest["outcome"] {
  const outcome = test.outcome();
  if (outcome === "unexpected") return "failed";
  if (outcome === "flaky") return "flaky";
  if (outcome === "skipped") return "skipped";
  return result.status === "passed" ? "passed" : "failed";
}

export default class AsciiReporter implements Reporter {
  private cli = new CLIOutput();
  private startTime = 0;
  private tests: RecordedTest[] = [];

  onBegin(_config: unknown, _suite: Suite): void {
    this.startTime = Date.now();
    this.tests = [];
    console.log("");
    console.log(this.cli.formatTestSuiteStart("Playwright E2E Suite"));
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    // Only record the final attempt — retries report intermediate results
    // that would double-count the test.
    if (result.retry > 0) return;

    const skipAnnotation = test.annotations.find(
      (a) => a.type === "skip" || a.type === "fixme",
    );

    this.tests.push({
      name: test.title,
      file: relFile(test.location.file),
      line: test.location.line,
      outcome: outcomeOf(test, result),
      durationMs: result.duration,
      error: result.error ? firstLine(result.error.message) : undefined,
      skipNote: skipAnnotation?.description,
    });
  }

  onEnd(result: FullResult): void {
    const durationS = (Date.now() - this.startTime) / 1000;

    const passed = this.tests.filter(
      (t) => t.outcome === "passed" || t.outcome === "flaky",
    ).length;
    const failed = this.tests.filter((t) => t.outcome === "failed").length;
    const skipped = this.tests.filter((t) => t.outcome === "skipped").length;
    const flaky = this.tests.filter((t) => t.outcome === "flaky").length;
    const errors = result.status === "interrupted" ? 1 : 0;

    const failures: TestFailure[] = this.tests
      .filter((t) => t.outcome === "failed")
      .map((t) => ({
        name: t.name,
        file: t.file,
        line: t.line,
        message: t.error,
      }));

    const slowest: SlowTest[] = [...this.tests]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 8)
      .map((t) => ({ name: t.name, duration_s: t.durationMs / 1000 }));

    const insights = buildTestInsights({
      failed,
      skipped,
      errors,
      slowest,
    });
    if (flaky) {
      insights.unshift(
        `${flaky} flaky test(s) — passed only after retry; investigate before trusting them.`,
      );
    }

    // Surface skip reasons so "skipped" is interpretable, not just a count.
    const skipReasons = new Map<string, number>();
    for (const t of this.tests) {
      if (t.outcome === "skipped" && t.skipNote) {
        skipReasons.set(t.skipNote, (skipReasons.get(t.skipNote) ?? 0) + 1);
      }
    }
    if (skipReasons.size) {
      const top = [...skipReasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([note, n]) => `${note} (${n})`)
        .join("; ");
      insights.push(`Skip reasons: ${top}`);
    }
    if (result.status === "interrupted") {
      insights.unshift("Run interrupted — results may be incomplete.");
    }

    // Repro commands use Playwright's file + -g title filters (no -x flag).
    const reproLines = failures.slice(0, 5).map((f) => {
      return `    pnpm test ${f.file} -g "${f.name}"`;
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
