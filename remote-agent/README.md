# Remote AI Agent

AI-powered remote task execution system for autonomous testing and deployment in staging environment.

## Overview

The Remote AI Agent runs on your **STAGING PC (Windows)** and allows Claude Code on **DEV (Mac)** to execute tasks autonomously without manual intervention.

### Architecture

```
DEV (Mac) - Claude Code
    ↓ HTTP/HTTPS (via ngrok)
    ↓ Natural language instructions
STAGING PC - Remote AI Agent
    ↓ Claude API interprets instructions
    ↓ Generates & validates commands
    ↓ Executes on Windows
    ↓ Returns results
```

## What Can It Do?

The agent interprets natural language instructions and executes them safely:

**Examples:**
- "Check if Python service is running"
- "Run all tests and report failures"
- "Restart the uvicorn service"
- "Show last 50 lines of error log"
- "Test database connection"
- "Pull latest code from main branch"

## Key Features

### 1. Natural Language Interface
No need to remember specific commands - just describe what you want:

```typescript
// On Mac DEV
import { getStagingAgentClient } from '@/lib/staging-agent-client';

const client = getStagingAgentClient();
await client.executeTask("Check if IB Gateway is running and test the connection");
```

### 2. AI-Powered Command Generation
Claude API interprets your instruction and generates appropriate Windows commands:

```
Instruction: "Check if Python service is running"
↓
AI generates:
- tasklist | findstr uvicorn
- netstat -ano | findstr :8000
↓
Agent executes and returns results
```

### 3. Safety Guardrails

**Whitelist of Allowed Operations:**
- check status
- read logs
- run tests
- restart service
- check ib gateway
- git operations (pull, status)
- system info

**Forbidden Patterns:**
- `rm -rf`, `del /f`, `format`
- `DROP DATABASE`, `DROP TABLE`
- Other destructive operations

### 4. Dry Run Mode
Preview commands before execution:

```typescript
const result = await client.executeTask(
  "Delete all temp files",
  true  // dry run - doesn't execute
);

console.log("Would execute:", result.commands);
```

### 5. Complete Audit Trail
All commands logged with timestamps:

```
2025-11-03 14:30:15 - [20251103_143015] Received task: Check if Python service is running
2025-11-03 14:30:16 - [20251103_143015] Executing command: tasklist | findstr uvicorn
2025-11-03 14:30:17 - [20251103_143015] Task complete - executed 2 commands
```

## Installation

See [SETUP_WINDOWS.md](./SETUP_WINDOWS.md) for complete Windows setup instructions.

**Quick Start:**

```powershell
# On STAGING PC (Windows)
cd C:\Users\[YourUsername]\ma-tracker-app\remote-agent

# Install dependencies
pip install -r requirements.txt

# Configure
copy .env.example .env
notepad .env  # Add API keys

# Start agent
python main.py
```

## Usage from Mac DEV

### 1. Configure Connection

```bash
# On Mac DEV
# Add to .env.local:
STAGING_AGENT_URL=https://your-ngrok-url.ngrok-free.dev
STAGING_AGENT_API_KEY=your-secure-key-here
```

### 2. Use TypeScript Client

```typescript
import { getStagingAgentClient } from '@/lib/staging-agent-client';

const client = getStagingAgentClient();

// Check status
const status = await client.getStatus();
console.log('Python service:', status.python_service_running);
console.log('IB Gateway:', status.ib_gateway_reachable);

// Execute task
const result = await client.executeTask(
  "Run pytest and show any failures"
);

console.log('AI interpreted as:', result.ai_interpretation);
console.log('Commands executed:', result.commands);
console.log('Results:', result.results);

// Helper methods
await client.checkPythonService();
await client.runTests();
await client.restartPythonService();
await client.deployFromMain();
```

### 3. Helper Functions

```typescript
import { isStagingReady, executeTaskWithRetry } from '@/lib/staging-agent-client';

// Check if staging is ready
const { ready, issues } = await isStagingReady();
if (!ready) {
  console.log('Issues:', issues);
}

// Execute with automatic retry
const result = await executeTaskWithRetry(
  "Start Python service if not running"
);
```

## API Reference

### POST /execute-task

Execute a task from natural language instruction.

**Request:**
```json
{
  "instruction": "Check if Python service is running",
  "dry_run": false,
  "max_commands": 5
}
```

**Headers:**
```
Content-Type: application/json
X-API-Key: your-api-key
```

**Response:**
```json
{
  "task_id": "20251103_143015",
  "instruction": "Check if Python service is running",
  "ai_interpretation": "Check for uvicorn process",
  "commands": ["tasklist | findstr uvicorn"],
  "results": [
    {
      "command": "tasklist | findstr uvicorn",
      "stdout": "python.exe    4532  Services    0   145,232 K",
      "stderr": "",
      "return_code": 0,
      "duration_ms": 234
    }
  ],
  "status": "completed",
  "timestamp": "2025-11-03T14:30:17Z",
  "dry_run": false
}
```

### GET /status

Get detailed agent status.

**Response:**
```json
{
  "status": "running",
  "agent_version": "1.0.0",
  "uptime": "2:14:32",
  "environment": "STAGING",
  "python_service_running": true,
  "ib_gateway_reachable": true
}
```

### GET /health

Health check.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-03T14:30:00Z"
}
```

### GET /logs?lines=100

Get recent log entries.

**Response:**
```json
{
  "lines": 100,
  "total_lines": 1532,
  "logs": "2025-11-03 14:30:15 - INFO - Starting task...\n..."
}
```

## Use Cases

### Autonomous Testing

```typescript
// I (Claude Code) can now test staging without bothering you!

const client = getStagingAgentClient();

// Run tests
const testResult = await client.runTests();
if (testResult.results.some(r => r.return_code !== 0)) {
  // Tests failed - check logs
  const logs = await client.viewServiceLogs(100);
  console.log('Test failures:', logs);
}
```

### Automated Deployment

```typescript
// Deploy latest code to staging
const result = await client.deployFromMain();

// Verify deployment
await client.checkPythonService();
await client.runTests();

// If all good, tell you it's ready for Luis
console.log('Staging validated - ready to push to PROD');
```

### Health Monitoring

```typescript
// Periodic health checks
setInterval(async () => {
  const { ready, issues } = await isStagingReady();
  if (!ready) {
    console.log('Staging issues detected:', issues);
    // Auto-fix common issues
    await client.restartPythonService();
  }
}, 5 * 60 * 1000); // Every 5 minutes
```

### Debug Assistance

```typescript
// Something's not working - gather debug info
const client = getStagingAgentClient();

const debugInfo = await client.executeTask(`
  Gather debugging information:
  - Check Python service status
  - Show last 50 log lines
  - Check disk space
  - Show network connections on port 8000
`);

console.log('Debug info:', debugInfo.results);
```

## Security

### Authentication
- Requires `X-API-Key` header
- API key stored in `.env`
- Generate secure key: `python -c "import secrets; print(secrets.token_urlsafe(32))"`

### Command Validation
- Whitelist of allowed operations
- Forbidden pattern detection
- All commands logged

### Network Security
- Exposed via ngrok tunnel only
- No direct internet access
- HTTPS encryption

### Rate Limiting
- 30 second timeout per command
- Max 5 commands per task
- Logging for audit trail

## Troubleshooting

### Agent Won't Start

```powershell
# Check Python environment
python --version  # Should be 3.9+

# Check dependencies
pip list | findstr anthropic

# Check .env file
type .env  # Verify ANTHROPIC_API_KEY is set
```

### Can't Connect from Mac

```bash
# Test ngrok tunnel
curl https://your-ngrok-url.ngrok-free.dev/health

# Check API key
echo $STAGING_AGENT_API_KEY
```

### Commands Failing

```powershell
# Check agent logs
Get-Content remote-agent.log -Tail 50

# Or via API
curl https://your-ngrok-url/logs?lines=50
```

## Development

### Adding New Allowed Operations

Edit `main.py`:

```python
ALLOWED_OPERATIONS = [
    # ... existing operations
    "your new operation",
]
```

### Modifying Command Timeout

Edit `execute_command()` in `main.py`:

```python
result = subprocess.run(
    ["powershell", "-Command", command],
    timeout=60  # Change from 30 to 60 seconds
)
```

### Custom Command Validation

Add custom validation in `check_command_safety()`:

```python
def check_command_safety(command: str) -> tuple[bool, str]:
    # Add your custom checks
    if "sensitive-file" in command.lower():
        return False, "Cannot access sensitive files"

    # ... existing checks
```

## Cost

**Claude API Usage:**
- ~$0.01 per task (Sonnet 4.5)
- Typical: 500-1000 tokens per interpretation
- Monthly cost: ~$5-10 for heavy usage

## Roadmap

### Planned Features
- [ ] Scheduled tasks (cron-like)
- [ ] Task history and replay
- [ ] Multi-step workflows
- [ ] Approval workflow for risky operations
- [ ] Integration with monitoring tools
- [ ] WebSocket for real-time updates

### Under Consideration
- [ ] Support for Mac staging environment
- [ ] Docker container deployment
- [ ] Multi-agent orchestration
- [ ] Machine learning for command optimization

## Support

**Logs:** `remote-agent.log` in agent directory

**Health Check:** `http://localhost:8001/health`

**GitHub Issues:** https://github.com/donkeithross3-commits/ma-tracker-app/issues

## License

Proprietary - M&A Tracker App
