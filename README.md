# Minhas Finanças

App web (PWA) para controlar contas a pagar, contas pagas, entradas e quanto sobra no mês.
Os dados ficam no Firebase (Firestore), sincronizados entre computador e celular, com login Google.

**Abrir:** https://victxrrdgs.github.io/financas/

## Como instalar no celular
- **Android (Chrome):** abra o link → menu ⋮ → *Adicionar à tela inicial* / *Instalar app*.
- **iPhone (Safari):** abra o link → botão Compartilhar → *Adicionar à Tela de Início*.

## Recursos
- Resumo do mês: entrou, pago, a pagar, vencidas, quanto sobrou e previsão de fim de mês
- Contas com vencimento, categoria e aviso de vencidas / vencendo
- Toque no círculo para marcar como paga
- Contas e entradas recorrentes (aluguel, salário…) criadas automaticamente todo mês
- Funciona offline e sincroniza quando a internet volta
- Exportar backup em JSON e planilha do Excel (.xlsx) com resumo, lançamentos, cartões, contas e financiamentos
- **Hoje** (v3): "Pode gastar hoje" em destaque, com os dias até a próxima entrada, e a lista "Precisa de você" (vencidas, vencendo, faturas fechando, orçamentos, comissões, dividir contas) com Pagar e Desfazer
- **Lançar em uma linha**: botão central, escreve `50 salgado nubank` e o app entende igual ao bot do Telegram (`parser.js`)
- Navegação: Hoje · Movimentos · Lançar · Planejar · Mais
- Cartões: faturas pelo dia de fechamento, compras parceladas, assinaturas, conferir com o banco e **Renegociei esta fatura** (o acordo vira parcelas nas próximas faturas)
- **Dívidas**: plano passo a passo, simulador (avalanche, bola de neve, só o mínimo), linha do tempo mês a mês, cenários "e se…", dicas e teto legal dos juros do rotativo
- Financiamentos (veículo, seguro) como parcelas do mês, fora do plano de dívidas
- Fechamento do mês: nos 10 primeiros dias, guarda a sobra numa meta e ajusta orçamentos
- Dividir contas com outra pessoa (cada um vê o que deve)
- Testes das regras: `node --test tests/`

## Segurança
O repositório é público, mas **nenhum dado financeiro fica aqui**. A configuração em
`firebase-config.js` é pública por natureza; o acesso aos dados é controlado pelas regras em
`firestore.rules` (cada usuário só lê e grava os próprios dados).

## Arquivos
- `index.html`, `styles.css`, `app.js` — interface
- `store.js` — acesso ao Firebase (ou modo local de teste se `firebase-config.js` estiver vazio)
- `sw.js`, `manifest.webmanifest`, `icons/` — instalação como app
- `firestore.rules` — cópia das regras de segurança aplicadas no Firebase
