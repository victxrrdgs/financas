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
- Exportar backup em JSON

## Segurança
O repositório é público, mas **nenhum dado financeiro fica aqui**. A configuração em
`firebase-config.js` é pública por natureza; o acesso aos dados é controlado pelas regras em
`firestore.rules` (cada usuário só lê e grava os próprios dados).

## Arquivos
- `index.html`, `styles.css`, `app.js` — interface
- `store.js` — acesso ao Firebase (ou modo local de teste se `firebase-config.js` estiver vazio)
- `sw.js`, `manifest.webmanifest`, `icons/` — instalação como app
- `firestore.rules` — cópia das regras de segurança aplicadas no Firebase
