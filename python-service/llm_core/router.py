# python-service/llm_core/router.py

from typing import List, Dict, Any, Optional
import aisuite as ai

from .config import get_model_for_task

_client = ai.Client()


def call_llm(
    task: str,
    messages: List[Dict[str, str]],
    model: Optional[str] = None,
    **kwargs: Any,
) -> str:
    """
    High-level entry point for all LLM calls in this project.

    - task: logical task name ("code_gen", "analysis", etc.)
    - messages: list of {"role": ..., "content": ...}
    - model: optional override
    - kwargs: extra options (temperature, max_tokens, etc.)

    Returns: content string from the first choice.
    """
    chosen_model = model or get_model_for_task(task)

    resp = _client.chat.completions.create(
        model=chosen_model,
        messages=messages,
        **kwargs,
    )

    return resp.choices[0].message.content