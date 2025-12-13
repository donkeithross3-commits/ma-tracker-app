# python-service/llm_core/config.py

import os

# default model mapping for different "kinds" of work
TASK_MODELS = {
    "code_gen":        os.getenv("LLM_MODEL_CODE_GEN", "openai:gpt-4.1-mini"),
    "analysis":        os.getenv("LLM_MODEL_ANALYSIS", "openai:gpt-4o"),
    "cheap_fast":      os.getenv("LLM_MODEL_CHEAP_FAST", "openai:gpt-4o-mini"),
    "reasoning_heavy": os.getenv("LLM_MODEL_REASONING_HEAVY", "anthropic:claude-3-5-sonnet-20241022"),
    # add more task types as needed
}


def get_model_for_task(task: str) -> str:
    try:
        return TASK_MODELS[task]
    except KeyError:
        # sensible default / fallback
        return os.getenv("LLM_MODEL_DEFAULT", "openai:gpt-4o")