/**
 * Token rotation pool — round-robins across multiple API keys.
 * Set SWARM_TOKENS=tok1,tok2,tok3 or pass single token.
 */
export class TokenPool {
  constructor(primary) {
    const raw = process.env.SWARM_TOKENS || process.env.ANTHROPIC_API_KEY || primary || '';
    this.tokens = raw.split(',').map(t => t.trim()).filter(Boolean);
    if (!this.tokens.length && !process.env.SWARM_DRY_RUN) throw new Error('No API tokens. Set ANTHROPIC_API_KEY or SWARM_TOKENS.');
    this.idx = 0;
  }

  next() {
    const tok = this.tokens[this.idx % this.tokens.length];
    this.idx++;
    return tok;
  }

  count() { return this.tokens.length; }
}
