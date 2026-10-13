// POST /api/pagbank-webhook?c=CODIGO
// O PagBank chama este endereço quando o pagamento muda de situação.
// Por segurança, não confiamos no conteúdo recebido: consultamos o pedido direto no PagBank.
import { json, getDoc, putDoc, pagbank, reservar, sendEmail, orderEmailHtml, stamp, cents, loadStore } from '../lib/loja.mjs';

const pagoDe = (o) => (o?.charges || []).filter((c) => String(c.status).toUpperCase() === 'PAID');

export default async (req) => {
  if (req.method !== 'POST') return json({ ok: true });
  const url = new URL(req.url);
  let payload = {};
  try { payload = await req.json(); } catch {}

  const code = String(url.searchParams.get('c') || payload.reference_id || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return json({ ok: true, ignorado: 'sem código' });
  const path = `pedidos/${code}`;
  const doc = await getDoc(path);
  if (!doc) return json({ ok: true, ignorado: 'pedido não encontrado' });

  // Confirma no PagBank a partir do ID do pedido (ORDE_...) que veio na notificação.
  let pbOrder = null;
  const orderId = String(payload.id || '').startsWith('ORDE_') ? payload.id : null;
  if (orderId) {
    try { pbOrder = await pagbank(`/orders/${encodeURIComponent(orderId)}`); }
    catch (e) { console.error('consulta PagBank', e.status, e.message); return json({ error: 'consulta falhou' }, 500); }
  } else {
    // notificação do checkout (ex.: EXPIRED) — nada a fazer aqui; o prazo é tratado pela rotina de expiração
    return json({ ok: true, tipo: 'checkout', status: payload.status || null });
  }

  if (String(pbOrder.reference_id || '') !== code) return json({ ok: true, ignorado: 'referência diferente' });

  const pagos = pagoDe(pbOrder);
  const statusCobranca = String((pbOrder.charges || [])[0]?.status || '').toUpperCase();
  const valorPago = pagos.reduce((t, c) => t + Number(c.amount?.value || 0), 0);

  if (pagos.length) {
    if (doc.status === 'pago' || doc.status === 'enviado') return json({ ok: true, jaPago: true });
    if (valorPago < cents(doc.total)) {
      console.error('valor pago menor que o pedido', code, valorPago, cents(doc.total));
      await putDoc(path, { ...doc, alerta: `Valor pago (${valorPago / 100}) menor que o total do pedido.` });
      return json({ ok: true, alerta: 'valor' });
    }
    const tipo = String(pagos[0].payment_method?.type || '').toUpperCase();
    const next = {
      ...doc,
      status: 'pago',
      paidTs: Date.now(),
      paidAt: stamp(),
      pay: tipo === 'PIX' ? 'Pix (pago no site)' : tipo === 'CREDIT_CARD' ? 'Cartão de crédito (pago no site)' : tipo === 'DEBIT_CARD' ? 'Cartão de débito (pago no site)' : doc.pay,
      pagbankOrder: pbOrder.id,
      analise: false,
    };
    // Pago depois de o prazo ter vencido: tenta reservar de novo as peças.
    if (doc.status === 'cancelado') {
      try {
        next.reserved = (await reservar(doc.items.map((i) => ({ pid: i.pid, color: i.color, size: i.size, qty: i.qty })))) || [];
        next.stockOut = next.reserved.length > 0;
        next.alerta = 'Pagamento chegou depois do prazo. As peças foram reservadas de novo.';
      } catch (e) {
        next.reserved = []; next.stockOut = false;
        next.alerta = 'ATENÇÃO: pagamento chegou depois do prazo e alguma peça já não tem estoque. Fale com o cliente.';
      }
    }
    await putDoc(path, next);
    let nome = 'Loja';
    try { nome = (await loadStore()).settings.name || nome; } catch {}
    await sendEmail(`Pedido #${code} PAGO — ${next.customer?.name} — falta enviar`, orderEmailHtml(next, next.alerta ? `Pagamento confirmado · ${next.alerta}` : 'Pagamento confirmado · falta enviar', nome));
    return json({ ok: true, status: 'pago' });
  }

  if (statusCobranca === 'IN_ANALYSIS' && doc.status === 'confirmado') {
    await putDoc(path, { ...doc, analise: true, pay: 'Cartão (em análise no PagBank)' });
    return json({ ok: true, status: 'analise' });
  }
  if ((statusCobranca === 'DECLINED' || statusCobranca === 'CANCELED') && doc.status === 'confirmado') {
    await putDoc(path, { ...doc, analise: false, ultimaRecusa: stamp() });
    return json({ ok: true, status: 'recusado' });
  }
  return json({ ok: true, status: statusCobranca || 'sem mudança' });
};

export const config = { path: '/api/pagbank-webhook' };
