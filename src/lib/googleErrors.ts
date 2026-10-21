export type GcalPhase =
  | "off"
  | "loading"
  | "ready"
  | "offline"
  | "reconnect"
  | "unconfigured"
  | "error";

// Problems with the connection itself: no network, expired grant, no server.
export class GcalError extends Error {
  readonly phase: GcalPhase;
  constructor(phase: GcalPhase) {
    super(phase);
    this.phase = phase;
  }
}

// A Google API answer other than success. `scope` means missing permission.
export class GoogleError extends Error {
  readonly status: number;
  readonly scope: boolean;
  constructor(status: number, scope: boolean) {
    super(`Google ${status}`);
    this.status = status;
    this.scope = scope;
  }
}

export type GoogleApi = <T>(
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  options?: { params?: Record<string, string>; body?: unknown }
) => Promise<T>;
