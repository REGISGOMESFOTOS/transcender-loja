# Transcender Camisas — loja virtual

Site da loja com pagamento **Pix e cartão pelo PagBank**, opção de **finalizar pelo WhatsApp**, estoque automático, e-mail de aviso a cada pedido e Painel com login para a equipe.

| Peça | Serviço | Para quê |
|---|---|---|
| Site e funções | Netlify | Coloca a loja no ar e roda o "servidor" |
| Banco de dados e login | Supabase | Produtos, estoque, pedidos, clientes, financeiro, fotos |
| Pagamentos | PagBank | Pix e cartão de crédito |
| E-mails | Resend | Aviso de pedido novo / pago e de "me avise" |

---

## Passo a passo de instalação

Faça **na ordem**. Cada passo leva poucos minutos.

### 1. Supabase (banco de dados)
1. Em **supabase.com**, abra o projeto `transcender`.
2. Menu da esquerda → **SQL Editor** → **New query**.
3. Abra o arquivo [`supabase/schema.sql`](supabase/schema.sql) deste repositório, copie tudo e cole no editor.
4. **Na última linha**, troque `SEU-EMAIL-AQUI@gmail.com` pelo e-mail que você vai usar para entrar no Painel.
5. Clique em **Run**. Deve aparecer "Success".
6. Menu → **Project Settings** → **API Keys** (ou **Data API**). Anote três coisas:
   - **Project URL** (ex.: `https://abcd1234.supabase.co`)
   - **anon / public** key (na aba *Legacy API keys*, começa com `eyJ...`)
   - **service_role** key (mesma aba, clique em *Reveal*). ⚠️ Esta é secreta: não mande para ninguém.

### 1b. Histórico de segurança (recomendado)
No SQL Editor, rode também o arquivo [`supabase/historico.sql`](supabase/historico.sql). Ele guarda uma cópia de tudo que for alterado ou apagado (produtos, configurações, pedidos, financeiro), para nada se perder.

### 2. Resend (e-mails)
1. Em **resend.com** → **API Keys** → **Create API Key** (permissão *Sending access*). Copie a chave (`re_...`).
2. Sem domínio próprio, o Resend só envia para o e-mail da sua conta Resend. Use esse e-mail no passo 4.

### 3. PagBank (pagamentos)
1. Pelo computador, entre em **acesso.pagbank.com.br**.
2. Menu **Venda online** → **Integrações** → **Gerar Token**. Copie o token.
3. Primeiro teste: deixe `PAGBANK_ENV = producao` e faça uma compra real de valor baixo (dá para criar um produto de teste de R$ 1,00 e ocultar depois).
4. Se ao pagar aparecer erro de liberação (`allowlist_access_required`), o PagBank exige uma **homologação** da conta para usar o Checkout por API. Fale com o suporte do PagBank pedindo a liberação do **Checkout PagBank via API**. Enquanto isso, a loja continua aceitando pedidos pelo WhatsApp normalmente.

### 4. Netlify (colocar no ar)
1. Em **netlify.com** → **Add new project** → **Import an existing project** → **GitHub** → escolha `transcender-loja` → **Deploy**.
2. Depois do primeiro deploy: **Project configuration** → **Environment variables** → **Add a variable**, uma por vez:

| Nome | Valor |
|---|---|
| `SUPABASE_URL` | Project URL do Supabase |
| `SUPABASE_ANON_KEY` | chave anon/public |
| `SUPABASE_SERVICE_ROLE_KEY` | chave service_role |
| `PAGBANK_TOKEN` | token do PagBank |
| `PAGBANK_ENV` | `producao` (ou `sandbox` para testes) |
| `RESEND_API_KEY` | chave do Resend |
| `EMAIL_AVISOS` | seu e-mail (o mesmo da conta Resend) |
| `SITE_URL` | endereço do site, ex.: `https://transcender.netlify.app` |

3. **Deploys** → **Trigger deploy** → **Deploy site** (para as variáveis valerem).
4. (Opcional) **Domain management** → mude o nome do site para `transcender` ou conecte seu domínio.

### 5. Supabase: endereço do site (para os e-mails de login)
1. Supabase → **Authentication** → **URL Configuration**.
2. **Site URL**: o endereço do site (o mesmo do `SITE_URL`).
3. Em **Redirect URLs**, adicione `https://SEU-SITE/#painel`.

### 6. Primeiro acesso e importação
1. Abra o site → no rodapé, **Área da equipe** → **Primeiro acesso** → seu e-mail (o mesmo do passo 1.4) e uma senha.
2. Confirme pelo link que chega no e-mail e entre.
3. **Configurações** → **Importar da loja antiga** → escolha o arquivo `importacao-loja.json` → **Publicar alterações**.
4. Confira as fotos dos produtos (cadastre as que faltarem) e pronto.

### 7. Dar acesso a outra pessoa
**Configurações** → **Equipe com acesso ao Painel** → adicione o e-mail dela. Ela entra em **Área da equipe** → **Primeiro acesso**.

---

## Como funciona

- **Pix / cartão no site**: as peças são reservadas e o cliente vai para a página segura do PagBank. Quando o pagamento cai, o PagBank avisa o site, o pedido vira **Pago · falta enviar** e você recebe um e-mail. Sem pagamento em 1 hora, o pedido é cancelado e as peças voltam ao estoque.
- **WhatsApp**: o pedido é registrado como **Novo · a confirmar**, as peças ficam reservadas, você recebe um e-mail e o WhatsApp da loja abre com a mensagem. Se ninguém confirmar em 24 horas, ele é cancelado e as peças voltam.
- **Me avise quando chegar**: o pedido de aviso entra direto na aba **Avisos** e chega por e-mail.
- **Preços e estoque são conferidos no servidor**: ninguém consegue mudar o preço pelo navegador nem comprar peça que acabou.

## Estrutura

```
public/index.html                 loja + painel (uma página)
netlify/functions/                "servidor"
  criar-pedido.mjs                registra pedido, reserva estoque, abre pagamento
  pagbank-webhook.mjs             recebe a confirmação de pagamento
  expirar-pedidos.mjs             roda a cada 10 min e libera pedidos vencidos
  avise-me.mjs                    pedido de aviso de reposição
  status-pedido.mjs, config.mjs
netlify/lib/loja.mjs              regras compartilhadas (preço, frete, e-mail, PagBank)
supabase/schema.sql               banco de dados e regras de acesso
```
