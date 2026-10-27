-- =====================================================================
--  Transcender Camisas — HISTÓRICO DE SEGURANÇA
--  Guarda uma cópia de tudo que for alterado ou apagado em produtos,
--  configurações e dados do Painel (pedidos, clientes, financeiro...).
--  Rode uma vez em: Supabase → SQL Editor → New query → Run
--  Pode rodar de novo sem problema.
-- =====================================================================

create table if not exists public.historico (
  id bigserial primary key,
  tabela text not null,
  chave text not null,
  acao text not null,
  dados_antigos jsonb not null,
  quem text,
  quando timestamptz not null default now()
);
create index if not exists historico_chave_idx on public.historico (tabela, chave, quando desc);

alter table public.historico enable row level security;
drop policy if exists "historico so equipe le" on public.historico;
create policy "historico so equipe le" on public.historico for select to authenticated using (public.is_admin());

create or replace function public.guardar_historico() returns trigger
language plpgsql security definer set search_path = public as $$
declare k text;
begin
  k := coalesce(to_jsonb(old)->>'id', to_jsonb(old)->>'path', '?');
  -- não guarda se nada mudou de verdade
  if tg_op = 'UPDATE' and to_jsonb(old) - 'atualizado' = to_jsonb(new) - 'atualizado' then
    return new;
  end if;
  insert into public.historico (tabela, chave, acao, dados_antigos, quem)
  values (tg_table_name, k, tg_op, to_jsonb(old), coalesce(auth.jwt() ->> 'email', auth.role()));
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

drop trigger if exists historico_produtos on public.produtos;
create trigger historico_produtos before update or delete on public.produtos
  for each row execute function public.guardar_historico();

drop trigger if exists historico_config on public.config;
create trigger historico_config before update or delete on public.config
  for each row execute function public.guardar_historico();

drop trigger if exists historico_docs on public.docs;
create trigger historico_docs before update or delete on public.docs
  for each row execute function public.guardar_historico();
