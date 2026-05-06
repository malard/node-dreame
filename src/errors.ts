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
 * command sending timed out"). The literal `msg` field claims the
 * device is offline — that interpretation is **frequently wrong**.
 *
 * What 80001 actually means: the cloud's HTTP-side waiter for the
 * device's MQTT-side ACK gave up after ~8 seconds. It does NOT mean
 * the action failed to reach the device, and it does NOT mean the
 * device is unreachable. Verified live 2026-05-04 on a Dreame X50:
 * `vacuum.start()`, `vacuum.dock()`, `vacuum.cancelCurrentJob()`,
 * `setProperties`, and `getProperties` all returned 80001 from the
 * HTTP layer while the device was simultaneously executing the actions
 * AND echoing state changes back over MQTT. The 80001 is a false
 * negative on a healthy device that just happens to take >8s to ACK.
 *
 * Practical implication: do NOT treat this error as authoritative
 * about device reachability. The MQTT subscription is the source of
 * truth — observe the device's response there. If you need a yes/no
 * "is the device responsive" answer, use `Vacuum.verifyMqtt()`, which
 * judges purely on whether an MQTT echo arrives (and ignores 80001
 * from the trigger write).
 *
 * The only case where 80001 is a true positive is when the device
 * actually IS unreachable (powered off, network lost, mid-reboot). In
 * that case no echo will arrive on MQTT either — that's the
 * disambiguation.
 *
 * The class name is kept for legibility against the wire-level
 * literal `msg` field, but consumers should treat it as "HTTP-side
 * ACK timeout" in their internal modeling — never as proof of
 * offline. `Vacuum.refresh()` surfaces this same outcome as
 * `kind: "no-ack"`.
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
