import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // HVA-149: guard against the refresh-required bug class. New mutation
  // code in (exec)/(captain)/admin should use lib/hooks/use-server-mutation
  // instead of hand-rolled useTransition + router.refresh() — the wrapper
  // bundles all three pieces (submitting flag, useTransition, refresh)
  // so authors can't forget the refresh on success.
  //
  // Files migrated to the new pattern remove the no-restricted-syntax
  // disable comment; new code must either use the wrapper or opt out
  // with a comment explaining the deferred reason.
  {
    files: ["app/(exec)/**/*.{ts,tsx}", "app/(captain)/**/*.{ts,tsx}", "app/admin/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.name='useTransition']",
          message:
            "Use `useServerMutation` from '@/lib/hooks/use-server-mutation' instead of raw useTransition. The wrapper bundles useTransition + router.refresh() + toast so refresh-required bugs (HVA-136/143/146) can't recur. If you genuinely need raw useTransition (non-mutation use), prefix with `// eslint-disable-next-line no-restricted-syntax` + a one-line reason.",
        },
      ],
    },
  },
]);

export default eslintConfig;
