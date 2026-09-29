#!/usr/bin/env bash
# Install the repo's local git hooks into .git/hooks.
#
# .git/hooks is not tracked by git, so a fresh clone has no hooks. This copies
# the versioned hooks from scripts/git-hooks/ into place, backing up any hook it
# would overwrite.
#
# Per D10 in docs/architecture/decision-log.md there is no CI: these hooks are
# the only automated guard, so run this once after cloning.
#
# Usage:  bash scripts/install-git-hooks.sh

set -e

repo_root=$(cd "$(dirname "$0")/.." && pwd)
cd "$repo_root"

src_dir="$repo_root/scripts/git-hooks"
dest_dir="$(git rev-parse --git-path hooks)"

if [ ! -d "$src_dir" ]; then
    echo "error: $src_dir not found" >&2
    exit 1
fi

mkdir -p "$dest_dir"

installed=0
for hook in "$src_dir"/*; do
    [ -f "$hook" ] || continue
    name=$(basename "$hook")
    dest="$dest_dir/$name"

    if [ -e "$dest" ]; then
        backup="$dest.backup"
        if [ -e "$backup" ]; then
            rm -f "$backup"
        fi
        mv "$dest" "$backup"
        echo "  backed up existing $name -> $name.backup"
    fi

    cp "$hook" "$dest"
    chmod +x "$dest"
    echo "  installed $name"
    installed=$((installed + 1))
done

# Windows checkouts can lose the executable bit; make sure it is set.
if [ "$installed" -eq 0 ]; then
    echo "no hooks found in $src_dir" >&2
    exit 1
fi

echo
echo "Installed $installed hook(s) into $dest_dir"
echo "Run 'bash scripts/install-git-hooks.sh' again after pulling changes to scripts/git-hooks/."
