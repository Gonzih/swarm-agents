/**
 * Terminal display — live status board for the swarm.
 */
import chalk from 'chalk';

const ENGINES = { claude: '⬡', aider: '◈', openai: '○' };

export class Display {
  constructor({ agentCount }) {
    this.agentCount = agentCount;
    this.agents = {};  // id → { status, task, since }
    this.stats = { pending: 0, running: 0, done: 0, failed: 0 };
    this.logs = [];
    this.started = Date.now();
  }

  agentBusy(id, task, engine) {
    this.agents[id] = { status: 'busy', task: task.title.slice(0, 60), engine, since: Date.now() };
    this._render();
  }

  agentIdle(id) {
    if (this.agents[id]) this.agents[id].status = 'idle';
    this._render();
  }

  agentDone(id, branch) {
    if (this.agents[id]) {
      this.agents[id].status = 'idle';
      this.agents[id].task = null;
    }
    this.log(chalk.green(`  ✓ pushed ${branch || '(noop)'}`));
  }

  agentFailed(id, err) {
    if (this.agents[id]) this.agents[id].status = 'idle';
    this.log(chalk.red(`  ✗ agent ${id} failed: ${err}`));
  }

  updateStats(stats) {
    this.stats = stats;
    this._render();
  }

  log(msg) {
    this.logs.push(`${_elapsed(this.started)} ${msg}`);
    if (this.logs.length > 20) this.logs = this.logs.slice(-20);
    this._render();
  }

  _render() {
    // Don't clear if stdout isn't a TTY
    if (!process.stdout.isTTY) return;

    console.clear();
    const uptime = _elapsed(this.started);
    console.log(chalk.bold.cyan('⬡  SWARM') + chalk.dim(`  up ${uptime}`));
    console.log(chalk.dim('─'.repeat(60)));

    // Queue stats
    const { pending, running, done, failed } = this.stats;
    console.log(
      chalk.dim('queue: ') +
      chalk.yellow(`${pending} pending`) + '  ' +
      chalk.blue(`${running} running`) + '  ' +
      chalk.green(`${done} done`) +
      (failed > 0 ? '  ' + chalk.red(`${failed} failed`) : '')
    );
    console.log('');

    // Agent roster
    for (const [id, a] of Object.entries(this.agents)) {
      const icon = ENGINES[a.engine] || '·';
      const status = a.status === 'busy'
        ? chalk.cyan(`${icon} [${id}] ${a.task}`)
        : chalk.dim(`${icon} [${id}] idle`);
      console.log('  ' + status);
    }

    console.log('');
    console.log(chalk.dim('─'.repeat(60)));
    for (const l of this.logs.slice(-10)) console.log(l);
  }

  summary() {
    const elapsed = _elapsed(this.started);
    const { done, failed } = this.stats;
    console.log('');
    console.log(chalk.bold('Swarm complete.'));
    console.log(`  ${chalk.green(done)} tasks done, ${chalk.red(failed)} failed — ran for ${elapsed}`);
  }
}

function _elapsed(start) {
  const s = Math.floor((Date.now() - start) / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m${s%60}s`;
  return `${Math.floor(s/3600)}h${Math.floor((s%3600)/60)}m`;
}
