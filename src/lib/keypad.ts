/**
 * The keypad's two decisions — which twelve keys it draws and what a key does to
 * the entry — kept apart from the sheet that draws it (`components/Keypad.tsx`).
 *
 * Written for the money keypad of the combined 2.x app, where a currency with
 * cents traded `000` for `.`; what is left is the measurement sheet's number,
 * one decimal place. The reducer is a string, not a number, because `12.` is a
 * state somebody is halfway through typing and a number would lose the point.
 */

/** How many digits an entry may hold in all. */
export const MAX_DIGITS = 12;

/** The twelve keys, in reading order: `.` replaces `000` when there are decimals. */
export function keypadKeys(decimals: number): readonly string[] {
  return ['1', '2', '3', '4', '5', '6', '7', '8', '9', decimals > 0 ? '.' : '000', '0', 'back'];
}

/**
 * One key on the keypad's entry string — digits, at most one `.`, at most
 * `decimals` digits after it.
 *
 *   ''     + '.'  → '0.'        a bare point means "zero point"
 *   '12.'  + '.'  → '12.'       the second point is ignored
 *   '12.5' + '0'  → '12.50'
 *   '12.50'+ '1'  → '12.50'     two decimals, no more
 *   '12.5' + ⌫    → '12.'  → '12'  backspace walks back across the point
 *   '0'    + '5'  → '5'         a leading zero is never a digit anybody meant
 *
 * The whole part is capped: `MAX_DIGITS` in all, so decimals cost some of them.
 * `000` after a point is ignored (it only exists on a keypad without one).
 */
export function keypadPress(entry: string, key: string, decimals: number): string {
  if (key === 'back') return entry.slice(0, -1);
  const point = entry.indexOf('.');
  if (key === '.') {
    if (decimals <= 0 || point !== -1) return entry;
    return `${entry === '' ? '0' : entry}.`;
  }
  if (!/^\d+$/.test(key)) return entry;
  if (point !== -1) {
    if (key.length > 1) return entry;
    return entry.length - point - 1 >= decimals ? entry : entry + key;
  }
  const next = (entry === '0' ? '' : entry) + key;
  return next.replace(/^0+(?=\d)/, '').slice(0, MAX_DIGITS - Math.max(0, decimals));
}
