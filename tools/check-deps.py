#!/usr/bin/env python3
"""
Dependency Checker for Native Media AI Studio

Checks pnpm catalog versions, outdated packages, peer dependency conflicts,
security vulnerabilities, and provides upgrade recommendations with breaking change detection.

Usage:
    python tools/check-deps.py              # Full check
    python tools/check-deps.py --json       # JSON output
    python tools/check-deps.py --table      # Table format output
    python tools/check-deps.py --fix        # Auto-upgrade catalog (with confirmation)
    python tools/check-deps.py --ci         # CI mode (exit code 1 if updates available)
    python tools/check-deps.py --audit      # Include security audit
"""

import json
import os
import re
import shutil
import subprocess
import sys
from dataclasses import asdict, dataclass
from datetime import datetime
from pathlib import Path

try:
    import packaging.specifiers
    import packaging.version
    HAS_PACKAGING = True
except ImportError:
    HAS_PACKAGING = False


# Color codes for terminal output
class Colors:
    RED = '\033[91m'
    GREEN = '\033[92m'
    YELLOW = '\033[93m'
    BLUE = '\033[94m'
    MAGENTA = '\033[95m'
    CYAN = '\033[96m'
    WHITE = '\033[97m'
    RESET = '\033[0m'
    BOLD = '\033[1m'
    DIM = '\033[2m'

    @classmethod
    def disable(cls):
        cls.RED = cls.GREEN = cls.YELLOW = cls.BLUE = cls.MAGENTA = cls.CYAN = cls.WHITE = cls.RESET = cls.BOLD = cls.DIM = ''


# Disable colors if not a TTY or on Windows without ANSI support
if not sys.stdout.isatty() or os.environ.get('TERM') == 'dumb':
    Colors.disable()


@dataclass
class PackageInfo:
    name: str
    current: str
    latest: str
    wanted: str
    location: str
    is_catalog: bool = False
    peer_conflict: bool = False
    breaking: bool = False
    deprecated: bool = False
    security: bool = False
    changelog_url: str = ""
    major_bump: bool = False


@dataclass
class CheckResult:
    timestamp: str
    total_packages: int
    outdated: int
    catalog_outdated: int
    peer_conflicts: int
    breaking_changes: int
    deprecated_count: int
    security_issues: int
    packages: list[PackageInfo]


class DependencyChecker:
    def __init__(self, workspace_root: Path, use_colors: bool = True):
        self.workspace_root = workspace_root
        self.catalog_file = workspace_root / "pnpm-workspace.yaml"
        self.catalog: dict[str, str] = {}
        self.pnpm_cmd = self._find_pnpm()
        self.use_colors = use_colors and sys.stdout.isatty()
        if not self.use_colors:
            Colors.disable()
        self.load_catalog()

    def _find_pnpm(self) -> str:
        """Find pnpm executable path"""
        candidates = [
            "pnpm",
            "pnpm.cmd",
            shutil.which("pnpm"),
            shutil.which("pnpm.cmd"),
            Path.home() / "AppData" / "Roaming" / "npm" / "pnpm.cmd",
            Path.home() / "AppData" / "Roaming" / "npm" / "pnpm",
            Path(os.environ.get("APPDATA", "")) / "npm" / "pnpm.cmd",
            Path(os.environ.get("APPDATA", "")) / "npm" / "pnpm",
            Path(os.environ.get("LOCALAPPDATA", "")) / "pnpm" / "pnpm.cmd",
        ]
        for c in candidates:
            if c and Path(c).exists():
                return str(c)
        return "pnpm"  # Fallback

    def load_catalog(self):
        """Load catalog versions from pnpm-workspace.yaml"""
        import yaml
        try:
            with open(self.catalog_file) as f:
                data = yaml.safe_load(f)
                self.catalog = data.get("catalog", {})
        except Exception as e:
            print(f"{Colors.YELLOW}Warning: Could not load catalog: {e}{Colors.RESET}", file=sys.stderr)

    def run_pnpm(self, args: list[str]) -> tuple[str, str, int]:
        """Run pnpm command and return stdout, stderr, exit_code"""
        try:
            result = subprocess.run(
                [self.pnpm_cmd] + args,
                cwd=self.workspace_root,
                capture_output=True,
                text=True,
                encoding="utf-8",
                errors="replace",
                timeout=180,
                shell=True  # Needed for .cmd on Windows
            )
            return result.stdout, result.stderr, result.returncode
        except subprocess.TimeoutExpired:
            return "", "pnpm command timed out", 1
        except Exception as e:
            return "", str(e), 1

    def _print(self, msg: str, level: str = "info"):
        """Print with color coding"""
        prefix = {
            "info": f"{Colors.CYAN}[*]{Colors.RESET}",
            "success": f"{Colors.GREEN}[OK]{Colors.RESET}",
            "warn": f"{Colors.YELLOW}[!]{Colors.RESET}",
            "error": f"{Colors.RED}[ERR]{Colors.RESET}",
            "debug": f"{Colors.DIM}[DBG]{Colors.RESET}",
        }.get(level, f"{Colors.WHITE}[?]{Colors.RESET}")
        print(f"{prefix} {msg}")

    def get_outdated(self) -> list[dict]:
        """Get outdated packages using pnpm outdated --json"""
        stdout, stderr, code = self.run_pnpm(["outdated", "--json", "--long"])
        if code not in (0, 1):  # pnpm returns 1 when updates available
            self._print(f"pnpm outdated failed: {stderr}", "error")
            return []
        try:
            data = json.loads(stdout) if stdout.strip() else {}
            result = []
            for name, info in data.items():
                info["name"] = name
                result.append(info)
            return result
        except json.JSONDecodeError as e:
            self._print(f"Failed to parse pnpm outdated output: {e}", "error")
            return []

    def get_catalog_outdated(self) -> list[dict]:
        """Check catalog packages for updates"""
        outdated = []
        if not HAS_PACKAGING:
            self._print("packaging module not available, skipping catalog version check", "warn")
            return outdated

        for name, spec in self.catalog.items():
            stdout, stderr, code = self.run_pnpm(["view", name, "version", "--json"])
            if code != 0 or not stdout.strip():
                continue
            try:
                # pnpm view can return either a string directly or an object with version key
                data = json.loads(stdout)
                if isinstance(data, str):
                    latest = data.strip('"')
                elif isinstance(data, dict):
                    latest = data.get("version", "").strip('"')
                else:
                    latest = str(data).strip('"')

                if not latest:
                    continue

                try:
                    spec_obj = packaging.specifiers.SpecifierSet(spec)
                    if spec_obj.contains(latest):
                        base_version = re.sub(r'^[\^~>=<]+', '', spec)
                        if packaging.version.parse(latest) > packaging.version.parse(base_version):
                            outdated.append({
                                "name": name,
                                "current": spec,
                                "latest": latest,
                                "spec": spec,
                                "type": "minor_patch"
                            })
                    else:
                        outdated.append({
                            "name": name,
                            "current": spec,
                            "latest": latest,
                            "spec": spec,
                            "type": "major_bump",
                            "major_bump": True
                        })
                except packaging.specifiers.InvalidSpecifier:
                    base_version = re.sub(r'^[\^~>=<]+', '', spec)
                    if latest != base_version:
                        outdated.append({
                            "name": name,
                            "current": spec,
                            "latest": latest,
                            "spec": spec,
                            "type": "unknown",
                            "major_bump": self._is_major_bump(base_version, latest)
                        })
            except Exception as e:
                self._print(f"Error checking {name}: {e}", "debug")
        return outdated

    def _is_major_bump(self, current: str, latest: str) -> bool:
        """Check if version bump is major"""
        try:
            if HAS_PACKAGING:
                return packaging.version.parse(latest).major > packaging.version.parse(current).major
            return int(latest.split('.')[0]) > int(current.split('.')[0])
        except:
            return False

    def check_peer_deps(self) -> list[dict]:
        """Check for peer dependency conflicts using pnpm install dry-run"""
        stdout, stderr, code = self.run_pnpm(["install", "--dry-run", "--reporter=json"])
        conflicts = []

        # Check both stdout and stderr for peer dependency issues
        for stream in [stdout, stderr]:
            for line in stream.split('\n'):
                line_lower = line.lower()
                if 'peer' in line_lower and any(kw in line_lower for kw in ['unmet', 'conflict', 'missing', 'invalid']):
                    conflicts.append({"message": line.strip()})

        return conflicts

    def check_security_audit(self) -> tuple[int, list[dict]]:
        """Run pnpm audit for security vulnerabilities"""
        stdout, stderr, code = self.run_pnpm(["audit", "--json"])
        issues = []
        if code == 0 and stdout.strip():
            try:
                data = json.loads(stdout)
                # pnpm audit returns { advisories: [...], metadata: {...} }
                advisories = data.get("advisories", [])
                for adv in advisories:
                    issues.append({
                        "title": adv.get("title", "Unknown"),
                        "severity": adv.get("severity", "unknown"),
                        "package": adv.get("module_name", adv.get("package", "unknown")),
                        "version": adv.get("findings", [{}])[0].get("version", "unknown") if adv.get("findings") else "unknown",
                        "url": adv.get("url", ""),
                        "cwe": adv.get("cwe", [])
                    })
            except json.JSONDecodeError:
                pass
        return len(issues), issues

    def check_deprecated(self, packages: list[PackageInfo]) -> list[PackageInfo]:
        """Check for deprecated packages"""
        for pkg in packages:
            stdout, stderr, code = self.run_pnpm(["view", pkg.name, "deprecated", "--json"])
            if code == 0 and stdout.strip():
                try:
                    deprecated = json.loads(stdout)
                    if deprecated:
                        pkg.deprecated = True
                except:
                    pass
        return packages

    def check_breaking_changes(self, packages: list[PackageInfo]) -> list[PackageInfo]:
        """Check for potential breaking changes (major version bump)"""
        for pkg in packages:
            try:
                current_clean = re.sub(r'^[\^~>=<]+', '', pkg.current)
                current_major = int(current_clean.split('.')[0]) if current_clean.split('.')[0].isdigit() else 0
                latest_major = int(pkg.latest.split('.')[0]) if pkg.latest.split('.')[0].isdigit() else 0
                if latest_major > current_major:
                    pkg.breaking = True
                    pkg.major_bump = True
                    pkg.changelog_url = self._guess_changelog(pkg.name)
            except:
                pass
        return packages

    def _guess_changelog(self, name: str) -> str:
        """Guess changelog URL for a package"""
        common = {
            "vite": "https://github.com/vitejs/vite/blob/main/packages/vite/CHANGELOG.md",
            "react": "https://github.com/facebook/react/blob/main/CHANGELOG.md",
            "react-dom": "https://github.com/facebook/react/blob/main/CHANGELOG.md",
            "typescript": "https://github.com/microsoft/TypeScript/blob/main/CHANGELOG.md",
            "tailwindcss": "https://github.com/tailwindlabs/tailwindcss/blob/master/CHANGELOG.md",
            "@tailwindcss/vite": "https://github.com/tailwindlabs/tailwindcss/blob/master/CHANGELOG.md",
            "eslint": "https://github.com/eslint/eslint/blob/main/CHANGELOG.md",
            "@playwright/test": "https://github.com/microsoft/playwright/blob/main/packages/playwright-test/CHANGELOG.md",
            "playwright": "https://github.com/microsoft/playwright/blob/main/CHANGELOG.md",
            "vitest": "https://github.com/vitest-dev/vitest/blob/main/packages/vitest/CHANGELOG.md",
            "remotion": "https://github.com/remotion-dev/remotion/blob/main/CHANGELOG.md",
            "zod": "https://github.com/colinhacks/zod/blob/main/CHANGELOG.md",
            "three": "https://github.com/mrdoob/three.js/blob/dev/CHANGELOG.md",
            "@react-three/fiber": "https://github.com/pmndrs/react-three-fiber/blob/main/CHANGELOG.md",
            "@react-three/drei": "https://github.com/pmndrs/drei/blob/main/CHANGELOG.md",
            "animejs": "https://github.com/animejs/animejs/blob/main/CHANGELOG.md",
            "lucide-react": "https://github.com/lucide-icons/lucide/blob/main/CHANGELOG.md",
            "zustand": "https://github.com/pmndrs/zustand/blob/main/CHANGELOG.md",
            "theatre": "https://github.com/theatre-project/theatre/blob/main/CHANGELOG.md",
            "pnpm": "https://github.com/pnpm/pnpm/blob/main/CHANGELOG.md",
        }
        for key, url in common.items():
            if name.startswith(key):
                return url
        return f"https://www.npmjs.com/package/{name}?activeTab=versions"

    def check_missing_catalog(self, outdated_data: list[dict]) -> list[str]:
        """Find packages that should be in catalog but aren't"""
        missing = []
        for item in outdated_data:
            name = item.get("name", "")
            if name not in self.catalog and not name.startswith("@types/"):
                missing.append(name)
        return missing

    def check_lockfile_drift(self) -> bool:
        """Check if lockfile is in sync with package.json"""
        stdout, stderr, code = self.run_pnpm(["install", "--frozen-lockfile", "--dry-run"])
        return code != 0

    def run_check(self, fix: bool = False, audit: bool = False, table: bool = False, yes: bool = False) -> CheckResult:
        """Run full dependency check"""
        self._print("Checking dependencies...")

        # Get outdated packages
        self._print("Checking outdated packages...")
        outdated_data = self.get_outdated()
        self._print(f"Found {len(outdated_data)} outdated packages")

        # Get catalog outdated
        self._print("Checking catalog versions...")
        catalog_outdated = self.get_catalog_outdated()
        self._print(f"Found {len(catalog_outdated)} outdated catalog packages")

        # Check peer deps
        self._print("Checking peer dependencies...")
        peer_conflicts = self.check_peer_deps()
        self._print(f"Found {len(peer_conflicts)} peer conflicts")

        # Security audit
        security_issues_list = []
        security_count = 0
        if audit:
            self._print("Running security audit...")
            security_count, security_issues_list = self.check_security_audit()
            self._print(f"Found {security_count} security issues")

        # Build package list
        packages = []

        # Add regular outdated
        for item in outdated_data:
            name = item.get("name", "")
            current = item.get("current", "")
            latest = item.get("latest", "")
            wanted = item.get("wanted", "")
            location = item.get("path", "") or item.get("location", "")

            is_catalog = name in self.catalog
            pkg = PackageInfo(
                name=name,
                current=current,
                latest=latest,
                wanted=wanted,
                location=location,
                is_catalog=is_catalog,
                security=False
            )
            packages.append(pkg)

        # Add catalog outdated
        for item in catalog_outdated:
            name = item["name"]
            if not any(p.name == name for p in packages):
                pkg = PackageInfo(
                    name=name,
                    current=item["current"],
                    latest=item["latest"],
                    wanted=item["latest"],
                    location="catalog",
                    is_catalog=True,
                    major_bump=item.get("major_bump", False)
                )
                packages.append(pkg)

        # Check deprecated
        self._print("Checking for deprecated packages...")
        packages = self.check_deprecated(packages)

        # Check breaking changes
        self._print("Checking for breaking changes...")
        packages = self.check_breaking_changes(packages)

        # Check missing catalog entries
        missing_catalog = self.check_missing_catalog(outdated_data)

        # Check lockfile drift
        lockfile_drift = self.check_lockfile_drift()
        if lockfile_drift:
            self._print("Lockfile drift detected (run pnpm install)", "warn")

        # Count
        total = len(packages)
        outdated_count = len([p for p in packages if not p.is_catalog])
        catalog_outdated_count = len([p for p in packages if p.is_catalog])
        breaking_count = len([p for p in packages if p.breaking])
        deprecated_count = len([p for p in packages if p.deprecated])

        result = CheckResult(
            timestamp=datetime.now().isoformat(),
            total_packages=total,
            outdated=outdated_count,
            catalog_outdated=catalog_outdated_count,
            peer_conflicts=len(peer_conflicts),
            breaking_changes=breaking_count,
            deprecated_count=deprecated_count,
            security_issues=security_count,
            packages=packages
        )

        # Print summary
        self._print_summary(result, peer_conflicts, security_issues_list, missing_catalog, lockfile_drift, table)

        if fix and (outdated_count > 0 or catalog_outdated_count > 0):
            self._auto_fix(result, yes)

        return result

    def _print_summary(self, result: CheckResult, peer_conflicts: list[dict],
                       security_issues: list[dict], missing_catalog: list[str],
                       lockfile_drift: bool, table: bool):
        """Print formatted summary"""
        c = Colors

        if table:
            self._print_table(result, peer_conflicts, security_issues, missing_catalog, lockfile_drift)
            return

        print(f"\n{c.CYAN}{'=' * 70}{c.RESET}")
        print(f"{c.BOLD}Dependency Check Summary{c.RESET}")
        print(f"{c.CYAN}{'=' * 70}{c.RESET}")
        print(f"  Total packages checked: {result.total_packages}")
        print(f"  Outdated (workspace):   {result.outdated}")
        print(f"  Outdated (catalog):     {result.catalog_outdated}")
        print(f"  Peer conflicts:         {result.peer_conflicts}")
        print(f"  Breaking changes:       {result.breaking_changes}")
        print(f"  Deprecated packages:    {result.deprecated_count}")
        print(f"  Security issues:        {result.security_issues}")

        if result.breaking_changes > 0:
            print(f"\n  {c.RED}{c.BOLD}[BREAKING CHANGES]{c.RESET}")
            for p in result.packages:
                if p.breaking:
                    tag = f" {c.RED}[BREAKING]{c.RESET}"
                    major = f" {c.MAGENTA}[MAJOR]{c.RESET}" if p.major_bump else ""
                    print(f"    {p.name}: {c.YELLOW}{p.current}{c.RESET} -> {c.GREEN}{p.latest}{c.RESET}{tag}{major}")
                    if p.changelog_url:
                        print(f"      {c.DIM}Changelog: {p.changelog_url}{c.RESET}")

        if result.deprecated_count > 0:
            print(f"\n  {c.YELLOW}{c.BOLD}[DEPRECATED]{c.RESET}")
            for p in result.packages:
                if p.deprecated:
                    print(f"    {p.name}: {c.YELLOW}{p.current}{c.RESET} -> {c.GREEN}{p.latest}{c.RESET} [DEPRECATED]")

        if result.security_issues > 0:
            print(f"\n  {c.RED}{c.BOLD}[SECURITY]{c.RESET}")
            for issue in security_issues:
                sev_color = {"critical": c.RED, "high": c.RED, "moderate": c.YELLOW, "low": c.BLUE}.get(issue.get("severity", "").lower(), c.WHITE)
                print(f"    {sev_color}{issue.get('severity', '').upper()}{c.RESET}: {issue.get('package')}@{issue.get('version')} - {issue.get('title')}")
                if issue.get("url"):
                    print(f"      {c.DIM}{issue.get('url')}{c.RESET}")

        if peer_conflicts:
            print(f"\n  {c.YELLOW}{c.BOLD}[PEER CONFLICTS]{c.RESET}")
            for c_conflict in peer_conflicts:
                print(f"    {c_conflict['message']}")

        if missing_catalog:
            print(f"\n  {c.BLUE}{c.BOLD}[MISSING CATALOG ENTRIES]{c.RESET}")
            for name in missing_catalog:
                print(f"    {name} (should be added to pnpm-workspace.yaml)")

        if lockfile_drift:
            print(f"\n  {c.YELLOW}{c.BOLD}[LOCKFILE DRIFT]{c.RESET} Run 'pnpm install' to sync")

        if result.outdated > 0 or result.catalog_outdated > 0:
            print(f"\n  {c.GREEN}{c.BOLD}[UPGRADABLE]{c.RESET}")
            for p in result.packages:
                tag = f" {c.BLUE}[CATALOG]{c.RESET}" if p.is_catalog else ""
                breaking = f" {c.RED}[BREAKING]{c.RESET}" if p.breaking else ""
                deprecated = f" {c.YELLOW}[DEPRECATED]{c.RESET}" if p.deprecated else ""
                print(f"    {p.name}: {c.YELLOW}{p.current}{c.RESET} -> {c.GREEN}{p.latest}{c.RESET}{tag}{breaking}{deprecated}")

        print(f"{c.CYAN}{'=' * 70}{c.RESET}")

    def _print_table(self, result: CheckResult, peer_conflicts: list[dict],
                     security_issues: list[dict], missing_catalog: list[str],
                     lockfile_drift: bool):
        """Print table format summary"""
        c = Colors
        print(f"\n{c.BOLD}{'Package':<35} {'Current':<15} {'Latest':<15} {'Type':<12} {'Flags'}{c.RESET}")
        print(f"{c.CYAN}{'-' * 80}{c.RESET}")

        for p in result.packages:
            flags = []
            if p.is_catalog: flags.append(f"{c.BLUE}CATALOG{c.RESET}")
            if p.breaking: flags.append(f"{c.RED}BREAKING{c.RESET}")
            if p.deprecated: flags.append(f"{c.YELLOW}DEPRECATED{c.RESET}")
            if p.security: flags.append(f"{c.RED}SECURITY{c.RESET}")
            if p.major_bump: flags.append(f"{c.MAGENTA}MAJOR{c.RESET}")

            ptype = "catalog" if p.is_catalog else "workspace"
            print(f"{p.name:<35} {p.current:<15} {p.latest:<15} {ptype:<12} {' '.join(flags)}")

        print(f"{c.CYAN}{'-' * 80}{c.RESET}")
        print(f"Total: {result.total_packages} | Outdated: {result.outdated} | Catalog: {result.catalog_outdated} | Breaking: {result.breaking_changes} | Deprecated: {result.deprecated_count} | Security: {result.security_issues}")

    def _auto_fix(self, result: CheckResult, yes: bool = False):
        """Auto-upgrade catalog packages (safe updates only)"""
        catalog_updates = [p for p in result.packages if p.is_catalog and not p.breaking and not p.deprecated]

        if not catalog_updates:
            self._print("No safe catalog updates available (all have breaking changes or deprecated)", "warn")
            return

        self._print(f"Safe catalog updates available ({len(catalog_updates)}):")
        for p in catalog_updates:
            print(f"  {p.name}: {p.current} -> {p.latest}")

        if not yes:
            confirm = input("\nApply these catalog updates? [y/N]: ").strip().lower()
            if confirm != 'y':
                self._print("Cancelled.")
                return

        import yaml
        with open(self.catalog_file) as f:
            data = yaml.safe_load(f)

        for p in catalog_updates:
            data["catalog"][p.name] = f"^{p.latest}"
            self._print(f"Updated {p.name} to ^{p.latest}")

        with open(self.catalog_file, 'w') as f:
            yaml.dump(data, f, sort_keys=False)

        self._print("Catalog updated. Run 'pnpm install' to apply.", "success")

    def to_json(self, result: CheckResult) -> str:
        """Convert result to JSON"""
        return json.dumps(asdict(result), indent=2, default=str)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Check dependencies for updates")
    parser.add_argument("--json", action="store_true", help="Output JSON")
    parser.add_argument("--table", action="store_true", help="Output table format")
    parser.add_argument("--fix", action="store_true", help="Auto-fix catalog versions (safe only)")
    parser.add_argument("--yes", "-y", action="store_true", help="Auto-confirm fixes (non-interactive)")
    parser.add_argument("--ci", action="store_true", help="CI mode (exit 1 if updates)")
    parser.add_argument("--audit", action="store_true", help="Include security audit")
    parser.add_argument("--no-color", action="store_true", help="Disable colored output")
    parser.add_argument("--workspace", default=".", help="Workspace root path")
    args = parser.parse_args()

    workspace = Path(args.workspace).resolve()
    checker = DependencyChecker(workspace, use_colors=not args.no_color)
    result = checker.run_check(fix=args.fix, audit=args.audit, table=args.table, yes=args.yes)

    if args.json:
        print(checker.to_json(result))

    if args.ci and (result.outdated > 0 or result.catalog_outdated > 0):
        sys.exit(1)

    sys.exit(0)


if __name__ == "__main__":
    main()
