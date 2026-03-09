export const prompts = {
  setupForksSenior: `Optional (unused when working directly on upstream).
You are the senior dev agent (Codex). Create a fork of {{DEVTEAM_UPSTREAM_REPO}} into your GitHub account.
Steps:
1) gh repo fork {{DEVTEAM_UPSTREAM_REPO}} --clone=false
2) Confirm with: gh repo view {{config.user}}/{{repoBaseName}}
Return: FORK_URL=<url>`,
  setupForksJunior: `Optional (unused when working directly on upstream).
You are the junior dev agent (Codex). Create a fork of {{DEVTEAM_UPSTREAM_REPO}} into your GitHub account.
Steps:
1) gh repo fork {{DEVTEAM_UPSTREAM_REPO}} --clone=false
2) Confirm with: gh repo view {{config.user}}/{{repoBaseName}}
Return: FORK_URL=<url>`,
  startNewSprint: `Create a new Linear issue in project "{{LINEAR_PROJECT}}" and team "{{LINEAR_TEAM}}".
Title: "Sprint #{{sprint_number}} Planning"
Description:
- Summary of sprint goals
- Call for senior/junior to propose 2–3 features
- Reference previous sprint if sprint_number > 1
Use Linear API: save_issue
Return: ISSUE_ID=<identifier>`,
  startDebateSenior: `Post a comment in Linear issue {{planning_issue}} proposing 2–3 features.
Consider architecture, TanStack patterns, MSW mocks.
Use Linear API: create_comment`,
  continueDebateSenior: `Continue debate in Linear issue {{planning_issue}}.
Respond to junior’s last comment.
If consensus reached, end with "CONSENSUS_REACHED".
Use Linear API: create_comment`,
  continueDebateJunior: `Continue debate in Linear issue {{planning_issue}}.
Respond to senior with suggestions/concerns.
Do NOT declare consensus.
Use Linear API: create_comment`,
  consensusCheck: `Read comments from Linear issue {{planning_issue}}.
Decide CONSENSUS=true/false.
Return: CONSENSUS=true or CONSENSUS=false`,
  startDevTasking: `Read debate summary.
Create 2–4 Linear issues (Todo) for sprint tasks.
Each task must have: title, description, assignee, branch name.
Return:
TASK|{{issue_id}}|{{assignee}}|{{branch}}`,
  checkDevProgressImplement: `Implement ONLY the feature in Linear issue {{issue}}.
Steps:
1) Mark issue In Progress (Linear save_issue stateName="In Progress")
2) Clone or enter the upstream repo
3) Read issue details (Linear get_issue)
4) Create branch: {{branch}}
5) Implement feature only (atomic commits)
6) Push branch to upstream
7) Create PR: gh pr create --repo {{DEVTEAM_UPSTREAM_REPO}} --head {{branch}}
8) Request review from {{reviewerUser}}
9) Comment on Linear issue + planning issue
Return: PR_CREATED=<number>`,
  processReview: `Review PR #{{pr}} on {{DEVTEAM_UPSTREAM_REPO}}.
Steps:
1) gh pr view {{pr}}
2) gh pr diff {{pr}}
3) gh api repos/{{DEVTEAM_UPSTREAM_REPO}}/pulls/{{pr}}/comments
Write a substantive review:
- code quality, TS types, component structure
- bugs/edge cases, perf
Post 1–3 inline comments.
If shouldApprove: gh pr review ... --approve
Else: gh pr review ... --request-changes
Comment in Linear planning issue.
Return: REVIEW_RESULT=approved or REVIEW_RESULT=changes_requested`,
  authorFixTask: `Read review feedback for PR #{{pr}}.
Apply fixes on same branch, push updates.
Comment in Linear issue: FIXES_PUSHED=true
Return: FIXES_PUSHED=true`,
  processMergeConflictRebase: `If PR #{{pr}} has conflicts, rebase on upstream main and force-push.
Comment in Linear when done.
Return: REBASE_DONE=true`,
  processMergeLinearUpdate: `After host merges PR:
- Mark related Linear issues Done
- Post summary in planning issue`,
  finishSprint: `Mark all sprint tasks Done in Linear.
Post final summary in planning issue.
Archive sprint history.`
};
