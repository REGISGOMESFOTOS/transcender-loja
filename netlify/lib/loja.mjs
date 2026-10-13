// Funções compartilhadas pelo servidor da loja (Netlify Functions).
// Nada aqui roda no navegador: as chaves secretas ficam só no servidor.

const env = (k, d = '') => (globalThis.Netlify?.env?.get?.(k) ?? process.env[k] ?? d);

export const cfg = () => ({
  supabaseUrl: env('SUPABASE_URL').replace(/\/+$/, ''),
  supabaseAnon: env('SUPABASE_ANON_KEY'),
  supabaseService: env('SUPABASE_SERVICE_ROLE_KEY'),
  pagbankToken: env('PAGBANK_TOKEN'),
  pagbankEnv: (env('PAGBANK_ENV', 'sandbox') || 'sandbox').toLowerCase(),
  resendKey: env('RESEND_API_KEY'),
  emailTo: env('EMAIL_AVISOS'),
  emailFrom: env('EMAIL_REMETENTE', 'Loja <onboarding@resend.dev>'),
  siteUrl: (env('SITE_URL') || env('URL') || '').replace(/\/+$/, ''),
});

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });

// ---------- Supabase (REST, com a chave de serviço) ----------
export async function sb(path, { method = 'GET', body, prefer, headers = {} } = {}) {
  const c = cfg();
  if (!c.supabaseUrl || !c.supabaseService) throw new Error('Supabase não configurado (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY).');
  const res = await fetch(`${c.supabaseUrl}/rest/v1/${path}`, {
    method,
    headers: {
      apikey: c.supabaseService,
      // chave antiga (JWT "eyJ...") vai também no Authorization; a chave nova "sb_secret_..." vai só no apikey
      ...(c.supabaseService.startsWith('eyJ') ? { authorization: `Bearer ${c.supabaseService}` } : {}),
      'content-type': 'application/json',
      ...(prefer ? { prefer } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const err = new Error((data && (data.message || data.hint)) || `Supabase ${res.status}`);
    err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

export async function loadStore() {
  const [conf, prods] = await Promise.all([
    sb('config?id=eq.1&select=dados'),
    sb('produtos?select=id,dados,estoque'),
  ]);
  const settings = (conf && conf[0] && conf[0].dados) || {};
  const products = (prods || []).map((r) => ({ ...r.dados, id: r.id, stock: r.estoque || {} }));
  return { settings: settings.settings || {}, categories: settings.categories || [], products };
}

export const getDoc = async (path) => {
  const r = await sb(`docs?path=eq.${encodeURIComponent(path)}&select=dados`);
  return r && r[0] ? r[0].dados : null;
};
export const putDoc = (path, dados) => {
  const colecao = path.split('/').slice(0, -1).join('/');
  return sb('docs?on_conflict=path', { method: 'POST', body: [{ path, colecao, dados, atualizado: new Date().toISOString() }], prefer: 'resolution=merge-duplicates,return=minimal' });
};
export const patchDoc = async (path, patch) => {
  const cur = (await getDoc(path)) || {};
  const next = { ...cur, ...patch };
  await putDoc(path, next);
  return next;
};
export const listDocs = async (colecao, extra = '') =>
  ((await sb(`docs?colecao=eq.${encodeURIComponent(colecao)}&select=path,dados${extra}`)) || []).map((r) => r.dados);

export const reservar = (itens) => sb('rpc/reservar_estoque', { method: 'POST', body: { itens } });
export const devolver = (reservado) => sb('rpc/devolver_estoque', { method: 'POST', body: { reservado } });

// ---------- Regras da loja (iguais às da página) ----------
export const finalPrice = (p) => (p.salePrice && p.salePrice < p.price ? p.salePrice : p.price);
export const round2 = (n) => Math.round(n * 100) / 100;
export const money = (v) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
export const onlyDigits = (s) => String(s || '').replace(/\D/g, '');
export const brPhone = (s) => {
  let d = onlyDigits(s);
  if (d.length === 13 && d.startsWith('55')) d = d.slice(2);
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return s || '';
};
export const shipping = (settings) => ({ label: 'Moto Uber', area: 'Fortaleza', fee: 15, freeOver: 300, ...(settings.shipping || {}) });

export function newCode() {
  const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let s = '';
  for (let i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)];
  return s;
}

export function stamp(d = new Date()) {
  return d.toLocaleString('pt-BR', { timeZone: 'America/Fortaleza', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }).replace(',', '');
}

// Monta o pedido a partir do carrinho, recalculando tudo no servidor.
export function buildOrder(store, cart, buyer) {
  const s = store.settings || {};
  const errors = [];
  if (!Array.isArray(cart) || !cart.length) errors.push('Seu carrinho está vazio.');
  if (cart.length > 40) errors.push('Pedido grande demais. Fale com a loja pelo WhatsApp.');
  const name = String(buyer?.name || '').trim();
  if (name.split(/\s+/).filter((w) => w.length > 1).length < 2) errors.push('Escreva seu nome completo, com nome e sobrenome.');
  const pd = onlyDigits(buyer?.phone).replace(/^55(?=\d{10,11}$)/, '');
  if (pd.length < 10 || pd.length > 11) errors.push('Informe seu WhatsApp com DDD.');
  const mode = s.delivery && buyer?.mode === 'entrega' ? 'entrega' : 'retirada';
  const address = String(buyer?.address || '').trim().replace(/\s*\n\s*/g, ', ');
  if (mode === 'entrega' && address.length < 8) errors.push('Informe o endereço completo: rua, número e bairro.');

  const merged = new Map();
  const items = [];
  for (const l of cart || []) {
    const p = store.products.find((x) => x.id === l.pid);
    const qty = Math.floor(Number(l.qty));
    if (!p || p.active === false) { errors.push('Um produto do carrinho não está mais disponível.'); continue; }
    if (!(qty >= 1 && qty <= 50)) { errors.push(`Quantidade inválida em ${p.name}.`); continue; }
    const color = l.color || '';
    const size = l.size || '';
    if ((p.colors || []).length && !(p.colors || []).some((c) => c.name === color)) { errors.push(`Escolha uma cor válida para ${p.name}.`); continue; }
    if ((p.sizes || []).length && !(p.sizes || []).includes(size)) { errors.push(`Escolha um tamanho válido para ${p.name}.`); continue; }
    const key = `${p.id}|${color}|${size}`;
    if (merged.has(key)) { merged.get(key).qty += qty; continue; }
    const it = { pid: p.id, name: p.name, color, size, qty, price: finalPrice(p) };
    merged.set(key, it);
    items.push(it);
  }
  const subtotal = round2(items.reduce((t, i) => t + i.price * i.qty, 0));
  const sh = shipping(s);
  const free = sh.freeOver > 0 && subtotal >= sh.freeOver;
  const ship = mode === 'entrega' && !free ? round2(+sh.fee || 0) : 0;
  const shipCost = mode === 'entrega' && free ? round2(+sh.fee || 0) : 0;
  return {
    errors: [...new Set(errors)],
    order: {
      customer: { name, phone: brPhone(pd) },
      mode,
      address: mode === 'entrega' ? address + (String(buyer?.ref || '').trim() ? ` — Ref.: ${String(buyer.ref).trim()}` : '') : '',
      obs: String(buyer?.obs || '').trim().slice(0, 300),
      items,
      subtotal,
      ship,
      shipCost,
      total: round2(subtotal + ship),
    },
  };
}

// ---------- E-mail (Resend) ----------
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export function orderEmailHtml(o, title, storeName) {
  const c = cfg();
  const rows = (o.items || []).map((i) =>
    `<tr><td style="padding:6px 8px;border-bottom:1px solid #eee">${i.qty}× ${esc(i.name)}${i.color ? ' · ' + esc(i.color) : ''}${i.size ? ' · ' + esc(i.size) : ''}</td><td style="padding:6px 8px;border-bottom:1px solid #eee;text-align:right;white-space:nowrap">${money(i.price * i.qty)}</td></tr>`).join('');
  return `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#1c2233">
  <h2 style="margin:0 0 4px">${esc(title)}</h2>
  <p style="margin:0 0 16px;color:#5f6779">${esc(storeName || 'Loja')} · Pedido #${esc(o.code)} · ${esc(o.at || '')}</p>
  <p style="margin:0 0 4px"><b>${esc(o.customer?.name)}</b> · ${esc(o.customer?.phone)}</p>
  <p style="margin:0 0 12px;color:#5f6779">${o.mode === 'entrega' ? 'Entrega: ' + esc(o.address) : 'Retirada na loja'}<br>Pagamento: ${esc(o.pay || '')}${o.obs ? '<br>Obs: ' + esc(o.obs) : ''}</p>
  <table style="width:100%;border-collapse:collapse;font-size:14px">${rows}
  <tr><td style="padding:6px 8px">Subtotal</td><td style="padding:6px 8px;text-align:right">${money(o.subtotal)}</td></tr>
  ${o.mode === 'entrega' ? `<tr><td style="padding:6px 8px">Frete</td><td style="padding:6px 8px;text-align:right">${o.ship ? money(o.ship) : 'Grátis'}</td></tr>` : ''}
  <tr><td style="padding:6px 8px"><b>Total</b></td><td style="padding:6px 8px;text-align:right"><b>${money(o.total)}</b></td></tr></table>
  ${c.siteUrl ? `<p style="margin:20px 0 0"><a href="${esc(c.siteUrl)}/#painel" style="background:#1c2233;color:#fff;padding:10px 16px;border-radius:999px;text-decoration:none">Abrir o Painel</a></p>` : ''}
</div>`;
}

export async function sendEmail(subject, html) {
  const c = cfg();
  if (!c.resendKey || !c.emailTo) return { skipped: true };
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { authorization: `Bearer ${c.resendKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({ from: c.emailFrom, to: c.emailTo.split(',').map((x) => x.trim()).filter(Boolean), subject, html }),
    });
    if (!r.ok) console.error('Resend', r.status, await r.text());
    return { ok: r.ok };
  } catch (e) {
    console.error('Resend falhou', e);
    return { ok: false };
  }
}

// ---------- PagBank ----------
export const pagbankBase = () => (cfg().pagbankEnv === 'producao' || cfg().pagbankEnv === 'production' ? 'https://api.pagseguro.com' : 'https://sandbox.api.pagseguro.com');

export async function pagbank(path, { method = 'GET', body } = {}) {
  const c = cfg();
  if (!c.pagbankToken) throw new Error('PagBank não configurado (PAGBANK_TOKEN).');
  const res = await fetch(`${pagbankBase()}${path}`, {
    method,
    headers: { authorization: `Bearer ${c.pagbankToken}`, 'content-type': 'application/json', accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!res.ok) {
    const msg = data?.error_messages?.map((e) => e.description || e.message || e.error).join('; ') || data?.message || `PagBank ${res.status}`;
    const err = new Error(msg); err.status = res.status; err.data = data;
    throw err;
  }
  return data;
}

export const cents = (v) => Math.round(Number(v || 0) * 100);
