export interface User {
  id: string;
  email: string;
  display_name: string;
  role: "user" | "admin";
  status: "active" | "suspended";
  avatar_url?: string | null;
  google_linked: boolean;
  created_at: string;
  last_login_at?: string | null;
}

export interface SessionResponse {
  access_token: string;
  token_type: string;
  user: User;
}

export interface Conversation {
  id: string;
  title: string;
  model_id?: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
}

export interface Attachment {
  id: string;
  filename: string;
  content_type: string;
  size: number;
}

export interface Message {
  id: string;
  conversation_id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: { id: string; name: string; arguments: unknown }[] | null;
  tool_call_id?: string | null;
  tool_name?: string | null;
  attachments?: Attachment[] | null;
  model_id?: string | null;
  error?: string | null;
  created_at: string;
}

export interface AIModel {
  id: string;
  provider_id: string;
  model_id: string;
  display_name: string;
  context_length: number;
  max_output_tokens: number;
  temperature: number;
  top_p: number;
  enabled: boolean;
  is_default: boolean;
  provider_name?: string;
  provider_type?: string;
}

export interface Provider {
  id: string;
  name: string;
  provider_type: string;
  base_url: string;
  custom_headers?: Record<string, string> | null;
  enabled: boolean;
  is_system: boolean;
  has_api_key: boolean;
  created_at: string;
}

export interface Tool {
  id: string;
  source: string;
  name: string;
  display_name: string;
  description: string;
  parameters_schema?: unknown;
  integration_id?: string | null;
  mcp_server_id?: string | null;
  external_id?: string | null;
  enabled: boolean;
  requires_approval: boolean;
  created_at: string;
}

export interface Integration {
  id: string;
  key: string;
  name: string;
  config?: Record<string, unknown> | null;
  enabled: boolean;
  status: string;
  has_credentials: boolean;
  created_at: string;
  tool_count: number;
}

export interface MCPServer {
  id: string;
  name: string;
  transport: "stdio" | "http";
  command?: string | null;
  args?: string[] | null;
  url?: string | null;
  status: string;
  last_error?: string | null;
  enabled: boolean;
  created_at: string;
  tool_count: number;
}

export interface ToolExecution {
  id: string;
  user_id: string;
  conversation_id?: string | null;
  tool_name: string;
  arguments?: unknown;
  result?: string | null;
  status: string;
  error?: string | null;
  duration_ms: number;
  created_at: string;
}

export interface AuditLog {
  id: string;
  user_id?: string | null;
  action: string;
  resource_type?: string | null;
  resource_id?: string | null;
  details?: unknown;
  ip?: string | null;
  created_at: string;
}

export interface OverviewStats {
  total_users: number;
  active_users: number;
  total_conversations: number;
  total_messages: number;
  ai_requests: number;
  tool_executions: number;
  model_usage: { model_id: string; model_name?: string; count: number }[];
  system_status: Record<string, unknown>;
  recent_activity: AuditLog[];
}

export interface UserSettings {
  theme: "light" | "dark" | "system";
  default_model_id?: string | null;
  system_prompt?: string | null;
  send_on_enter: boolean;
  allow_personal_api: boolean;
}

export interface SystemSettings {
  app_name: string;
  registration_enabled: boolean;
  maintenance_mode: boolean;
  default_theme: string;
  google_oauth_configured: boolean;
  ai_base_url: string;
  ai_model: string;
  smtp_configured: boolean;
}

export interface StreamEvent {
  type: string;
  [key: string]: unknown;
}
