export class DreameError extends Error {
  constructor(message: string, public override readonly cause?: unknown) {
    super(message);
    this.name = "DreameError";
  }
}

export class DreameAuthError extends DreameError {
  constructor(message: string, public readonly status?: number, cause?: unknown) {
    super(message, cause);
    this.name = "DreameAuthError";
  }
}

export class DreameApiError extends DreameError {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body?: unknown,
    cause?: unknown,
  ) {
    super(message, cause);
    this.name = "DreameApiError";
  }
}

export class DreameTransportError extends DreameError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "DreameTransportError";
  }
}
