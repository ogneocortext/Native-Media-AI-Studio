/**
 * ASCII Art Vitest Reporter (Vitest 5 Reporter API)
 *
 * Prints the shared ASCII-art test summary with actionable insights at the
 * end of every `vitest run`, matching the Python backend's pytest output so
 * agents and users read both suites the same way.
 */

import type {
  Reporter,
  TestCase,
  TestModule,
  TestRunEndReason,
} from 'vitest/node';

import {
  CLIOutput,
  buildTestInsights,
  summarizeTestResults,
  type NormalizedTestResult,
  type TestOutcome,
} from './cli-output-formatter.ts';

interface RecordedTest {
  name: string;
  file: string;
  state: string;
  durationMs: number;
  error?: string;
  skipNote?: string;
}

function firstErrorLine(errors: readonly unknown[] | undefined): string {
  const first = errors?.[0] as { message?: string } | undefined;
  const message = first?.message ?? '';
  const line = message.split('\n').find((l) => l.trim().length > 0) ?? '';
  return line.trim().slice(0, 120);
}

export class AsciiArtVitestReporter implements Reporter {
  private cli = new CLIOutput();
  private startTime = 0;
  private tests: RecordedTest[] = [];

  onTestRunStart(): void {
    this.startTime = Date.now();
    this.tests = [];
    console.log('');
    console.log(this.cli.formatTestSuiteStart('Vitest Unit Suite'));
  }

  onTestCaseResult(testCase: TestCase): void {
    const result = testCase.result();
    if (result.state === 'pending') return;

    const diagnostic = testCase.diagnostic();
    this.tests.push({
      name: testCase.fullName,
      file: testCase.module.moduleId,
      state: result.state,
      durationMs: diagnostic?.duration ?? 0,
      error:
        result.state === 'failed' ? firstErrorLine(result.errors) : undefined,
      skipNote: result.state === 'skipped' ? result.note : undefined,
    });
  }

  onTestRunEnd(
    testModules: readonly TestModule[],
    unhandledErrors: readonly unknown[],
    reason: TestRunEndReason,
  ): void {
    const durationS = (Date.now() - this.startTime) / 1000;

    const normalized: NormalizedTestResult[] = this.tests.map((t) => ({
      name: t.name,
      file: t.file,
      outcome: t.state as TestOutcome,
      durationMs: t.durationMs,
      error: t.error,
      skipNote: t.skipNote,
    }));
    const summary = summarizeTestResults(normalized);
    const { passed, failed, skipped, failures, slowest, skipReasons } =
      summary;

    // Module-level failures (e.g. import/suite errors) that produced no
    // per-test results still need to show up as failures.
    const recordedFiles = new Set(this.tests.map((t) => t.file));
    let suiteLevelFailures = 0;
    for (const mod of testModules) {
      if (mod.state() === 'failed' && !recordedFiles.has(mod.moduleId)) {
        suiteLevelFailures += 1;
        failures.push({
          name: mod.moduleId,
          file: mod.moduleId,
          message: 'module failed (suite-level error)',
        });
      }
    }
    for (const err of unhandledErrors) {
      const raw = (err as { message?: unknown }).message;
      const message = typeof raw === 'string' ? raw : String(err);
      failures.push({ name: 'unhandled error', message: message.slice(0, 120) });
    }
    const totalErrors = unhandledErrors.length + suiteLevelFailures;

    let insights = buildTestInsights({
      failed,
      skipped,
      errors: totalErrors,
      slowest,
    });
    const totalTests = passed + failed + skipped;
    if (reason === 'interrupted') {
      insights = insights.filter((i) => !i.startsWith('All green'));
      insights.unshift(
        'Run interrupted — results may be incomplete; rerun to confirm.',
      );
    } else if (totalTests === 0 && totalErrors === 0) {
      insights = [
        'No tests ran — check file patterns/filters before trusting this result.',
      ];
    }

    // Surface skip reasons so "N skipped" is interpretable, not just a count.
    if (skipReasons.length) {
      const top = skipReasons
        .map(([note, n]) => `${note} (${n})`)
        .join('; ');
      insights.push(`Skip reasons: ${top}`);
    }

    console.log('');
    console.log(
      this.cli.formatTestResults({
        passed,
        failed,
        skipped,
        errors: totalErrors,
        duration_s: durationS,
        suite: 'vitest',
        failures,
        slowest,
        insights,
        rerunHint: 'pnpm vitest run',
      }),
    );
  }
}
