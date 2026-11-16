import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { Engine } from './engine';

/**
 * Static hosting (D16): the built box UI at /box/, the built player PWA at / with SPA fallback
 * (so /j/CODE loads the app), and /j redirecting to the current party for a passive NFC sticker.
 * A missing build gets a small helpful page instead of an error.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '../../..');

export function defaultStaticDirs(): { box: string; player: string } {
  return { box: path.join(repoRoot, 'apps/box/dist'), player: path.join(repoRoot, 'apps/player/dist') };
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
};

const API_PREFIXES = ['/parties', '/games', '/health', '/faucet', '/webhooks', '/agent', '/agent-tools', '/audio', '/replays', '/ws'];

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title><style>body{font-family:system-ui,sans-serif;background:#0b1020;color:#e8ecf5;display:grid;place-items:center;min-height:100vh;margin:0}
main{max-width:34rem;padding:2rem}code{background:#1b2440;padding:.15rem .4rem;border-radius:.3rem}a{color:#4cc9f0}</style></head>
<body><main><h1>${title}</h1>${body}</main></body></html>`;
}

function missingBuild(which: 'box' | 'player'): string {
  const pkg = which === 'box' ? '@huddle/box' : '@huddle/player';
  const what = which === 'box' ? 'box screen' : 'player app';
  return page(
    `Huddle ${what} is not built yet`,
    `<p>The engine is running, but it could not find the built ${what}.</p>
<p>Build it with <code>pnpm --filter ${pkg} build</code>, or run its dev server with <code>pnpm --filter ${pkg} dev</code>.</p>
<p>Engine status: <a href="/health">/health</a></p>`,
  );
}

function sendFile(reply: FastifyReply, file: string): FastifyReply {
  const ext = path.extname(file).toLowerCase();
  reply.header('content-type', MIME[ext] ?? 'application/octet-stream');
  if (ext === '.html' || path.basename(file) === 'sw.js') reply.header('cache-control', 'no-cache');
  return reply.send(fs.createReadStream(file));
}

function serve(reply: FastifyReply, root: string, rel: string, which: 'box' | 'player'): FastifyReply {
  const index = path.join(root, 'index.html');
  if (!fs.existsSync(index)) return reply.code(503).header('content-type', MIME['.html']!).send(missingBuild(which));
  const file = path.resolve(root, `.${path.posix.normalize(`/${rel}`)}`);
  if (file !== root && !file.startsWith(root + path.sep)) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
  try {
    if (fs.statSync(file).isFile()) return sendFile(reply, file);
  } catch {
    /* fall through to the SPA fallback */
  }
  // A missing asset is a 404; any other path is a client-side route.
  if (path.extname(rel)) return reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
  return sendFile(reply, index);
}

export function registerStatic(app: FastifyInstance, engine: Engine, dirs: { box: string; player: string }): void {
  const box = path.resolve(dirs.box);
  const player = path.resolve(dirs.player);

  app.get('/j', async (_req, reply) => {
    const current = engine.mostRecentActive();
    if (current) return reply.redirect(`/j/${current.code}`);
    return reply
      .code(404)
      .header('content-type', MIME['.html']!)
      .send(page('No party is running', '<p>Ask the host to start a party on the box, then tap again.</p>'));
  });

  app.setNotFoundHandler((req, reply) => {
    const notFound = (): FastifyReply => reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } });
    if (req.method !== 'GET' && req.method !== 'HEAD') return notFound();
    let pathname: string;
    try {
      pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    } catch {
      return notFound();
    }
    if (API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))) return notFound();
    if (pathname === '/box') return reply.redirect('/box/');
    if (pathname.startsWith('/box/')) return serve(reply, box, pathname.slice('/box'.length), 'box');
    return serve(reply, player, pathname, 'player');
  });
}
