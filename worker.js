/**
 * worker.js
 * Cloudflare Worker Anycast para IEValidator Pro API
 * Validação de Inscrição Estadual dos 27 Estados (SINTEGRA / CONFAZ) na borda (<1ms)
 * 
 * @license MIT
 * @see https://github.com/clepta2/ievalidator-pro
 */

import { validarIePorEstado, ESTADOS_IE } from './ievalidator-pro.js';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-api-key',
  'Access-Control-Max-Age': '86400'
};

const rateLimitBuckets = new Map();

function checkRateLimit(ipOrKey, limit = 60) {
  const now = Date.now();
  let b = rateLimitBuckets.get(ipOrKey);
  if (!b || now > b.resetAt) {
    b = { count: 1, resetAt: now + 60000 };
    rateLimitBuckets.set(ipOrKey, b);
    return { ok: true, remaining: limit - 1 };
  }
  b.count++;
  if (b.count > limit) return { ok: false, remaining: 0, retryAfter: Math.ceil((b.resetAt - now) / 1000) };
  return { ok: true, remaining: limit - b.count };
}

export default {
  async fetch(request, env = {}, ctx = {}) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const authHeader = request.headers.get('Authorization') || request.headers.get('x-api-key') || '';
    const cleanKey = authHeader.replace(/^Bearer\s+/i, '').trim();
    const isPro = Boolean(
      cleanKey && (
        cleanKey.startsWith('ie_live_') || 
        cleanKey.startsWith('ie_pro_') || 
        cleanKey.startsWith('ie_master_') || 
        cleanKey.startsWith('pnt_live_') ||
        (env && (env.API_KEY === cleanKey || env.PRO_KEY === cleanKey))
      ) && cleanKey.length >= 16
    );

    const ip = request.headers.get('cf-connecting-ip') || 'anon';
    const maxReqs = isPro ? 300 : 60;
    const rate = checkRateLimit(isPro ? cleanKey : ip, maxReqs);
    const TELEMETRY = {
      ...CORS_HEADERS,
      'x-ie-ratelimit-remaining': String(rate.remaining)
    };

    if (!rate.ok) {
      return new Response(JSON.stringify({ ok: false, error: 'RATE_LIMIT_EXCEEDED', retryAfter: rate.retryAfter }), {
        status: 429,
        headers: { 'Content-Type': 'application/json', 'Retry-After': String(rate.retryAfter), ...TELEMETRY }
      });
    }

    // Listagem de Estados
    if (path === '/api/ie/estados' || path === '/estados') {
      return new Response(JSON.stringify({
        ok: true,
        totalEstados: 27,
        estados: ESTADOS_IE
      }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...TELEMETRY }
      });
    }

    // Validação em Lote
    if (path === '/api/ie/lote' && request.method === 'POST') {
      let itens = [];
      try {
        const body = await request.json();
        itens = Array.isArray(body) ? body : (body.itens || []);
      } catch (_) {}

      const resultados = itens.slice(0, 50).map(i => validarIePorEstado(i.uf, i.ie));
      return new Response(JSON.stringify({
        ok: true,
        totalProcessado: resultados.length,
        resultados
      }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...TELEMETRY }
      });
    }

    // Validação Individual
    let uf = url.searchParams.get('uf');
    let ie = url.searchParams.get('ie') || url.searchParams.get('valor');

    // Suporte a rota REST: /api/ie/:uf/:ie
    const match = path.match(/^\/api\/ie\/([a-zA-Z]{2})\/([a-zA-Z0-9.\-\/]+)$/i) || path.match(/^\/([a-zA-Z]{2})\/([a-zA-Z0-9.\-\/]+)$/i);
    if (match) {
      uf = match[1];
      ie = match[2];
    }

    if (uf && ie) {
      const res = validarIePorEstado(uf, ie);
      return new Response(JSON.stringify({
        ok: res.valido,
        ...res
      }, null, 2), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...TELEMETRY }
      });
    }

    return new Response(JSON.stringify({
      ok: true,
      service: 'IEValidator Pro API',
      padrao: 'SINTEGRA / CONFAZ (27 Estados)',
      uso: 'GET /api/ie?uf=SP&ie=110042490114 ou GET /api/ie/SP/110042490114'
    }, null, 2), {
      status: 200,
      headers: { 'Content-Type': 'application/json', ...TELEMETRY }
    });
  }
};
