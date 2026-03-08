import { Octokit } from '@octokit/core';
import { LinearClient } from '../linear/client';
import { createIssue, getIssueComments, updateIssueState } from '../linear/issues';
import { createRepoIssue } from '../github/issues';
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
    const action = payload['action'] as string | undefined;

    if (event === 'pull_request') {
      const pr = payload['pull_request'] as Record<string, unknown> | undefined;
      if (!pr) {
        return;
      }

      const prNumber = pr['number'] as number | undefined;
      const prBody = pr['body'] as string | undefined;
      const prTitle = pr['title'] as string | undefined;
      const merged = pr['merged'] as boolean | undefined;

      if (!prNumber) {
        return;
      }

      if (action === 'opened' || action === 'reopened' || action === 'synchronize') {
        const linearKey = this.extractLinearKey(prBody, prTitle);
        if (linearKey) {
          await this.attachPrToTask(linearKey, prNumber);
        }
      }

      if (action === 'closed' && merged) {
        const linearKey = this.extractLinearKey(prBody, prTitle);
        if (linearKey) {
          await this.markTaskMerged(linearKey);
        }
      }
    }

    if (event === 'pull_request_review') {
      const review = payload['review'] as Record<string, unknown> | undefined;
      const pr = payload['pull_request'] as Record<string, unknown> | undefined;
      const prBody = pr?.['body'] as string | undefined;
      const prTitle = pr?.['title'] as string | undefined;
      const state = (review?.['state'] as string | undefined)?.toLowerCase();
      const linearKey = this.extractLinearKey(prBody, prTitle);

      if (!linearKey || !state) {
        return;
      }

      if (state === 'approved') {
        await this.incrementReviewRound(linearKey);
      }

      if (state === 'changes_requested') {
        await this.setSprintStateAndPersist('AUTHOR_FIXES');
      }
    }
  }

  async handleLinearEvent(payload: Record<string, unknown>): Promise<void> {
    const type = payload['type'] as string | undefined;
    const action = payload['action'] as string | undefined;
    const data = payload['data'] as Record<string, unknown> | undefined;

    if (type === 'Comment' && action === 'create') {
      const body = data?.['body'] as string | undefined;
      const issue = data?.['issue'] as Record<string, unknown> | undefined;
      const issueId = issue?.['id'] as string | undefined;

      if (!body || !issueId) {
        return;
      }

      const isPlanningIssue = issueId === this.state.sprint.planningIssueLinearId;
      if (isPlanningIssue && body.includes('CONSENSUS_REACHED')) {
        const comments = await getIssueComments({
          client: this.deps.linearClient,
          issueId
        });

        if (comments.length >= 2) {
          await this.setConsensusReached();
        }
      }
    }
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
      if (this.state.tasks.length > 0) {
        await this.setSprintStateAndPersist('DEV');
        return;
      }
      await this.createTasksFromDebate();
      return;
    }

    if (currentState === 'DEV') {
      if (this.state.tasks.length > 0 && this.state.tasks.every((task) => task.githubPrNumber)) {
        await this.setSprintStateAndPersist('REVIEW');
        return;
      }
      logger.info('DEV state - awaiting PRs');
      return;
    }

    if (currentState === 'REVIEW') {
      if (this.state.tasks.length > 0 && this.state.tasks.every((task) => task.status === 'Merged')) {
        await this.setSprintStateAndPersist('COMPLETE');
        return;
      }
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
        planningIssueLinearKey: planningIssue.identifier,
        consensusReached: false
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

  private async createTasksFromDebate(): Promise<void> {
    const planningIssueId = this.state.sprint.planningIssueLinearId;
    if (!planningIssueId) {
      return;
    }

    if (!this.state.sprint.consensusReached) {
      logger.info('Consensus not reached yet, skipping task creation');
      return;
    }

    const comments = await getIssueComments({
      client: this.deps.linearClient,
      issueId: planningIssueId
    });

    const candidateLines = comments
      .flatMap((comment) => comment.split('\n'))
      .map((line) => line.trim())
      .filter((line) => line.startsWith('-') || line.startsWith('*') || line.startsWith('•'))
      .map((line) => line.replace(/^[-*•]\s*/, '').trim())
      .filter(Boolean);

    const uniqueLines = Array.from(new Set(candidateLines));
    const taskTitles = uniqueLines.length > 0
      ? uniqueLines.slice(0, 3)
      : [`Sprint #${this.state.sprint.number} Task 1`, `Sprint #${this.state.sprint.number} Task 2`];

    const tasks = [] as OrchestratorState['tasks'];

    for (const [index, title] of taskTitles.entries()) {
      const description = `Derived from planning consensus.\n\n- ${title}`;
      const issue = await createIssue({
        client: this.deps.linearClient,
        teamName: this.deps.linearTeamName,
        projectName: this.deps.linearProjectName,
        title,
        description
      });

      const slug = this.slugify(title);
      const branch = `feat/${slug}`;
      const githubIssueNumber = await createRepoIssue({
        octokit: this.deps.octokit,
        repoFullName: this.deps.repoFullName,
        title: `[Linear] ${title}`,
        body: `Linked Linear issue: ${issue.identifier}\n\nPlanning: ${this.state.sprint.planningIssueLinearKey}`
      });

      tasks.push({
        linearId: issue.id,
        linearKey: issue.identifier,
        githubIssueNumber,
        githubPrNumber: null,
        assignee: index % 2 === 0 ? 'senior' : 'junior',
        branch,
        reviewRound: 0,
        status: 'Todo'
      });
    }

    const nextState: OrchestratorState = {
      ...this.state,
      tasks,
      sprint: {
        ...this.state.sprint,
        state: 'DEV'
      }
    };

    await this.updateState(nextState);
    logger.info('Tasks created from debate', { count: tasks.length });
  }

  private async resetSprint(): Promise<void> {
    const nextState: OrchestratorState = {
      ...this.state,
      sprint: {
        number: this.state.sprint.number + 1,
        state: 'IDLE',
        planningIssueLinearId: null,
        planningIssueLinearKey: null,
        consensusReached: false
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

  private async setConsensusReached(): Promise<void> {
    if (this.state.sprint.consensusReached) {
      return;
    }

    const nextState: OrchestratorState = {
      ...this.state,
      sprint: {
        ...this.state.sprint,
        consensusReached: true,
        state: 'TASKING'
      }
    };

    await this.updateState(nextState);
    logger.info('Consensus reached, moving to TASKING');
  }

  private async setSprintStateAndPersist(state: SprintState): Promise<void> {
    const nextState = this.setSprintState(state);
    await this.updateState(nextState);
  }

  private extractLinearKey(body?: string, title?: string): string | null {
    const target = `${title || ''}\n${body || ''}`;
    const match = target.match(/([A-Z]+-\d+)/);
    return match ? match[1] : null;
  }

  private slugify(input: string): string {
    return input
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
      .slice(0, 60);
  }

  private async attachPrToTask(linearKey: string, prNumber: number): Promise<void> {
    const taskIndex = this.state.tasks.findIndex((task) => task.linearKey === linearKey);
    if (taskIndex === -1) {
      return;
    }

    const task = this.state.tasks[taskIndex];
    if (task.githubPrNumber === prNumber) {
      return;
    }

    const updatedTask = { ...task, githubPrNumber: prNumber, status: 'Review' as const };
    const tasks = [...this.state.tasks];
    tasks[taskIndex] = updatedTask;

    if (task.linearId) {
      await updateIssueState({
        client: this.deps.linearClient,
        issueId: task.linearId,
        stateName: 'In Progress'
      });
    }

    await this.updateState({ ...this.state, tasks });
    logger.info('Attached PR to task', { linearKey, prNumber });
  }

  private async markTaskMerged(linearKey: string): Promise<void> {
    const taskIndex = this.state.tasks.findIndex((task) => task.linearKey === linearKey);
    if (taskIndex === -1) {
      return;
    }

    const task = this.state.tasks[taskIndex];
    const updatedTask = { ...task, status: 'Merged' as const };
    const tasks = [...this.state.tasks];
    tasks[taskIndex] = updatedTask;

    if (task.linearId) {
      await updateIssueState({
        client: this.deps.linearClient,
        issueId: task.linearId,
        stateName: 'Done'
      });
    }

    await this.updateState({ ...this.state, tasks });
    logger.info('Task merged', { linearKey });
  }

  private async incrementReviewRound(linearKey: string): Promise<void> {
    const taskIndex = this.state.tasks.findIndex((task) => task.linearKey === linearKey);
    if (taskIndex === -1) {
      return;
    }

    const task = this.state.tasks[taskIndex];
    const updatedTask = { ...task, reviewRound: task.reviewRound + 1 };
    const tasks = [...this.state.tasks];
    tasks[taskIndex] = updatedTask;

    await this.updateState({ ...this.state, tasks });
    logger.info('Review round incremented', { linearKey, reviewRound: updatedTask.reviewRound });
  }
}
