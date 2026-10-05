import { vi } from 'vitest';

export interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

type Handler = (call: Call) => Response | Promise<Response> | unknown;

/**
 * Replaces global fetch with a router. Handlers are matched in order by
 * "METHOD url-prefix"; a handler may return a Response or any JSON value.
 * Every call is recorded for assertions.
 */
export function mockFetch(routes: [string, Handler][]) {
  const calls: Call[] = [];
  const fn = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const headers = Object.fromEntries(new Headers(init.headers).entries());
    const call: Call = { url, method, headers, body: await readBody(init.body, headers['content-type']) };
    calls.push(call);
    const route = routes.find(([pattern]) => {
      const [routeMethod, prefix] = pattern.split(' ');
      return routeMethod === method && url.startsWith(prefix!);
    });
    if (!route) return new Response(JSON.stringify({ error: `no mock for ${method} ${url}` }), { status: 404 });
    const result = await route[1](call);
    return result instanceof Response ? result : Response.json(result);
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

/** A tiny PNG served by media mocks. */
export const imageResponse = () => new Response(new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }));

async function readBody(body: RequestInit['body'], contentType = ''): Promise<unknown> {
  if (body === undefined || body === null) return undefined;
  if (body instanceof URLSearchParams) return Object.fromEntries(body.entries());
  if (body instanceof FormData) return Object.fromEntries([...body.entries()].map(([k, v]) => [k, typeof v === 'string' ? v : `<file ${v.size}>`]));
  if (body instanceof Blob) return `<blob ${body.size}>`;
  if (typeof body === 'string') return contentType.includes('json') ? JSON.parse(body) : body;
  return body;
}
