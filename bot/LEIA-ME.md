# Bot do Telegram · Minhas Finanças (@violinhabot)

Você manda `5,50 salgado nubank` e o lançamento cai no app. Roda grátis no Cloudflare Workers.
Este arquivo e o `worker.js` não têm nenhum segredo: os tokens ficam só no Cloudflare.

## Configuração pelo celular (≈15 min)

### 1. Token do bot
No Telegram, abra **@BotFather** → `/mybots` → **@violinhabot** → **API Token** → copie.

### 2. Chave do Firebase (conta de serviço)
1. No navegador do celular: **console.firebase.google.com** → projeto **minhas-financas**.
2. ⚙️ **Configurações do projeto** → aba **Contas de serviço** → **Gerar nova chave privada** → confirmar.
3. Um arquivo `.json` é baixado. Abra-o (Arquivos → Downloads → abrir com um editor de texto) e **copie todo o conteúdo**.
   ⚠️ Essa chave dá acesso total ao banco de dados: não mande para ninguém. Depois de colar no Cloudflare, apague o arquivo do celular.

### 3. Seu UID
Ainda no Firebase: **Authentication** → **Usuários** → copie o **UID do usuário** da sua conta Google.

### 4. Criar o Worker
1. Acesse **dash.cloudflare.com** e crie uma conta gratuita.
2. **Workers e Pages** → **Criar** → **Criar Worker** → nome: `violinha-bot` → **Implantar**.
3. **Editar código** → apague tudo → cole o conteúdo de
   `https://raw.githubusercontent.com/victxrrdgs/financas/main/bot/worker.js` → **Implantar**.

### 5. Variáveis
No Worker: **Configurações** → **Variáveis e segredos** → **Adicionar**:

| Nome | Tipo | Valor |
|---|---|---|
| `BOT_TOKEN` | Segredo | token do passo 1 |
| `FIREBASE_SA` | Segredo | JSON inteiro do passo 2 |
| `USER_UID` | Texto | UID do passo 3 |
| `WEBHOOK_SECRET` | Segredo | invente uma senha só com letras e números |

Salve e **implante**.

### 6. Conectar o Telegram
Abra no navegador: `https://violinha-bot.SEU-USUARIO.workers.dev/setup?key=SUA_SENHA_DO_WEBHOOK`
(o endereço exato aparece no topo da página do Worker). Deve aparecer **✅ Bot conectado!**

### 7. Liberar só para você
1. Mande `/start` para o @violinhabot. Ele responde com o seu **chat id**.
2. Crie a variável `ALLOWED_CHAT` (Texto) com esse número → implante.
3. Mande `/start` de novo: deve aparecer **✅ Bot liberado para você**.

## Como usar
- `5,50 salgado nubank` → compra no cartão Nubank
- `120 tênis inter 3x` → R$ 120 em 3x no Inter
- `pix 50 mercado itaú` / `débito 30 padaria nubank` → pago da conta
- `recebi 1800 seguro nubank` → entrada
- `ontem 40 ifood nubank` · `12/11 89,90 farmácia inter` → outra data
- Botões: **Mudar categoria** e **Desfazer**
- `/contas` lista os cartões e contas · `/ajuda` mostra os exemplos

O bot reconhece o cartão/conta pelo nome cadastrado no app (ex.: "nubank", "inter", "itaú platinum", "mp" para Mercado Pago, "pão de açúcar").
Quando o mesmo nome é cartão e conta (Nubank), compra vai para o cartão e pix/débito para a conta.

## Próximas versões (no PC de casa)
Foto do comprovante (leitura por IA), áudio, consulta de saldo e de fatura pelo bot, avisos de vencimento.
