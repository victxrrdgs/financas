// Testes das regras de cartão, renegociação, simulador de dívidas e leitura em uma linha.
// Rodar: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../calc.js';
import * as P from '../planos.js';
import { interpretar } from '../parser.js';

const itau = { id: 'it', nome: 'Itaú Platinum', tipo: 'cartao', fechamento: 3, vencimento: 10 };
const nubank = { id: 'nu', nome: 'Nubank', tipo: 'cartao', fechamento: 27, vencimento: 2 };

test('compra cai na fatura certa conforme o fechamento', () => {
  assert.equal(C.mesFatura(itau, '2026-11-24'), '2026-12');   // depois do fechamento de 03/11 → fatura de dezembro
  assert.equal(C.mesFatura(itau, '2026-11-02'), '2026-11');   // antes do fechamento → novembro
  assert.equal(C.mesFatura(itau, '2026-11-03'), '2026-12');   // no dia do fechamento já vai para a próxima
  assert.equal(C.mesFatura(nubank, '2026-11-24'), '2026-12'); // vence dia 2 (antes do fechamento): fatura do mês seguinte
  assert.equal(C.mesFatura(nubank, '2026-11-28'), '2027-01');
});

test('parcelas dividem os centavos e seguem mês a mês', () => {
  const p = C.parcelasDe({ data: '2026-11-24', valor: 100, parcelas: 3 }, itau);
  assert.deepEqual(p.map((x) => x.ym), ['2026-12', '2027-01', '2027-02']);
  assert.deepEqual(p.map((x) => x.valor), [33.34, 33.33, 33.33]); // o resto vai na 1ª
  assert.equal(C.r2(p.reduce((t, x) => t + x.valor, 0)), 100);
});

test('fatura renegociada não conta como pago no resumo do mês', () => {
  const D = { contas: [], entradas: [], compras: [{ id: 'a', carteiraId: 'it', valor: 658.42, parcelas: 1, data: '2026-10-20' }],
    carteiras: [itau], faturas: [{ id: 'it_2026-11', pago: true, valor: 0, renegociada: true }], transferencias: [], recorrentes: [], comissoes: [] };
  const f = C.faturaDe(D, itau, '2026-11');
  assert.equal(f.pago, true);
  assert.equal(f.renegociada, true);
  assert.equal(C.resumoMes(D, '2026-11').pago, 0);
});

test('simulador: mínimo é o mês mais pesado e crédito vale uma vez só', () => {
  const ds = [{ id: 'r', saldo: 300, parcela: 100 }, { id: 'aj', saldo: -50, parcela: -50 }];
  const s = P.simular(ds, 0);
  assert.equal(s.minimo, 100);                     // mês 1 = 100 − 50 = 50; meses 2 e 3 = 100
  assert.equal(P.simular(ds, 100).viavel, true);
  assert.equal(P.simular(ds, 60).viavel, false);
});

test('simulador: rotativo do cartão respeita o teto de 100% de juros', () => {
  const s = P.simular([{ id: 'mp', saldo: 100, taxa: 15, teto: 100 }, { id: 'x', saldo: 10000, parcela: 1 }], 1);
  assert.ok(s.juros <= 100.001, `juros ${s.juros} passou do teto`);
});

test('leitura em uma linha igual à do bot', () => {
  const carts = [nubank, { id: 'i', nome: 'Itaú', tipo: 'conta' }];
  const a = interpretar('50 salgado nubank', carts);
  assert.equal(a.tipo, 'compra'); assert.equal(a.valor, 50); assert.equal(a.cart.id, 'nu'); assert.equal(a.categoria, 'Restaurantes');
  const b = interpretar('32,90 ifood pizza nubank', carts);
  assert.equal(b.valor, 32.9); assert.equal(b.descricao, 'Ifood pizza');
  assert.equal(interpretar('1.200 salário itaú', carts).valor, 1200);
  assert.ok(interpretar('salgado nubank', carts).erro);
});
