# AI Dev Orchestrator

Node orchestrator for coordinating a multi-agent Codex dev team with Linear and GitHub.

## Requirements

- Node.js 20+
- Render Web Service (or similar)

## Environment variables

- GITHUB_APP_ID
- GITHUB_APP_PRIVATE_KEY
- GITHUB_APP_INSTALLATION_ID
- GITHUB_UPSTREAM_REPO
- ORCHESTRATOR_REPO
- AGENT_WORKFLOW_FILE (optional, default ai-dev-agent.yml)
- GITHUB_ORCH_USER
- DEV_SENIOR_USER
- DEV_JUNIOR_USER
- LINEAR_API_KEY
- LINEAR_TEAM_NAME
- LINEAR_PROJECT_NAME
- LINEAR_SENIOR_USER_ID (optional, assigns Linear tasks to senior)
- LINEAR_JUNIOR_USER_ID (optional, assigns Linear tasks to junior)
- STATE_ISSUE_TITLE
- GITHUB_WEBHOOK_SECRET (recommended; if omitted, GitHub signature validation is skipped)
- LINEAR_WEBHOOK_SECRET (recommended; if omitted, Linear signature validation is skipped)

## Scripts

- `npm run dev`
- `npm run build`
- `npm start`

## Endpoints

- `GET /health`
- `GET /status`
- `POST /simulate`
