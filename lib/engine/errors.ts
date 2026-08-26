export class EngineError extends Error {
  override readonly name: string = "EngineError";
  readonly code: string;

  constructor(code: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.code = code;
  }
}

export class ClaimNotFoundError extends EngineError {
  override readonly name = "ClaimNotFoundError";

  constructor(claimId: string) {
    super("CLAIM_NOT_FOUND", `claim was not found: ${claimId}`);
  }
}

export class EngineStateError extends EngineError {
  override readonly name = "EngineStateError";

  constructor(message: string) {
    super("INVALID_CLAIM_STATE", message);
  }
}

export class EngineValidationError extends EngineError {
  override readonly name = "EngineValidationError";

  constructor(message: string) {
    super("VALIDATION_ERROR", message);
  }
}
