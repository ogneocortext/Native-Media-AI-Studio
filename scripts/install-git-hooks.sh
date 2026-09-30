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
        # An earlier run of this installer left its own copy behind. Do not
        # back that up as if it were someone else's hook - that would pile up
        # .backup files on every re-install and hide a genuine pre-existing
        # hook the first time we overwrote it.
        if cmp -s "$hook" "$dest"; then
            chmod +x "$dest"
            echo "  $name already up to date"
            installed=$((installed + 1))
            continue
        fi

        backup="$dest.backup"
        if [ -e "$backup" ]; then
            rm -f "$backup"
        fi
        mv "$dest" "$backup"
        echo "  backed up existing $name -> $name.backup"
        if grep -q 'install-git-hooks.sh' "$backup" 2>/dev/null; then
            echo "    (that was a previous copy of ours; nothing of yours was lost)"
            # Our own previous copy: discard it, it is being replaced.
            rm -f "$backup"
        else
            # Someone else's hook must keep running. The hook itself calls
            # pre-commit.backup at each exit point, so preserving the file is
            # all that is needed - but the new hook still has to be copied in,
            # so no early continue here.
            if [ "$name" = "pre-commit" ] && [ -f "$backup" ]; then
                echo "  backed-up pre-commit will still be called by the new hook"
            fi
        fi
    fi

    cp "$hook" "$dest"
    chmod +x "$dest"
    echo "  installed $name"
    installed=$((installed + 1))
done

# Re-running is a no-op, not a failure: every hook being up to date is success.
if [ "$installed" -eq 0 ]; then
    echo "no hooks found in $src_dir" >&2
    exit 1
fi

echo
echo "Hooks ready in $dest_dir ($installed managed)"
echo "Run 'bash scripts/install-git-hooks.sh' again after pulling changes to scripts/git-hooks/."

# Report any other hooks present that this installer does not manage, so a
# stale or blocked one (e.g. Git LFS erroring when git-lfs is missing) is
# visible rather than surprising later.
other=""
for f in "$dest_dir"/*; do
    [ -f "$f" ] || continue
    n=$(basename "$f")
    case "$n" in
        *.sample|*.backup) continue ;;
    esac
    if [ ! -f "$src_dir/$n" ]; then
        other="$other $n"
    fi
done

if [ -n "$other" ]; then
    echo
    echo "Other hooks already present (not managed by this script):$other"
fi
