// GET /api/config — chaves públicas para a página (nunca as secretas).
import { cfg, json, envStatus } from '../lib/loja.mjs';

export default async () => {
  const c = cfg();
  return json({ supabaseUrl: c.supabaseUrl, supabaseAnonKey: c.supabaseAnon, pagamentoOnline: !!c.pagbankToken, ambientePagamento: c.pagbankEnv, configurado: envStatus() });
};

export const config = { path: '/api/config' };
