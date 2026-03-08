import { Octokit } from '@octokit/core';

type RepoInfo = {
  owner: string;
  repo: string;
};

export type StateIssue = {
  number: number;
  body: string;
  title: string;
};

const parseRepo = (fullName: string): RepoInfo => {
  const [owner, repo] = fullName.split('/');
  if (!owner || !repo) {
    throw new Error('Invalid repo name');
  }
  return { owner, repo };
};

export const findOrCreateStateIssue = async (
  octokit: Octokit,
  repoFullName: string,
  title: string,
  initialBody: string
): Promise<StateIssue> => {
  const { owner, repo } = parseRepo(repoFullName);

  const list = await octokit.request('GET /repos/{owner}/{repo}/issues', {
    owner,
    repo,
    state: 'all',
    per_page: 100
  });

  const existing = list.data.find((issue) => issue.title === title);
  if (existing) {
    return {
      number: existing.number,
      body: existing.body || '',
      title: existing.title
    };
  }

  const created = await octokit.request('POST /repos/{owner}/{repo}/issues', {
    owner,
    repo,
    title,
    body: initialBody
  });

  return {
    number: created.data.number,
    body: created.data.body || '',
    title: created.data.title
  };
};

export const updateIssueBody = async (
  octokit: Octokit,
  repoFullName: string,
  issueNumber: number,
  body: string
): Promise<void> => {
  const { owner, repo } = parseRepo(repoFullName);
  await octokit.request('PATCH /repos/{owner}/{repo}/issues/{issue_number}', {
    owner,
    repo,
    issue_number: issueNumber,
    body
  });
};

export const createRepoIssue = async (params: {
  octokit: Octokit;
  repoFullName: string;
  title: string;
  body: string;
}): Promise<number> => {
  const { owner, repo } = parseRepo(params.repoFullName);
  const response = await params.octokit.request('POST /repos/{owner}/{repo}/issues', {
    owner,
    repo,
    title: params.title,
    body: params.body
  });

  return response.data.number;
};
