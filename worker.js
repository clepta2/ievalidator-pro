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

    // Puxar Inscrições Estaduais por CNPJ na SEFAZ: GET /api/ie/consultar?cnpj=... ou /api/ie/puxar?cnpj=...
    const matchCnpj = path.match(/^\/api\/ie\/cnpj\/(\d{14})$/i) || path.match(/^\/api\/ie\/consultar\/(\d{14})$/i);
    let cnpjInput = url.searchParams.get('cnpj') || (matchCnpj ? matchCnpj[1] : null);

    if (cnpjInput || path === '/api/ie/consultar' || path === '/api/ie/puxar') {
      const cleanCnpj = String(cnpjInput || '').replace(/\D/g, '');
      if (cleanCnpj.length !== 14) {
        return new Response(JSON.stringify({ ok: false, error: 'CNPJ_INVALIDO', mensagem: 'Informe um CNPJ válido com 14 dígitos numéricos para puxar as Inscrições Estaduais.' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json', ...TELEMETRY }
        });
      }

      const ufFiltro = (url.searchParams.get('uf') || '').trim().toUpperCase();

      try {
        const liveRes = await fetch(`https://publica.cnpj.ws/cnpj/${cleanCnpj}`, {
          headers: { 'User-Agent': 'IEValidator-Edge/1.0' },
          signal: AbortSignal.timeout(6000)
        });

        if (liveRes.ok) {
          const d = await liveRes.json();
          const est = d.estabelecimento || {};
          let rawIes = est.inscricoes_estaduais || [];

          if (ufFiltro) {
            rawIes = rawIes.filter(i => (i.estado?.sigla || '').toUpperCase() === ufFiltro);
          }

          const iesFormatadas = rawIes.map(i => {
            const siglaUf = (i.estado?.sigla || '').toUpperCase();
            const val = validarIePorEstado(siglaUf, i.inscricao_estadual);
            return {
              uf: siglaUf,
              estado: i.estado?.nome || siglaUf,
              inscricaoEstadual: i.inscricao_estadual,
              ieFormatada: val.valido ? val.ie : i.inscricao_estadual,
              ativoSefaz: Boolean(i.ativo),
              validoMatematicamente: val.valido,
              atualizadoEm: i.atualizado_em || null
            };
          });

          return new Response(JSON.stringify({
            ok: true,
            cnpj: cleanCnpj,
            razaoSocial: d.razao_social || '',
            nomeFantasia: est.nome_fantasia || '',
            ufFiltro: ufFiltro || 'TODAS',
            totalIesEncontradas: iesFormatadas.length,
            totalIesAtivas: iesFormatadas.filter(i => i.ativoSefaz).length,
            inscricoesEstaduais: iesFormatadas,
            origem: 'sefaz_sintegra_nacional',
            timestamp: new Date().toISOString()
          }, null, 2), {
            status: 200,
            headers: { 'Content-Type': 'application/json', ...TELEMETRY }
          });
        }
      } catch (err) {
        return new Response(JSON.stringify({ ok: false, error: 'SEFAZ_INDISPONIVEL', mensagem: 'Falha temporária ao consultar a base do SINTEGRA/SEFAZ: ' + err.message }), {
          status: 502,
          headers: { 'Content-Type': 'application/json', ...TELEMETRY }
        });
      }
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
