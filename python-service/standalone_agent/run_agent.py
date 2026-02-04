#!/usr/bin/env python3
"""
Launcher that replaces this process with the agent (os.execv).
When run from a batch file, the batch waits on the agent process,
so Ctrl+C is delivered to the agent and it exits without "Terminate batch job (Y/N)?".
"""
import os
import sys

def main():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    agent_path = os.path.join(script_dir, "ib_data_agent.py")
    os.chdir(script_dir)
    os.execv(sys.executable, [sys.executable, agent_path])

if __name__ == "__main__":
    main()
