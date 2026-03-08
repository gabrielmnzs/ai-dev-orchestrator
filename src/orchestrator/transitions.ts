import { Octokit } from '@octokit/core';
import { LinearClient } from '../linear/client';
import { createComment, createIssue, getIssueComments, updateIssueState } from '../linear/issues';
import { createRepoIssue } from '../github/issues';
import { dispatchWorkflow } from '../github/actions';
import { logger } from '../utils/logger';
import { OrchestratorState, persistState, SprintState } from './state';
import { prompts } from './prompts';

type OrchestratorDeps = {
  octokit: Octokit;
  linearClient: LinearClient;
  repoFullName: string;
  orchestratorRepo: string;
  agentWorkflowFile: string;
  issueNumber: number;
  linearTeamName: string;
  linearProjectName: string;
  linearSeniorUserId?: string;
  linearJuniorUserId?: string;
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

  async simulate(): Promise<{ ok: boolean; message: string }> {
    if (!this.state.sprint.planningIssueLinearId) {
      return { ok: false, message: 'planning issue not created yet' };
    }

    if (this.state.tasks.length > 0) {
      return { ok: false, message: 'tasks already exist for this sprint' };
    }

    await this.setConsensusReached();
    await this.createTasksFromDebate();
    return { ok: true, message: 'consensus simulated and tasks created' };
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
          await this.postPlanningComment(
            `PR #${prNumber} opened for Linear ${linearKey}.`
          );
        }
      }

      if (action === 'closed' && merged) {
        const linearKey = this.extractLinearKey(prBody, prTitle);
        if (linearKey) {
          await this.markTaskMerged(linearKey);
          await this.postPlanningComment(
            `PR #${prNumber} merged for Linear ${linearKey}.`
          );
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
        await this.postPlanningComment(`PR review approved for Linear ${linearKey}.`);
      }

      if (state === 'changes_requested') {
        await this.setSprintStateAndPersist('AUTHOR_FIXES');
        await this.postPlanningComment(`PR changes requested for Linear ${linearKey}.`);
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
      const authorId = this.extractCommentAuthorId(payload);

      if (!body || !issueId) {
        return;
      }

      const isPlanningIssue = issueId === this.state.sprint.planningIssueLinearId;
      if (isPlanningIssue && authorId) {
        const uniqueAuthors = new Set(this.state.sprint.planningCommentAuthors);
        uniqueAuthors.add(authorId);
        if (uniqueAuthors.size !== this.state.sprint.planningCommentAuthors.length) {
          const nextState: OrchestratorState = {
            ...this.state,
            sprint: {
              ...this.state.sprint,
              planningCommentAuthors: Array.from(uniqueAuthors)
            }
          };
          await this.updateState(nextState);
        }
      }

      if (isPlanningIssue && body.includes('CONSENSUS_REACHED')) {
        const comments = await getIssueComments({
          client: this.deps.linearClient,
          issueId
        });

        if (comments.length >= 2 && this.state.sprint.planningCommentAuthors.length >= 2) {
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
      await this.dispatchPendingWorkflows();
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
    await this.postPlanningComment('Sprint planning started. Please propose 2-3 features.');
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
      const assigneeId = index % 2 === 0
        ? this.deps.linearSeniorUserId
        : this.deps.linearJuniorUserId;
      const reviewerUser = index % 2 === 0
        ? this.state.agents.junior
        : this.state.agents.senior;
      const issue = await createIssue({
        client: this.deps.linearClient,
        teamName: this.deps.linearTeamName,
        projectName: this.deps.linearProjectName,
        title,
        description,
        assigneeId
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
        reviewerUser,
        reviewRound: 0,
        status: 'Todo',
        workflowDispatched: false
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
    await this.postPlanningComment(
      `Created ${tasks.length} tasks and moved sprint to DEV.`
    );
    await this.dispatchPendingWorkflows();
  }

  private async resetSprint(): Promise<void> {
    const nextState: OrchestratorState = {
      ...this.state,
      sprint: {
        number: this.state.sprint.number + 1,
        state: 'IDLE',
        planningIssueLinearId: null,
        planningIssueLinearKey: null,
        consensusReached: false,
        planningCommentAuthors: []
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
    await this.postPlanningComment('Consensus reached. Moving to TASKING.');
  }

  private async postPlanningComment(body: string): Promise<void> {
    const planningIssueId = this.state.sprint.planningIssueLinearId;
    if (!planningIssueId) {
      return;
    }

    await createComment({
      client: this.deps.linearClient,
      issueId: planningIssueId,
      body
    });
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

  private async dispatchPendingWorkflows(): Promise<void> {
    const pendingTasks = this.state.tasks.filter(
      (task) => !task.workflowDispatched && task.linearKey && !task.githubPrNumber
    );

    if (pendingTasks.length === 0) {
      return;
    }

    for (const task of pendingTasks) {
      const assigneeUser = task.assignee === 'senior'
        ? this.state.agents.senior
        : this.state.agents.junior;
      const repoBaseName = this.deps.repoFullName.split('/')[1] || '';
      const prompt = this.interpolatePrompt(prompts.checkDevProgressImplement, {
        issue: task.linearKey || '',
        branch: task.branch,
        reviewerUser: task.reviewerUser,
        DEVTEAM_UPSTREAM_REPO: this.deps.repoFullName,
        config: { user: assigneeUser },
        repoBaseName
      });

      await dispatchWorkflow({
        octokit: this.deps.octokit,
        repoFullName: this.deps.orchestratorRepo,
        workflowFile: this.deps.agentWorkflowFile,
        ref: 'main',
        inputs: {
          agent: task.assignee,
          linear_issue: task.linearKey || '',
          branch: task.branch,
          prompt
        }
      });

      task.workflowDispatched = true;
      logger.info('Dispatched workflow for task', { linearKey: task.linearKey });
    }

    await this.updateState({ ...this.state, tasks: [...this.state.tasks] });
  }

  private interpolatePrompt(template: string, values: Record<string, unknown>): string {
    let output = template;
    const replaceAll = (key: string, value: string) => {
      output = output.split(`{{${key}}}`).join(value);
    };

    Object.entries(values).forEach(([key, value]) => {
      if (typeof value === 'string') {
        replaceAll(key, value);
        return;
      }

      if (typeof value === 'object' && value) {
        Object.entries(value as Record<string, unknown>).forEach(([nestedKey, nestedValue]) => {
          if (typeof nestedValue === 'string') {
            replaceAll(`${key}.${nestedKey}`, nestedValue);
          }
        });
      }
    });

    return output;
  }

  private extractCommentAuthorId(payload: Record<string, unknown>): string | null {
    const data = payload['data'] as Record<string, unknown> | undefined;
    const user = data?.['user'] as Record<string, unknown> | undefined;
    const actor = payload['actor'] as Record<string, unknown> | undefined;
    const userId = data?.['userId'] as string | undefined;
    const userIdFromUser = user?.['id'] as string | undefined;
    const actorId = actor?.['id'] as string | undefined;
    return userId || userIdFromUser || actorId || null;
  }
}
