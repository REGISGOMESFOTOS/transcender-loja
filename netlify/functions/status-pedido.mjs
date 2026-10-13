// GET /api/status-pedido?c=CODIGO — usado pela página de retorno do pagamento.
import { json, getDoc } from '../lib/loja.mjs';

export default async (req) => {
  const code = String(new URL(req.url).searchParams.get('c') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return json({ error: 'Código inválido.' }, 400);
  const d = await getDoc(`pedidos/${code}`);
  if (!d) return json({ error: 'Pedido não encontrado.' }, 404);
  return json({ code, status: d.status, total: d.total, metodo: d.metodo, analise: !!d.analise, nome: String(d.customer?.name || '').split(' ')[0] });
};

export const config = { path: '/api/status-pedido' };
