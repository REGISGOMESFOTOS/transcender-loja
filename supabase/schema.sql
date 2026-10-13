-- =====================================================================
--  Transcender Camisas — banco de dados (Supabase)
--  Cole este arquivo inteiro em: Supabase → SQL Editor → New query → Run
--  Pode rodar de novo sem problema: ele não apaga dados existentes.
-- =====================================================================

-- 1) Tabelas ------------------------------------------------------------

-- Configurações da loja (nome, WhatsApp, frete, categorias, logo...)
create table if not exists public.config (
  id int primary key default 1 check (id = 1),
  dados jsonb not null default '{}'::jsonb,
  atualizado timestamptz not null default now()
);

-- Produtos (dados públicos) e estoque por "cor|tamanho"
create table if not exists public.produtos (
  id text primary key,
  dados jsonb not null,
  estoque jsonb not null default '{}'::jsonb,
  ordem int not null default 0,
  atualizado timestamptz not null default now()
);

-- Quem pode entrar no Painel (e-mails da equipe)
create table if not exists public.equipe (
  email text primary key
);

-- Dados privados do Painel: pedidos, avisos, custos, metas, caixa...
create table if not exists public.docs (
  path text primary key,
  colecao text not null,
  dados jsonb not null,
  atualizado timestamptz not null default now()
);
create index if not exists docs_colecao_idx on public.docs (colecao);

-- 2) Quem é da equipe ---------------------------------------------------
create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.equipe
    where lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
grant execute on function public.is_admin() to anon, authenticated;

-- 3) Regras de acesso (RLS) --------------------------------------------
alter table public.config   enable row level security;
alter table public.produtos enable row level security;
alter table public.equipe   enable row level security;
alter table public.docs     enable row level security;

drop policy if exists "config leitura publica" on public.config;
create policy "config leitura publica" on public.config for select using (true);
drop policy if exists "config equipe escreve" on public.config;
create policy "config equipe escreve" on public.config for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "produtos leitura publica" on public.produtos;
create policy "produtos leitura publica" on public.produtos for select using (true);
drop policy if exists "produtos equipe escreve" on public.produtos;
create policy "produtos equipe escreve" on public.produtos for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "equipe ve equipe" on public.equipe;
create policy "equipe ve equipe" on public.equipe for select to authenticated using (public.is_admin());
drop policy if exists "equipe gerencia equipe" on public.equipe;
create policy "equipe gerencia equipe" on public.equipe for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

drop policy if exists "docs so equipe" on public.docs;
create policy "docs so equipe" on public.docs for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- 4) Estoque: reservar e devolver (atômico, sem vender a mesma peça 2x) --
create or replace function public.reservar_estoque(itens jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  it jsonb; p record; k text; disp int; q int;
  reservado jsonb := '[]'::jsonb;
begin
  for it in
    select value from jsonb_array_elements(itens) order by value->>'pid', value->>'color', value->>'size'
  loop
    select * into p from public.produtos where id = it->>'pid' for update;
    if not found then
      raise exception 'produto_inexistente:%', it->>'pid';
    end if;
    q := (it->>'qty')::int;
    if q is null or q < 1 then
      raise exception 'quantidade_invalida:%', it->>'pid';
    end if;
    if coalesce((p.dados->>'trackStock')::boolean, false) then
      k := coalesce(it->>'color', '') || '|' || coalesce(it->>'size', '');
      disp := coalesce((p.estoque->>k)::int, 0);
      if disp < q then
        raise exception 'sem_estoque:%:%:%', p.id, k, disp;
      end if;
      update public.produtos
        set estoque = jsonb_set(estoque, array[k], to_jsonb(disp - q), true), atualizado = now()
        where id = p.id;
      reservado := reservado || jsonb_build_object('pid', p.id, 'k', k, 'qty', q);
    end if;
  end loop;
  return reservado;
end $$;

create or replace function public.devolver_estoque(reservado jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare r jsonb; atual int;
begin
  if not (public.is_admin() or coalesce(auth.role(), '') = 'service_role') then
    raise exception 'sem_permissao';
  end if;
  for r in select value from jsonb_array_elements(coalesce(reservado, '[]'::jsonb)) loop
    select coalesce((estoque->>(r->>'k'))::int, 0) into atual from public.produtos where id = r->>'pid' for update;
    if found then
      update public.produtos
        set estoque = jsonb_set(estoque, array[r->>'k'], to_jsonb(atual + (r->>'qty')::int), true), atualizado = now()
        where id = r->>'pid';
    end if;
  end loop;
end $$;

revoke all on function public.reservar_estoque(jsonb) from public, anon, authenticated;
grant execute on function public.reservar_estoque(jsonb) to service_role;
revoke all on function public.devolver_estoque(jsonb) from public, anon;
grant execute on function public.devolver_estoque(jsonb) to authenticated, service_role;

-- 5) Tempo real para o Painel ------------------------------------------
do $$ begin
  begin
    alter publication supabase_realtime add table public.docs;
  exception when duplicate_object then null;
  end;
  begin
    alter publication supabase_realtime add table public.produtos;
  exception when duplicate_object then null;
  end;
end $$;

-- 6) Fotos (Storage) ----------------------------------------------------
insert into storage.buckets (id, name, public)
values ('fotos', 'fotos', true)
on conflict (id) do update set public = true;

drop policy if exists "fotos leitura publica" on storage.objects;
create policy "fotos leitura publica" on storage.objects for select using (bucket_id = 'fotos');
drop policy if exists "fotos equipe envia" on storage.objects;
create policy "fotos equipe envia" on storage.objects for insert to authenticated
  with check (bucket_id = 'fotos' and public.is_admin());
drop policy if exists "fotos equipe altera" on storage.objects;
create policy "fotos equipe altera" on storage.objects for update to authenticated
  using (bucket_id = 'fotos' and public.is_admin());
drop policy if exists "fotos equipe apaga" on storage.objects;
create policy "fotos equipe apaga" on storage.objects for delete to authenticated
  using (bucket_id = 'fotos' and public.is_admin());

-- 7) Linha inicial de configuração --------------------------------------
insert into public.config (id, dados) values (1, '{}'::jsonb) on conflict (id) do nothing;

-- 8) SEU E-MAIL na equipe (troque pelo e-mail que você vai usar no Painel)
insert into public.equipe (email) values (regisbgomes@gmail.com) on conflict do nothing;
