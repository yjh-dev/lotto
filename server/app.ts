/**
 * 맥북 API 서버 — Node 내장 http, 외부 의존성 없음. Tailscale 안에서만 열려 있음 (localhost에 바인딩)
 *
 *   GET /api/health                 서버·DB 상태
 *   GET /api/draws?after=N          N회 이후 회차 (휴대폰이 덧붙일 데이터). after 생략 시 전체
 *   GET /api/status                 최근 수집 기록
 *   GET /api/recommendations        회차별 기본 추천 이력과 채점 결과
 *   GET /api/purchases              내가 산 번호(용지 QR)와 채점 결과
 *   POST /api/purchases {qr}        용지 QR 문자열 저장 (같은 용지는 한 번만)
 *   DELETE /api/purchases?key=…     잘못 저장한 용지 삭제
 *   (쓰기는 구매 기록뿐 — 회차 데이터는 맥북 수집기만 씀)
 *   그 외                            dist/ 의 웹 화면 (휴대폰 브라우저로 바로 사용 가능)
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';
import type { LottoRepository } from '../src/db/repository.ts';
import { expectedLatestRound } from '../src/data/normalize.ts';
import { parseLottoQr, QrError } from '../src/data/qr.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.wasm': 'application/wasm',
  '.apk': 'application/vnd.android.package-archive',
};

function send(res: ServerResponse, status: number, body: unknown) {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    // 휴대폰 앱(Capacitor, 다른 origin)에서 호출할 수 있도록. Tailscale 안에서만 열려 있음
    'Access-Control-Allow-Origin': '*',
  });
  res.end(json);
}

/** 요청 본문(JSON, 최대 4KB) */
async function readJson(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 4096) throw new QrError('요청이 너무 큽니다');
    chunks.push(c as Buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new QrError('JSON 형식이 아닙니다');
  }
}

async function serveStatic(distDir: string, path: string, res: ServerResponse) {
  const root = resolve(distDir);
  let file = normalize(join(root, decodeURIComponent(path)));
  if (!file.startsWith(root)) return send(res, 403, { error: 'forbidden' });
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    file = join(root, 'index.html'); // SPA
  }
  try {
    const body = await readFile(file);
    res.writeHead(200, {
      'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
      'Cache-Control': file.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache',
    });
    res.end(body);
  } catch {
    send(res, 404, { error: '웹 화면이 빌드되지 않았습니다 (npm run build)' });
  }
}

export function createApp(repo: LottoRepository, opts: { distDir?: string } = {}): Server {
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    try {
      if (req.method === 'OPTIONS') {
        res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, DELETE', 'Access-Control-Allow-Headers': 'Content-Type' });
        return res.end();
      }
      if (url.pathname === '/api/purchases' && req.method === 'POST') {
        const body = (await readJson(req)) as { qr?: unknown };
        if (typeof body?.qr !== 'string') return send(res, 400, { error: 'qr 문자열이 필요합니다' });
        const ticket = parseLottoQr(body.qr);
        const saved = await repo.savePurchase(ticket);
        return send(res, saved ? 201 : 200, { saved, duplicate: saved === 0, ticket });
      }
      if (url.pathname === '/api/purchases' && req.method === 'DELETE') {
        const key = url.searchParams.get('key');
        if (!key) return send(res, 400, { error: 'key가 필요합니다' });
        return send(res, 200, { deleted: await repo.deletePurchase(key) });
      }
      if (req.method !== 'GET') return send(res, 405, { error: '허용되지 않는 요청' });

      switch (url.pathname) {
        case '/api/health': {
          const last = await repo.lastRound();
          return send(res, 200, { ok: true, lastRound: last, expectedRound: expectedLatestRound(), time: new Date().toISOString() });
        }
        case '/api/draws': {
          const after = Number(url.searchParams.get('after') ?? 0);
          if (!Number.isInteger(after) || after < 0) return send(res, 400, { error: 'after는 0 이상의 정수' });
          const all = await repo.getDraws();
          return send(res, 200, { latest: all.at(-1)?.round ?? 0, draws: all.filter((d) => d.round > after) });
        }
        case '/api/status':
          return send(res, 200, { lastRound: await repo.lastRound(), expectedRound: expectedLatestRound(), fetchLog: await repo.recentFetchLog(20) });
        case '/api/recommendations':
          return send(res, 200, { recommendations: await repo.listRecommendations(Number(url.searchParams.get('limit') ?? 50)) });
        case '/api/purchases':
          return send(res, 200, { purchases: await repo.listPurchases() });
        default:
          if (url.pathname.startsWith('/api/')) return send(res, 404, { error: 'not found' });
          if (!opts.distDir) return send(res, 404, { error: 'not found' });
          return serveStatic(opts.distDir, url.pathname, res);
      }
    } catch (e) {
      send(res, e instanceof QrError ? 400 : 500, { error: (e as Error).message });
    }
  });
}
