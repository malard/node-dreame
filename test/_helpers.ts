/**
 * Test helpers — small, intentionally low-magic.
 *
 * `mockFetch(routes)` returns a `fetch`-compatible function that matches
 * incoming requests against a route table and returns the configured
 * response. Routes are matched on `"<METHOD> <urlSubstring>"` so a key
 * like `"POST /dreame-auth/oauth/token"` matches any URL containing
 * that path with the given method.
 *
 * Each route value is either:
 *   - a `MockResponse` object — returned for every call
 *   - a function `(req) => MockResponse | Promise<MockResponse>` — receives
 *     the parsed request (url, method, headers, body) and decides
 *
 * The handler also records every call as a `MockCall` on the returned
 * `fetchImpl.calls` array, so tests can assert the request shape.
 */

export interface MockResponse {
  /** HTTP status. Default 200. */
  status?: number;
  /** Body to JSON.stringify. Mutually exclusive with `text`. */
  json?: unknown;
  /** Raw body text. Use this for malformed/empty-body cases. */
  text?: string;
  /** Override response content-type (default `application/json`). */
  contentType?: string;
}

export interface MockCall {
  url: string;
  method: string;
  headers: Record<string, string>;
  /** The body as a string (URLSearchParams stringified, or pass-through for strings). */
  body: string;
  /** The body parsed as JSON, if it was JSON. */
  bodyJson: unknown;
  /** The body parsed as URLSearchParams form fields, if it was form-encoded. */
  bodyForm: Record<string, string> | null;
}

export type MockRouteHandler =
  | MockResponse
  | ((req: MockCall) => MockResponse | Promise<MockResponse>);

export interface MockFetch {
  (input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /** Every call recorded in order. */
  calls: MockCall[];
}

export function mockFetch(routes: Record<string, MockRouteHandler>): MockFetch {
  const calls: MockCall[] = [];

  const fn = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url =
      input instanceof URL
        ? input.toString()
        : typeof input === "string"
          ? input
          : input.url;
    const method = (init.method ?? "GET").toUpperCase();

    const headers: Record<string, string> = {};
    const h = init.headers;
    if (h instanceof Headers) {
      h.forEach((v, k) => {
        headers[k.toLowerCase()] = v;
      });
    } else if (Array.isArray(h)) {
      for (const [k, v] of h) {
        headers[k.toLowerCase()] = String(v);
      }
    } else if (h && typeof h === "object") {
      for (const [k, v] of Object.entries(h)) {
        headers[k.toLowerCase()] = String(v);
      }
    }

    let body = "";
    if (typeof init.body === "string") {
      body = init.body;
    } else if (init.body instanceof URLSearchParams) {
      body = init.body.toString();
    }

    let bodyJson: unknown = undefined;
    if (body && headers["content-type"]?.includes("json")) {
      try {
        bodyJson = JSON.parse(body);
      } catch {
        // leave undefined
      }
    }

    let bodyForm: Record<string, string> | null = null;
    if (body && headers["content-type"]?.includes("form-urlencoded")) {
      bodyForm = {};
      for (const [k, v] of new URLSearchParams(body)) {
        bodyForm[k] = v;
      }
    }

    const call: MockCall = { url, method, headers, body, bodyJson, bodyForm };
    calls.push(call);

    const routeKey = Object.keys(routes).find((k) => {
      const space = k.indexOf(" ");
      if (space < 0) {
        return false;
      }
      const routeMethod = k.slice(0, space).toUpperCase();
      const routePath = k.slice(space + 1);
      return routeMethod === method && url.includes(routePath);
    });

    if (!routeKey) {
      throw new Error(`mockFetch: no route matched ${method} ${url}`);
    }

    const handler = routes[routeKey]!;
    const resOpts =
      typeof handler === "function" ? await handler(call) : handler;

    const status = resOpts.status ?? 200;
    const responseText =
      resOpts.text !== undefined
        ? resOpts.text
        : resOpts.json !== undefined
          ? JSON.stringify(resOpts.json)
          : "";
    const contentType = resOpts.contentType ?? "application/json";

    return new Response(responseText, {
      status,
      headers: { "content-type": contentType },
    });
  }) as MockFetch;
  fn.calls = calls;
  return fn;
}
