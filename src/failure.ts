import {
  AgentBusyError,
  AuthenticationError,
  ConfigurationError,
  CursorSdkError,
  NetworkError,
  RateLimitError,
} from "@cursor/sdk";

export function failureResponse(error: unknown): Response {
  const message = error instanceof Error ? error.message : String(error);
  let status = 500;
  let code = "cursor_sdk_error";
  let type = "server_error";

  if (error instanceof AuthenticationError) {
    status = 401; code = "cursor_auth"; type = "authentication_error";
  } else if (error instanceof RateLimitError) {
    status = 429; code = "cursor_rate_limit"; type = "rate_limit_error";
  } else if (error instanceof AgentBusyError) {
    status = 409; code = "cursor_agent_busy"; type = "conflict_error";
  } else if (error instanceof ConfigurationError) {
    status = error.status && error.status >= 400 && error.status < 500 ? error.status : 400;
    code = error.code || "cursor_configuration"; type = "invalid_request_error";
  } else if (error instanceof NetworkError) {
    status = error.status && error.status >= 500 ? error.status : 503;
    code = error.code || "cursor_network"; type = "server_error";
  } else if (error instanceof CursorSdkError) {
    status = error.status || 500; code = error.code || code;
  }

  return Response.json({ error: { message, type, code } }, { status });
}
