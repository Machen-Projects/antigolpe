#!/usr/bin/env node
/**
 * Teste automatizado do workflow AntiGolpe. Dispara requisições sintéticas
 * direto no webhook de produção do n8n, no mesmo formato que a Evolution API
 * realmente envia (evento MESSAGES_UPSERT). Não depende do WhatsApp estar
 * conectado: testa a lógica do workflow e a chamada real ao Gemini.
 *
 * Uso:
 *   node scripts/test_webhook.js
 *   node scripts/test_webhook.js --url http://localhost:5678/webhook/antigolpe
 */

const WEBHOOK_URL =
  process.argv.includes('--url')
    ? process.argv[process.argv.indexOf('--url') + 1]
    : 'http://localhost:5678/webhook/antigolpe';

// Monta um payload no formato exato que a Evolution API envia para
// MESSAGES_UPSERT de uma mensagem de texto recebida (não-eco, não-grupo).
function payloadTexto(texto, numero = '5555999999999') {
  return {
    event: 'messages.upsert',
    instance: 'machen-atendimento',
    data: {
      key: {
        remoteJid: `${numero}@s.whatsapp.net`,
        fromMe: false,
        id: 'TEST-' + Date.now() + Math.random().toString(36).slice(2, 6)
      },
      pushName: 'Usuario Teste',
      message: { conversation: texto },
      messageType: 'conversation'
    }
  };
}

const casos = [
  {
    nome: 'Golpe obvio - falsa promocao',
    payload: payloadTexto(
      'Parabens! Voce ganhou um premio de R$500, clique aqui para resgatar: http://premio-fake-teste.click'
    ),
    esperado: 'classificacao deveria ser "golpe" (ou pelo menos "suspeito"), nunca "seguro"'
  },
  {
    nome: 'Golpe do parente/emergencia',
    payload: payloadTexto(
      'Oi mae, troquei de numero, bati o carro e preciso que voce faca um PIX de 800 reais agora pro guincho, urgente'
    ),
    esperado: 'classificacao deveria ser "golpe" ou "suspeito"'
  },
  {
    nome: 'Mensagem neutra, sem sinais de golpe',
    payload: payloadTexto('Oi mae, cheguei bem em casa, te ligo mais tarde, beijo'),
    esperado: 'classificacao deveria ser "seguro" ou "indeterminado" (nunca "golpe")'
  }
];

async function rodarCaso(caso) {
  const inicio = Date.now();
  try {
    const res = await fetch(WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(caso.payload)
    });
    const ms = Date.now() - inicio;
    const body = await res.text();
    console.log(`\n=== ${caso.nome} ===`);
    console.log(`HTTP ${res.status} em ${ms}ms`);
    console.log(`Resposta do webhook: ${body}`);
    console.log(`Esperado: ${caso.esperado}`);
    console.log(
      'Nota: a resposta real (classificacao/texto enviado ao usuario) fica na'
    );
    console.log(
      '  execucao do n8n (Editor > Executions) e na tabela antigolpe_interacoes.'
    );
  } catch (err) {
    console.error(`\n=== ${caso.nome} ===`);
    console.error(`ERRO ao chamar o webhook: ${err.message}`);
    console.error(
      'Verifique se o n8n esta rodando (docker ps) e se o workflow esta ativo.'
    );
  }
}

async function main() {
  console.log(`Testando webhook: ${WEBHOOK_URL}`);
  console.log(`${casos.length} casos de teste...\n`);
  for (const caso of casos) {
    await rodarCaso(caso);
  }
  console.log(
    '\nPara ver a classificacao real de cada teste, rode:\n' +
      '  docker exec evolution-postgres psql -U evolution -d n8n_prospecta -c ' +
      `"SELECT tipo_mensagem, classificacao, tipo_golpe, confianca, conteudo_resumido, criado_em FROM antigolpe_interacoes ORDER BY criado_em DESC LIMIT ${casos.length};"`
  );
}

main();
