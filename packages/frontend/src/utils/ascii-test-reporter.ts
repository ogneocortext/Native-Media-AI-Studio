/**
 * ASCII Art Vitest Reporter
 * Provides beautiful ASCII art test output for Vitest (Vite)
 * Works alongside the Python CLI output formatter for consistent test reporting
 */

import { Reporter } from 'vitest/reporter';
import { CliOutputFormatter, formatDuration } from './cli-output-formatter';

export class AsciiArtVitestReporter implements Reporter {
  private cli: CliOutputFormatter;
  private startTime: number;
  private testResults: Array<{
    name: string;
    status: 'passed' | 'failed' | 'skipped';
    durationMs: number;
  }> = [];

  constructor(options: any) {
    super(options);
    this.cli = new CliOutputFormatter();
    this.startTime = Date.now();
  }

  onStart(config: any): void {
    this.cli.printTestSuiteStart('Test Suite', config.testCount);
    console.log('\n');
  }

  onTestFileStart(file: any): void {
    console.log(`\n📁 Testing: ${file.name}`);
  }

  onTestFileFinish(file: any, result: any): void {
    const testResult = result.results?.find((t: any) => t.state === 'failed') ||
      result.results?.[0] ||
      { status: result.status, duration: result.duration || 0 };

    this.testResults.push({
      name: file.name,
      status: testResult.status || result.status || 'passed',
      durationMs: testResult.duration || result.duration || 0
    });
  }

  onTestStart(test: any): void {
    // Could log individual test start if verbose mode
  }

  async onTestResult(test: any, result: any): Promise<void> {
    this.testResults.push({
      name: test.name,
      status: result.status || 'passed',
      durationMs: result.duration || 0
    });

    if (result.status === 'failed') {
      const firstError = result.errors?.[0] || {};
      const errorMessage = firstError.message || 'Unknown error';
      const errorStack = firstError.stack || '';
      
      this.cli.printTestFailure(test.name, errorMessage, errorStack);
    }
  }

  onTestFileFinish(file: any, result: any): void {
    // Already handled in onTestResult for individual tests
  }

  async onTestRunEnd(result: any): Promise<void> {
    const totalDurationMs = Date.now() - this.startTime;
    const passed = result.passedCount || this.testResults.filter(r => r.status === 'passed').length;
    const failed = result.failedCount || this.testResults.filter(r => r.status === 'failed').length;
    const skipped = result.skippedCount || this.testResults.filter(r => r.status === 'skipped').length;

    this.cli.printTestSummary(passed, failed, skipped, totalDurationMs);
    this.cli.printPerformanceSummary({
      totalDurationMs,
      averageDurationMs: totalDurationMs / Math.max(1, this.testResults.length),
      maxDurationMs: Math.max(...this.testResults.map(r => r.durationMs), 0),
      p95DurationMs: this.testResults
        .sort((a, b) => b.durationMs - a.durationMs)
        .slice(0, Math.ceil(this.testResults.length * 0.05))
        .map(r => r.durationMs)[0] || 0
    });

    // Summary of failed tests
    if (failed > 0) {
      this.cli.printTestFailures(this.testResults.filter(r => r.status === 'failed'));
    }
  }
}

function msToTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return s % 60 === 0 ? `${m}m` : `${m}m ${s % 60}s`;
}