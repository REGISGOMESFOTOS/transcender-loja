// Roda sozinho a cada 10 minutos.
// - Pedido online não pago no prazo: cancela e devolve as peças ao estoque.
// - Pedido pelo WhatsApp que ficou 24h sem ser confirmado: cancela e devolve as peças.
import { listDocs, putDoc, devolver, pagbank, stamp } from '../lib/loja.mjs';

const FOLGA = 10 * 60 * 1000; // 10 min de tolerância depois do prazo

export default async () => {
  const agora = Date.now();
  const pedidos = await listDocs('pedidos');
  let cancelados = 0;
  for (const o of pedidos) {
    const vencidoOnline = o.status === 'confirmado' && o.online && !o.analise && o.expiresTs && agora > o.expiresTs + FOLGA;
    const vencidoWhats = o.status === 'novo' && !o.online && o.expiresTs && agora > o.expiresTs;
    if (!vencidoOnline && !vencidoWhats) continue;
    try {
      if (o.reserved && o.reserved.length) await devolver(o.reserved);
      if (o.checkoutId) { try { await pagbank(`/checkouts/${encodeURIComponent(o.checkoutId)}/inactivate`, { method: 'POST' }); } catch {} }
      await putDoc(`pedidos/${o.code}`, {
        ...o,
        status: 'cancelado',
        reserved: [],
        stockOut: false,
        canceledAt: stamp(),
        motivo: vencidoOnline ? 'Pagamento não feito no prazo' : 'Não confirmado em 24h',
      });
      cancelados++;
    } catch (e) {
      console.error('expirar', o.code, e);
    }
  }
  console.log(`expirar-pedidos: ${cancelados} cancelado(s)`);
};

export const config = { schedule: '*/10 * * * *' };
