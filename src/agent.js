/**
 * Agent — wraps a coding engine subprocess (claude / aider / openai).
 * Each task gets an isolated temp clone. Agent streams output, parses cost,
 * then commits + pushes on success.
 */
import { execa } from 'execa';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import simpleGit from 'simple-git';

export class Agent {
  constructor({ id, engine, token, ghToken, baseBranch, budgetUsd, log, repo }) {
    this.id = id;
    this.engine = engine;
    this.token = token;
    this.ghToken = ghToken;
    this.baseBranch = baseBranch;
    this.budgetUsd = budgetUsd;
    this.log = log;     // (msg) => void
    this.repo = repo;   // { owner, name, cloneUrl, localPath }
    this.busy = false;
  }

  /** Run a task. Returns { branch, commitSha, pr } on success. Throws on failure. */
  async run(task) {
    this.busy = true;
    const workdir = path.join(os.tmpdir(), `swarm-${this.id}-${randomUUID().slice(0,8)}`);

    try {
      await this._clone(workdir);
      const branch = `swarm/${task.id.slice(0, 8)}-${slugify(task.title)}`;
      const git = simpleGit(workdir);
      await git.checkoutLocalBranch(branch);

      const prompt = this._buildPrompt(task);
      await this._exec(workdir, prompt);

      // Check if anything changed
      const status = await git.status();
      if (status.files.length === 0) {
        this.log(`[agent:${this.id}] no changes — task may already be done`);
        return { branch: null, commitSha: null, noop: true };
      }

      await git.add('.');
      const msg = `feat(swarm): ${task.title}\n\nTask-Id: ${task.id}\nEngine: ${this.engine}`;
      const commit = await git.commit(msg);

      await git.push('origin', branch, ['--set-upstream']);
      this.log(`[agent:${this.id}] pushed ${branch}`);

      return { branch, commitSha: commit.commit };
    } finally {
      fs.rmSync(workdir, { recursive: true, force: true });
      this.busy = false;
    }
  }

  async _clone(workdir) {
    fs.mkdirSync(workdir, { recursive: true });
    const url = this.repo.localPath
      ? this.repo.localPath
      : this._authedUrl(this.repo.cloneUrl);
    const git = simpleGit();
    this.log(`[agent:${this.id}] cloning → ${workdir}`);
    await git.clone(url, workdir, ['--depth=1', `--branch=${this.baseBranch}`]);
  }

  _authedUrl(url) {
    if (!this.ghToken) return url;
    return url.replace('https://', `https://${this.ghToken}@`);
  }

  _buildPrompt(task) {
    return [
      `You are an autonomous coding agent. Complete the following task in this repository.`,
      ``,
      `TASK: ${task.title}`,
      task.body ? `\nDETAILS:\n${task.body}` : '',
      ``,
      `RULES:`,
      `- Make the minimal correct change to complete this task.`,
      `- Do not reformat unrelated code.`,
      `- Do not create documentation files unless the task specifically requires it.`,
      `- Run tests if a test command is available and all tests pass before finishing.`,
      `- If you cannot complete the task, write a file SWARM_BLOCKED.md explaining why.`,
      `- When done, stop. Do not ask questions.`,
    ].filter(l => l !== null).join('\n');
  }

  async _exec(workdir, prompt) {
    if (this.engine === 'claude') {
      return this._runClaude(workdir, prompt);
    } else if (this.engine === 'aider') {
      return this._runAider(workdir, prompt);
    } else {
      throw new Error(`Unknown engine: ${this.engine}`);
    }
  }

  async _runClaude(workdir, prompt) {
    const args = [
      '--dangerously-skip-permissions',
      '--output-format', 'stream-json',
      '--max-turns', '30',
      '--print',
      prompt,
    ];
    if (this.budgetUsd) args.push('--max-budget-usd', String(this.budgetUsd));

    const env = {
      ...process.env,
      ANTHROPIC_API_KEY: this.token,
      CLAUDE_CODE_OAUTH_TOKENS: '',
    };

    const proc = execa('claude', args, { cwd: workdir, env, reject: false });
    let cost = 0;

    for await (const line of proc) {
      try {
        const evt = JSON.parse(line);
        if (evt.type === 'result' && evt.cost_usd) cost = evt.cost_usd;
      } catch {}
      // stream raw output to log at debug level
    }

    const result = await proc;
    this.log(`[agent:${this.id}] claude done (exit ${result.exitCode}, $${cost.toFixed(4)})`);

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(`claude exited ${result.exitCode}`);
    }
  }

  async _runAider(workdir, prompt) {
    const args = ['--yes', '--message', prompt, '--no-git'];
    const env = { ...process.env, OPENAI_API_KEY: this.token };
    const result = await execa('aider', args, { cwd: workdir, env, reject: false });
    if (result.exitCode !== 0) throw new Error(`aider exited ${result.exitCode}`);
  }
}

function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40).replace(/-$/, '');
}
