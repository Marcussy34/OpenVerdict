/**
 * The `ov` banner: a figlet-style "OpenVerdict" wordmark next to a small
 * shield-with-check mark (the verify page icon), the tagline and one context
 * line. Printed to stderr so `--json` output on stdout stays parseable.
 * ASCII only: no box drawing, no em dash, nothing a plain terminal breaks on.
 */

/** The shield: seven rows, eleven columns. */
const SHIELD = [
  "  .-----.  ",
  " /       \\ ",
  " |     / | ",
  " | \\  /  | ",
  " |  \\/   | ",
  "  \\     /  ",
  "   '---'   ",
];

/** "OpenVerdict" in a small figlet-like face; the last row is the p descender. */
const WORDMARK = [
  "  ___                 __   __             _  _      _",
  " / _ \\  _ __  ___  _ _\\ \\ / /___  _ _  __| |(_) __ | |_",
  "| (_) || '_ \\/ -_)| ' \\\\ V // -_)| '_|/ _` || |/ _||  _|",
  " \\___/ | .__/\\___||_||_|\\_/ \\___||_|  \\__,_||_|\\__| \\__|",
  "       |_|",
];

export const TAGLINE = "adversarial AI jury protocol";
export const TAGLINE_DETAIL = "jurors on Gonka, settled on Sui, evidence on Walrus";

const GAP = "  ";
/** Column where the wordmark starts (shield plus gap). */
const WORD_COLUMN = SHIELD[0]!.length + GAP.length;
/** Column where the tagline starts, four past the wordmark's descender. */
const TAGLINE_COLUMN = WORD_COLUMN + 14;
export const BANNER_WIDTH = 80;

const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  green: "\u001b[32m",
};

export type BannerOptions = {
  /** Host shown on the context line (an origin or a bare host). */
  base: string;
  /** The command line as typed, "ov watch 0x..."; shortened to fit 80 columns. */
  command: string;
  color: boolean;
};

/** The banner lines, coloured when asked; each fits in 80 columns. */
export function renderBanner(options: BannerOptions): string[] {
  const paint = (text: string, code: string) => (options.color ? `${code}${text}${ANSI.reset}` : text);
  const lines: string[] = [];
  for (let row = 0; row < SHIELD.length; row += 1) {
    // Wordmark rows sit on shield rows 1 to 5; the tagline fills rows 5 and 6.
    const word = row >= 1 && row <= WORDMARK.length ? WORDMARK[row - 1]! : "";
    let right = "";
    if (row === SHIELD.length - 2) {
      right = `${paint(word.padEnd(TAGLINE_COLUMN - WORD_COLUMN), ANSI.bold)}${paint(TAGLINE, ANSI.dim)}`;
    } else if (row === SHIELD.length - 1) {
      right = `${" ".repeat(TAGLINE_COLUMN - WORD_COLUMN)}${paint(TAGLINE_DETAIL, ANSI.dim)}`;
    } else if (word.length > 0) {
      right = paint(word, ANSI.bold);
    }
    // No trailing blanks: the shield alone is trimmed before it is painted.
    const shield = right ? SHIELD[row]! : SHIELD[row]!.trimEnd();
    lines.push(right ? `${paint(shield, ANSI.green)}${GAP}${right}` : paint(shield, ANSI.green));
  }
  // The context line is the footer under the whole mark, aligned with the wordmark.
  const host = hostOf(options.base);
  const room = BANNER_WIDTH - WORD_COLUMN - host.length - 5;
  const command = options.command.length > room ? `${options.command.slice(0, Math.max(0, room - 3))}...` : options.command;
  lines.push(`${" ".repeat(WORD_COLUMN)}${paint(`${host}  |  ${command}`, ANSI.dim)}`.trimEnd());
  return lines;
}

function hostOf(base: string): string {
  try {
    return new URL(base.includes("://") ? base : `https://${base}`).host;
  } catch {
    return base;
  }
}

/** Colour codes off, for width checks and tests. */
export function stripAnsi(text: string): string {
  return text.replace(/\u001b\[[0-9;]*m/g, "");
}

/**
 * Colour only on a TTY or with FORCE_COLOR, never with NO_COLOR or --no-color;
 * mirrors what most CLIs do so the banner never litters a log file.
 */
export function wantsColor(env: Record<string, string | undefined>, isTty: boolean, noColorFlag: boolean): boolean {
  if (noColorFlag) return false;
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "0" && env.FORCE_COLOR !== "") return true;
  return isTty;
}
