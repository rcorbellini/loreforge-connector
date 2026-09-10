// A SALA — quem está à mesa, com que direitos (spec 072).
//
// O conector servia UM personagem. O comentário de `bin/conector.js` dizia isso com
// todas as letras ("Um conector serve UM personagem"), e a troca de personagem ao vivo
// existia porque não havia outro jeito. Agora ele serve uma MESA: N contas pareadas, N
// assentos, e uma fila só (`fila.js`).
//
// ESTE ARQUIVO É ESTADO, NÃO TEMPO. Quem está aqui e o que pode fazer mora aqui; quem
// joga agora e quem espera mora em `fila.js`. A divisão não é estética: o roster
// sobrevive ao processo (vai para a configuração), a fila morre com ele — como a trava
// de turno e o código de pareamento já morrem.
//
// A SALA NUNCA DESCE AO MODELO. Nem para a Mente, nem para o Árbitro: nenhum campo
// daqui entra em `_contextoPayload`, `narrate` ou `deriveWhisper`. É invariante da spec
// (Princípio IX) e é conferível por diff — ver `quickstart.md`.

"use strict";

const { log } = require("./log");

// Quantos 401 seguidos do mundo derrubam um membro. Dois, e não um: um 401 isolado pode
// ser o server reiniciando no meio de um turno. O terceiro nunca chega — a partir do
// segundo, os assentos dele param (research R6).
const MAX_401 = 2;

// Quantos turnos autônomos seguidos SEM NENHUM PASSO APLICADO antes de o intervalo
// começar a crescer, e até onde ele cresce (FR-032).
//
// Não é economia teórica: a Elga fez 122 de 654 turnos só deitando e levantando (1,05M
// tokens), e o Draven teve 194 de 281 escolhas viradas em `wake_up` recusado. Os dois
// casos só apareceram na análise, dias depois. O recuo é o que faz isso doer na hora.
const SEM_EFEITO_ATE_RECUAR = 3;
const RECUO_MAX = 8;              // teto do multiplicador


class Assento {
  constructor({ personagem, dono, nome, mundo, mente, laco, intervaloMs = 45000 }) {
    this.personagem = personagem;
    this.dono = dono;                 // `sub` do membro
    this.nome = nome || personagem;   // como o personagem se chama, para a tela
    this.mundo = mundo;               // instância PRÓPRIA (FR-006)
    this.mente = mente;               // instância PRÓPRIA (FR-007)
    this.laco = laco;

    // OS DOIS BITS (FR-028), e eles não são um enum de três estados.
    //
    // `permitido` é o TETO, do anfitrião. `ligado` é a VONTADE, do dono. O personagem
    // age sozinho só quando os dois valem. A combinação que justifica serem dois —
    // bloqueado COM vontade ligada — é a que faz `liberar` saber ao que voltar; um enum
    // apagaria a vontade debaixo do bloqueio e liberar viraria chute.
    this.autonomia = { permitido: true, ligado: false, motivo: null };

    this.intervaloMs = intervaloMs;
    this.restanteMs = intervaloMs;
    this.semEfeito = 0;               // turnos autônomos seguidos sem passo aplicado
    this.custo = { entrada: 0, saida: 0, chamadas: 0 };
  }

  // A vontade E o teto. Não inclui "está jogando" nem "está na fila": isso é tempo, e
  // quem sabe disso é a fila.
  querAgirSozinho() {
    return !!(this.autonomia.permitido && this.autonomia.ligado);
  }

  // O intervalo EFETIVO, já com o recuo de quem não está conseguindo fazer nada.
  intervaloEfetivo() {
    if (this.semEfeito < SEM_EFEITO_ATE_RECUAR) return this.intervaloMs;
    const passos = this.semEfeito - SEM_EFEITO_ATE_RECUAR + 1;
    return this.intervaloMs * Math.min(RECUO_MAX, Math.pow(2, passos));
  }

  // Chamado no fim de TODO turno do assento. `aplicou` diz se algum passo mudou o mundo.
  fecharTurno({ aplicou, autonomo }) {
    if (autonomo) this.semEfeito = aplicou ? 0 : this.semEfeito + 1;
    else if (aplicou) this.semEfeito = 0;
    // O RELÓGIO REARMA AQUI, não durante (FR-014). É daqui que sai o rodízio: quem
    // acabou volta para o fim por consequência aritmética, sem política de justiça
    // nenhuma precisar existir.
    this.restanteMs = this.intervaloEfetivo();
    if (this.mente && this.mente.custoDoTurno) {
      const c = this.mente.custoDoTurno();
      this.custo.entrada += c.entrada || 0;
      this.custo.saida += c.saida || 0;
      this.custo.chamadas += c.chamadas || 0;
    }
  }

  paraTela() {
    return {
      personagem: this.personagem, dono: this.dono, nome: this.nome,
      autonomia: { ...this.autonomia },
      intervaloMs: this.intervaloMs, restanteMs: this.restanteMs,
      ocupado: !!(this.laco && this.laco.ocupado),
      custo: { ...this.custo },
    };
  }

  paraConfig() {
    return { personagem: this.personagem, dono: this.dono, nome: this.nome,
             autonomia: { ...this.autonomia }, intervaloMs: this.intervaloMs };
  }
}


class Membro {
  constructor({ sub, email, nome, entrouEm }) {
    this.sub = sub;
    this.email = email || "";
    this.nome = nome || "";
    this.entrouEm = entrouEm || new Date().toISOString();
    this.estado = "ativo";            // "ativo" | "desautenticado"
    this._falhas401 = 0;
  }

  // NENHUM `jwt` AQUI, e é decisão de desenho (contracts/sala-config.md). A trava de
  // segredos do `config.js` é PLANA — `Object.defineProperty(..., enumerable:false)` por
  // nome —, e uma credencial dentro de `sala.membros[]` voltaria a ser enumerável
  // justamente quando passa a haver credencial de terceiro para proteger. As chaves vivem
  // num mapa plano (`cfg.jwtPorMembro`), alcançado por este módulo pela porta
  // `credenciais`.

  paraTela() {
    return { sub: this.sub, email: this.email, nome: this.nome,
             entrouEm: this.entrouEm, estado: this.estado };
  }

  paraConfig() {
    return { sub: this.sub, email: this.email, nome: this.nome,
             entrouEm: this.entrouEm };
  }
}


class Sala {
  // `credenciais` é a PORTA para as chaves: `{ ler(sub), gravar(sub, jwt), apagar(sub) }`.
  // A sala nunca guarda um token em campo próprio — pede quando precisa. É o que permite
  // testar tudo aqui sem nenhum segredo em memória.
  //
  // `fabricas.assento({personagem, dono, jwt})` devolve `{mundo, mente, laco, nome}`.
  // Injetada para este módulo não conhecer nem HTTP nem modelo: o teste passa uma
  // fábrica falsa e exercita o roster inteiro sem rede.
  constructor({ nome, credenciais, fabricas, tetoCustoTokens = null, emitir } = {}) {
    this.nome = nome || "Sala";
    this.anfitriao = null;            // `sub` do primeiro a parear
    this.membros = new Map();         // sub -> Membro
    this.assentos = new Map();        // personagem -> Assento
    this.tetoCustoTokens = tetoCustoTokens;
    this.pausadaPorCusto = false;
    this.credenciais = credenciais || { ler: () => null, gravar: () => {}, apagar: () => {} };
    this.fabricas = fabricas || {};
    this.emitir = emitir || (() => {});
  }

  // --- consultas ---------------------------------------------------------- //

  membro(sub) { return this.membros.get(sub) || null; }
  assentoDe(personagem) { return this.assentos.get(personagem) || null; }
  ehAnfitriao(sub) { return !!sub && sub === this.anfitriao; }

  // De quem é este personagem? `null` quando não há assento — e a diferença importa:
  // quem não está assentado não tem dono NESTA SALA, ainda que tenha no mundo.
  dono(personagem) {
    const a = this.assentos.get(personagem);
    return a ? a.dono : null;
  }

  ehMembroAtivo(sub) {
    const m = this.membros.get(sub);
    return !!m && m.estado === "ativo";
  }

  assentosDe(sub) {
    return [...this.assentos.values()].filter((a) => a.dono === sub);
  }

  jwtDe(sub) { return this.credenciais.ler(sub); }

  // O JWT que uma chamada ao mundo POR CONTA DESTE PERSONAGEM tem de levar (FR-004).
  // É o ponto mais fácil de errar da spec inteira: mandar o do anfitrião faz o server
  // responder 403 em todo turno de convidado (`app.py`, `_authorize_character`).
  jwtDoAssento(personagem) {
    const dono = this.dono(personagem);
    return dono ? this.jwtDe(dono) : null;
  }

  // --- membros ------------------------------------------------------------ //

  acrescentarMembro({ sub, email, nome, jwt }) {
    if (!sub) throw new Error("membro sem `sub`");
    let m = this.membros.get(sub);
    if (m) {
      // reparear: atualiza a credencial e RESSUSCITA quem estava desautenticado, sem
      // perder assento nenhum — é o caminho de volta de R6.
      m.email = email || m.email;
      m.nome = nome || m.nome;
      m.estado = "ativo";
      m._falhas401 = 0;
    } else {
      m = new Membro({ sub, email, nome });
      this.membros.set(sub, m);
    }
    if (jwt) this.credenciais.gravar(sub, jwt);
    if (!this.anfitriao) this.anfitriao = sub;   // o primeiro a parear manda na mesa
    this.emitir("sala", this.paraTela());
    return m;
  }

  // A EXPULSÃO É TAMBÉM REVOGAÇÃO DE CREDENCIAL (FR-040/FR-042).
  //
  // A ordem abaixo é o contrato, e ela importa: tirar da fila antes de tirar o assento
  // (senão a fila guarda ponteiro para assento morto), e apagar a chave sempre — mesmo
  // que o resto falhe. Achado da Fase 0: o JWT do mundo NÃO TEM `exp` (`auth.py`) e o
  // mundo não tem revogação individual, então apagar a cópia é tudo o que este lado pode
  // fazer, e deixar de fazê-lo é deixar uma credencial permanente para trás.
  expulsar(sub) {
    if (!sub || !this.membros.has(sub)) return { erro: "não é membro desta sala" };
    if (this.ehAnfitriao(sub)) return { erro: "o anfitrião não pode ser expulso" };
    const personagens = this.assentosDe(sub).map((a) => a.personagem);
    for (const p of personagens) this.assentos.delete(p);
    this.membros.delete(sub);
    this.credenciais.apagar(sub);
    log("EXPULSO DA SALA", `${sub} (assentos: ${personagens.join(", ") || "nenhum"})`);
    this.emitir("sala", this.paraTela());
    return { ok: true, personagens };
  }

  sair(sub) {
    if (this.ehAnfitriao(sub)) return { erro: "o anfitrião não sai da própria sala" };
    const personagens = this.assentosDe(sub).map((a) => a.personagem);
    for (const p of personagens) this.assentos.delete(p);
    this.membros.delete(sub);
    this.credenciais.apagar(sub);
    this.emitir("sala", this.paraTela());
    return { ok: true, personagens };
  }

  // O mundo recusou a identidade deste membro. Ver research R6: não existe expiração
  // natural (o JWT não tem `exp`), então isto só acontece se o `auth.secret` do server
  // mudar — e aí insistir custa uma chamada de modelo por volta do relógio para o mundo
  // dizer 401 no fim.
  falhou401(sub) {
    const m = this.membros.get(sub);
    if (!m) return false;
    m._falhas401 += 1;
    if (m._falhas401 < MAX_401) return false;
    m.estado = "desautenticado";
    log("MEMBRO DESAUTENTICADO (assentos parados)", `${sub} após ${m._falhas401} 401`);
    this.emitir("sala", this.paraTela());
    return true;
  }

  respondeuBem(sub) {
    const m = this.membros.get(sub);
    if (m) m._falhas401 = 0;
  }

  // --- assentos ----------------------------------------------------------- //

  async assentar({ personagem, sub }) {
    if (!this.ehMembroAtivo(sub)) return { erro: "não é membro ativo desta sala" };
    if (this.assentos.has(personagem)) {
      const dono = this.dono(personagem);
      return dono === sub ? { erro: "você já está com este personagem na sala" }
                          : { erro: "este personagem já está na sala com outro jogador" };
    }
    const jwt = this.jwtDe(sub);
    const peças = await this.fabricas.assento({ personagem, dono: sub, jwt });
    const a = new Assento({ personagem, dono: sub, ...peças });
    // O ESTADO ANTERIOR VOLTA (FR-030). Sair não apaga a vontade nem o bloqueio: quem
    // reentra encontra o interruptor como deixou, e o bloqueio do anfitrião sobrevive a
    // alguém sair e voltar para escapar dele.
    const guardado = this._guardados && this._guardados.get(personagem);
    if (guardado) {
      a.autonomia = { ...guardado.autonomia };
      a.intervaloMs = guardado.intervaloMs || a.intervaloMs;
      a.restanteMs = a.intervaloEfetivo();
    }
    this.assentos.set(personagem, a);
    this.emitir("entrou", { personagem, dono: sub });
    this.emitir("sala", this.paraTela());
    return { ok: true, assento: a };
  }

  desassentar(personagem) {
    const a = this.assentos.get(personagem);
    if (!a) return { erro: "este personagem não está na sala" };
    this._lembrar(a);
    this.assentos.delete(personagem);
    this.emitir("saiu", { personagem, dono: a.dono });
    this.emitir("sala", this.paraTela());
    return { ok: true };
  }

  _lembrar(assento) {
    if (!this._guardados) this._guardados = new Map();
    this._guardados.set(assento.personagem, {
      autonomia: { ...assento.autonomia }, intervaloMs: assento.intervaloMs });
  }

  // --- os dois bits ------------------------------------------------------- //

  // A VONTADE DO DONO. Recusa quando o teto está baixo — e o cliente nem deveria ter
  // deixado clicar (FR-038), mas a rota não confia nisso.
  ligarAutonomia(personagem, ligado) {
    const a = this.assentos.get(personagem);
    if (!a) return { erro: "este personagem não está na sala" };
    if (!a.autonomia.permitido) {
      return { erro: a.autonomia.motivo || "a autonomia deste personagem está bloqueada",
               bloqueado: true };
    }
    a.autonomia.ligado = !!ligado;
    if (a.autonomia.ligado) a.restanteMs = a.intervaloEfetivo();
    this.emitir("sala", this.paraTela());
    return { ok: true, autonomia: { ...a.autonomia } };
  }

  // O TETO, DO ANFITRIÃO. NUNCA toca `ligado` (FR-037) — é isso que faz `liberar` saber
  // ao que voltar, e é a razão de serem dois bits.
  permitirAutonomia(personagem, permitido, motivo) {
    const a = this.assentos.get(personagem);
    if (!a) return { erro: "este personagem não está na sala" };
    a.autonomia.permitido = !!permitido;
    a.autonomia.motivo = permitido ? null : (motivo || "bloqueado pelo anfitrião");
    if (!permitido) a.restanteMs = a.intervaloEfetivo();
    this.emitir("sala", this.paraTela());
    return { ok: true, autonomia: { ...a.autonomia } };
  }

  // --- custo -------------------------------------------------------------- //

  custoTotal() {
    const t = { entrada: 0, saida: 0, chamadas: 0 };
    for (const a of this.assentos.values()) {
      t.entrada += a.custo.entrada; t.saida += a.custo.saida;
      t.chamadas += a.custo.chamadas;
    }
    return t;
  }

  // O teto pausa a mesa INTEIRA e AVISA. Nunca em silêncio (Princípio VIII): uma sala
  // que simplesmente parasse de agir seria lida como defeito, e o jogador ficaria
  // esperando por um personagem que nunca mais vai se mexer.
  conferirTeto() {
    if (!this.tetoCustoTokens) return false;
    const t = this.custoTotal();
    const gasto = t.entrada + t.saida;
    const antes = this.pausadaPorCusto;
    this.pausadaPorCusto = gasto >= this.tetoCustoTokens;
    if (this.pausadaPorCusto && !antes) {
      log("TETO DE CUSTO DA SALA ALCANÇADO", `${gasto} de ${this.tetoCustoTokens}`);
      this.emitir("sistema", { texto:
        `A sala alcançou o teto de gasto (${gasto} de ${this.tetoCustoTokens} tokens). ` +
        `A autonomia está pausada para todos até o anfitrião liberar.` });
      this.emitir("sala", this.paraTela());
    }
    return this.pausadaPorCusto;
  }

  // --- serialização ------------------------------------------------------- //

  // O QUE A TELA VÊ. Sem credencial nenhuma, nem mascarada: a página não tem o que fazer
  // com um token (contracts/sala-config.md).
  paraTela() {
    return {
      nome: this.nome,
      anfitriao: this.anfitriao,
      pausadaPorCusto: this.pausadaPorCusto,
      tetoCustoTokens: this.tetoCustoTokens,
      custo: this.custoTotal(),
      membros: [...this.membros.values()].map((m) => ({
        ...m.paraTela(), ehAnfitriao: this.ehAnfitriao(m.sub) })),
      assentos: [...this.assentos.values()].map((a) => a.paraTela()),
    };
  }

  paraConfig() {
    return {
      nome: this.nome,
      anfitriao: this.anfitriao,
      tetoCustoTokens: this.tetoCustoTokens,
      membros: [...this.membros.values()].map((m) => m.paraConfig()),
      assentos: [...this.assentos.values()].map((a) => a.paraConfig()),
    };
  }

  // Restaura o roster gravado. Os ASSENTOS não são recriados aqui — recriar exigiria
  // subir `Mundo`/`Mente` de cada um no boot, contra um mundo que pode estar fora do ar.
  // Eles voltam quando alguém entra, com os bits guardados; é o mesmo caminho de quem
  // saiu e voltou.
  static deConfig(bruto, deps) {
    const s = new Sala({ nome: (bruto && bruto.nome) || undefined,
                         tetoCustoTokens: (bruto && bruto.tetoCustoTokens) || null,
                         ...deps });
    for (const m of (bruto && bruto.membros) || []) {
      if (!m || !m.sub) continue;
      s.membros.set(m.sub, new Membro(m));
    }
    s.anfitriao = (bruto && bruto.anfitriao) || null;
    if (s.anfitriao && !s.membros.has(s.anfitriao)) s.anfitriao = null;
    s._guardados = new Map();
    for (const a of (bruto && bruto.assentos) || []) {
      if (!a || !a.personagem) continue;
      s._guardados.set(a.personagem, {
        autonomia: { permitido: true, ligado: false, motivo: null, ...(a.autonomia || {}) },
        intervaloMs: a.intervaloMs || 45000 });
    }
    return s;
  }
}

module.exports = { Sala, Membro, Assento, MAX_401, SEM_EFEITO_ATE_RECUAR, RECUO_MAX };
