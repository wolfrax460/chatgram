/** Typed AI errors shared by every adapter and by the service layer. */
class AiError extends Error {
  constructor(code, message, details) {
    super(message);
    this.name = 'AiError';
    this.code = code;
    this.details = details;
  }
}

const ERROR_CODES = {
  RATE_LIMITED: 'rate_limited',
  AUTH_FAILED: 'auth_failed',
  TIMEOUT: 'timeout',
  CONTENT_BLOCKED: 'content_blocked',
  UNAVAILABLE: 'unavailable',
  BUDGET_EXCEEDED: 'budget_exceeded',
  NOT_CONFIGURED: 'not_configured',
};

module.exports = { AiError, ERROR_CODES };
