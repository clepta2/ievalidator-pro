import worker from './worker.js';
import { IEValidatorPro } from './ievalidator-pro.js';

console.log('🧪 Iniciando Bateria de Testes do IEValidator Pro (SINTEGRA 27 UFs)...\n');

let pass = 0;
function assert(cond, msg) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${msg}`);
  } else {
    console.error(`  ❌ FALHA: ${msg}`);
    throw new Error(msg);
  }
}

// 1. Teste de Isento
const resIsento = IEValidatorPro.validar('SP', 'ISENTO');
assert(resIsento.valido === true, 'ISENTO deve ser válido');
assert(resIsento.isento === true, 'Flag isento true');

// 2. Teste de SP Produtor Rural (P)
const resProdutor = IEValidatorPro.validar('SP', 'P-01100424.9/000');
assert(resProdutor.valido === true, 'Produtor rural P de SP deve ser válido');

// 3. Teste de SP Válido
const resSp = IEValidatorPro.validar('SP', '110.042.490.114');
assert(resSp.valido === true, 'IE de SP válida');
assert(resSp.ieLimpa === '110042490114', 'IE limpa com 12 dígitos');

// 4. Teste de SP Inválido
const resInvalido = IEValidatorPro.validar('SP', '110.042.490.999');
assert(resInvalido.valido === false, 'IE com DV incorreto deve ser rejeitada');

// 5. Teste Worker HTTP
const resHttp = await worker.fetch(new Request('https://api.test/api/ie?uf=SP&ie=ISENTO'));
assert(resHttp.status === 200, 'Worker responde 200 OK');
const bodyHttp = await resHttp.json();
assert(bodyHttp.ok === true && bodyHttp.isento === true, 'Resposta HTTP confirma isenção');

// 6. Teste de Listagem de Estados
const resEstados = await worker.fetch(new Request('https://api.test/api/ie/estados'));
const bodyEstados = await resEstados.json();
assert(bodyEstados.totalEstados === 27, 'Catálogo lista exatamente os 27 Estados');

// 7. Teste de Puxar Inscrições Estaduais por CNPJ
console.log('  Testing puxar IE por CNPJ...');
const resPuxar = await worker.fetch(new Request('https://api.test/api/ie/consultar?cnpj=47960950000121'));
assert(resPuxar.status === 200, 'Endpoint /api/ie/consultar responde 200 OK');
const bodyPuxar = await resPuxar.json();
assert(bodyPuxar.ok === true, 'Puxa IEs da SEFAZ com sucesso');
assert(bodyPuxar.totalIesEncontradas >= 2, 'Encontra múltiplas IEs da Magazine Luiza');
assert(bodyPuxar.inscricoesEstaduais.some(i => i.uf === 'SP'), 'Encontra IE de São Paulo');

console.log(`\n🎉 Todos os ${pass} testes do IEValidator Pro passaram com sucesso!`);
