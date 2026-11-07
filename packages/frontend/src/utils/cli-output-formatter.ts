/**
 * CLI Output Formatter - TypeScript port of cli_output.py.
 *
 * Produces ASCII-art test summaries with actionable insights for the Vitest
 * reporter so humans and AI agents can interpret results the same way they do
 * for the Python backend suite.
 */

// Relative path (not @shared) so Playwright's reporter loader — which does
// not resolve tsconfig/vite aliases — can import this file too.
import outputData from '../../../../shared/cli-output-data.json' with { type: 'json' };

export enum Status {
  SUCCESS = '[OK]',
  ERROR = '[ERR]',
  WARNING = '[WARN]',
  INFO = '[INFO]',
  RUNNING = '[RUN]',
  PENDING = '[...]',
}

export interface CLIResult {
  status: Status;
  command: string;
  output: string;
  duration_ms: number;
  exit_code: number;
}

export interface TestFailure {
  name: string;
  file?: string;
  line?: number | null;
  message?: string;
  /** Stable error code (E_ASSERT/E_ERROR/E_TIMEOUT/E_ENV/E_SETUP) — see
   *  shared/cli-output-data.json error_codes for class + agent action. */
  code?: string;
}

export interface SlowTest {
  name: string;
  duration_s: number;
}

/** Runner-agnostic per-test record — adapters map their native result types
 *  into this so summarizeTestResults can aggregate identically everywhere. */
export type TestOutcome = 'passed' | 'failed' | 'skipped' | 'flaky';

export interface NormalizedTestResult {
  name: string;
  file?: string;
  line?: number;
  outcome: TestOutcome;
  durationMs: number;
  error?: string;
  skipNote?: string;
  code?: string;
}

export interface TestReportSummary {
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  failures: TestFailure[];
  slowest: SlowTest[];
  /** Top skip/skip-note reasons as [reason, count], max 3 entries. */
  skipReasons: [string, number][];
}

/** Aggregate normalized test records into counts, failure rows, slowest
 *  tests, and top skip reasons — shared by the Vitest and Playwright
 *  reporters so both emit identical report semantics. */
export function summarizeTestResults(
  tests: readonly NormalizedTestResult[],
): TestReportSummary {
  const count = (o: TestOutcome | TestOutcome[]) =>
    tests.filter((t) =>
      Array.isArray(o) ? o.includes(t.outcome) : t.outcome === o,
    ).length;

  const failures: TestFailure[] = tests
    .filter((t) => t.outcome === 'failed')
    .map((t) => ({
      name: t.name,
      file: t.file,
      line: t.line,
      message: t.error,
      code: t.code,
    }));

  const slowest: SlowTest[] = [...tests]
    .sort((a, b) => b.durationMs - a.durationMs)
    .slice(0, 8)
    .map((t) => ({ name: t.name, duration_s: t.durationMs / 1000 }));

  const reasonCounts = new Map<string, number>();
  for (const t of tests) {
    if (t.outcome === 'skipped' && t.skipNote) {
      reasonCounts.set(t.skipNote, (reasonCounts.get(t.skipNote) ?? 0) + 1);
    }
  }
  const skipReasons = [...reasonCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  return {
    // Flaky counts as passed: it did pass, just needed a retry.
    passed: count(['passed', 'flaky']),
    failed: count('failed'),
    skipped: count('skipped'),
    flaky: count('flaky'),
    failures,
    slowest,
    skipReasons,
  };
}

// Display data is single-sourced in shared/cli-output-data.json (loaded by
// cli_output.py too) so the Python and TypeScript reports never drift.
const ASCII_ART_LIBRARY: Record<string, string[]> = outputData.ascii_art;
const VERDICT_LINES: Record<string, string[]> = outputData.verdict_lines;
const CLASSIFY_RULES: { code: string; keywords: string[] }[] =
  outputData.classify_rules;

/** Assign a stable error code to a failure message — mirrors
 *  classify_failure() in cli_output.py; both read the same rules from
 *  shared/cli-output-data.json. Unmatched messages get E_ERROR. */
export function classifyFailure(message: string | undefined): string {
  const text = (message ?? '').toLowerCase();
  for (const rule of CLASSIFY_RULES) {
    if (rule.keywords.some((k) => text.includes(k))) return rule.code;
  }
  return 'E_ERROR';
}

function pick<T>(list: T[]): T {
  return list[Math.floor(Math.random() * list.length)];
}

export function getAsciiArt(category: string): string {
  return pick(ASCII_ART_LIBRARY[category] ?? ['']).trim();
}

function getVerdict(category: string): string {
  return pick(VERDICT_LINES[category] ?? ['Test run complete.']);
}

// ---------------------------------------------------------------------------
// Formatter
// ---------------------------------------------------------------------------

export class CLIOutput {
  private width: number;

  constructor(width = 80) {
    this.width = width;
  }

  private hr(char = '-'): string {
    return char.repeat(this.width);
  }

  private section(title: string, char = '='): string {
    return `\n${char.repeat(this.width)}\n${title}\n${char.repeat(this.width)}\n`;
  }

  formatResult(result: CLIResult): string {
    const icon = result.status;
    const duration =
      result.duration_ms < 1000
        ? `${result.duration_ms.toFixed(0)}ms`
        : `${(result.duration_ms / 1000).toFixed(2)}s`;
    const exitInfo = result.exit_code !== 0 ? ` (exit ${result.exit_code})` : '';
    const header = `${icon} ${result.command} ${duration}${exitInfo}`;
    let output = result.output.trim();
    if (output.length > 500) {
      output = output.slice(0, 500) + '\n... (truncated)';
    }
    return `${header}\n${this.hr('-')}\n${output}\n`;
  }

  formatTable(headers: string[], rows: string[][], title = ''): string {
    if (!rows.length) {
      return title ? `${this.section(title)}_No data_\n` : '_No data_\n';
    }
    const colWidths = headers.map((h, i) =>
      Math.max(h.length, ...rows.map((r) => String(r[i] ?? '').length)),
    );
    const formatRow = (cells: string[]): string =>
      `| ${cells
        .map((c, i) => String(c).slice(0, colWidths[i]).padEnd(colWidths[i]))
        .join(' | ')} |`;
    const sep = '+' + colWidths.map((w) => '-'.repeat(w + 2)).join('+') + '+';

    const lines: string[] = [];
    if (title) lines.push(this.section(title));
    lines.push(sep, formatRow(headers), sep);
    for (const row of rows) lines.push(formatRow(row.map(String)));
    lines.push(sep);
    return lines.join('\n');
  }

  formatJson(data: unknown, title = ''): string {
    const output = JSON.stringify(data, null, 2);
    return title
      ? `${this.section(title)}\n\`\`\`json\n${output}\n\`\`\`\n`
      : `\`\`\`json\n${output}\n\`\`\`\n`;
  }

  formatSummary(results: CLIResult[], title = 'Summary'): string {
    if (!results.length) return '';
    const passed = results.filter((r) => r.status === Status.SUCCESS).length;
    const failed = results.filter((r) => r.status === Status.ERROR).length;
    const totalTime = results.reduce((s, r) => s + r.duration_ms, 0);

    const lines = [this.section(title, '=')];
    lines.push(
      `Total: ${results.length} | [OK] ${passed} | [ERR] ${failed} | ${formatDuration(totalTime)}`,
    );
    lines.push('');
    const counts = new Map<Status, number>();
    for (const r of results) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
    const STATUS_NAMES: Record<string, string> = {
      '[OK]': 'OK',
      '[ERR]': 'ERR',
      '[WARN]': 'WARN',
      '[INFO]': 'INFO',
      '[RUN]': 'RUN',
      '[...]': 'PENDING',
    };
    for (const [status, count] of counts) {
      lines.push(`  ${status} ${STATUS_NAMES[status] ?? status}: ${count}`);
    }
    return lines.join('\n');
  }

  formatKvPairs(data: Record<string, unknown>, title = ''): string {
    return this.formatTable(
      ['Key', 'Value'],
      Object.entries(data).map(([k, v]) => [k, String(v)]),
      title,
    );
  }

  formatTestSuiteStart(suiteName: string, testCount = 0): string {
    const lines = [this.section(`TEST SUITE: ${suiteName}`, '='), ''];
    lines.push(getAsciiArt('running'), '');
    if (testCount) lines.push(`  Running ${testCount} tests...`);
    return lines.join('\n');
  }

  /**
   * Professional ASCII test report with actionable insights.
   * Mirrors CLIOutput.format_test_results in cli_output.py.
   */
  formatTestResults(opts: {
    passed: number;
    failed: number;
    skipped: number;
    duration_s: number;
    suite?: string;
    total?: number;
    errors?: number;
    failures?: TestFailure[];
    slowest?: SlowTest[];
    insights?: string[];
    meta?: Record<string, string>;
    rerunHint?: string;
    /**
     * Optional verbatim repro commands. When omitted, commands are generated
     * as `${rerunHint} ${failure.name} -x` (pytest style). Playwright passes
     * its own `pnpm test <file> -g "<title>"` lines here.
     */
    reproLines?: string[];
  }): string {
    const {
      passed,
      failed,
      skipped,
      duration_s,
      suite = 'tests',
      errors = 0,
      failures = [],
      slowest = [],
      insights = [],
      meta = {},
      rerunHint = 'vitest run',
      reproLines,
    } = opts;
    const total = opts.total ?? passed + failed + skipped + errors;
    const bad = failed + errors;
    const category = bad > 0 ? 'failure' : skipped > 0 ? 'warning' : 'success';

    const lines: string[] = [];
    lines.push(this.section(`${suite.toUpperCase()} RESULTS`, '='), '');
    lines.push(getAsciiArt(category), '');
    lines.push(`  VERDICT: ${getVerdict(category)}`, '');

    const pct = (n: number) => (total ? `${((100 * n) / total).toFixed(1)}%` : '0%');
    const rows: string[][] = [
      ['[OK]  Passed', String(passed), pct(passed)],
      ['[ERR] Failed', String(failed), pct(failed)],
    ];
    if (errors) rows.push(['[ERR] Errors', String(errors), pct(errors)]);
    if (skipped) rows.push(['[...] Skipped', String(skipped), pct(skipped)]);
    rows.push(['TOTAL', String(total), '100%']);
    lines.push(this.formatTable(['Status', 'Count', 'Share'], rows), '');

    const durBits = [`Duration: ${formatDuration(duration_s * 1000)}`];
    if (meta.commit) durBits.push(`commit ${meta.commit}`);
    if (meta.branch) durBits.push(`branch ${meta.branch}`);
    lines.push(`  ${durBits.join(' | ')}`, '');

    if (failures.length) {
      lines.push(this.section('FAILURES — reproduce individually', '-'));
      const failRows = failures.slice(0, 20).map((f) => {
        const loc = f.file
          ? `${f.file}${f.line ? `:${f.line}` : ''}`
          : f.name;
        const msg = `${f.code ? `[${f.code}] ` : ''}${(f.message ?? '')
          .split('\n')[0]
          .slice(0, 80)}`;
        return [
          f.name.split(/::|>/).pop()?.slice(0, 40) ?? '?',
          loc.slice(0, 40),
          msg,
        ];
      });
      lines.push(
        this.formatTable(['Test', 'Location', 'Error (first line)'], failRows),
        '',
        '  Reproduce one failure:',
      );
      if (reproLines?.length) {
        lines.push(...reproLines);
      } else {
        for (const f of failures.slice(0, 5)) {
          lines.push(`    ${rerunHint} ${f.file ?? ''} -t "${f.name}"`);
        }
        if (failures.length > 5) lines.push(`    ... and ${failures.length - 5} more`);
      }
      lines.push('');
    }

    if (slowest.length && Math.max(...slowest.map((s) => s.duration_s)) >= 0.05) {
      lines.push(this.section('SLOWEST TESTS', '-'));
      lines.push(
        this.formatTable(
          ['Test', 'Duration'],
          slowest.slice(0, 10).map((s) => [
            s.name.slice(0, 50),
            `${s.duration_s.toFixed(2)}s`,
          ]),
        ),
        '',
      );
    }

    if (insights.length) {
      lines.push(this.section('INSIGHTS & NEXT STEPS', '-'));
      for (const item of insights) lines.push(`  * ${item}`);
      lines.push('');
    }

    const result = bad > 0 ? 'FAIL' : skipped > 0 ? 'PASS_WITH_SKIPS' : 'PASS';
    const codeCounts: Record<string, number> = {};
    for (const f of failures) {
      if (f.code) codeCounts[f.code] = (codeCounts[f.code] ?? 0) + 1;
    }
    lines.push(
      `# RESULT: ${result} | suite=${suite} | total=${total} | passed=${passed} | failed=${failed} | errors=${errors} | skipped=${skipped} | duration_s=${duration_s.toFixed(1)}`,
    );
    lines.push(
      `# RESULT_JSON: ${JSON.stringify({
        verdict: result,
        suite,
        total,
        passed,
        failed,
        errors,
        skipped,
        duration_s: Number(duration_s.toFixed(1)),
        codes: Object.keys(codeCounts).length ? codeCounts : null,
      })}`,
    );

    return lines.join('\n');
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000);
    const seconds = Math.round((ms % 60000) / 1000);
    return `${minutes}m ${seconds}s`;
  }
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

export function formatProgress(
  current: number,
  total: number,
  prefix = '',
  width = 40,
): string {
  if (total === 0) return '';
  const pct = current / total;
  const filled = Math.floor(width * pct);
  const bar = '#'.repeat(filled) + '-'.repeat(width - filled);
  return `${prefix} [${bar}] ${(pct * 100).toFixed(1)}% (${current}/${total})`;
}

export function buildTestInsights(opts: {
  failed: number;
  skipped: number;
  errors?: number;
  slowest?: SlowTest[];
}): string[] {
  const { failed, skipped, errors = 0, slowest = [] } = opts;
  const insights: string[] = [];
  const bad = failed + errors;
  if (bad) {
    insights.push(
      `${bad} test(s) failed — treat the run as RED. Fix failures before merging; each failure above has a ready-made reproduce command.`,
    );
    insights.push(
      'If a failure looks environmental (missing service, GPU, network), confirm with a single-test rerun before assuming a code regression.',
    );
  }
  if (skipped) {
    insights.push(
      `${skipped} test(s) skipped — skipped tests provide NO coverage. If the skip is intentional (marker, missing optional dep), document why; otherwise investigate.`,
    );
  }
  if (slowest.length && slowest[0].duration_s >= 1.0) {
    const top = slowest[0];
    insights.push(
      `Slowest test: ${top.name} at ${top.duration_s.toFixed(2)}s — if the suite feels slow, optimize fixtures/mocks here first.`,
    );
  }
  if (!insights.length && !bad && !skipped) {
    insights.push('All green — no action needed. Safe to commit or proceed to the next task.');
  }
  return insights;
}
