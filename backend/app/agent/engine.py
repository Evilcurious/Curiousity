"""Curiousity agent engine.

A LangGraph-style plan → act → observe loop over the unified provider
interface: the model streams a response, may request tool calls, tools are
executed (with permission checks and human approval for sensitive actions),
results are fed back, and the loop continues up to agent_max_steps.

All provider I/O flows through `ProviderAdapter`, so the engine is completely
decoupled from Ollama or any specific AI server.
"""
from __future__ import annotations

import asyncio
import json
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Callable, Dict, List, Optional

from sqlalchemy.orm import Session

from app.agent.providers.base import ProviderError, StreamEvent
from app.agent.providers.registry import build_adapter
from app.agent.tools.base import ToolContext
from app.agent.tools.registry import ToolRegistry
from app.config import get_settings
from app.models import AIModel, Conversation, Message, User, UserSettings

SYSTEM_PROMPT = """You are Curiousity, a capable AI assistant running on a self-hosted agent platform.
Current date: {date}.
You can use tools when they help you answer. When you need a tool, request it with the function-calling interface.
Be concise, accurate and helpful. Format answers in Markdown when useful (code blocks with language tags for code).
If a tool returns an error, explain what happened and suggest a fix rather than repeating the failure."""


@dataclass
class GenerationHandle:
    """Tracks a running generation so it can be stopped from the API."""
    id: str
    conversation_id: str
    user_id: str
    cancel_event: asyncio.Event = field(default_factory=asyncio.Event)
    task: Optional[asyncio.Task] = None


_active_generations: Dict[str, GenerationHandle] = {}


def register_generation(conversation_id: str, user_id: str) -> GenerationHandle:
    handle = GenerationHandle(id=uuid.uuid4().hex, conversation_id=conversation_id, user_id=user_id)
    _active_generations[handle.id] = handle
    return handle


def stop_generation(conversation_id: str, user_id: str) -> bool:
    stopped = False
    for handle in list(_active_generations.values()):
        if handle.conversation_id == conversation_id and handle.user_id == user_id:
            handle.cancel_event.set()
            stopped = True
    return stopped


def _release(handle: GenerationHandle) -> None:
    _active_generations.pop(handle.id, None)


def truncate_history(messages: List[Dict[str, Any]], budget_chars: int) -> List[Dict[str, Any]]:
    """Keep the newest messages that fit the character budget (context management)."""
    total = 0
    kept: List[Dict[str, Any]] = []
    for msg in reversed(messages):
        size = len(str(msg.get("content") or "")) + 200
        if total + size > budget_chars and kept:
            break
        kept.append(msg)
        total += size
    kept.reverse()
    return kept


class AgentEngine:
    def __init__(self, db: Session, user: User, conversation: Conversation,
                 model: AIModel, handle: GenerationHandle):
        self.db = db
        self.user = user
        self.conversation = conversation
        self.model = model
        self.handle = handle
        self.settings = get_settings()
        self.tools = ToolRegistry(db, user.id)
        self.ctx = ToolContext(
            user_id=user.id, conversation_id=conversation.id, db=db,
        )

    # ------------------------------------------------------------------ history
    def build_messages(self, include_pending: bool = True) -> List[Dict[str, Any]]:
        settings_row = self.db.get(UserSettings, self.user.id)
        system = SYSTEM_PROMPT.format(date=datetime.now(timezone.utc).strftime("%Y-%m-%d"))
        if settings_row and settings_row.system_prompt:
            system += "\n\nUser-defined instructions:\n" + settings_row.system_prompt

        history: List[Dict[str, Any]] = []
        rows = (
            self.db.query(Message)
            .filter(Message.conversation_id == self.conversation.id)
            .order_by(Message.created_at)
            .all()
        )
        for m in rows:
            if m.role == "system":
                continue
            entry: Dict[str, Any] = {"role": m.role, "content": m.content or ""}
            if m.tool_calls:
                entry["tool_calls"] = [
                    {
                        "id": tc.get("id", ""),
                        "type": "function",
                        "function": {
                            "name": tc.get("name", ""),
                            "arguments": json.dumps(tc.get("arguments", {})),
                        },
                    }
                    for tc in m.tool_calls
                ]
            if m.tool_call_id:
                entry["tool_call_id"] = m.tool_call_id
            if m.attachments:
                # Inline small text attachments so the model can read them.
                extras = []
                for att in m.attachments:
                    content = att.get("preview")
                    if content:
                        extras.append(f"[Attachment {att.get('filename', 'file')}]\n{content}")
                if extras:
                    entry["content"] = (entry["content"] + "\n\n" + "\n\n".join(extras)).strip()
            history.append(entry)

        history = truncate_history(history, self.settings.agent_context_budget_chars)
        return [{"role": "system", "content": system}] + history

    # ------------------------------------------------------------------ main loop
    async def run(self, user_message_id: str) -> AsyncIterator[Dict[str, Any]]:
        """Stream agent events as dicts (SSE-ready):
        {type: token|tool_call|tool_result|approval_required|message_done|error|done}
        """
        handle = self.handle
        try:
            for step in range(1, self.settings.agent_max_steps + 1):
                if handle.cancel_event.is_set():
                    yield {"type": "done", "reason": "stopped"}
                    return

                adapter = build_adapter(self.model.provider, self.model)
                messages = self.build_messages()
                tool_defs = self.tools.openai_tools()

                text_parts: List[str] = []
                tool_calls: List[Any] = []
                prompt_tokens = completion_tokens = 0

                try:
                    async for event in adapter.stream_chat(messages, tools=tool_defs):
                        if handle.cancel_event.is_set():
                            yield {"type": "done", "reason": "stopped"}
                            await self._save_assistant(user_message_id, "".join(text_parts),
                                                      tool_calls, prompt_tokens, completion_tokens,
                                                      cancelled=True)
                            return
                        if event.type == "token":
                            text_parts.append(event.text)
                            yield {"type": "token", "text": event.text, "step": step}
                        elif event.type == "tool_call" and event.tool_call:
                            tool_calls.append(event.tool_call)
                            yield {
                                "type": "tool_call",
                                "tool_call_id": event.tool_call.id,
                                "name": event.tool_call.name,
                                "arguments": event.tool_call.arguments,
                                "step": step,
                            }
                        elif event.type == "usage":
                            prompt_tokens += event.prompt_tokens
                            completion_tokens += event.completion_tokens
                except ProviderError as exc:
                    yield {"type": "error", "message": str(exc)}
                    await self._save_assistant(user_message_id, "".join(text_parts), tool_calls,
                                              prompt_tokens, completion_tokens, error=str(exc))
                    return

                full_text = "".join(text_parts)

                # Models without native tool support may emit tool calls as text.
                if not tool_calls and tool_defs:
                    parsed = self._extract_text_tool_call(full_text)
                    if parsed:
                        tool_calls.append(parsed)
                        full_text = re.sub(r"```(?:json)?\s*\{[\s\S]*?\}\s*```", "", full_text).strip()

                if not tool_calls:
                    await self._save_assistant(user_message_id, full_text, None,
                                              prompt_tokens, completion_tokens)
                    yield {"type": "message_done", "content": full_text}
                    yield {"type": "done", "reason": "complete"}
                    return

                # Persist the assistant tool-call message, then run the tools.
                assistant_msg = await self._save_assistant(
                    user_message_id, full_text, tool_calls,
                    prompt_tokens, completion_tokens, pending_tools=True,
                )
                approval_needed = False
                for tc in tool_calls:
                    spec = self.tools.get(tc.name)
                    if spec and spec.requires_approval:
                        execution = await self.tools.execute(
                            tc.name, tc.arguments, self.ctx,
                            message_id=assistant_msg.id, approved=False,
                        )
                        yield {
                            "type": "approval_required",
                            "tool_call_id": tc.id,
                            "execution_id": execution.id,
                            "name": tc.name,
                            "arguments": tc.arguments,
                        }
                        approval_needed = True
                        continue

                    yield {"type": "tool_call_start", "name": tc.name, "arguments": tc.arguments}
                    execution = await self.tools.execute(
                        tc.name, tc.arguments, self.ctx,
                        message_id=assistant_msg.id, approved=True,
                    )
                    result_text = self._render_tool_result(execution)
                    self.db.add(Message(
                        conversation_id=self.conversation.id,
                        user_id=self.user.id,
                        role="tool",
                        content=result_text,
                        tool_call_id=tc.id,
                        tool_name=tc.name,
                        model_id=self.model.id,
                    ))
                    self.db.commit()
                    yield {
                        "type": "tool_result",
                        "tool_call_id": tc.id,
                        "name": tc.name,
                        "status": execution.status,
                        "result": result_text[:1500],
                    }

                if approval_needed and handle.cancel_event.is_set():
                    yield {"type": "done", "reason": "stopped"}
                    return
                # loop continues: the model now sees tool results
            yield {"type": "error", "message": "Agent reached the maximum number of steps"}
        finally:
            _release(handle)

    async def resume_after_approval(self, execution_id: str, approved: bool,
                                    tool_call_id: str) -> AsyncIterator[Dict[str, Any]]:
        """Continue generation after a human approved/denied a pending tool."""
        from app.models import ToolExecution
        execution = self.db.get(ToolExecution, execution_id)
        if execution is None:
            yield {"type": "error", "message": "Execution not found"}
            return
        if approved:
            spec = self.tools.get(execution.tool_name)
            result = await self.tools.execute(
                execution.tool_name, execution.arguments or {}, self.ctx,
                message_id=execution.message_id, approved=True,
            )
            execution.status = result.status
            execution.result = result.result
            execution.error = result.error
            self.db.commit()
            result_text = self._render_tool_result(result)
        else:
            execution.status = "denied"
            execution.error = "Denied by user"
            self.db.commit()
            result_text = json.dumps({"status": "denied", "message": "The user denied this tool execution."})

        self.db.add(Message(
            conversation_id=self.conversation.id,
            user_id=self.user.id,
            role="tool",
            content=result_text,
            tool_call_id=tool_call_id,
            tool_name=execution.tool_name,
            model_id=self.model.id,
        ))
        self.db.commit()
        yield {"type": "tool_result", "tool_call_id": tool_call_id,
               "name": execution.tool_name, "status": execution.status,
               "result": result_text[:1500]}

        # Continue the agent loop with a fresh handle.
        handle = register_generation(self.conversation.id, self.user.id)
        self.handle = handle
        async for evt in self.run(execution.message_id or ""):
            yield evt

    # ------------------------------------------------------------------ helpers
    async def _save_assistant(self, user_message_id: str, content: str,
                              tool_calls: Optional[List[Any]], tokens_in: int, tokens_out: int,
                              error: Optional[str] = None, cancelled: bool = False,
                              pending_tools: bool = False) -> Message:
        serialized = None
        if tool_calls:
            serialized = [
                {"id": tc.id, "name": tc.name, "arguments": tc.arguments} for tc in tool_calls
            ]
        msg = Message(
            conversation_id=self.conversation.id,
            user_id=self.user.id,
            role="assistant",
            content=(content + ("\n\n_[Generation stopped]_" if cancelled and content else "")),
            tool_calls=serialized,
            model_id=self.model.id,
            tokens_in=tokens_in,
            tokens_out=tokens_out,
            error=error,
        )
        self.db.add(msg)
        self.conversation.updated_at = datetime.now(timezone.utc)
        self.db.commit()
        self.db.refresh(msg)
        return msg

    @staticmethod
    def _render_tool_result(execution) -> str:
        if execution.status == "success":
            return execution.result or "(no output)"
        return json.dumps({"status": execution.status, "error": execution.error}, default=str)

    @staticmethod
    def _extract_text_tool_call(text: str) -> Optional[Any]:
        from app.agent.providers.base import ToolCallRequest
        if not text or '"arguments"' not in text:
            return None
        for cand in re.findall(r"\{[\s\S]*?\}", text):
            try:
                obj = json.loads(cand)
            except json.JSONDecodeError:
                continue
            if isinstance(obj, dict):
                name = obj.get("tool") or obj.get("name") or obj.get("function")
                args = obj.get("arguments") or obj.get("parameters")
                if isinstance(name, str) and isinstance(args, dict):
                    return ToolCallRequest(id=f"call_{uuid.uuid4().hex[:12]}", name=name, arguments=args)
        return None
