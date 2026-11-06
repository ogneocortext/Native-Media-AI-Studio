/**
 * CLI Output Formatter - Cross-platform terminal output presentation
 * Matches the Python cli_output.py module for consistent output across backend/frontend
 */

export enum Status {
  SUCCESS = '[OK]',
  ERROR = '[ERR]',
  WARNING = '[WARN]',
  INFO = '[INFO]',
  RUNNING = '[RUN]',
  PENDING = '[...]'
}

export interface CLIResult {
  status: Status;
  command: string;
  output: string;
  duration_ms: number;
  exit_code: number;
  test_details?: Array<{
    name: string;
    status: string;
    duration_ms: number;
  }>;
}

export class CLIOutput {
  private width: number = 80;

  constructor(width: number = 80) {
    this.width = width;
  }

  private _hr(char: string = '-'): string {
    return char.repeat(this.width);
  }

  private _section(title: string, char: string = '='): string {
    return `\n${char.repeat(this.width)}\n${title}\n${char.repeat(this.width)}\n`;
  }

  private _statusIcon(status: Status): string {
    return status.value;
  }

  formatResult(result: CLIResult): string {
    const icon = this._statusIcon(result.status);
    const duration = result.duration_ms < 1000 
      ? `${result.duration_ms}ms` 
      : `${(result.duration_ms / 1000).toFixed(2)}s`;
    const exitInfo = result.exit_code !== 0 ? ` (exit ${result.exit_code})` : '';

    const header = `${icon} ${result.command} ${duration}${exit_info}`;

    // Truncate long output
    let output = result.output.trim();
    if (output.length > 500) {
      output = output.substring(0, 500) + '\n... (truncated)';
    }

    return `${header}\n${this._hr('─')}\n${output}\n`;
  }

  formatTable(headers: string[], rows: string[][], title: string = ''): string {
    if (!rows.length) {
      return `${this._section(title)}_No data_\n`;
    }

    // Calculate column widths
    const colWidths = headers.map((h, i) => {
      return Math.max(h.length, ...rows.map(r => String(r[i] || '').length));
    });

    const formatRow = (cells: string[]): string => {
      return `| ${cells.map((c, i) => String(c).padEnd(colWidths[i])).join(' | ')} |`;
    };

    const separator = '+' + colWidths.map(w => '-'.repeat(w + 2)).join('-+-') + '+';

    const lines: string[] = [];
    if (title) {
      lines.push(this._section(title, '='));
    }
    lines.push(sep);
    lines.push(formatRow(headers));
    lines.append(sep);
    for (const row of rows) {
      lines.push(formatRow(row.map(c => String(c))));
    }
    lines.append(sep);
    
    return lines.join('\n');
  }

  formatJson(data: any, title: string = ''): string {
    const output = JSON.stringify(data, null, 2);
    if (title) {
      return `${this._section(title)}\n\`\`\`json\n${output}\n\`\`\`\n`;
    }
    return `\`\`\`json\n${output}\n\`\`\`\n`;
  }

  formatSummary(results: CLIResult[], title: string = 'Summary'): string {
    if (!results.length) return '';

    const passed = results.filter(r => r.status === Status.SUCCESS).length;
    const failed = sum(1 for r in results if r.status === Status.ERROR);
    const total = results.length;
    const totalTime = results.reduce((sum, r) => sum + r.duration_ms, 0);

    const lines: string[] = [];
    lines.push(this._section(title, '='));
    lines.push(`Total: ${total} | [OK] ${passed} | [ERR] ${failed} | ${totalDurationMs.toFixed(0)}ms`);
    lines.append('');
    
    // Status counts
    const statusCounts: { [key: string]: number } = {};
    for (const r of results) {
      statusCounts[r.status] = (statusCounts[r.status] || 0) + 1;
    }
    
    for (const [status, count] of Object.entries(statusCounts)) {
      lines.append(`  ${status.value} ${status.name}: ${count}`);
    }
    
    return lines.join('\n');
  }

  formatTestResultsWithArt(
    passed: number,
    failed: number,
    skipped: number,
    duration_ms: number,
    test_details: any[] = [],
    coverage: any = null,
    performance: any = null
  ): string {
    const total = passed + failed + skipped;
    const duration = formatDuration(duration_ms);

    // Determine category and get ASCII art
    let category = '';
    let category_msg = '';
    if (failed > 0) {
      category = 'failure';
      category_msg = 'some_failed';
    } else if (skipped > 0 && failed === 0) {
      category = 'warning';
      category_msg = 'some_skipped';
    } else {
      category = 'success';
      category_msg = duration_ms < 5000 ? 'all_passed_fast' : 'all_passed';
    }

    const asciiArt = this.getAsciiArt(category);
    const message = this.getRandomMessage(category_msg);

    const lines: string[] = [];
    lines.push(this._section('TEST RESULTS', '='));
    lines.push(asciiArt);
    lines.push('');
    lines.append(`  ${message}`);
    lines.append('');

    // Summary table
    lines.append(cli.formatTable(['Status', 'Count', '%'], [
      ['[OK] Passed', str(passed), `${passed/total*100:.1f}%` if total > 0 else '0%'],
      ['[ERR] Failed', str(failed), `${failed/total*100:.1f}%` if total > 0 else '0%'],
      ['[...] Skipped', str(skipped), `${skipped/total*100:.1f}%` if total > 0 else '0%'],
      ['Total', str(total), '100%'],
    ], 'Summary'));

    // Duration
    lines.push(`Duration: ${duration_str}`);
    lines.append('');

    // Test details if provided
    if (test_details && test_details.length > 0) {
      lines.append(this._section('Test Details', '-'));
      const detail_rows = [];
      for (const test of test_details) {
        const status_icon = {'passed': '[OK]', 'failed': '[ERR]', 'skipped': '[...]'}[test.status] || '[?]';
        const name = test.name || 'Unknown';
        const duration_str = formatDuration(test.duration_ms || 0);
        detail_rows.append([status_icon, name, duration_str]);
      }
      if (detail_rows.length > 0) {
        lines.append(this.format_table(['Status', 'Test', 'Duration'], detail_rows));
        lines.append('');
      }
    }

    // Coverage info
    if (coverage) {
      lines.append(this._section('Coverage', '-'));
      const coverage_rows = [
        ['Lines', `${coverage.lines}%`],
        ['Branches', f"{coverage.get('branches', 0)}%"],
        ['Functions', f"{coverage.get('functions', 0)}%"],
        ['Statements', f"{coverage.get('statements', 0)}%"],
      ];
      lines.append(this.format_table(['Metric', 'Coverage'], coverage_rows));
      lines.append('');
    }

    // Performance info
    if (performance) {
      lines.append(this._section('Performance', '-'));
      const perf_rows = [
        ['Avg Duration', format_duration(performance.get('avg_ms', 0))],
        ['Max Duration', format_duration(performance.get('max_ms', 0))],
        ['P95', format_duration(performance.get('p95_ms', 0))],
        ['Peak Memory', `${performance.get('peak_memory_mb', 0)}MB`],
      ];
      lines.append(this.format_table(['Metric', 'Value'], perf_rows));
      lines.append('');
    }

    // Contextual message
    const categoryMap = {
      'failure': 'some_failed',
      'warning': 'some_skipped',
      'success': 'all_passed_fast' if duration_ms < 5000 else 'all_passed'
    };
    const message = this.getRandomMessage(category_map.get(category, 'all_passed'));
    lines.append(`💬 ${message}`);
    
    return lines.join('\n');
  }

  formatTestSuiteStart(suiteName: string, testCount: number): string {
    const asciiArt = this.getAsciiArt('running');
    const lines: string[] = [];
    lines.push(this._section(`TEST SUITE: ${suiteName}`, '='));
    lines.push(ascii_art);
    lines.push(`Running ${testCount} tests...`);
    lines.append('');
    return lines.join('\n');
  }

  formatTestSuiteProgress(current: number, total: number, currentTest: string = ''): string {
    return this.formatProgress(current, total, 'Running tests', 30);
  }

  // Helper methods
  getAsciiArt(category: string): string {
    const artLibrary = {
      success: [
        `  _______________________
 /_  __/ ____/ ___/_  __/
 / / / __/  \__ \\ / /   
 / / / /___ ___/ // /    
/_/ /_____//____//_/     
                          `,
        `  __  __     ______     ______     ______  
 /\\ \\_\\ \\   /\\  ___\\   /\\  == \\   /\\__  _\\  
 \\ \\  __ \\  \\ \\  __\\   \\ \\  __<   \\/_/\\ \\/  
  \\ \\_\\ \\_\\  \\ \\_____\\  \\ \\_\\ \\_\\  \\ \\_\\  
   \\/_/\\/_/   \\/_____/   \\/_/ /_/   \\/_/  
                                        `,
        `   _____ _____ _____ _____ _____ 
  |_   _|_   _|_   _|_   _|_   _|  
    | |   | |   | |   | |   | |   |  
    | |   | |   | |   | |   | |   |  
    |_|   |_|   |_|   |_|   |_|  
                                 `,
        `
  ████████████████████████████████
  █  ALL TESTS PASSED!          █
  ████████████████████████████████
        `
      ],
    failure: [
        `
  ████████████████████████████████
  █  SOME TESTS FAILED!         █
  ████████████████████████████████
        `,
        `
  _______________________
 /_  __/ ____/ ___/_  __/
  / / / __/  \\__ \\ / /   
 / / / /___ ___/ // /    
/_/ /_____//____//_/     
        `,
        `
  ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠
  ⚠  SOME TESTS FAILED! ⚠
  ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠ ⚠
        `
    ],
    running: [
        `
  ████████████████████████████████
  █  TESTS RUNNING...           █
  ████████████████████████████████
        `,
        `
  ⠋ Running tests...
  ⠙ Running tests...
  ⠹ Running tests...
  ⠸ Running tests...
  ⠼ Running tests...
  ⠴ Running tests...
  ⠦ Running tests...
  ⠧ Running tests...
  ⠇ Running tests...
  ⠏ Running tests...
        `,
    ],
    coverage: [
        `
  ████████████████████████████████
  █  COVERAGE REPORT             █
  ████████████████████████████████
        `,
        `
  ████████████████████████████████
  █  Lines: 85%  Branches: 72%  █
  █  Functions: 88%  Statements: 85%  █
  ████████████████████████████████
        `,
    ],
    performance: [
        """
  ████████████████████████████████
  █  PERFORMANCE REPORT          █
  ████████████████████████████████
        """,
        """
  ⚡ Fast: 42ms avg  |  🐢 Slow: 1.2s max
  📊 95th percentile: 245ms
  💾 Memory: 45MB peak
        """
    ]
  };

  TEST_MESSAGES = {
    'all_passed': [
        'All tests passed! The force is strong with this code. ⭐',
        'Perfect! Every test shines like a star. ✨',
        'Clean sweep! Your tests are sparkling clean. 🌟',
        'Zero failures! Your code is bulletproof. 🛡️',
    ],
    'some_failed': [
        'Some tests stumbled. Time to investigate! 🔍',
        'A few tests tripped. Let\'s help them up! 🤝',
        'Failures detected. Your debugger is calling. 🐛',
        'Not all heroes wear caps - some fix tests. 🦸'
    ],
    'some_skipped': [
        'Some tests took a coffee break. ☕',
        'A few tests decided to skip leg day. 🏃',
        'Skipped tests are just taking a breather. 😴'
    ],
    'slow_tests': [
        'Some tests are taking the scenic route. 🐢',
        'Slow tests detected. Time to optimize! ⚡',
        'These tests need a coffee boost. ☕'
    ],
    'coverage_low': [
        'Coverage could use a boost! 📈',
        'Time to write more tests! 📝',
        'Uncovered code is lonely code. 🤝'
    ],
    'all_passed_fast': [
        'Blazing fast! All tests at warp speed. 🚀',
        'Lightning fast! Your tests are on fire. ⚡',
        'Speed demon! Tests completed in record time. 🏎️'
    ]
  };

  getRandomMessage(category: string): string {
    const messages = TEST_MESSAGES[category] || ['Test completed.'];
    return messages[Math.floor(Math.random() * messages.length)];
  }

  getAsciiArt(category: string): string {
    const artList = ASCII_ART_LIBRARY[category] || [''];
    return artList[Math.floor(Math.random() * artList.length)];
  }

  formatTestSuiteStart(suiteName: string, testCount: number): string {
    const asciiArt = getAsciiArt('running');
    const lines: string[] = [];
    lines.push(this._section(`TEST SUITE: ${suiteName}`, '='));
    lines.push(asciiArt);
    lines.push(`Running ${testCount} tests...`);
    lines.push('');
    return lines.join('\n');
  }

  formatTestSuiteProgress(current: number, total: number, currentTest: string = ''): string {
    return formatProgress(current, total, 'Running tests', 30);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  else if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  else if (ms < 3600000) {
    const minutes = Math.floor(ms / 60000);
    const seconds = (ms % 60000) / 1000;
    return `${minutes}m ${seconds.toFixed(0)}s`;
  } else {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    return `${hours}h ${minutes}m`;
  }
}

function formatProgress(current: number, total: number, prefix: string = '', width: number = 40): string {
  if (total === 0) return '';
  const pct = current / total;
  const filled = Math.floor(width * pct);
  const bar = '█'.repeat(filled) + '░'.repeat(width - filled);
  const pctStr = `${(pct * 100).toFixed(1)}%`;
  return `${prefix} [${bar}] ${pct_str} (${current}/${total})`;
}