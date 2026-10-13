// POST /api/criar-pedido
// Recebe o carrinho do cliente, confere preços e estoque no servidor,
// reserva as peças e registra o pedido. Para Pix/cartão, cria o checkout no PagBank.
import { cfg, json, loadStore, buildOrder, reservar, devolver, putDoc, newCode, stamp, sendEmail, orderEmailHtml, pagbank, cents, getDoc } from '../lib/loja.mjs';

const MINUTOS_PAGAR = 60; // tempo para pagar online antes de liberar as peças

export default async (req) => {
  if (req.method !== 'POST') return json({ error: 'Use POST.' }, 405);
  let body;
  try { body = await req.json(); } catch { return json({ error: 'Pedido inválido.' }, 400); }
  const metodo = ['pix', 'cartao', 'whatsapp'].includes(body?.metodo) ? body.metodo : null;
  if (!metodo) return json({ error: 'Escolha a forma de pagamento.' }, 400);

  let store;
  try { store = await loadStore(); } catch (e) { console.error(e); return json({ error: 'A loja está fora do ar por um instante. Tente de novo.' }, 503); }

  const { errors, order } = buildOrder(store, body.cart || [], body.buyer || {});
  if (errors.length) return json({ error: errors[0], errors }, 400);
  if (order.total <= 0) return json({ error: 'O total do pedido precisa ser maior que zero.' }, 400);

  // código único
  let code = newCode();
  for (let i = 0; i < 4 && (await getDoc(`pedidos/${code}`)); i++) code = newCode();

  // reserva atômica do estoque
  let reserved = [];
  try {
    reserved = (await reservar(order.items.map((i) => ({ pid: i.pid, color: i.color, size: i.size, qty: i.qty })))) || [];
  } catch (e) {
    const m = String(e.message || '').match(/sem_estoque:([^:]+):([^:]*\|[^:]*):(\d+)/);
    if (m) {
      const p = store.products.find((x) => x.id === m[1]);
      const [cor, tam] = m[2].split('|');
      const n = +m[3];
      return json({
        error: `${p ? p.name : 'Uma peça'}${cor ? ' ' + cor : ''}${tam ? ' tamanho ' + tam : ''} ${n ? `só tem ${n} em estoque agora` : 'acabou de esgotar'}. Ajuste o carrinho e tente de novo.`,
        estoque: true,
      }, 409);
    }
    console.error('reservar', e);
    return json({ error: 'Não deu para reservar as peças. Tente de novo.' }, 500);
  }

  const now = Date.now();
  const online = metodo !== 'whatsapp';
  const pay = metodo === 'pix' ? 'Pix (no site)' : metodo === 'cartao' ? 'Cartão (no site)' : (['Pix', 'Cartão de crédito', 'Cartão de débito'].includes(body.buyer?.pay) ? body.buyer.pay : 'Pix');
  const doc = {
    ...order,
    code,
    ts: now,
    at: stamp(new Date(now)),
    status: online ? 'confirmado' : 'novo',
    online,
    metodo,
    pay,
    reserved,
    stockOut: reserved.length > 0,
    expiresTs: online ? now + MINUTOS_PAGAR * 60 * 1000 : now + 24 * 60 * 60 * 1000,
    items: order.items.map((i) => ({ ...i, cost: null })),
  };

  // custo das peças (para o lucro no Painel)
  try {
    const custos = (await getDoc('privado/custos')) || {};
    doc.items = doc.items.map((i) => ({ ...i, cost: typeof custos[i.pid] === 'number' ? custos[i.pid] : null }));
  } catch {}

  let payUrl = null;
  if (online) {
    const c = cfg();
    const base = c.siteUrl || new URL(req.url).origin;
    const hook = `${base}/api/pagbank-webhook?c=${code}`;
    try {
      const checkout = await pagbank('/checkouts', {
        method: 'POST',
        body: {
          reference_id: code,
          expiration_date: new Date(doc.expiresTs - 3 * 3600 * 1000).toISOString().slice(0, 19) + '-03:00',
          customer_modifiable: true,
          items: order.items.map((i, n) => ({
            reference_id: `${i.pid}-${n + 1}`.slice(0, 100),
            name: `${i.name}${i.color ? ' ' + i.color : ''}${i.size ? ' ' + i.size : ''}`.slice(0, 100),
            quantity: i.qty,
            unit_amount: cents(i.price),
          })),
          additional_amount: cents(order.ship),
          payment_methods: metodo === 'pix' ? [{ type: 'PIX' }] : [{ type: 'CREDIT_CARD' }],
          payment_methods_configs: metodo === 'cartao' ? [{ type: 'CREDIT_CARD', config_options: [{ option: 'INSTALLMENTS_LIMIT', value: '3' }] }] : undefined,
          soft_descriptor: String(store.settings.name || 'Loja').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 17) || undefined,
          redirect_url: `${base}/?pedido=${code}`,
          return_url: `${base}/?pedido=${code}`,
          notification_urls: [hook],
          payment_notification_urls: [hook],
        },
      });
      payUrl = (checkout.links || []).find((l) => String(l.rel).toUpperCase() === 'PAY')?.href || null;
      doc.checkoutId = checkout.id || null;
      if (!payUrl) throw new Error('PagBank não devolveu o link de pagamento.');
    } catch (e) {
      console.error('PagBank checkout', e.status, e.message, JSON.stringify(e.data || {}));
      try { await devolver(reserved); } catch (e2) { console.error('devolver', e2); }
      return json({ error: 'Não conseguimos abrir o pagamento agora. Tente de novo ou finalize pelo WhatsApp.', detalhe: `PagBank ${e.status || ''}: ${String(e.message || '').slice(0, 300)}` }, 502);
    }
  }

  try {
    await putDoc(`pedidos/${code}`, doc);
  } catch (e) {
    console.error('salvar pedido', e);
    try { await devolver(reserved); } catch {}
    return json({ error: 'Não deu para registrar o pedido. Tente de novo.' }, 500);
  }

  // Pedido pelo WhatsApp: avisa por e-mail na hora. Pedido online: o e-mail vai quando o pagamento for confirmado.
  if (!online) {
    await sendEmail(`Novo pedido #${code} pelo WhatsApp — ${doc.customer.name}`, orderEmailHtml(doc, 'Novo pedido (finalizar pelo WhatsApp)', store.settings.name));
  }

  return json({ ok: true, code, total: doc.total, payUrl });
};

export const config = { path: '/api/criar-pedido' };
