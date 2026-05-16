# Landing Checklist

Before commit or PR:

1. Check worktree:

   ```bash
   git status --short
   ```

2. Run local CI equivalent:

   ```bash
   make all
   ```

3. Review diff:

   ```bash
   git diff
   git diff --cached
   ```

4. Commit with semantic message:

   ```bash
   git add <files>
   git commit -m "feat: short imperative summary"
   ```

Done means:
- `make all` passes locally.
- CI uses same `make all` gate.
- Docs/tests are updated with behavior changes.
- No generated or dependency folders are staged.
