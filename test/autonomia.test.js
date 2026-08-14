// A BIFURCAÇÃO DO TICK AUTÔNOMO (spec 033, item 53.6).
//
// Cada volta do relógio bifurca: quem TEM compromisso decide se age por ele; quem
// NÃO tem para e faz um. O ramo de criar nasceu ligado (spec 035, 30/07) e o
// refactor de prompts de 06/08 apagou o `if`, deixando `REFLECT_COMMAND` órfão —
// declarado e nunca referenciado, por uma semana.
//
// Falhava em SILÊNCIO, que é o que o tornou caro: um personagem sem intenção
// simplesmente nunca fazia nenhuma, e isso se parece com apatia, não com defeito.
// O Irmão Tobias passou três horas perguntando o mesmo caminho porque, sem
// compromisso e sem urgência biológica, a única bússola que lhe restava era a
// memória — e ela só tinha repetições do próprio fracasso.
//
// Este teste existe para que o `if` não possa ser apagado de novo em silêncio.

"use strict";

const test = require("node:test");
const assert = require("node:assert");

const Mente = require("../mente");

test("sem compromisso, o tick manda REFLETIR — e não chama modelo nenhum", async () => {
  // se tocasse no modelo, a chamada falharia (não há runtime no teste): o próprio
  // sucesso desta chamada é a prova de que o ramo é determinístico
  const d = await Mente.deriveWhisper({ intentions: [], self: { id: "x" } });
  const sussurro = d && d.texto;

  assert.ok(sussurro, "sem intenção, o tick não produziu sussurro nenhum");
  assert.strictEqual(sussurro, Mente.promptsPadrao().refletir);
  // a ROTINA viaja junto: é ela que faz o laço responder a reflexão com a face
  // recortada em vez da cena inteira (item 53.6)
  assert.strictEqual(d.rotina, "refletir");
  assert.match(sussurro, /decid/i, "o comando não manda decidir");
  // o texto ANTIGO mandava descrever a 'action' — campo do formato que o caminho
  // de tool-calling aposentou. Se voltar, voltou o prompt errado.
  assert.doesNotMatch(sussurro, /'action'|"action"/,
                      "o comando ainda fala do formato antigo");
});

test("o comando de refletir é uma rotina EDITÁVEL no painel", () => {
  const nomes = Mente.ROTINAS.map((r) => r.nome);
  assert.ok(nomes.includes("refletir"),
            "quem tuna não consegue trocar o prompt de reflexão");
  assert.ok(Object.keys(Mente.promptsPadrao()).includes("refletir"));
});

// NÃO existe teste do ramo OPOSTO ("com compromisso, não reflete"), e a ausência é
// deliberada. Ele exigiria chamar `deriveWhisper` com uma intenção, o que dispara o
// MODELO — e um `fetch` em voo mantém o event loop vivo, então o processo de teste
// não encerra nem quando a asserção passa. A primeira versão deste arquivo tinha
// esse teste: passava enquanto o Ollama estava ocupado com o jogo (falhava rápido) e
// travava por minutos no instante em que ele ficou livre. Teste que depende do que
// está rodando na máquina não é teste.
//
// O que se perde é pouco: é o MESMO `if` do teste acima, pelo outro lado. Cobrir o
// ramo do modelo pede uma costura para injetar runtime, que o `mente.js` não tem —
// e inventá-la só para este teste seria pior que a lacuna.
