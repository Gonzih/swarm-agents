/**
 * Task discovery — scans repo for work:
 *   1. Open GitHub issues
 *   2. TODO/FIXME/HACK comments in source
 *   3. Failing tests (runs test suite, parses output)
 *   4. Lint errors
 *   5. Auto-generated improvement tasks (when queue is empty)
 */
import fs from 'fs';
import path from 'path';
import { execa } from 'execa';

export class TaskDiscovery {
  constructor({ repoPath, octokit, owner, name, log }) {
    this.repoPath = repoPath;
    this.octokit = octokit;
    this.owner = owner;
    this.name = name;
    this.log = log;
  }

  async discover(queue) {
    const found = [];
    found.push(...await this._issues(queue));
    found.push(...await this._todos(queue));
    found.push(...await this._tests(queue));
    found.push(...await this._lint(queue));
    if (found.length === 0) found.push(...this._synthetic(queue));

    for (const t of found) {
      if (!queue.has(t.title)) {
        queue.push(t);
        this.log(`  + task: ${t.title}`);
      }
    }
    return found.length;
  }

  async _issues(queue) {
    if (!this.octokit || !this.owner) return [];
    try {
      const { data } = await this.octokit.rest.issues.listForRepo({
        owner: this.owner,
        repo: this.name,
        state: 'open',
        per_page: 20,
      });
      return data
        .filter(i => !i.pull_request)
        .filter(i => !queue.has(`[issue #${i.number}] ${i.title}`))
        .map(i => ({
          type: 'issue',
          title: `[issue #${i.number}] ${i.title}`,
          body: i.body || '',
          meta: { issueNumber: i.number },
        }));
    } catch (e) {
      this.log(`  ⚠ issues fetch failed: ${e.message}`);
      return [];
    }
  }

  async _todos(queue) {
    const tasks = [];
    const pattern = /\/\/\s*(TODO|FIXME|HACK)[:\s]+(.+)/gi;
    const exts = ['.js', '.ts', '.tsx', '.jsx', '.py', '.go', '.rs'];

    const walk = (dir, depth = 0) => {
      if (depth > 8) return;
      let entries;
      try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
      for (const e of entries) {
        if (e.name.startsWith('.') || e.name === 'node_modules' || e.name === 'dist') continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) { walk(full, depth + 1); continue; }
        if (!exts.includes(path.extname(e.name))) continue;
        const content = fs.readFileSync(full, 'utf8');
        let m;
        while ((m = pattern.exec(content)) !== null) {
          const title = `Fix ${m[1]} in ${path.relative(this.repoPath, full)}: ${m[2].trim()}`;
          if (!queue.has(title)) tasks.push({ type: 'todo', title, body: '', meta: { file: full } });
        }
      }
    };
    walk(this.repoPath);
    return tasks.slice(0, 10); // cap at 10 TODOs per discovery pass
  }

  async _tests(queue) {
    // Detect test runner
    const pkg = this._readJSON('package.json');
    if (!pkg) return [];

    const cmd = pkg.scripts?.test;
    if (!cmd || cmd === 'echo "Error: no test specified"') return [];

    try {
      const result = await execa('npm', ['test', '--', '--no-coverage'], {
        cwd: this.repoPath, reject: false, timeout: 60000,
        env: { ...process.env, CI: 'true' }
      });
      if (result.exitCode === 0) return [];

      const output = result.stdout + result.stderr;
      const title = 'Fix failing test suite';
      if (queue.has(title)) return [];
      return [{ type: 'test', title, body: output.slice(0, 2000), meta: {} }];
    } catch {
      return [];
    }
  }

  async _lint(queue) {
    const pkg = this._readJSON('package.json');
    if (!pkg?.scripts?.lint) return [];

    try {
      const result = await execa('npm', ['run', 'lint'], {
        cwd: this.repoPath, reject: false, timeout: 30000
      });
      if (result.exitCode === 0) return [];
      const title = 'Fix lint errors';
      if (queue.has(title)) return [];
      const body = (result.stdout + result.stderr).slice(0, 2000);
      return [{ type: 'lint', title, body, meta: {} }];
    } catch {
      return [];
    }
  }

  _synthetic(queue) {
    // When the queue is totally empty: generate analysis tasks
    const tasks = [
      { title: 'Audit and improve error handling across the codebase', type: 'synthetic' },
      { title: 'Add missing TypeScript types and fix type errors', type: 'synthetic' },
      { title: 'Write unit tests for untested utility functions', type: 'synthetic' },
      { title: 'Improve README: add usage examples and configuration docs', type: 'synthetic' },
      { title: 'Identify and remove dead code', type: 'synthetic' },
    ];
    return tasks.filter(t => !queue.has(t.title)).map(t => ({ ...t, body: '', meta: {} }));
  }

  _readJSON(filename) {
    try {
      return JSON.parse(fs.readFileSync(path.join(this.repoPath, filename), 'utf8'));
    } catch { return null; }
  }
}
