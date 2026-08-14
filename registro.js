// O REGISTRO DO TURNO — a metade que só o conector sabe.
//
// O mundo vê a proposta, a recusa e o desfecho. O que ele NÃO vê, e se perde
// para sempre se não subir aqui, é o que a Mente PENSOU: o racional, o modelo
// que estava rodando, a versão de prompt, o custo. É esse material que serve à
// engenharia de prompt e ao troubleshooting (spec 044, US5).
//
// ENVELOPE ESTRUTURADO + CORPO DESCRITIVO. O envelope é identidade e física
// (quem, quando, qual turno, qual modelo, quanto custou) — o que a régua do
// projeto autoriza como campo. O corpo é PROSA, porque as perguntas de amanhã
// ainda não foram feitas: campo fixo obrigaria a decidir hoje o que se vai
// querer saber depois, e "me resuma a trajetória deste jogador" é leitura de
// prosa, não soma de contadores.
//
// DUAS COISAS QUE ESTE MÓDULO NUNCA FAZ:
//   1. derrubar o turno. Sem destino, sem rede, sem nada: o jogo segue.
//   2. mandar a credencial. Ela é não-enumerável no `config` justamente para
//      que um espalhamento distraído aqui não a leve junto.

"use strict";

const crypto = require("crypto");

function criar({ mundo, cfg, extensoes, mente }) {
  function abrir() {
    const inicio = Date.now();
    if (mente && mente.zerarCusto) mente.zerarCusto();

    const linha = {
      // --- envelope ---
      turno_id: crypto.randomUUID(),
      personagem: cfg.personagem,
      instante: new Date().toISOString(),
      modelo: rotuloDoModelo(cfg),
      versao_prompt: extensoes ? extensoes.versaoPrompt() : "padrao",
      corpo_suprimido: false,
      // --- corpo ---
      corpo: {
        sussurro: null,
        origem: null,
        // DOIS raciocínios, e confundi-los custou uma análise errada: o
        // `pensamento` é a frase do ESCOLHER ("o que ele quer e por quê", dita ao
        // escolher as capacidades); o `racional_autonomo` é a leitura do prompt de
        // AUTONOMIA (personalidade × biologia × intenções × cenário) que decide SE
        // se age. O campo antigo chamava-se `racional` e guardava o primeiro — ler
        // um pelo outro faz o log responder à pergunta errada.
        pensamento: null,
        racional_autonomo: null,
        // AS INTENÇÕES EM VIGOR NESTE TURNO. Sem isto, o histórico não permite
        // perguntar a coisa mais importante sobre autonomia: *o personagem se
        // comportou diferente quando tinha um compromisso?* O estado do `world/` é
        // o de AGORA, não o de então — uma intenção criada e abandonada não deixa
        // rastro nenhum, e era exatamente o caso do Doncel (criou uma boa e a
        // largou em três minutos, sem nada que o registrasse).
        //
        // Vale o peso: log gordo e rico serve; log magro e inútil não.
        intencoes: null,
        escolhas: [],
        narracao: null,
        falhas_de_extensao: [],
        falhas: [],
      },
    };
    let descartado = false;

    return {
      id: linha.turno_id,
      // O que o personagem PRETENDIA quando este turno começou — a foto, não o
      // estado de hoje. É o que permite fatiar a análise por compromisso.
      pretendia(intencoes) {
        linha.corpo.intencoes = (intencoes || []).map((i) => ({
          id: i.id, status: i.status, content: i.content }));
      },
      sussurro(texto, origem, racionalAutonomo) {
        linha.corpo.sussurro = texto;
        linha.corpo.origem = origem;
        // O PORQUÊ do tick autônomo. Só ele explica a DECISÃO DE AGIR, e antes disto
        // ele morria no stderr do conector — existia enquanto a janela do terminal
        // durasse. Numa análise retrospectiva era justo o que mais faltava: dava
        // para ver o que o personagem fez, nunca por que decidiu fazer. A memória
        // do projeto já dizia que o racional sobe SEMPRE (spec 044); este não subia.
        if (racionalAutonomo) linha.corpo.racional_autonomo = racionalAutonomo;
      },
      pensou(intent) {
        if (!intent) return;
        // o que a Mente disse de si — não o que nós inferimos dela
        linha.corpo.pensamento = intent.pensamento || intent.racional || null;
      },
      propos(capacidade, alvos, prosa, r) {
        linha.corpo.escolhas.push({
          capacidade,
          alvos: alvos || null,
          prosa_tentativa: (prosa && prosa.acao) || null,
          recusado: !!(r && r.recusado),
          // a recusa em LINGUAGEM DE MUNDO, com o motivo: recusa nunca é
          // silenciosa, nem no jogo nem no registro
          recusa: r && r.recusado ? r.texto : null,
          desfecho: r && r.narrativa
            ? { aconteceu: r.narrativa.aconteceu || [],
                viradas: r.narrativa.viradas || [] }
            : null,
        });
      },
      narrou(prosa) { linha.corpo.narracao = prosa || null; },
      falha(msg) { linha.corpo.falhas.push(String(msg)); },
      falhaDeExtensao(ponto, msg) {
        linha.corpo.falhas_de_extensao.push({ ponto, erro: String(msg) });
      },
      descartar() { descartado = true; },

      async fechar() {
        if (descartado) return null;
        linha.custo = mente && mente.custoDoTurno
          ? { ...mente.custoDoTurno(), duracao_ms: Date.now() - inicio }
          : { duracao_ms: Date.now() - inicio };

        // O CORPO SEMPRE SOBE, e isso é REGRA DA CASA, não configuração.
        //
        // Houve um interruptor aqui, e o dono do mundo o derrubou pelo motivo
        // certo: quem hospeda precisa medir, e telemetria voluntária num jogo
        // hospedado é telemetria que não existe — desligar é grátis e medir é o
        // que paga a conta de melhorar os prompts de todo mundo.
        //
        // `corpo_suprimido` fica no formato: linhas antigas o usam, e um corpo
        // ausente continua precisando ser distinguível de um corpo vazio.
        const aEnviar = linha;
        // A GUARDA É AQUI, e não só no `mundo`. O `fechar()` é chamado num
        // `finally` do laço: uma exceção que escapasse daqui derrubaria um turno
        // JÁ JOGADO por causa de telemetria — trocar o certo pelo acessório.
        // O `Mundo` real também engole; isto é a segunda tranca, para valer
        // qualquer que seja a implementação injetada.
        try {
          await mundo.registrar(aEnviar);
        } catch (_) { /* o jogo vale mais que o dado sobre o jogo */ }
        return linha;
      },
    };
  }

  return { abrir };
}

function rotuloDoModelo(cfg) {
  if (cfg.runtime === "remote") return `anthropic/${cfg.remoteModel}`;
  if (cfg.runtime === "openrouter") return `openrouter/${cfg.openrouterModel}`;
  return `ollama/${cfg.model}`;
}

module.exports = { criar, rotuloDoModelo };
