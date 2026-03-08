import { Octokit } from '@octokit/core';

type RepoInfo = {
  owner: string;
  repo: string;
};

const parseRepo = (fullName: string): RepoInfo => {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) {
    throw new Error('Invalid repo name');
  }
  return { owner, repo };
};

export const getPullRequest = async (
  octokit: Octokit,
  repoFullName: string,
  pullNumber: number
) => {
  const { owner, repo } = parseRepo(repoFullName);
  const response = await octokit.request('GET /repos/{owner}/{repo}/pulls/{pull_number}', {
    owner,
    repo,
    pull_number: pullNumber
  });

  return response.data;
};
