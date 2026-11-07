/**
 * CLI Output Formatter - TypeScript port of cli_output.py.
 *
 * Produces ASCII-art test summaries with actionable insights for the Vitest
 * reporter so humans and AI agents can interpret results the same way they do
 * for the Python backend suite.
 */

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
}

export interface SlowTest {
  name: string;
  duration_s: number;
}

// ---------------------------------------------------------------------------
// ASCII art library
// ---------------------------------------------------------------------------

const ASCII_ART_LIBRARY: Record<string, string[]> = {
  success: [
    `
   _____ _____ _____ _____ _____
  |_   _|_   _|_   _|_   _|_   _|
    | |   | |   | |   | |   | |
    | |   | |   | |   | |   | |
    |_|   |_|   |_|   |_|   |_|
`,
    `
  _______________________
 /_  __/ ____/ ___/_  __/
 / / / __/  \\__ \\ / /
 / / / /___ ___/ // /
/_/ /_____//____//_/
`,
    `
+------------------------------------------+
|        ALL TESTS PASSED!                 |
+------------------------------------------+
`,
  ],
  failure: [
    `
+------------------------------------------+
|        SOME TESTS FAILED!                |
+------------------------------------------+
`,
    `
  _______________________
 /_  __/ ____/ ___/_  __/
 / / / __/  \\__ \\ / /
 / / / /___ ___/ // /
/_/ /_____//____//_/
`,
    `
!  !  !  !  !  !  !  !  !  !  !  !
!        SOME TESTS FAILED!         !
!  !  !  !  !  !  !  !  !  !  !  !
`,
  ],
  warning: [
    `
+------------------------------------------+
|     WARNING: TESTS SKIPPED / FLAKY       |
+------------------------------------------+
`,
    `
?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?
?      SOME TESTS WERE SKIPPED        ?
?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?  ?
`,
  ],
  running: [
    `
+------------------------------------------+
|             TESTS RUNNING...             |
+------------------------------------------+
`,
  ],
};

const VERDICT_LINES: Record<string, string[]> = {
  success: [
    'ALL TESTS PASSED — suite is green; safe to proceed.',
    '0 failures — nothing to fix; ship it.',
  ],
  failure: [
    'FAILURES PRESENT — fix the failing tests before merging.',
    'One or more tests failed; see FAILURES section for repro commands.',
  ],
  warning: [
    'PASSED WITH SKIPS — verify skipped tests are intentionally excluded.',
    'Suite passed but coverage is incomplete; skipped != verified.',
  ],
};

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
    return `${header}\n${this.hr('─')}\n${output}\n`;
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
    for (const [status, count] of counts) {
      lines.push(`  ${status} ${status.replace('[', '').replace(']', '')}: ${count}`);
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
        const msg = (f.message ?? '').split('\n')[0].slice(0, 80);
        return [f.name.split('>').pop()?.slice(0, 40) ?? '?', loc.slice(0, 40), msg];
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
    lines.push(
      `# RESULT: ${result} | suite=${suite} | total=${total} | passed=${passed} | failed=${failed} | errors=${errors} | skipped=${skipped} | duration_s=${duration_s.toFixed(1)}`,
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
