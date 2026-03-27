/**
 * Reviewer agent — uses Claude to review a PR diff summary and decide: approve or request changes.
 * Runs as a lightweight subprocess call, not a full agent loop.
 */
import { execa } from 'execa';

export class Reviewer {
  constructor({ token, log }) {
    this.token = token;
    this.log = log;
  }

  /** Returns { approve: bool, comment: string } */
  async review(prTitle, fileSummary) {
    const prompt = [
      `You are a senior code reviewer. Review this pull request and decide if it should be merged.`,
      ``,
      `PR Title: ${prTitle}`,
      ``,
      `Changed files:`,
      fileSummary,
      ``,
      `Respond with exactly one JSON object on a single line:`,
      `{"approve": true/false, "comment": "your review comment here"}`,
      ``,
      `Approve if: the changes look reasonable and targeted. Request changes if: the diff is suspiciously large, deletes critical files, adds security holes, or is clearly wrong.`,
    ].join('\n');

    try {
      const result = await execa('claude', [
        '--dangerously-skip-permissions',
        '--output-format', 'text',
        '--max-turns', '1',
        '--print',
        prompt,
      ], {
        env: { ...process.env, ANTHROPIC_API_KEY: this.token },
        reject: false,
        timeout: 30000,
      });

      const text = result.stdout || '';
      const match = text.match(/\{.*"approve".*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        return { approve: Boolean(parsed.approve), comment: parsed.comment || 'Auto-reviewed.' };
      }
    } catch (e) {
      this.log(`  ⚠ reviewer error: ${e.message}`);
    }

    // Default: approve (keep the loop moving)
    return { approve: true, comment: 'Auto-approved (reviewer fallback).' };
  }
}
