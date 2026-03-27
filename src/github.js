/**
 * GitHub integration — PR creation, auto-merge, review.
 */
import { Octokit } from '@octokit/rest';

export function createOctokit(token) {
  if (!token) return null;
  return new Octokit({ auth: token });
}

export function parseRepo(url) {
  // Handles: https://github.com/owner/name, github.com/owner/name, owner/name
  const m = url.match(/(?:github\.com[:/])([^/]+)\/([^/.]+)/);
  if (m) return { owner: m[1], name: m[2].replace(/\.git$/, '') };
  // local path — no github integration
  return null;
}

export async function openPR({ octokit, owner, name, branch, base, title, body }) {
  if (!octokit) return null;
  try {
    const { data } = await octokit.rest.pulls.create({
      owner, repo: name, head: branch, base,
      title, body: body || `Automated by swarm agent.\n\nBranch: \`${branch}\``,
    });
    return data.html_url;
  } catch (e) {
    if (e.status === 422) return null; // already exists
    throw e;
  }
}

export async function reviewAndMergePR({ octokit, owner, name, prNumber, reviewAgent }) {
  if (!octokit) return;

  // Pull the diff
  const { data: pr } = await octokit.rest.pulls.get({ owner, repo: name, pull_number: prNumber });
  const { data: files } = await octokit.rest.pulls.listFiles({ owner, repo: name, pull_number: prNumber });

  const summary = files.map(f => `${f.status} ${f.filename} (+${f.additions} -${f.deletions})`).join('\n');

  // reviewAgent: async (summary) => { approve: bool, comment: string }
  const review = reviewAgent ? await reviewAgent(pr.title, summary) : { approve: true, comment: 'LGTM' };

  if (review.approve) {
    await octokit.rest.pulls.createReview({
      owner, repo: name, pull_number: prNumber,
      event: 'APPROVE', body: review.comment,
    });
    await octokit.rest.pulls.merge({
      owner, repo: name, pull_number: prNumber,
      merge_method: 'squash',
    });
    return 'merged';
  } else {
    await octokit.rest.pulls.createReview({
      owner, repo: name, pull_number: prNumber,
      event: 'REQUEST_CHANGES', body: review.comment,
    });
    return 'changes_requested';
  }
}

/** List unreviewed swarm PRs */
export async function listSwarmPRs({ octokit, owner, name }) {
  if (!octokit) return [];
  const { data } = await octokit.rest.pulls.list({
    owner, repo: name, state: 'open', per_page: 50,
  });
  return data.filter(p => p.head.ref.startsWith('swarm/'));
}
