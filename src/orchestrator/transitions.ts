import { Octokit } from '@octokit/core';
import { LinearClient } from '../linear/client';
import { createIssue } from '../linear/issues';
import { logger } from '../utils/logger';
import { OrchestratorState, persistState, SprintState } from './state';

type OrchestratorDeps = {
  octokit: Octokit;
  linearClient: LinearClient;
  repoFullName: string;
  issueNumber: number;
  linearTeamName: string;
  linearProjectName: string;
};

export class Orchestrator {
  private state: OrchestratorState;
  private deps: OrchestratorDeps;

  constructor(state: OrchestratorState, deps: OrchestratorDeps) {
    this.state = state;
    this.deps = deps;
  }

  getState(): OrchestratorState {
    return this.state;
  }

  private async updateState(state: OrchestratorState): Promise<void> {
    this.state = state;
    await persistState({
      octokit: this.deps.octokit,
      repoFullName: this.deps.repoFullName,
      issueNumber: this.deps.issueNumber,
      state
    });
  }

  async handleGitHubEvent(event: string, payload: Record<string, unknown>): Promise<void> {
    logger.info('GitHub event received', { event });
    logger.info('GitHub payload keys', { keys: Object.keys(payload) });
  }

  async handleLinearEvent(payload: Record<string, unknown>): Promise<void> {
    logger.info('Linear event received', { keys: Object.keys(payload) });
  }

  async tick(): Promise<void> {
    const currentState = this.state.sprint.state;
    logger.info('Scheduler tick', { state: currentState });

    if (currentState === 'IDLE') {
      await this.startPlanning();
      return;
    }

    if (currentState === 'PLANNING') {
      await this.startDebate();
      return;
    }

    if (currentState === 'DEBATE') {
      logger.info('DEBATE state - waiting for consensus');
      return;
    }

    if (currentState === 'TASKING') {
      logger.info('TASKING state - pending implementation');
      return;
    }

    if (currentState === 'DEV') {
      logger.info('DEV state - awaiting PRs');
      return;
    }

    if (currentState === 'REVIEW') {
      logger.info('REVIEW state - awaiting reviews');
      return;
    }

    if (currentState === 'AUTHOR_FIXES') {
      logger.info('AUTHOR_FIXES state - awaiting fixes');
      return;
    }

    if (currentState === 'MERGE') {
      logger.info('MERGE state - awaiting merge');
      return;
    }

    if (currentState === 'COMPLETE') {
      logger.info('COMPLETE state - resetting to IDLE');
      await this.resetSprint();
    }
  }

  private async startPlanning(): Promise<void> {
    const sprintNumber = this.state.sprint.number;
    const planningIssue = await createIssue({
      client: this.deps.linearClient,
      teamName: this.deps.linearTeamName,
      projectName: this.deps.linearProjectName,
      title: `Sprint #${sprintNumber} Planning`,
      description:
        'Sprint planning started. Please propose 2-3 features for this sprint. '
        + 'Senior and Junior should debate and reach consensus.'
    });

    const nextState: OrchestratorState = {
      ...this.state,
      sprint: {
        ...this.state.sprint,
        state: 'PLANNING',
        planningIssueLinearId: planningIssue.id,
        planningIssueLinearKey: planningIssue.identifier
      }
    };

    await this.updateState(nextState);
    logger.info('Planning issue created', { planningIssue });
  }

  private async startDebate(): Promise<void> {
    const nextState = this.setSprintState('DEBATE');
    await this.updateState(nextState);
    logger.info('Moved to DEBATE');
  }

  private async resetSprint(): Promise<void> {
    const nextState: OrchestratorState = {
      ...this.state,
      sprint: {
        number: this.state.sprint.number + 1,
        state: 'IDLE',
        planningIssueLinearId: null,
        planningIssueLinearKey: null
      },
      tasks: []
    };

    await this.updateState(nextState);
  }

  private setSprintState(state: SprintState): OrchestratorState {
    return {
      ...this.state,
      sprint: {
        ...this.state.sprint,
        state
      }
    };
  }
}
