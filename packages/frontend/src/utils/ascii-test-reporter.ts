/**
 * ASCII Art Vitest Reporter (Vitest 5 Reporter API)
 *
 * Prints the shared ASCII-art test summary with actionable insights at the
 * end of every `vitest run`, matching the Python backend's pytest output so
 * agents and users read both suites the same way.
 */

import type { Reporter, TestCase, TestModule } from 'vitest/node';

import {
  CLIOutput,
  buildTestInsights,
  type SlowTest,
  type TestFailure,
} from './cli-output-formatter';

interface RecordedTest {
  name: string;
  file: string;
  state: string;
  durationMs: number;
  error?: string;
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
    });
  }

  onTestRunEnd(
    testModules: readonly TestModule[],
    unhandledErrors: readonly unknown[],
    reason: string,
  ): void {
    const durationS = (Date.now() - this.startTime) / 1000;

    const passed = this.tests.filter((t) => t.state === 'passed').length;
    const failed = this.tests.filter((t) => t.state === 'failed').length;
    const skipped = this.tests.filter((t) => t.state === 'skipped').length;

    // Module-level failures (e.g. import/suite errors) that produced no
    // per-test results still need to show up as failures.
    const recordedFiles = new Set(this.tests.map((t) => t.file));
    const failures: TestFailure[] = this.tests
      .filter((t) => t.state === 'failed')
      .map((t) => ({ name: t.name, file: t.file, message: t.error }));
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

    const slowest: SlowTest[] = [...this.tests]
      .sort((a, b) => b.durationMs - a.durationMs)
      .slice(0, 8)
      .map((t) => ({ name: t.name, duration_s: t.durationMs / 1000 }));

    const insights = buildTestInsights({
      failed,
      skipped,
      errors: totalErrors,
      slowest,
    });
    if (reason !== 'passed' && reason !== 'failures') {
      insights.unshift(`Run ended early (${reason}) — results may be incomplete.`);
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
