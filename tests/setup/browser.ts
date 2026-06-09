// =============================================================================
// HVA-138: vitest browser-mode setup
// =============================================================================
//
// Loads @testing-library/jest-dom's custom matchers so component tests
// can use expect(el).toBeInTheDocument() etc.
//
// Runs once per test file in the browser project (separate from
// tests/setup/per-file.ts which is for the node DB suite).
// =============================================================================

import '@testing-library/jest-dom/vitest';
