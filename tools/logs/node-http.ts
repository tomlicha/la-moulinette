import type { IncomingMessage, ServerResponse } from 'node:http';

type Handler = (req: Request) => Promise<Response | undefined>;

/** Adapte un gestionnaire Request vers Response à `node:http` (et aux middlewares Vite). `false` : URL non prise en charge. */
export async function serveWith(
  handler: Handler,
  req: IncomingMessage,
  res: ServerResponse,
  maxBytes: number,
): Promise<boolean> {
  const method = req.method ?? 'GET';
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);

  let body: Uint8Array | undefined;
  if (method !== 'GET' && method !== 'HEAD') {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > maxBytes) {
        res.statusCode = 413;
        res.end();
        return true;
      }
      chunks.push(c as Buffer);
    }
    body = new Uint8Array(Buffer.concat(chunks));
  }

  const request = new Request(`http://${req.headers.host ?? 'localhost'}${req.url}`, { method, headers, body });
  const response = await handler(request);
  if (!response) return false;
  res.statusCode = response.status;
  response.headers.forEach((v, k) => res.setHeader(k, v));
  res.end(Buffer.from(await response.arrayBuffer()));
  return true;
}
