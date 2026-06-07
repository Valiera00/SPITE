#!/usr/bin/env bash
# Pre-commit safety: refuse to let any .env file get staged.
# Wire as a git pre-commit hook:
#   ln -s ../../scripts/check-no-secrets.sh .git/hooks/pre-commit
#   chmod +x .git/hooks/pre-commit
# Or invoke manually before pushing:
#   ./scripts/check-no-secrets.sh

set -e

# Files that, if tracked or staged, would leak credentials.
PATTERNS='\.env(\..+)?$|\.env\.local|\.env\.production'

staged=$(git diff --cached --name-only | grep -E "$PATTERNS" || true)
tracked=$(git ls-files | grep -E "$PATTERNS" | grep -v '\.env\.example$' || true)

problems=0

if [ -n "$staged" ]; then
  echo "ERROR: refusing commit — .env file(s) in staging area:"
  echo "$staged" | sed 's/^/  /'
  echo
  echo "  Unstage with: git restore --staged <file>"
  echo "  Make sure your .gitignore covers .env*.local"
  problems=1
fi

if [ -n "$tracked" ]; then
  echo "ERROR: .env file(s) are tracked by git:"
  echo "$tracked" | sed 's/^/  /'
  echo
  echo "  Untrack with: git rm --cached <file>"
  echo "  Then commit the removal."
  problems=1
fi

if [ "$problems" -eq 0 ]; then
  echo "OK: no .env files staged or tracked."
fi

exit $problems
