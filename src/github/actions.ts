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

export const dispatchWorkflow = async (params: {
  octokit: Octokit;
  repoFullName: string;
  workflowFile: string;
  ref: string;
  inputs: Record<string, string>;
}): Promise<void> => {
  const { owner, repo } = parseRepo(params.repoFullName);
  await params.octokit.request('POST /repos/{owner}/{repo}/actions/workflows/{workflow_id}/dispatches', {
    owner,
    repo,
    workflow_id: params.workflowFile,
    ref: params.ref,
    inputs: params.inputs
  });
};
