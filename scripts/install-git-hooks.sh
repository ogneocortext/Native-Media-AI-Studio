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
        if grep -q 'install-git-hooks.sh' "$dest" 2>/dev/null; then
            # The file being replaced is a previous copy of ours. Replace it in
            # place and leave a genuine .backup untouched: a pre-existing hook
            # saved on the FIRST install must survive every later re-install,
            # not just the first. (Deleting it here is what silently dropped
            # Git LFS's pre-push hook on 2026-11-14.)
            rm -f "$dest"
            if [ -e "$backup" ] && grep -q 'install-git-hooks.sh' "$backup" 2>/dev/null; then
                rm -f "$backup"  # stale copy of ours, no genuine hook to keep
            fi
            echo "  replacing previous copy of $name"
        elif [ -e "$backup" ] && ! grep -q 'install-git-hooks.sh' "$backup" 2>/dev/null; then
            # A genuine pre-existing hook is already preserved; never clobber
            # it with a newer displaced copy.
            echo "  $name.backup already preserves a pre-existing hook"
            rm -f "$dest"
        else
            mv "$dest" "$backup"
            echo "  backed up existing $name -> $name.backup"
        fi
        if [ -e "$backup" ] && ! grep -q 'install-git-hooks.sh' "$backup" 2>/dev/null; then
            echo "  the preserved $name.backup will still be called by the new hook"
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
