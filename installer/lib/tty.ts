/**
 * Returns true only when process.stdin is a real TTY.
 * This guards against piped/redirected stdin (e.g., curl | bash).
 */
export function isInteractive(): boolean {
  return process.stdin.isTTY === true;
}
