// Staging Agent Client
// TypeScript client for communicating with Remote AI Agent on STAGING PC

interface CommandResult {
  command: string;
  stdout: string;
  stderr: string;
  return_code: number;
  duration_ms: number;
}

interface TaskResponse {
  task_id: string;
  instruction: string;
  ai_interpretation: string;
  commands: string[];
  results?: CommandResult[];
  status: string;
  timestamp: string;
  dry_run: boolean;
}

interface AgentStatus {
  status: string;
  agent_version: string;
  uptime: string;
  environment: string;
  python_service_running: boolean;
  ib_gateway_reachable: boolean;
}

export class StagingAgentClient {
  private baseUrl: string;
  private apiKey: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl || process.env.STAGING_AGENT_URL || "";
    this.apiKey = apiKey || process.env.STAGING_AGENT_API_KEY || "";

    if (!this.baseUrl) {
      throw new Error(
        "STAGING_AGENT_URL not configured. Set in .env.local"
      );
    }
  }

  /**
   * Execute a task on staging environment
   *
   * @param instruction Natural language instruction (e.g., "Check if Python service is running")
   * @param dryRun If true, shows what commands would run without executing
   */
  async executeTask(
    instruction: string,
    dryRun: boolean = false
  ): Promise<TaskResponse> {
    const response = await fetch(`${this.baseUrl}/execute-task`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": this.apiKey,
      },
      body: JSON.stringify({
        instruction,
        dry_run: dryRun,
        max_commands: 5,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Agent request failed: ${response.status} - ${error}`);
    }

    return await response.json();
  }

  /**
   * Get status of staging environment
   */
  async getStatus(): Promise<AgentStatus> {
    const response = await fetch(`${this.baseUrl}/status`);

    if (!response.ok) {
      throw new Error(`Failed to get agent status: ${response.status}`);
    }

    return await response.json();
  }

  /**
   * Health check
   */
  async isHealthy(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        timeout: 5000,
      } as any);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Get recent logs from agent
   */
  async getLogs(lines: number = 100): Promise<string> {
    const response = await fetch(`${this.baseUrl}/logs?lines=${lines}`);

    if (!response.ok) {
      throw new Error(`Failed to get logs: ${response.status}`);
    }

    const data = await response.json();
    return data.logs;
  }

  // Helper methods for common operations

  /**
   * Check if Python service is running on staging
   */
  async checkPythonService(): Promise<boolean> {
    const status = await this.getStatus();
    return status.python_service_running;
  }

  /**
   * Check if IB Gateway is reachable on staging
   */
  async checkIBGateway(): Promise<boolean> {
    const status = await this.getStatus();
    return status.ib_gateway_reachable;
  }

  /**
   * Run tests on staging
   */
  async runTests(testPattern?: string): Promise<TaskResponse> {
    const instruction = testPattern
      ? `Run Python tests matching pattern: ${testPattern}`
      : "Run all Python tests and report results";

    return await this.executeTask(instruction);
  }

  /**
   * Restart Python service on staging
   */
  async restartPythonService(): Promise<TaskResponse> {
    return await this.executeTask(
      "Stop the uvicorn Python service if running, then start it fresh on port 8000"
    );
  }

  /**
   * Deploy latest code from main branch
   */
  async deployFromMain(): Promise<TaskResponse> {
    return await this.executeTask(
      "Pull latest code from main branch and restart Python service"
    );
  }

  /**
   * Check system resources on staging
   */
  async checkSystemResources(): Promise<TaskResponse> {
    return await this.executeTask(
      "Show CPU usage, memory usage, and disk space"
    );
  }

  /**
   * View recent service logs
   */
  async viewServiceLogs(lines: number = 50): Promise<TaskResponse> {
    return await this.executeTask(
      `Show the last ${lines} lines of the Python service log file`
    );
  }

  /**
   * Test database connection
   */
  async testDatabaseConnection(): Promise<TaskResponse> {
    return await this.executeTask(
      "Test connection to PostgreSQL database and show status"
    );
  }
}

// Singleton instance
let stagingAgentClient: StagingAgentClient | null = null;

/**
 * Get staging agent client instance
 */
export function getStagingAgentClient(): StagingAgentClient {
  if (!stagingAgentClient) {
    stagingAgentClient = new StagingAgentClient();
  }
  return stagingAgentClient;
}

// Helper functions for common use cases

/**
 * Quick check if staging environment is ready
 */
export async function isStagingReady(): Promise<{
  ready: boolean;
  issues: string[];
}> {
  try {
    const client = getStagingAgentClient();
    const status = await client.getStatus();

    const issues: string[] = [];

    if (!status.python_service_running) {
      issues.push("Python service not running");
    }

    if (!status.ib_gateway_reachable) {
      issues.push("IB Gateway not reachable");
    }

    return {
      ready: issues.length === 0,
      issues,
    };
  } catch (error) {
    return {
      ready: false,
      issues: [
        `Cannot connect to staging agent: ${error instanceof Error ? error.message : "Unknown error"}`,
      ],
    };
  }
}

/**
 * Execute task with automatic retry
 */
export async function executeTaskWithRetry(
  instruction: string,
  maxRetries: number = 2
): Promise<TaskResponse> {
  const client = getStagingAgentClient();
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await client.executeTask(instruction);
    } catch (error) {
      lastError = error as Error;
      console.error(
        `Attempt ${attempt}/${maxRetries} failed:`,
        error
      );

      if (attempt < maxRetries) {
        // Wait before retry (exponential backoff)
        await new Promise((resolve) =>
          setTimeout(resolve, 1000 * Math.pow(2, attempt - 1))
        );
      }
    }
  }

  throw lastError || new Error("Task execution failed");
}
