// GET /api/config — chaves públicas para a página (nunca as secretas).
import { cfg, json, envStatus } from '../lib/loja.mjs';

// Liga/desliga Pix e cartão no site. Fica desligado até o PagBank liberar a conta (homologação).
const PAGAMENTO_NO_SITE = false;

export default async () => {
  const c = cfg();
  return json({ supabaseUrl: c.supabaseUrl, supabaseAnonKey: c.supabaseAnon, pagamentoOnline: !!c.pagbankToken && PAGAMENTO_NO_SITE, ambientePagamento: c.pagbankEnv, configurado: envStatus() });
};

export const config = { path: '/api/config' };
