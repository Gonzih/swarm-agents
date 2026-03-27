/**
 * Terminal display + event bus emitter.
 * All state changes go to both TTY and the WebSocket event bus.
 */
import chalk from 'chalk';
import { emit } from './events.js';

const ENGINES = { claude: '⬡', aider: '◈', openai: '○' };

export class Display {
  constructor({ agentCount }) {
    this.agentCount = agentCount;
    this.agents = {};  // id → { status, task, since, engine, logs[] }
    this.stats = { pending: 0, running: 0, done: 0, failed: 0 };
    this.logs = [];
    this.started = Date.now();
  }

  agentBusy(id, task, engine) {
    this.agents[id] = {
      status: 'busy',
      task: task.title,
      taskType: task.type,
      taskBody: task.body,
      engine,
      since: Date.now(),
      logs: [],
    };
    emit('agent_busy', { id, task, engine });
    this._render();
  }

  agentIdle(id) {
    if (this.agents[id]) this.agents[id].status = 'idle';
    emit('agent_idle', { id });
    this._render();
  }

  agentDone(id, branch, prUrl) {
    if (this.agents[id]) {
      this.agents[id].status = 'done';
      this.agents[id].branch = branch;
      this.agents[id].prUrl = prUrl;
    }
    emit('agent_done', { id, branch, prUrl });
    this.log(chalk.green(`  ✓ [${id}] pushed ${branch || '(noop)'}`) + (prUrl ? chalk.dim(` ${prUrl}`) : ''));
  }

  agentFailed(id, err) {
    if (this.agents[id]) this.agents[id].status = 'failed';
    emit('agent_failed', { id, error: err });
    this.log(chalk.red(`  ✗ [${id}] ${err}`));
  }

  agentLog(id, line) {
    if (this.agents[id]) {
      this.agents[id].logs.push(line);
      if (this.agents[id].logs.length > 200) this.agents[id].logs.shift();
    }
    emit('agent_log', { id, line });
  }

  updateStats(stats) {
    this.stats = stats;
    emit('queue_update', { stats });
    this._render();
  }

  log(msg) {
    const entry = `${_elapsed(this.started)} ${msg}`;
    this.logs.push(entry);
    if (this.logs.length > 20) this.logs = this.logs.slice(-20);
    emit('global_log', { line: msg });
    this._render();
  }

  _render() {
    if (!process.stdout.isTTY) return;
    console.clear();
    const uptime = _elapsed(this.started);
    console.log(chalk.bold.cyan('⬡  SWARM') + chalk.dim(`  up ${uptime}`));
    console.log(chalk.dim('─'.repeat(60)));
    const { pending, running, done, failed } = this.stats;
    console.log(
      chalk.dim('queue: ') +
      chalk.yellow(`${pending} pending`) + '  ' +
      chalk.blue(`${running} running`) + '  ' +
      chalk.green(`${done} done`) +
      (failed > 0 ? '  ' + chalk.red(`${failed} failed`) : '')
    );
    console.log('');
    for (const [id, a] of Object.entries(this.agents)) {
      const icon = ENGINES[a.engine] || '·';
      const status = a.status === 'busy'
        ? chalk.cyan(`${icon} [${id}] ${a.task?.slice(0, 55)}`)
        : a.status === 'done'
          ? chalk.green(`${icon} [${id}] ✓ ${a.branch || 'noop'}`)
          : chalk.dim(`${icon} [${id}] idle`);
      console.log('  ' + status);
    }
    console.log('');
    console.log(chalk.dim('─'.repeat(60)));
    for (const l of this.logs.slice(-8)) console.log(l);
  }

  summary() {
    const elapsed = _elapsed(this.started);
    const { done, failed } = this.stats;
    emit('swarm_done', { done, failed, elapsed });
    console.log('');
    console.log(chalk.bold('Swarm complete.'));
    console.log(`  ${chalk.green(done)} tasks done, ${chalk.red(failed)} failed — ran for ${elapsed}`);
  }
}

function _elapsed(start) {
  const s = Math.floor((Date.now() - start) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}
