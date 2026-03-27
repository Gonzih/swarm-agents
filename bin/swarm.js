#!/usr/bin/env node
import { program } from 'commander';
import { Orchestrator } from '../src/orchestrator.js';
import chalk from 'chalk';

program
  .name('swarm')
  .description('Autonomous multi-agent coding swarm')
  .version('0.1.0')
  .argument('<repo>', 'GitHub repo URL or local path')
  .option('-n, --agents <n>', 'parallel agent count', '3')
  .option('--engine <engine>', 'coding engine: claude|aider|openai', 'claude')
  .option('--token <token>', 'API token (or set ANTHROPIC_API_KEY / OPENAI_API_KEY)')
  .option('--gh-token <token>', 'GitHub token (or set GITHUB_TOKEN)')
  .option('--branch <branch>', 'base branch', 'main')
  .option('--max-tasks <n>', 'stop after N tasks (default: ∞)', '0')
  .option('--dry-run', 'discover tasks but do not execute', false)
  .option('--no-pr', 'commit directly without opening PRs')
  .option('--budget <usd>', 'max spend per agent per task (USD)', '5')
  .parse(process.argv);

const [repo] = program.args;
const opts = program.opts();

console.log(chalk.bold.cyan('\n⬡  SWARM\n'));
console.log(chalk.dim(`  repo     ${repo}`));
console.log(chalk.dim(`  agents   ${opts.agents}`));
console.log(chalk.dim(`  engine   ${opts.engine}`));
console.log(chalk.dim(`  branch   ${opts.branch}`));
if (opts.dryRun) console.log(chalk.yellow('  dry-run  ON'));
console.log('');

const orc = new Orchestrator({
  repo,
  agentCount: parseInt(opts.agents, 10),
  engine: opts.engine,
  token: opts.token || process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY,
  ghToken: opts.ghToken || process.env.GITHUB_TOKEN,
  baseBranch: opts.branch,
  maxTasks: parseInt(opts.maxTasks, 10) || Infinity,
  dryRun: opts.dryRun,
  openPRs: opts.pr !== false,
  budgetUsd: parseFloat(opts.budget),
});

process.on('SIGINT', async () => {
  console.log(chalk.yellow('\n\n  Draining agents...'));
  await orc.stop();
  process.exit(0);
});

orc.run().catch(err => {
  console.error(chalk.red('\n  Fatal:'), err.message);
  process.exit(1);
});
