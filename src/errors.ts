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

/**
 * Thrown when the cloud returns code 80001 ("device may be offline,
 * command sending timed out"). Means the cloud accepted the request but
 * the device didn't ACK within the broker timeout — typically because
 * the device is rebooting (post-OTA) or its MQTT subscription is down.
 *
 * Catch this specifically to distinguish "device unreachable right now"
 * from real protocol errors:
 *
 * ```ts
 * try {
 *   await vacuum.locate();
 * } catch (e) {
 *   if (e instanceof DreameDeviceOfflineError) { … }
 * }
 * ```
 */
export class DreameDeviceOfflineError extends DreameApiError {
  constructor(message: string, status: number, body?: unknown) {
    super(message, status, body);
    this.name = "DreameDeviceOfflineError";
  }
}

export class DreameTransportError extends DreameError {
  constructor(message: string, cause?: unknown) {
    super(message, cause);
    this.name = "DreameTransportError";
  }
}
