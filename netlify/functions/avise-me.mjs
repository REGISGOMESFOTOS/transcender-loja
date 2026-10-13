// POST /api/avise-me — cliente pede aviso de reposição; entra direto na aba Avisos.
import { json, loadStore, putDoc, listDocs, newCode, stamp, sendEmail, onlyDigits, brPhone } from '../lib/loja.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  let b;
  try { b = await req.json(); } catch { return json({ error: 'Pedido inválido.' }, 400); }
  const name = String(b?.name || '').trim();
  if (name.split(/\s+/).filter((w) => w.length > 1).length < 2) return json({ error: 'Escreva seu nome completo, com nome e sobrenome.' }, 400);
  const pd = onlyDigits(b?.phone).replace(/^55(?=\d{10,11}$)/, '');
  if (pd.length < 10 || pd.length > 11) return json({ error: 'Informe seu WhatsApp com DDD.' }, 400);

  const store = await loadStore();
  const p = store.products.find((x) => x.id === b?.pid);
  if (!p) return json({ error: 'Produto não encontrado.' }, 404);
  const color = (p.colors || []).some((c) => c.name === b.color) ? b.color : '';
  const size = (p.sizes || []).includes(b.size) ? b.size : '';
  const phone = brPhone(pd);

  // evita duplicar o mesmo pedido de aviso
  const existentes = await listDocs('avisos');
  const dup = existentes.find((a) => a.status === 'pendente' && a.pid === p.id && a.color === color && a.size === size && String(a.phone).replace(/\D/g, '') === pd);
  if (dup) return json({ ok: true, code: dup.code, repetido: true });

  const code = newCode();
  const a = { code, pid: p.id, name: p.name, color, size, cname: name, phone, ts: Date.now(), at: stamp(), status: 'pendente', origem: 'site' };
  await putDoc(`avisos/${code}`, a);
  await sendEmail(
    `Pedido de aviso: ${p.name}${color ? ' ' + color : ''}${size ? ' ' + size : ''} — ${name}`,
    `<div style="font-family:Arial,sans-serif;color:#1c2233"><h3 style="margin:0 0 8px">Cliente quer ser avisado(a) da reposição</h3><p><b>${esc(p.name)}</b>${color ? ' · ' + esc(color) : ''}${size ? ' · tamanho ' + esc(size) : ''}</p><p>${esc(name)} · ${esc(phone)}</p></div>`,
  );
  return json({ ok: true, code });
};

export const config = { path: '/api/avise-me' };
