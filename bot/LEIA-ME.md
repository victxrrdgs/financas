# Bot do Telegram · Minhas Finanças

O bot roda no **Google Apps Script** (`apps-script.gs`), na própria conta Google do dono do projeto Firebase.
Ele grava direto no Firestore pela API REST com o token da conta (`ScriptApp.getOAuthToken()`), sem chave secreta.

> `worker.js` é a versão antiga (Cloudflare) e não é mais usada.

## O que ele faz

| Mensagem | Resultado |
|---|---|
| `50 salgado nubank` | lança o gasto (cartão ou conta pelo nome) |
| 📷 foto de comprovante / PDF | lê por OCR (valor, data, loja) e pede confirmação ✅ |
| `/saldo` | saldo de cada conta + menor saldo previsto |
| `/fatura` · `/fatura nubank` | faturas abertas (com itens quando escolhe um cartão) |
| `/hoje` | quanto pode gastar por dia até a próxima entrada |
| `/avisos` | vencimentos, faturas fechando, orçamentos e saldo negativo |
| `/contas` · `/ajuda` | lista carteiras · ajuda |
| `quanto gastei com mercado` · `… em outubro` | total da categoria no período (padrão: mês atual) |
| `quanto gastei essa semana` · `… mês passado` | total do período e as 3 categorias principais |
| `qual a maior despesa do mês` | os maiores gastos do período |

Todo dia às 8h o bot manda os avisos sozinho (só quando há algo para avisar), com botões:
**✓ Paguei** (marca paga na carteira da conta e mostra o saldo, com **Trocar conta** e **Desfazer**),
**Adiar** (+1, +3 ou +7 dias), **Ver fatura** e **Ver tudo**. No dia 1 também manda o fechamento do mês anterior.

A leitura de texto (`interpretar`) é a mesma do `parser.js` do app: mude nos dois.

**Publicar mudanças no bot:** pelo `clasp` (`clasp push` com o código em `Código.js`), sem colar no editor.

Os cálculos de saldo, fatura e projeção são uma cópia de `calc.js` e `planos.js` (objeto `CALC` no fim do arquivo).
Se a regra mudar no app, copie de novo esses trechos.

## Como está montado

- **Busca de mensagens:** `poll()` roda a cada 1 minuto (acionador) e usa `getUpdates`.
  O webhook não funciona porque o Apps Script responde com redirecionamento 302.
- **Pareamento:** o primeiro chat que manda `/start` vira o dono (`ALLOWED_CHAT`); os outros são ignorados.
- **Propriedades do script:** `BOT_TOKEN`, `SEGREDO`, `ALLOWED_CHAT`, `OFFSET`. O token nunca fica no código.
- **OCR:** sobe a imagem para o Drive convertendo em Google Doc, exporta o texto e apaga o arquivo.
  Precisa do serviço avançado **Drive API** ativado no projeto.
- **Acionadores:** `poll` (a cada minuto) e `avisoDiario` (todo dia, 8h às 9h).

## Escopos (`appsscript.json`)

```json
"oauthScopes": [
  "https://www.googleapis.com/auth/datastore",
  "https://www.googleapis.com/auth/script.external_request",
  "https://www.googleapis.com/auth/drive.file"
]
```

## Instalar do zero

1. Crie um projeto em script.google.com, cole `apps-script.gs` e ajuste `PROJETO` e `UID`.
2. Adicione o serviço **Drive API** e os escopos acima no `appsscript.json`.
3. Implante como app da Web, abra a URL e cole o token do @BotFather.
4. Rode `migrarParaPolling()` e crie os acionadores `poll` (1 min) e `avisoDiario` (diário, 8h).
5. Mande `/start` para o bot no Telegram.

Funções de teste: `testarAcesso()`, `diagnostico()`, `testarOCR()`, `testarConsultas()`.
