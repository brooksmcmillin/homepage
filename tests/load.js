import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * Create a factory function from a non-module extension script.
 * Each call to the returned factory creates a fresh scope with fresh state.
 *
 * @param {string} filename - Script file relative to project root
 * @param {object} options
 * @param {string[]} options.globals - Names injected as function parameters
 * @param {string} options.returnExpr - JS expression for the return value
 * @param {string} [options.stripAfterLast] - Remove everything from the last occurrence of this string onward
 * @returns {Function} Factory that accepts global values and returns exports
 */
export function loadScript(
  filename,
  { globals = [], returnExpr = "{}", stripAfterLast } = {},
) {
  let code = readFileSync(resolve(ROOT, filename), "utf8");
  if (stripAfterLast) {
    const idx = code.lastIndexOf(stripAfterLast);
    if (idx !== -1) code = code.slice(0, idx);
  }
  return new Function(...globals, `${code}\nreturn (${returnExpr});`);
}
