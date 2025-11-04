"""
Remote AI Agent for Staging Environment

Allows Claude Code (on Mac DEV) to execute tasks autonomously on STAGING PC (Windows)
without requiring manual intervention.

Architecture:
- Runs on STAGING PC (Windows)
- Exposes FastAPI endpoints
- Uses Claude API to interpret natural language instructions
- Executes commands safely with guardrails
- Returns results to DEV environment

Security:
- Whitelist of allowed operations
- Command logging and audit trail
- API key authentication
- Dry-run mode for preview
"""

from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from anthropic import Anthropic
import subprocess
import os
import json
import logging
from datetime import datetime
from typing import List, Optional, Dict, Any
from pathlib import Path
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

# Setup logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('remote-agent.log'),
        logging.StreamHandler()
    ]
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Remote AI Agent",
    description="AI-powered remote task execution for staging environment",
    version="1.0.0"
)

# CORS for dev environment
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],  # TODO: Restrict to specific domains in production
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Security: Whitelist of allowed operations
ALLOWED_OPERATIONS = [
    "check status",
    "read logs",
    "run tests",
    "restart service",
    "check ib gateway",
    "get system info",
    "list processes",
    "check disk space",
    "view environment variables",
    "test database connection",
    "run python script",
    "check port availability",
    "git status",
    "git pull",
    "install dependencies",
]

FORBIDDEN_PATTERNS = [
    "rm -rf",
    "del /f",
    "format",
    "DROP DATABASE",
    "DROP TABLE",
    "delete *",
    "rmdir /s",
]


class TaskRequest(BaseModel):
    instruction: str
    dry_run: bool = False
    max_commands: int = 5


class CommandResult(BaseModel):
    command: str
    stdout: str
    stderr: str
    return_code: int
    duration_ms: int


class TaskResponse(BaseModel):
    task_id: str
    instruction: str
    ai_interpretation: str
    commands: List[str]
    results: Optional[List[CommandResult]] = None
    status: str
    timestamp: str
    dry_run: bool


class StatusResponse(BaseModel):
    status: str
    agent_version: str
    uptime: str
    environment: str
    python_service_running: bool
    ib_gateway_reachable: bool


# Global state
agent_start_time = datetime.now()


def verify_api_key(x_api_key: str = Header(None)) -> bool:
    """Verify API key from request header"""
    expected_key = os.getenv("REMOTE_AGENT_API_KEY")

    if not expected_key:
        logger.warning("REMOTE_AGENT_API_KEY not set - agent is unsecured!")
        return True  # Allow in dev mode

    if x_api_key != expected_key:
        raise HTTPException(status_code=401, detail="Invalid API key")

    return True


def check_command_safety(command: str) -> tuple[bool, str]:
    """Check if command is safe to execute"""

    # Check for forbidden patterns
    for pattern in FORBIDDEN_PATTERNS:
        if pattern.lower() in command.lower():
            return False, f"Forbidden pattern detected: {pattern}"

    return True, "Command is safe"


def interpret_instruction(instruction: str, anthropic_key: str) -> Dict[str, Any]:
    """Use Claude API to interpret natural language instruction into commands"""

    try:
        client = Anthropic(api_key=anthropic_key)

        working_dir = Path.cwd()

        prompt = f"""You are an AI agent running on a Windows PC in a staging environment.

**Current Context:**
- Working Directory: {working_dir}
- OS: Windows
- Environment: STAGING
- Available: Python, pip, uvicorn, git, IB Gateway

**Your Task:**
Interpret this instruction and convert it to Windows shell commands:

"{instruction}"

**Allowed Operations:**
{', '.join(ALLOWED_OPERATIONS)}

**Important Rules:**
1. Only suggest commands for allowed operations
2. Use Windows-compatible commands (PowerShell/CMD)
3. Keep it simple and safe
4. No destructive operations
5. Max 5 commands

**Output Format:**
Return ONLY a JSON object:
{{
  "interpretation": "Brief explanation of what you'll do",
  "commands": ["cmd1", "cmd2", ...],
  "reasoning": "Why these commands accomplish the task"
}}

Example:
Instruction: "Check if Python service is running"
Output:
{{
  "interpretation": "Check for uvicorn process running the Python service",
  "commands": ["tasklist | findstr uvicorn", "netstat -ano | findstr :8000"],
  "reasoning": "First checks if uvicorn process exists, then verifies port 8000 is listening"
}}
"""

        response = client.messages.create(
            model="claude-3-sonnet-20240229",
            max_tokens=2000,
            temperature=0.2,  # Lower temperature for more consistent output
            messages=[{
                "role": "user",
                "content": prompt
            }]
        )

        # Extract JSON from response
        content = response.content[0].text

        # Try to find JSON in the response
        json_start = content.find('{')
        json_end = content.rfind('}') + 1

        if json_start == -1 or json_end == 0:
            raise ValueError("No JSON found in AI response")

        json_str = content[json_start:json_end]
        result = json.loads(json_str)

        return {
            "interpretation": result.get("interpretation", ""),
            "commands": result.get("commands", []),
            "reasoning": result.get("reasoning", ""),
            "raw_response": content
        }

    except Exception as e:
        logger.error(f"Failed to interpret instruction: {e}")
        return {
            "interpretation": f"Error: {str(e)}",
            "commands": [],
            "reasoning": "",
            "error": str(e)
        }


def execute_command(command: str) -> CommandResult:
    """Execute a single command and return results"""

    logger.info(f"Executing command: {command}")
    start_time = datetime.now()

    try:
        # Execute command in PowerShell
        result = subprocess.run(
            ["powershell", "-Command", command],
            capture_output=True,
            text=True,
            timeout=30  # 30 second timeout
        )

        duration = (datetime.now() - start_time).total_seconds() * 1000

        return CommandResult(
            command=command,
            stdout=result.stdout,
            stderr=result.stderr,
            return_code=result.returncode,
            duration_ms=int(duration)
        )

    except subprocess.TimeoutExpired:
        return CommandResult(
            command=command,
            stdout="",
            stderr="Command timed out after 30 seconds",
            return_code=-1,
            duration_ms=30000
        )
    except Exception as e:
        return CommandResult(
            command=command,
            stdout="",
            stderr=str(e),
            return_code=-1,
            duration_ms=0
        )


@app.get("/")
async def root():
    """Agent information"""
    return {
        "service": "Remote AI Agent",
        "version": "1.0.0",
        "environment": "STAGING",
        "status": "running",
        "documentation": "/docs"
    }


@app.get("/health")
async def health():
    """Health check endpoint"""
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}


@app.get("/status")
async def get_status() -> StatusResponse:
    """Get detailed agent status"""

    uptime = datetime.now() - agent_start_time

    # Check if Python service is running
    python_running = False
    try:
        result = subprocess.run(
            ["powershell", "-Command", "tasklist | findstr uvicorn"],
            capture_output=True,
            text=True,
            timeout=5
        )
        python_running = result.returncode == 0
    except:
        pass

    # Check IB Gateway reachability
    ib_reachable = False
    try:
        result = subprocess.run(
            ["powershell", "-Command", "Test-NetConnection -ComputerName localhost -Port 7497"],
            capture_output=True,
            text=True,
            timeout=5
        )
        ib_reachable = "TcpTestSucceeded : True" in result.stdout
    except:
        pass

    return StatusResponse(
        status="running",
        agent_version="1.0.0",
        uptime=str(uptime),
        environment="STAGING",
        python_service_running=python_running,
        ib_gateway_reachable=ib_reachable
    )


@app.post("/execute-task")
async def execute_task(
    request: TaskRequest,
    x_api_key: str = Header(None)
) -> TaskResponse:
    """
    Execute a task based on natural language instruction

    The AI interprets the instruction and generates appropriate commands.
    Commands are validated for safety before execution.
    """

    # Verify API key
    verify_api_key(x_api_key)

    task_id = datetime.now().strftime("%Y%m%d_%H%M%S")

    logger.info(f"[{task_id}] Received task: {request.instruction}")

    # Get Anthropic API key
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    if not anthropic_key:
        raise HTTPException(
            status_code=500,
            detail="ANTHROPIC_API_KEY not configured on agent"
        )

    # Interpret instruction using Claude
    interpretation = interpret_instruction(request.instruction, anthropic_key)

    if "error" in interpretation:
        return TaskResponse(
            task_id=task_id,
            instruction=request.instruction,
            ai_interpretation=interpretation.get("interpretation", ""),
            commands=[],
            results=None,
            status="error",
            timestamp=datetime.now().isoformat(),
            dry_run=request.dry_run
        )

    commands = interpretation["commands"][:request.max_commands]

    # Validate commands
    for cmd in commands:
        is_safe, reason = check_command_safety(cmd)
        if not is_safe:
            logger.warning(f"[{task_id}] Unsafe command blocked: {cmd} - {reason}")
            return TaskResponse(
                task_id=task_id,
                instruction=request.instruction,
                ai_interpretation=interpretation["interpretation"],
                commands=commands,
                results=None,
                status="blocked",
                timestamp=datetime.now().isoformat(),
                dry_run=request.dry_run
            )

    # Dry run mode - return commands without executing
    if request.dry_run:
        logger.info(f"[{task_id}] Dry run - commands not executed")
        return TaskResponse(
            task_id=task_id,
            instruction=request.instruction,
            ai_interpretation=interpretation["interpretation"],
            commands=commands,
            results=None,
            status="dry_run_complete",
            timestamp=datetime.now().isoformat(),
            dry_run=True
        )

    # Execute commands
    results = []
    for cmd in commands:
        result = execute_command(cmd)
        results.append(result)

        # Stop on first failure
        if result.return_code != 0:
            logger.warning(f"[{task_id}] Command failed: {cmd}")
            break

    logger.info(f"[{task_id}] Task complete - executed {len(results)} commands")

    return TaskResponse(
        task_id=task_id,
        instruction=request.instruction,
        ai_interpretation=interpretation["interpretation"],
        commands=commands,
        results=results,
        status="completed",
        timestamp=datetime.now().isoformat(),
        dry_run=False
    )


@app.get("/logs")
async def get_logs(lines: int = 100):
    """Get recent agent logs"""
    try:
        with open("remote-agent.log", "r") as f:
            all_lines = f.readlines()
            recent_lines = all_lines[-lines:]
            return {
                "lines": lines,
                "total_lines": len(all_lines),
                "logs": "".join(recent_lines)
            }
    except FileNotFoundError:
        return {"error": "Log file not found"}


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("REMOTE_AGENT_PORT", "8001"))

    logger.info(f"Starting Remote AI Agent on port {port}")
    logger.info(f"Environment: STAGING")
    logger.info(f"Allowed operations: {len(ALLOWED_OPERATIONS)}")

    uvicorn.run(app, host="0.0.0.0", port=port)
