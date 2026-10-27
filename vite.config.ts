import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Les worktrees d'agents vivent sous .claude/ : leurs copies du code ne sont pas à tester ici.
    exclude: [...configDefaults.exclude, '.claude/**'],
  },
});
