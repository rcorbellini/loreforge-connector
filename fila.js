// A FILA DA MESA — quem joga agora, quem espera (spec 072).
//
// `sala.js` é ESTADO (quem está aqui, com que direitos); este arquivo é TEMPO. A divisão
// não é estética: o roster sobrevive ao processo, a fila morre com ele — como a trava de
// turno e o código de pareamento já morrem.
//
// UM TURNO POR VEZ, e isso vem da premissa: todos compartilham a MESMA LLM. A trava do
// laço (`comTurno`) continua existindo como último guarda-corpo; quem ORDENA é aqui.
//
// A CONSEQUÊNCIA ESTÁ ESCRITA NA SPEC, e é propriedade desejada, não defeito: com N
// assentos e turno de custo T, cada personagem age a cada ~N × T + I. O intervalo de
// autonomia deixa de ser PERÍODO e vira PISO. Numa roda de RPG é o ritmo certo.
//
// A FILA NÃO É GARANTIA DE ORDEM NO MUNDO (Princípio III). A trava autoritativa é a do
// server: outra sala pode jogar os personagens dela no mesmo mundo ao mesmo tempo, e
// deve. Isto aqui é justiça e custo.

"use strict";

const { log } = require("./log");

// Quanto uma vez pode DURAR antes de a mesa desistir de esperar por ela.
//
// Cinco minutos é folgado: um turno com 12 rodadas contra um modelo local cabe. O que
// isto impede é o turno que NUNCA volta — o incidente de 2026-07-27, quando o Ollama
// engasgou e o turno ficou pendurado. Ali congelou um jogador; numa sala congelaria a
// mesa inteira.
const PRAZO_TURNO_MS = 5 * 60 * 1000;

// De quanto em quanto o relógio da sala anda. Um só, para a sala inteira — não N.
const PASSO_MS = 500;


class Fila {
  constructor({ sala, emitir, prazoMs = PRAZO_TURNO_MS, passoMs = PASSO_MS } = {}) {
    this.sala = sala;
    this.emitir = emitir || (() => {});
    this.prazoMs = prazoMs;
    this.passoMs = passoMs;
    this.entradas = [];        // {personagem, classe, texto, quem, em}
    this.jogando = null;       // personagem do turno em voo
    this._t = null;
  }

  // --- a fila ------------------------------------------------------------- //

  // NO MÁXIMO UMA ENTRADA POR ASSENTO POR CLASSE (FR-013). Daí sai o invariante que
  // importa: `entradas.length <= 2 × assentos`. A fila não pode crescer sem limite
  // aconteça o que acontecer com os relógios — não há caso de borda que a exploda.
  enfileirar({ personagem, classe, texto = null, quem = null }) {
    const assento = this.sala.assentoDe(personagem);
    if (!assento) return { erro: "este personagem não está na sala" };

    if (classe === "manual") {
      // A MANUAL SUBSTITUI A AUTÔNOMA PENDENTE do mesmo assento (FR-012). Sem isto, o
      // jogador que digita enquanto o relógio venceu jogaria DUAS vezes — a dele e a que
      // o relógio já tinha pedido —, e a segunda cairia numa cena que a primeira mudou.
      this.entradas = this.entradas.filter(
        (e) => !(e.personagem === personagem && e.classe === "autonoma"));
    }
    const jaTem = this.entradas.some(
      (e) => e.personagem === personagem && e.classe === classe);
    if (jaTem) return { erro: "já há uma jogada deste personagem na fila", jaTem: true };

    this.entradas.push({ personagem, classe, texto, quem, em: Date.now() });
    this._anunciar();
    this._servir();
    return { ok: true, posicao: this._posicaoDe(personagem, classe) };
  }

  removerPersonagem(personagem) {
    const antes = this.entradas.length;
    this.entradas = this.entradas.filter((e) => e.personagem !== personagem);
    if (this.entradas.length !== antes) this._anunciar();
  }

  removerDe(sub) {
    const meus = new Set(this.sala.assentosDe(sub).map((a) => a.personagem));
    const antes = this.entradas.length;
    this.entradas = this.entradas.filter((e) => !meus.has(e.personagem));
    if (this.entradas.length !== antes) this._anunciar();
  }

  // MANUAL NA FRENTE DE TODA AUTÔNOMA (FR-011), FIFO dentro de cada classe.
  //
  // Sem isto, um humano espera atrás de quatro robôs — e a mesa fica intragável
  // exatamente para quem está prestando atenção nela.
  _ordenadas() {
    const peso = (e) => (e.classe === "manual" ? 0 : 1);
    return [...this.entradas].sort((a, b) => peso(a) - peso(b) || a.em - b.em);
  }

  _posicaoDe(personagem, classe) {
    return this._ordenadas().findIndex(
      (e) => e.personagem === personagem && e.classe === classe) + 1;
  }

  estado() {
    return {
      jogando: this.jogando,
      fila: this._ordenadas().map((e, i) => ({
        personagem: e.personagem, classe: e.classe, posicao: i + 1 })),
    };
  }

  _anunciar() {
    // `fila` é de MESA: numa roda, quem está jogando e quem espera é público.
    this.emitir("fila", { ...this.estado(), escopo: "mesa" });
  }

  // --- o serviço ---------------------------------------------------------- //

  async _servir() {
    if (this.jogando) return;                    // um turno por vez
    const proxima = this._ordenadas()[0];
    if (!proxima) return;

    const assento = this.sala.assentoDe(proxima.personagem);
    if (!assento) {                              // o assento saiu enquanto esperava
      this.removerPersonagem(proxima.personagem);
      return this._servir();
    }
    this.entradas = this.entradas.filter((e) => e !== proxima);
    this.jogando = proxima.personagem;
    this._anunciar();

    // O PRAZO SOLTA A PISTA, NÃO MATA O TURNO — e a diferença é deliberada.
    //
    // Um turno em voo pode já estar escrevendo no mundo: interrompê-lo deixaria metade
    // dos passos aplicados e nenhuma narração. O que a mesa faz ao vencer o prazo é
    // PARAR DE ESPERAR — avisa, libera a vez e serve o próximo. O turno abandonado
    // termina sozinho (o `AbortSignal.timeout` de `mundo.js` fecha a chamada HTTP), e o
    // registro dele sobe como qualquer outro.
    let soltou = false;
    const prazo = setTimeout(() => {
      soltou = true;
      log("PRAZO DO TURNO VENCIDO (a mesa segue)", proxima.personagem);
      this.emitir("sistema", { personagem: proxima.personagem, escopo: "dono", texto:
        "A vez demorou demais e a mesa seguiu. O que o mundo já tiver aceitado está " +
        "feito; o resto não aconteceu." });
      this._liberar(assento, proxima, { aplicou: false });
    }, this.prazoMs);
    if (prazo.unref) prazo.unref();

    try {
      if (proxima.classe === "manual") {
        await assento.laco.sussurrar(proxima.texto, "manual");
      } else {
        await assento.laco.talvezAgirSozinho();
      }
    } catch (e) {
      log("TURNO FALHOU (a mesa segue)", `${proxima.personagem}: ${e.message}`);
    } finally {
      clearTimeout(prazo);
      if (!soltou) {
        this._liberar(assento, proxima,
                      { aplicou: !!assento.laco.ultimoTurnoAplicou });
      }
    }
  }

  _liberar(assento, entrada, { aplicou }) {
    if (this.jogando !== entrada.personagem) return;   // já foi liberada pelo prazo
    this.jogando = null;
    // O RELÓGIO REARMA AQUI, no fim do turno DELE (FR-014) — e é daqui que sai o
    // rodízio, sem política de justiça nenhuma precisar existir.
    assento.fecharTurno({ aplicou, autonomo: entrada.classe === "autonoma" });
    this.sala.conferirTeto();
    this._anunciar();
    // a próxima só começa depois de esta fechar: um turno não vê o mundo mudar debaixo
    // dele, e a Mente do próximo lê a cena já com o que este fez.
    setImmediate(() => this._servir());
  }

  // --- o relógio da sala -------------------------------------------------- //

  // UM `setInterval` PARA A SALA INTEIRA, e não um por assento (research R3). N timers
  // acordariam o processo em N momentos diferentes para fazer a mesma conta.
  iniciar() {
    if (this._t) return this;
    this._t = setInterval(() => this._tique(), this.passoMs);
    if (this._t.unref) this._t.unref();
    return this;
  }

  parar() {
    if (this._t) clearInterval(this._t);
    this._t = null;
  }

  _tique() {
    if (this.sala.pausadaPorCusto) return;
    for (const a of this.sala.assentos.values()) {
      if (!this._elegivel(a)) continue;
      a.restanteMs = Math.max(0, a.restanteMs - this.passoMs);
      // O relógio de cada um é EVENTO DO DONO: é o interruptor dele, não da mesa.
      this.emitir("autonomia", {
        personagem: a.personagem, escopo: "dono",
        restante: a.restanteMs, total: a.intervaloEfetivo(),
        permitido: a.autonomia.permitido, ligado: a.autonomia.ligado,
        motivo: a.autonomia.motivo });
      if (a.restanteMs <= 0) {
        a.restanteMs = a.intervaloEfetivo();     // reposto já, para não disparar em rajada
        this.enfileirar({ personagem: a.personagem, classe: "autonoma" });
      }
    }
  }

  // OS CINCO CRITÉRIOS (data-model.md). Os dois primeiros são a vontade e o teto; os
  // três últimos são o que impede a fila de encher: o tempo de quem está jogando ou
  // esperando NÃO CONTA. É a generalização do `!this.ocupado` que morava no laço.
  _elegivel(a) {
    if (!a.querAgirSozinho()) return false;
    if (!this.sala.ehMembroAtivo(a.dono)) return false;
    if (this.jogando === a.personagem) return false;
    if (a.laco && a.laco.ocupado) return false;
    return !this.entradas.some((e) => e.personagem === a.personagem);
  }
}

module.exports = { Fila, PRAZO_TURNO_MS, PASSO_MS };
