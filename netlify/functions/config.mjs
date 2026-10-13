// GET /api/config — chaves públicas para a página (nunca as secretas).
import { cfg, json } from '../lib/loja.mjs';

export default async () => {
  const c = cfg();
  return json({ supabaseUrl: c.supabaseUrl, supabaseAnonKey: c.supabaseAnon, pagamentoOnline: !!c.pagbankToken, ambientePagamento: c.pagbankEnv });
};

export const config = { path: '/api/config' };
