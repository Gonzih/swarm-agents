/**
 * Orchestrator — the main swarm loop.
 *
 * Flow:
 *   1. Clone repo locally for task discovery (read-only reference clone)
 *   2. Discover tasks → fill queue
 *   3. Spin N agents, each claims a task, works in isolated temp clone
 *   4. On success: push branch → open PR → reviewer approves → merge
 *   5. Re-discover when queue drains. Loop indefinitely (or until maxTasks).
 *   6. SIGINT: drain gracefully.
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { randomUUID } from 'crypto';
import simpleGit from 'simple-git';
import { TaskQueue } from './queue.js';
import { TaskDiscovery } from './tasks.js';
import { Agent } from './agent.js';
import { Reviewer } from './reviewer.js';
import { TokenPool } from './tokens.js';
import { Display } from './display.js';
import { createOctokit, parseRepo, openPR, reviewAndMergePR, listSwarmPRs } from './github.js';

export class Orchestrator {
  constructor(opts) {
    this.opts = opts;
    this.running = false;
    this.agents = [];
    this.workdir = path.join(os.tmpdir(), `swarm-orc-${randomUUID().slice(0, 8)}`);
    fs.mkdirSync(this.workdir, { recursive: true });

    if (opts.dryRun) process.env.SWARM_DRY_RUN = '1';
    this.tokens = new TokenPool(opts.token);
    this.display = new Display({ agentCount: opts.agentCount });
    this.queue = new TaskQueue({ workdir: this.workdir });

    // GitHub
    const parsed = parseRepo(opts.repo);
    this.ghOwner = parsed?.owner;
    this.ghName = parsed?.name;
    this.isLocalRepo = !parsed;
    this.octokit = createOctokit(opts.ghToken);

    this.repoMeta = {
      owner: this.ghOwner,
      name: this.ghName,
      cloneUrl: parsed ? `https://github.com/${parsed.owner}/${parsed.name}.git` : null,
      localPath: this.isLocalRepo ? opts.repo : null,
    };

    this.reviewer = new Reviewer({
      token: this.tokens.next(),
      log: msg => this.display.log(msg),
    });

    this.tasksCompleted = 0;
    this.stopping = false;
  }

  async run() {
    this.running = true;

    // Clone a reference copy for discovery
    const refPath = path.join(this.workdir, 'ref');
    await this._cloneRef(refPath);

    const discovery = new TaskDiscovery({
      repoPath: refPath,
      octokit: this.octokit,
      owner: this.ghOwner,
      name: this.ghName,
      log: msg => this.display.log(msg),
    });

    // Initial discovery
    this.display.log('Discovering tasks...');
    await discovery.discover(this.queue);
    this.display.updateStats(this.queue.stats());

    if (this.opts.dryRun) {
      console.log('\nDry run — discovered tasks:');
      for (const t of this.queue.tasks) console.log(`  · ${t.title}`);
      this._cleanup();
      return;
    }

    // Review loop (background) — processes open swarm PRs
    this._startReviewLoop();

    // Rediscover when queue is low
    this._startDiscoveryLoop(discovery, refPath);

    // Agent pool
    const agentCount = this.opts.agentCount;
    const promises = [];
    for (let i = 0; i < agentCount; i++) {
      const agent = new Agent({
        id: i,
        engine: this.opts.engine,
        token: this.tokens.next(),
        ghToken: this.opts.ghToken,
        baseBranch: this.opts.baseBranch,
        budgetUsd: this.opts.budgetUsd,
        log: msg => this.display.log(msg),
        repo: this.repoMeta,
      });
      this.agents.push(agent);
      this.display.agentIdle(i);
      promises.push(this._agentLoop(agent));
    }

    await Promise.all(promises);
    this.display.summary();
    this._cleanup();
  }

  async _agentLoop(agent) {
    while (!this.stopping) {
      const task = this.queue.claim();

      if (!task) {
        // No work: wait and check again
        await sleep(5000);
        if (!this.queue.hasPending() && this.queue.stats().running === 0) {
          // All agents idle, queue drained — could break here or wait for re-discovery
          await sleep(15000);
          if (!this.queue.hasPending()) break;
        }
        continue;
      }

      this.display.agentBusy(agent.id, task, this.opts.engine);
      this.display.updateStats(this.queue.stats());

      try {
        const result = await agent.run(task);
        this.queue.complete(task.id, result);
        this.display.agentDone(agent.id, result.branch);
        this.tasksCompleted++;

        // Open PR
        if (result.branch && this.opts.openPRs && this.octokit) {
          const prUrl = await openPR({
            octokit: this.octokit,
            owner: this.ghOwner,
            name: this.ghName,
            branch: result.branch,
            base: this.opts.baseBranch,
            title: task.title,
          });
          if (prUrl) this.display.log(`PR: ${prUrl}`);
        }
      } catch (err) {
        this.queue.fail(task.id, err.message);
        this.display.agentFailed(agent.id, err.message);
      }

      this.display.updateStats(this.queue.stats());

      if (this.opts.maxTasks !== Infinity && this.tasksCompleted >= this.opts.maxTasks) {
        this.stopping = true;
        break;
      }
    }
  }

  _startReviewLoop() {
    if (!this.octokit || !this.ghOwner) return;
    const tick = async () => {
      if (this.stopping) return;
      try {
        const prs = await listSwarmPRs({ octokit: this.octokit, owner: this.ghOwner, name: this.ghName });
        for (const pr of prs) {
          const result = await reviewAndMergePR({
            octokit: this.octokit,
            owner: this.ghOwner,
            name: this.ghName,
            prNumber: pr.number,
            reviewAgent: (title, summary) => this.reviewer.review(title, summary),
          });
          this.display.log(`PR #${pr.number} → ${result}`);
        }
      } catch (e) {
        this.display.log(`review loop err: ${e.message}`);
      }
      if (!this.stopping) setTimeout(tick, 60000);
    };
    setTimeout(tick, 30000); // first review pass after 30s
  }

  _startDiscoveryLoop(discovery, refPath) {
    const tick = async () => {
      if (this.stopping) return;
      if (this.queue.pendingCount() < 2) {
        // Pull latest changes into ref clone before rediscovering
        try {
          const git = simpleGit(refPath);
          await git.pull('origin', this.opts.baseBranch);
        } catch {}
        await discovery.discover(this.queue);
        this.display.updateStats(this.queue.stats());
      }
      if (!this.stopping) setTimeout(tick, 120000);
    };
    setTimeout(tick, 120000);
  }

  async _cloneRef(dest) {
    if (this.isLocalRepo) {
      // Symlink or copy — just use path directly
      this.repoMeta.localPath = this.opts.repo;
      // For discovery, point to the actual local repo
      fs.mkdirSync(dest, { recursive: true });
      // shallow copy: just reference files for reading
      try {
        await simpleGit().clone(this.opts.repo, dest, ['--depth=1']);
      } catch {
        // local repo without remote — just use it directly
        this.repoMeta.localPath = this.opts.repo;
        return this.opts.repo;
      }
    } else {
      const url = this.opts.ghToken
        ? this.repoMeta.cloneUrl.replace('https://', `https://${this.opts.ghToken}@`)
        : this.repoMeta.cloneUrl;
      this.display.log(`Cloning ${this.repoMeta.cloneUrl}...`);
      await simpleGit().clone(url, dest, ['--depth=1', `--branch=${this.opts.baseBranch}`]);
    }
  }

  async stop() {
    this.stopping = true;
    // Wait for any running agents to drain (max 30s)
    const deadline = Date.now() + 30000;
    while (this.agents.some(a => a.busy) && Date.now() < deadline) {
      await sleep(1000);
    }
    this._cleanup();
  }

  _cleanup() {
    try { fs.rmSync(this.workdir, { recursive: true, force: true }); } catch {}
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
