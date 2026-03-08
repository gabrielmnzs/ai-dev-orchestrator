import { Octokit } from '@octokit/core';
import { findOrCreateStateIssue, updateIssueBody } from '../github/issues';

export type SprintState =
  | 'IDLE'
  | 'PLANNING'
  | 'DEBATE'
  | 'TASKING'
  | 'DEV'
  | 'REVIEW'
  | 'AUTHOR_FIXES'
  | 'MERGE'
  | 'COMPLETE';

export type TaskState = 'Todo' | 'In Progress' | 'Review' | 'Merged';

export type OrchestratorState = {
  sprint: {
    number: number;
    state: SprintState;
    planningIssueLinearId: string | null;
    planningIssueLinearKey: string | null;
  };
  tasks: Array<{
    linearId: string | null;
    linearKey: string | null;
    githubIssueNumber: number | null;
    githubPrNumber: number | null;
    assignee: 'senior' | 'junior';
    branch: string;
    reviewRound: number;
    status: TaskState;
  }>;
  agents: {
    senior: string;
    junior: string;
    orchestrator: string;
  };
  config: {
    branchPattern: string;
    schedulerMinutes: number;
  };
};

export const createInitialState = (params: {
  senior: string;
  junior: string;
  orchestrator: string;
  schedulerMinutes: number;
}): OrchestratorState => ({
  sprint: {
    number: 1,
    state: 'IDLE',
    planningIssueLinearId: null,
    planningIssueLinearKey: null
  },
  tasks: [],
  agents: {
    senior: params.senior,
    junior: params.junior,
    orchestrator: params.orchestrator
  },
  config: {
    branchPattern: 'feat/<slug>',
    schedulerMinutes: params.schedulerMinutes
  }
});

export const loadState = async (params: {
  octokit: Octokit;
  repoFullName: string;
  issueTitle: string;
  initialState: OrchestratorState;
}): Promise<{ state: OrchestratorState; issueNumber: number }> => {
  const initialBody = JSON.stringify(params.initialState, null, 2);
  const issue = await findOrCreateStateIssue(
    params.octokit,
    params.repoFullName,
    params.issueTitle,
    initialBody
  );

  const parsed = issue.body ? JSON.parse(issue.body) : params.initialState;
  return { state: parsed, issueNumber: issue.number };
};

export const persistState = async (params: {
  octokit: Octokit;
  repoFullName: string;
  issueNumber: number;
  state: OrchestratorState;
}): Promise<void> => {
  const body = JSON.stringify(params.state, null, 2);
  await updateIssueBody(params.octokit, params.repoFullName, params.issueNumber, body);
};
