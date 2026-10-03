// O LAÇO DO TURNO — agora o ORQUESTRADOR do harness por objetivos (spec 075).
//
// ESTA É A CISÃO (spec 044). Antes, quem encadeava os atos era a TELA: ela
// interpretava, propunha, narrava e desenhava. Agora quem encadeia é o conector,
// e a tela só assiste.
//
// E A SEGUNDA CISÃO (spec 075). Até aqui, a Mente fazia quatro coisas numa chamada
// paga: entender a cena, decidir o que quer, escolher a tool entre ~20 schemas e
// preencher os ids. Fazia as quatro mal e caro (~24 mil tokens por ação válida,
// `ferramentas/harness-objetivos/v1/montagem`). Agora:
//
//   MENTE (paga)      C3  o pensar do pedido (M2): o que fazer agora, o que fica para depois
//                         e o fato que fecha, em prosa, sem schema de tool
//   RESOLVEDOR (local, 0 token pago)
//                     C4  onde está o alvo · C6 qual tool · C7 cada parâmetro
//   MUNDO             M2  executa, aceita ou recusa com motivo
//   HARNESS (regra)   C8  andou? · C8D acabou?
//   MENTE (paga)      C3P o que eu quero (só com a autonomia ligada) · C9 narrar
//
// E O CICLO DO PEDIDO (spec 077). Com a chave do pensar ligada na tela do jogador, o pedido
// que não acaba na vez fica ABERTO (o desejo: o mundo guarda a prosa, o caderno o andamento)
// e anda nas vezes seguintes dele na fila — mesmo com a autonomia desligada —, repensado a
// cada vez pelo M2 com o que já foi feito, até o fato fechar, o plano dizer que não há mais
// nada, ou o limite.
//
// O laço NÃO DECIDE NADA SOZINHO e NÃO DESENHA NADA: chama as caixas
// (`harness/`), EMITE o que cada uma fez e REGISTRA cada caixa com o mesmo nome da
// página de arquitetura (FR-016, FR-023). Quem escuta decide o que fazer: o
// terminal imprime, o canal manda para a tela, o registro guarda.
//
// NADA É DESCARTADO EM SILÊNCIO: todo objetivo termina numa chamada ao mundo OU
// numa subida com motivo, e o que subiu vai para a narração como não acontecido.

"use strict";

const { log } = require("./log");
const H = require("./harness");
const { createDecider, DeciderUnavailable } = H.decider;
const { label, motivoEmMundo } = H.labels;
// importados por nome: `H.scene.x` casaria com a guarda de `contexto.scene.x`
// (`test/contrato.test.js`), que procura leitura de chave fora do contrato.
const { sceneIndex, nameOf } = H.scene;

// O TÍTULO-COMANDO de uma tentativa (achado 2026-09-29, jogando): `capacidade(alvos)`
// é DETERMINÍSTICO — vem da CHAMADA, não de quão bem ela foi narrada. O nome técnico
// não é vocabulário proibido aqui: vai ao bastidor (`<details>` só leitura), nunca a
// um menu que decida algo no mundo (Princípio V/IX).
function _tituloComando(capacidade, nomesDosAlvos) {
  const valores = (nomesDosAlvos || []).filter((v) => typeof v === "string" && v.trim());
  return `${capacidade}(${valores.join(", ")})`;
}

// A TRILHA DO LUGAR — "Costa de Ferro › Porto Negro › Taverna do Gancho". INCLUI o
// lugar atual (o balão do turno não tem um `<h3>` de cena ao lado para completar).
function _breadcrumbDoLugar(place) {
  const cadeia = [];
  let node = place;
  while (node && (node.name || node.id)) {
    cadeia.push(node.name || node.id);
    node = node.belongs_to;
  }
  return cadeia.reverse();
}

// No máximo quantos atos de um plano vão ao mundo numa vez (o C3 raramente passa de 3).
const MAX_OBJETIVOS = 6;
// O CICLO DO PEDIDO (spec 077), parametrizável por mesa em `cfg.harness`: o teto de vezes de um
// pedido, e quantas vezes seguidas sem avanço abrem o ponto de intervenção (K).
const TETO_VEZES = 12;
const VEZES_SEM_AVANCO = 2;

// AS DUAS FAIXAS DA MESA (spec 072, US3). A mesa ouve os FATOS; cada jogador lê a
// INTERPRETAÇÃO do próprio personagem. O DEFAULT é `dono`: um evento novo que ninguém
// classificou fica PRIVADO em vez de vazar. O raciocínio do harness (objetivos,
// rótulos, bastidor, plano, bloqueio) é do dono.
const _MESA = new Set([
  "tentativa",                                     // a TENTATIVA, in-world
  "beat",                                          // fato do mundo, 3ª pessoa
  "fila", "entrou", "saiu", "sala",                // estado da mesa
]);

function escopoDe(evento) {
  return _MESA.has(evento) ? "mesa" : "dono";
}

const _soma = (c) => ((c && c.entrada) || 0) + ((c && c.saida) || 0);


class Laco {
  constructor({ mundo, mente, extensoes, registro, emitir, decider, notebook, pensar }) {
    this.mundo = mundo;
    this.mente = mente;
    this.extensoes = extensoes || { hook: async (_p, d) => d, prompts: {} };
    this.registro = registro;
    this.emitir = emitir || (() => {});
    this._deciderInjetado = decider || null;
    this._notebookInjetado = notebook || null;
    // A CHAVE DO PENSAR (spec 077): uma função (o assento da mesa a dá) ou um booleano (o
    // terminal, `--pensar`). Desligada, o sussurro roda o plano uma vez e nada é carregado.
    this.pensar = pensar || false;
    this.ocupado = false;
    this.ocupadoDesde = null;
    this.numeroTurno = 0;
    this._seq = 0;
  }

  // TODO EVENTO DIZ DE QUEM É e A QUEM PODE CHEGAR (spec 072, FR-017).
  _emite(evento, dados) {
    try {
      this.emitir(evento, { ...(dados || {}),
                            personagem: this.mundo.personagem,
                            escopo: escopoDe(evento) });
    } catch (e) {
      log("OUVINTE DO LAÇO FALHOU (o turno segue)", e.message);
    }
  }

  _tituloDaRotina(nome) {
    const lista = (this.mente && this.mente.ROTINAS) || [];
    const r = lista.find((x) => x.nome === nome);
    return (r && r.titulo) || nome;
  }

  _cfg() {
    return (this.mente && typeof this.mente.config === "function") ? this.mente.config() : {};
  }

  _prompt(nome) { return H.prompts.comVersao(nome, this.extensoes); }

  // O decisor é do ecossistema do personagem: o system dele vem da mesa (extensões).
  _decider() {
    if (this._deciderInjetado) return this._deciderInjetado;
    const cfg = this._cfg();
    const chave = JSON.stringify(cfg.decisor || {}) + this._prompt("decisor_system").versao;
    if (!this._decisorCache || this._decisorChave !== chave) {
      this._decisorCache = createDecider({ cfg, system: () => this._prompt("decisor_system").texto });
      this._decisorChave = chave;
    }
    return this._decisorCache;
  }

  _notebook() {
    if (this._notebookInjetado) return this._notebookInjetado;
    if (!this._nb || this._nb.personagem !== this.mundo.personagem) {
      this._nb = new H.desire.Notebook(this.mundo.personagem);
    }
    return this._nb;
  }

  _pensarLigado() {
    return typeof this.pensar === "function" ? !!this.pensar() : !!this.pensar;
  }

  // A FILA PERGUNTA (spec 077): há pedido do jogador aberto? É o que dá a vez a quem está com a
  // autonomia desligada. O caderno pode estar velho (o jogador fechou o desejo pela tela); a
  // vez sincroniza com o mundo e, sem nada, descarta.
  temPedidoAberto() {
    return this._pensarLigado() && !!this._notebook().ativo({ soPedido: true });
  }

  // A CHAVE DESLIGADA COM PEDIDO ABERTO (FR-013): o pedido se fecha, sem lembrança de
  // desistência — quem parou foi o jogador. Com um turno em voo, fecha quando ele acabar.
  async fecharPedidoDoJogador() {
    if (this.ocupado) { this._fecharAoLiberar = true; return { adiado: true }; }
    return this._fecharPedidoDoJogadorAgora();
  }

  async _fecharPedidoDoJogadorAgora() {
    try {
      const ctx = await this.mundo.contexto();
      const nb = this._notebook();
      nb.sync((ctx.self || {}).intentions);
      const d = nb.ativo({ soPedido: true });
      if (!d) return { ok: true, fechado: null };
      await this._fecharPedido(d, "abandonada");
      return { ok: true, fechado: d.id };
    } catch (e) {
      log("FECHAR O PEDIDO DO JOGADOR FALHOU", e.message);
      return { erro: e.message };
    }
  }

  // A trava do conector. NÃO substitui a do mundo (Princípio III); só evita que o
  // próprio conector se atropele. `ocupadoDesde` distingue um turno de 20 s de um
  // PENDURADO há vinte minutos.
  async comTurno(fn) {
    if (this.ocupado) {
      this._emite("sistema",
        { texto: "Uma ação já está em andamento — aguarde o desfecho." });
      return null;
    }
    this.ocupado = true;
    this.ocupadoDesde = Date.now();
    this._emite("estado", { ocupado: true, ocupadoDesde: this.ocupadoDesde });
    try {
      return await fn();
    } finally {
      this.ocupado = false;
      this.ocupadoDesde = null;
      this._emite("estado", { ocupado: false, ocupadoDesde: null });
      if (this._fecharAoLiberar) {
        this._fecharAoLiberar = false;
        this._fecharPedidoDoJogadorAgora();
      }
    }
  }

  // ----------------------------------------------------------------------- //
  // A caixa: mede tempo e custo (pago e local) de um pedaço do turno
  // ----------------------------------------------------------------------- //

  async _caixa(t, box, fn, { prompt, rotulo } = {}) {
    if (t && t.entrou) t.entrou(box);
    if (rotulo) this._emite("harness", { box, texto: rotulo, numeroTurno: this.numeroTurno });
    const m0 = this.mente && this.mente.custoDoTurno ? this.mente.custoDoTurno() : null;
    const dec = this._decider();
    const d0 = dec.custoLocal ? dec.custoLocal() : null;
    const ini = Date.now();
    const r = await fn();
    const dados = { duracao_ms: Date.now() - ini };
    if (m0) {
      const m1 = this.mente.custoDoTurno();
      const pago = { entrada: m1.entrada - m0.entrada, saida: m1.saida - m0.saida,
                     chamadas: m1.chamadas - m0.chamadas };
      if (pago.chamadas) {
        dados.custo_pago = pago;
        dados.modelo = this._rotuloMente();
      }
    }
    if (d0) {
      const d1 = dec.custoLocal();
      const local = { chamadas: d1.chamadas - d0.chamadas, tokens_prompt: d1.tokens_prompt - d0.tokens_prompt };
      if (local.chamadas) {
        dados.custo_local = local;
        dados.modelo = dados.modelo || (dec.modelo ? dec.modelo() : null);
      }
    }
    if (prompt) dados.prompt_versao = prompt.versao;
    return [r, dados];
  }

  _rotuloMente() {
    const c = this._cfg();
    if (c.runtime === "remote") return `anthropic/${c.remoteModel}`;
    if (c.runtime === "openrouter") return `openrouter/${c.openrouterModel}`;
    if (c.runtime === "gemini") return `gemini/${c.geminiModel}`;
    return `ollama/${c.model}`;
  }

  // As ferramentas do turno: as do MUNDO (tools/list) e as LOCAIS de quem tuna. O nome
  // do mundo ganha sempre — uma tool local nunca sequestra uma capacidade do mundo.
  async _ferramentas() {
    const doMundo = await this.mundo.listarCapacidades();
    const nomes = new Set(doMundo.map((t) => t.name));
    const locais = (this.extensoes && typeof this.extensoes.toolsLocais === "function"
      ? this.extensoes.toolsLocais() : []).filter((t) => !nomes.has(t.name));
    return doMundo.concat(locais);
  }

  // ----------------------------------------------------------------------- //
  // O turno do jogador
  // ----------------------------------------------------------------------- //

  async sussurrar(texto, origem = "manual") {
    return this.comTurno(async () => {
      const t = this.registro ? this.registro.abrir() : null;
      if (t) this.mundo.turnoId = t.id;
      try {
        const contexto = await this.mundo.contexto();
        if (t) t.pretendia((contexto.self || {}).intentions);
        if (t) t.sussurro(texto, origem);
        // O caderno alinhado com o mundo antes do plano: o pedido aberto (spec 077) é lido daqui.
        // O sussurro durante um travamento é a voz do jogador: entra no plano como o pedido novo.
        const nb = this._notebook();
        const d = nb.sync((contexto.self || {}).intentions);
        if (t && d) t.desejo(nb.foto(d.id));
        await this._turno(texto, contexto, t);
      } catch (e) {
        this._falhou(e, t);
      } finally {
        if (t) await t.fechar();
      }
    });
  }

  _falhou(e, t) {
    // SEM FALLBACK (Princípio VIII): a Mente ou o decisor fora do ar interrompe o
    // turno. O mundo fica intacto — a verdade está nos arquivos, não aqui.
    const texto = e instanceof DeciderUnavailable
      ? `O decisor local não respondeu — ${e.message}. Confira o Ollama (ou o endpoint do decisor) e tente de novo.`
      : e instanceof H.objectives.PlanContractError
        ? "A Mente não devolveu um plano que desse para seguir. Confira o modelo de planejar e tente de novo."
        : `Algo interrompeu a cena: ${e.message}`;
    this._emite("erro", { texto });
    if (t) t.falha(e.message);
  }

  async _turno(texto, contexto, t) {
    this.numeroTurno += 1;
    const custo0 = this.mente.custoDoTurno ? _soma(this.mente.custoDoTurno()) : 0;
    let cena = { texto, contexto };
    cena = await this.extensoes.hook("antes_de_pensar", cena, t) || cena;
    const ctx = cena.contexto;

    const breadcrumb = _breadcrumbDoLugar(ctx && ctx.scene && ctx.scene.place);
    if (breadcrumb.length) this._emite("local", { breadcrumb });

    // C1 · a cena como índice + as ferramentas da face
    const [c1, d1] = await this._caixa(t, "C1", async () => {
      const tools = await this._ferramentas();
      return { tools, idx: sceneIndex(ctx) };
    });
    if (t) t.caixa("C1", { ...d1, saida: { tools: c1.tools.length, nomes_citaveis: c1.idx.size } });

    // C3 · o PLANO do turno (specs 076 e 077): só o passo ATO vai ao resolvedor; fala e gesto são
    // o que ele diz e expressa, e nunca chegam ao mundo. Com o pensar ligado e um pedido do
    // jogador aberto, o plano recebe o pedido anterior e o que já foi feito (sem o resto do plano
    // velho: medido, ele puxava o personagem para o pedido velho por cima do sussurro novo).
    const pensar = this._pensarLigado();
    const aberto = pensar ? this._notebook().ativo({ soPedido: true }) : null;
    const andamento = aberto ? { antes: _palavrasDe(aberto), feito: this._feito(aberto) } : null;
    const c3 = await this._planC3({ ctx, instrucao: cena.texto, t, andamento,
                                   entrada: { instrucao: cena.texto, ...(andamento ? { andamento } : {}) } });

    const ex = await this._executarAtos({ plan: c3.plan, ctx, tools: c1.tools, idx: c1.idx, t,
                                          sussurro: cena.texto, d: aberto });
    // O PEDIDO (spec 077): com o pensar ligado, o que o plano deixou para depois abre ou regrava
    // o pedido; "nada a carregar" fecha o que estava aberto. Desligado, nada é carregado.
    const custoDoPlano = this.mente.custoDoTurno ? _soma(this.mente.custoDoTurno()) - custo0 : 0;
    const extras = pensar
      ? await this._pedidoDoSussurro({ texto: cena.texto, plan: c3.plan, ctx, ex, aberto, t, custoDoPlano })
      : [];

    // O turno que mudou alguma coisa (spec 072, FR-032) — a sala lê para decidir se o
    // assento está girando à toa.
    this.ultimoTurnoAplicou = ex.desfechos.some((d) => d && d.ok);
    return this._fecharTurno(ex.desfechos, ctx, ex.naoAconteceu, t, extras);
  }

  // C3 · O PLANO DO TURNO (specs 076 e 077, PAGO, sem tools), para o sussurro e para a vez de
  // um pedido ou desejo aberto. A Mente devolve o contrato M2; o registro guarda o plano inteiro
  // e o racional sobe à camada visível. Plano fora do contrato LANÇA (`PlanContractError`) e o
  // turno falha honesto em `_falhou`, sem fallback (Princípio VIII).
  async _planC3({ ctx, instrucao, t, entrada, andamento }) {
    const p3 = this._prompt("objetivos");
    this._emite("rotina_ativa", { rotina: "objetivos", titulo: this._tituloDaRotina("objetivos") });
    let c3, d3;
    try {
      [c3, d3] = await this._caixa(t, "C3", () => H.objectives.objectives({
        mente: this.mente, ctx, instrucao, system: p3.texto, andamento }),
      { prompt: p3, rotulo: label("C3") });
    } finally {
      this._emite("rotina_ociosa", { stopReason: "end_turn" });
    }
    if (t) t.caixa("C3", { ...d3, entrada, saida: { plano: c3.plan } });
    if (t) t.pensou({ pensamento: c3.plan.stance || c3.steps.map((s) => s.action).join(" · ") });
    const texto = H.labels.rationaleText(c3.plan);
    if (texto) {
      this._emite("objetivos", { texto, passos: c3.steps.map((s) => ({ tipo: s.type })),
                                 numeroTurno: this.numeroTurno });
    }
    return c3;
  }

  // C4 → C6 → C7 → M2 para UM objetivo. → { out?, subiu?, objeto?, chamada?, tool? }
  async _resolverEAgir({ objetivo, ctx, tools, idx, t, sussurro, noDesejo }) {
    // C4 · onde está o alvo
    const [c4, d4] = await this._caixa(t, "C4", async () => {
      const citados = H.target.cited(objetivo, idx);
      return { citados, onde: H.target.whereIs(objetivo, idx) };
    }, { rotulo: label(c4Rotulo(objetivo, idx), { alvo: H.target.whereIs(objetivo, idx).nome }) });
    if (t) t.caixa("C4", { ...d4, entrada: { objetivo }, saida: c4.onde });
    const alvos = c4.citados.filter((a) => a.onde === "aqui" || a.onde === "longe");
    // O alvo LONGE segue: ir até lá (`travel_to`) ou perguntar de quem não está aqui
    // (`ask_about`) são atos válidos, e quem recusa o que não cabe é o mundo.
    this._bastidor("C4", { objetivo, alvo: c4.onde.nome, onde: c4.onde.onde });

    // C6 · qual capacidade
    const p6 = this._prompt("c6_tool");
    const [c6, d6] = await this._caixa(t, "C6", () => H.tool.chooseTool({
      texto: objetivo, tools, alvos, decider: this._decider(), pergunta: p6.texto }),
    { prompt: p6, rotulo: label("C6") });
    if (t) t.caixa("C6", { ...d6, entrada: { objetivo, candidatas: c6.candidatas, pista: c6.pista, abriu: c6.abriu },
                           saida: c6.tool ? { tool: c6.tool } : { subiu: c6.subiu }, decisao: c6.decisao });
    this._bastidor("C6", { objetivo, tool: c6.tool, margem: c6.decisao && c6.decisao.margem,
                           subiu: c6.subiu || null });
    if (!c6.tool) {
      // Sem tool — o relatório conta isto como TOOL AUSENTE (ou gesto). A subida fica
      // na caixa C6, e o laço a leva à narração e, sem alvo conhecido, ao plano.
      if (c6.subiu === "sem_tool" && c4.onde.onde === "desconhecido") {
        return { subiu: "alvo_desconhecido" };
      }
      return { subiu: c6.subiu };
    }
    const tool = tools.find((x) => x.name === c6.tool);
    // R1 (spec 076): a capacidade pede uma saída e o passo nomeou o DESTINO — a saída que leva
    // lá entra no lugar dele (ver `target.withDestinations`).
    const citados = H.target.withDestinations(objetivo, c4.citados, ctx, H.tool.refsOf(tool));
    const alvosC7 = citados.filter((a) => a.onde === "aqui" || a.onde === "longe");
    // SEM ALVO NENHUM citado e a tool pede referência: escolher no enum inteiro seria
    // a TROCA SILENCIOSA (pediram a caneca que não existe, beberia do cantil). Sobe.
    // Regra da montagem (`v1/montagem/rodar.py`: `not cit and t not in SEM_ALVO`).
    if (!alvosC7.length && Object.keys(H.tool.refsOf(tool)).length) {
      // a subida vai ao REGISTRO como caixa C7 (sem ela, o relatório não a veria)
      if (t) t.caixa("C7", { entrada: { objetivo, tool: c6.tool }, saida: { subiu: "alvo_desconhecido" } });
      this._bastidor("C7", { objetivo, tool: c6.tool, subiu: "alvo_desconhecido" });
      return { subiu: "alvo_desconhecido", tool: c6.tool };
    }

    // C7 · os parâmetros
    const p7 = this._prompt("c7_param");
    const [c7, d7] = await this._caixa(t, "C7", () => H.params.fillParams({
      texto: objetivo, tool, citados, ctx, decider: this._decider(), pergunta: p7.texto }),
    { prompt: p7, rotulo: label("C7") });
    if (t) t.caixa("C7", { ...d7, entrada: { objetivo, tool: c6.tool },
                           saida: c7.args ? { args: _semProsa(c7.args) } : { subiu: c7.subiu, objeto: c7.objeto },
                           decisao: c7.decisoes });
    this._bastidor("C7", { objetivo, tool: c6.tool, args: c7.args ? _semProsa(c7.args) : null,
                           subiu: c7.subiu || null });
    if (!c7.args) return { subiu: c7.subiu, objeto: c7.objeto, tool: c6.tool };

    // M2 · o mundo
    const out = await this._m2({ tool, args: c7.args, objetivo, ctx, t, sussurro, noDesejo });
    return { out, chamada: { tool: c6.tool, args: c7.args } };
  }

  _bastidor(box, dados) {
    this._emite("bastidor", { box, ...dados, numeroTurno: this.numeroTurno });
  }

  // M2 · a chamada ao mundo, com a tentativa visível e a recusa em linguagem de mundo.
  async _m2({ tool, args, objetivo, ctx, t, sussurro, noDesejo }) {
    const toolCallId = `t${this.numeroTurno}-${++this._seq}`;
    let corpo = await this.extensoes.hook("antes_de_propor",
      { capacidade: tool.name, args }, t) || { capacidade: tool.name, args };
    const nomesDosAlvos = Object.entries(_semProsa(corpo.args))
      .map(([, v]) => (Array.isArray(v) ? v : [v]))
      .flat().map((v) => nameOf(ctx, v) || (typeof v === "string" ? v : null));
    this._emite("tentativa", {
      toolCallId, nome: tool.name,
      tituloDinamico: _tituloComando(tool.name, nomesDosAlvos),
      descricaoDoTool: this.mundo.descricaoDe ? this.mundo.descricaoDe(tool.name) : "",
    });
    const ehLocal = !!(this.extensoes && typeof this.extensoes.ehLocal === "function"
      && this.extensoes.ehLocal(tool.name) && !(this.mundo.conhece && this.mundo.conhece(tool.name)));
    const [r, dm] = await this._caixa(t, "M2", async () => {
      if (ehLocal) {
        const s = await this.extensoes.executarLocal(tool.name, _semProsa(corpo.args));
        return { texto: s.erro || JSON.stringify(s.resultado), narrativa: {}, recusado: !!s.erro };
      }
      return this.mundo.chamarCapacidade(tool.name, corpo.args);
    });
    if (t) t.propos(tool.name, _semProsa(corpo.args), corpo.args.prosa, r);

    // O MUNDO NÃO CONSEGUIU JULGAR (item 52.1): recado de SISTEMA, nunca narração.
    const ji = r.sistema && r.sistema.juizo_indisponivel;
    if (ji) {
      const q = ji.quantas > 1 ? `${ji.quantas} vezes neste turno` : "neste turno";
      this._emite("sistema", { texto:
        `O mundo não conseguiu julgar ${q} — o desfecho caiu no padrão, e não é o ` +
        `personagem que falhou. Verifique o modelo do Árbitro (${ji.porque}).` });
      if (t) t.falhaDeExtensao("juizo", `indisponível ${ji.quantas}x: ${ji.porque}`);
    }

    let out = { ...(r.narrativa || {}), ok: !r.recusado, erro: r.recusado ? r.texto : null,
                recusaCorrigivel: r.recusado ? (r.recusa || null) : null };
    delete out.character_id;
    if (ehLocal && !r.recusado) out.informes = [r.texto];
    // A RECUSA VIRA MATÉRIA DE NARRAÇÃO (Princípio X: nunca um silêncio sem causa).
    if (!out.ok && out.erro && !(out.failed_effects || []).length) {
      out.failed_effects = [{ o_que_falhou: out.erro }];
    }
    out = await this.extensoes.hook("depois_do_desfecho", out, t) || out;

    const consultiva = H.evidence.isConsultive(tool, ehLocal);
    const acao = {
      tool: tool.name, args: _semProsa(corpo.args), objetivo,
      aceita: out.ok, motivo: out.ok ? null : out.erro,
      persistente: H.evidence.isPersistent(out, consultiva), consultiva,
      pedida: H.evidence.wasAsked(objetivo, sussurro), desejo: noDesejo || null,
    };
    if (t) {
      t.caixa("M2", { ...dm, entrada: { tool: tool.name, args: acao.args },
                      saida: { aceita: out.ok, motivo: acao.motivo } });
      t.acao(acao);
    }

    if (!out.ok) {
      if (out.erro) this._emite("recusa", { texto: out.erro, toolCallId });
    } else {
      let algumBeat = false;
      for (const frase of out.aconteceu || []) {
        this._emite("beat", { texto: frase, toolCallId });
        algumBeat = true;
      }
      // A tentativa CONSULTIVA não traz `aconteceu`; sem nenhum beat o tool_call_update
      // nascido "in_progress" nunca fecharia. Mostra o mesmo resumo que vai à narração.
      if (!algumBeat) this._emite("beat", { texto: this._desfechoEmPalavras(out), toolCallId });
    }
    return out;
  }

  // O DESFECHO EM PALAVRAS — só linguagem de mundo (o que aconteceu, o que falhou e
  // por quê). Nada de nome de regra nem de campo.
  _oQueCorrigir(rec) {
    const validos = (rec && rec.validos) || [];
    const nomes = validos.map((v) => (v && (v.nome || v.id)) || "").filter(Boolean);
    if (!nomes.length) return "";
    const campo = rec.campo ? `'${rec.campo}'` : "esse campo";
    return `. Para ${campo}, só valem: ${nomes.join(", ")}.`;
  }

  _desfechoEmPalavras(out) {
    if (!out.ok) {
      const base = out.erro || "o mundo não deixou.";
      return base + this._oQueCorrigir(out.recusaCorrigivel);
    }
    const partes = [];
    for (const f of out.aconteceu || []) partes.push(String(f));
    for (const f of out.failed_effects || []) {
      const txt = typeof f === "string" ? f : (f && (f.o_que_falhou || f.texto));
      if (txt) partes.push(String(txt));
    }
    for (const chave of ["lido", "falas", "wares", "informes", "reconhecimentos"]) {
      for (const m of out[chave] || []) {
        // PRINCÍPIO V: um objeto do mundo NUNCA vira JSON na tela (a bateria da 077 mostrou o
        // reconhecimento do Bram inteiro, com id e "posse", num batimento do turno). Do objeto, só o
        // que se lê em mundo: o texto, ou quem/o que foi observado.
        const txt = typeof m === "string" ? m : (m && (m.texto || m.text || m.fala || m.name || m.nome)) || "";
        if (txt) partes.push(String(txt));
      }
    }
    if (out.narrative_hint && !partes.length) partes.push(String(out.narrative_hint));
    return partes.join("\n") || "nada mudou.";
  }

  // O fim do turno: ou o recado de por que nada houve, ou a narração do ARCO (C9).
  async _fecharTurno(desfechos, contexto, naoAconteceu, t, fatosExtras) {
    const extras = fatosExtras || [];
    if (!desfechos.length && !(naoAconteceu || []).length && !extras.length) {
      // Turno vazio. NÃO narramos: sem fato nenhum, a narração preenche o vazio com
      // cenário inventado — o pior erro possível.
      this._emite("sistema", { texto: this._porQueNada(contexto) });
      return;
    }
    const juntar = (chave) => desfechos.flatMap((d) => d[chave] || []);
    const hints = desfechos.map((d) => d.narrative_hint).filter(Boolean);
    let depois = contexto;
    try {
      depois = await this.mundo.contexto();
    } catch (_) { /* sem diff; a narração segue com o que já tem */ }
    const paralelos = diffTextual(contexto, depois);
    if (paralelos.length) {
      this._emite("paralelo", { texto: paralelos.join(" "), numeroTurno: this.numeroTurno });
    }
    await this._narrar({
      hint: hints.length ? hints[hints.length - 1] : null,
      contexto,
      // O QUE SUBIU SEM RESOLVER entra como não acontecido (FR-007): a narração conta
      // o que não houve em vez de calar sobre o pedido.
      falhas: juntar("failed_effects").concat(naoAconteceu || []),
      viradas: juntar("viradas"),
      aconteceu: juntar("aconteceu").concat(extras),
      informes: juntar("informes"),
      reconhecimentos: juntar("reconhecimentos"),
      material: { lido: juntar("lido"), wares: juntar("wares"), falas: juntar("falas") },
    }, t);
  }

  _porQueNada(contexto) {
    const caps = (contexto && contexto.capacidades) || [];
    const prosas = caps.map((c) => (c.descricao || "").trim()).filter(Boolean);
    if (caps.length && caps.length <= 3 && prosas.length) {
      return "Ele não fez nada. " + prosas.join(" ");
    }
    return "Nada em que ele pudesse agir agora.";
  }

  async _narrar(arco, t) {
    const a = await this.extensoes.hook("antes_de_narrar", arco, t) || arco;
    this._emite("narracao_inicio", { numeroTurno: this.numeroTurno });
    this._emite("rotina_ativa", { rotina: "narrar", titulo: this._tituloDaRotina("narrar") });
    let prosa = "";
    try {
      const [p, d9] = await this._caixa(t, "C9", () => this.mente.narrate(
        a.hint, a.contexto, a.falhas, a.viradas, a.aconteceu, a.informes,
        a.reconhecimentos, a.material,
        (pedaco) => this._emite("narracao", { pedaco, numeroTurno: this.numeroTurno })));
      prosa = p;
      if (t) t.caixa("C9", { ...d9, saida: { caracteres: (prosa || "").length } });
    } finally {
      this._emite("narracao_fim", { texto: prosa, numeroTurno: this.numeroTurno });
      this._emite("rotina_ociosa", { stopReason: "end_turn" });
    }
    if (t) t.narrou(prosa);
  }

  // OLHAR não é agir (spec 018): não gasta turno e não toma a trava. Mas é NARRADO.
  async observar(pacote) {
    this._emite("narracao_inicio", {});
    let prosa = "";
    try {
      prosa = await this.mente.narrateObservation(
        pacote, { self: { name: pacote && pacote.observer } });
    } catch (e) {
      prosa = ((pacote && pacote.description) || "").trim()
            || `${(pacote && pacote.name) || "aquilo"} não revela nada além do que se vê.`;
      log("OBSERVAR SEM MENTE (caiu no estático)", e.message);
    } finally {
      this._emite("narracao_fim", { texto: prosa });
    }
    return prosa;
  }

  // ----------------------------------------------------------------------- //
  // O desejo: nasce, anda, fecha ou morre — decidido AQUI (opção 2)
  // ----------------------------------------------------------------------- //

  _prosaCena(ctx) {
    return this.mente._contextoPayload(ctx, { comCapacidades: false })
      .then((p) => this.mente._cenaEmProsa(p));
  }

  // O que fica para depois sobe à tela como o plano do ACP (só leitura): os itens do último
  // `depois`, todos pendentes — quem diz o que já aconteceu é o mundo, não esta lista.
  _emitePlano(d) {
    if (!d) return;
    this._emite("plano", {
      desejo: d.desejo,
      entries: (d.passos || []).map((p) => ({ content: p, status: "pending" })),
    });
  }

  // A VEZ DELE NA FILA (contrato 01; spec 077). O relógio é da SALA (spec 072); aqui só se
  // JOGA a vez quando mandam, e se diz se ela mudou alguma coisa. Com a autonomia desligada,
  // só o pedido do JOGADOR anda (a autonomia governa o que ele inventa); ligada, anda o desejo
  // mais recente e, sem desejo nenhum, ele pensa no que quer.
  async talvezAgirSozinho({ autonomia = true } = {}) {
    return this.comTurno(async () => {
      const t = this.registro ? this.registro.abrir() : null;
      if (t) this.mundo.turnoId = t.id;
      try {
        this.numeroTurno += 1;
        this.ultimoTurnoAplicou = false;
        const ctx = await this.mundo.contexto();
        const self = ctx.self || {};
        if (t) t.pretendia(self.intentions);
        // QUEM DORME FUNDO NÃO DECIDE — 0 token (o Motor recusaria o `wake_up`).
        if (self.is_deep_asleep) { if (t) t.descartar("sono"); return; }
        // EM TRÂNSITO: a viagem leva ticks; o pedido ESPERA a chegada (research R6 da 075).
        if (self.transit) {
          const destino = self.transit.journey_to_name || self.transit.to_name || "";
          this._emite("harness", { box: "C8", texto: label("TRANSITO", { destino }) });
          if (t) t.descartar("transito");
          return;
        }
        const nb = this._notebook();
        nb.sync(self.intentions);
        const d = autonomia ? nb.ativo() : (this._pensarLigado() ? nb.ativo({ soPedido: true }) : null);
        if (t) t.sussurro(null, "autonoma");
        const idx = sceneIndex(ctx);
        if (!d) {
          if (autonomia) await this._tickSemDesejo(ctx, idx, t);
          else if (t) t.descartar("sem_pedido");
          return;
        }
        if (t) t.desejo(nb.foto(d.id));
        await this._vezDoPedido(d, ctx, idx, t);
      } catch (e) {
        this._falhou(e, t);
      } finally {
        if (t) await t.fechar();
      }
    });
  }

  // Sem desejo, com a autonomia ligada: "o que eu quero agora?" (C3P · querer). O desejo nasce
  // só com o texto; a vez seguinte o pensa pelo M2, como um pedido (spec 077: o planejador
  // antigo saiu). Nada age no mundo nesta vez.
  async _tickSemDesejo(ctx, idx, t) {
    const pq = this._prompt("querer");
    this._emite("rotina_ativa", { rotina: "querer", titulo: this._tituloDaRotina("querer") });
    let q, dq;
    try {
      const prosaCena = await this._prosaCena(ctx);
      [q, dq] = await this._caixa(t, "C3P", async () => {
        const cru = await this.mente.conversar(pq.texto, prosaCena,
          { rotina: "querer", label: "QUERER (C3P)", temperature: 0.6 });
        return String(cru || "").split("\n").map((l) => l.trim()).find(Boolean) || "";
      }, { prompt: pq, rotulo: label("QUERER") });
    } finally {
      this._emite("rotina_ociosa", { stopReason: "end_turn" });
    }
    const desejo = q.replace(/^["“]|["”]$/g, "").trim();
    if (t) t.caixa("C3P", { ...dq, entrada: { querer: true }, saida: { desejo } });
    if (!desejo) { if (t) t.descartar("sem_desejo"); return; }
    this._emite("objetivos", { texto: desejo, numeroTurno: this.numeroTurno });
    await this.mundo.criarIntencao(H.desire.formatContent(desejo, [], null));
    const ctx2 = await this.mundo.contexto();
    this._notebook().sync((ctx2.self || {}).intentions);
  }

  // A VEZ DE UM PEDIDO OU DESEJO ABERTO (spec 077, research D3): confere o fato, os limites e a
  // janela de intervenção; repensa o pedido inteiro pelo M2 com o andamento; executa só os atos;
  // e fecha, regrava ou trava.
  async _vezDoPedido(d, ctx, idx, t) {
    const nb = this._notebook();
    const cfg = this._cfg();
    const h = cfg.harness || {};
    const mente0 = this.mente.custoDoTurno ? _soma(this.mente.custoDoTurno()) : 0;
    const pagar = () => {
      if (!this.mente.custoDoTurno) return;
      nb.pay(d.id, _soma(this.mente.custoDoTurno()) - mente0);
    };
    const palavras = _palavrasDe(d);
    const base = { id: d.id, origem: d.origem, palavras };

    // C8D · o fato que fecha já é verdade? (regra, 0 token)
    const [fimOk, dfd] = await this._caixa(t, "C8D", async () => H.ending.isDone(d.fim, ctx),
      { rotulo: label("C8D") });
    if (t) t.caixa("C8D", { ...dfd, entrada: { fim: d.fim }, saida: { cumprido: fimOk } });
    if (fimOk === true) {
      await this._fecharPedido(d, "concluida");
      if (t) t.pedido({ ...base, conferido: { antes: true }, desfecho: "andou", estado: "cumprido",
                        vezes: d.vezes || 0 });
      this.ultimoTurnoAplicou = true;
      return this._fecharTurno([], ctx, [], t, [_fatoCumprido(d.fim)]);
    }

    // O TETO do pedido: vezes demais, ou custo demais, sem fechar (FR-009)
    if ((d.vezes || 0) >= (h.tetoVezesPedido || TETO_VEZES) || H.progress.overBudget(d.tokens_pagos, cfg)) {
      await this._fecharPedido(d, "abandonada", { lembrar: true });
      this._emite("sistema", { texto: `Ele desiste do pedido ${_aspas(palavras)}.` });
      if (t) t.pedido({ ...base, desfecho: "teto", estado: "largado", vezes: d.vezes || 0 });
      return;
    }

    // O PONTO DE INTERVENÇÃO aberto espera a voz do jogador por uma janela de vezes (0 token);
    // vencida, ele segue repensando com as recusas.
    if (d.intervencao) {
      if ((d.intervencao.ticks || 0) < (h.janelaIntervencaoTicks || 1)) {
        d.intervencao.ticks = (d.intervencao.ticks || 0) + 1;
        nb.salvar();
        if (t) t.descartar("intervencao");
        if (t) t.pedido({ ...base, desfecho: "esperando", estado: "aberto", vezes: d.vezes || 0 });
        return;
      }
      d.intervencao = null;
      d.bloqueio = null;
      d.vezes_sem_avanco = 0;
      d.step = null;
      nb.salvar();
    }

    // C3 · o M2 repensa o pedido inteiro, com o que já foi feito e o que faltava
    const andamento = { feito: this._feito(d), faltava: d.passos || [] };
    const instrucao = palavras[palavras.length - 1];
    let c3;
    try {
      c3 = await this._planC3({ ctx, instrucao, t, andamento, entrada: { instrucao, andamento } });
    } catch (e) {
      // O PLANO FORA DO CONTRATO numa vez do meio: a vez falha honesta (076) e conta como vez sem
      // avanço — senão um modelo que sempre erra o formato prenderia o pedido para sempre.
      if (e instanceof H.objectives.PlanContractError) {
        nb.contarVez(d.id, false);
        pagar();
        if ((d.vezes_sem_avanco || 0) >= (h.vezesSemAvanco || VEZES_SEM_AVANCO)) {
          await this._abrirIntervencao(d, "plano_fora_do_contrato", null, t);
        }
      }
      throw e;
    }
    const plan = c3.plan;
    const tools = await this._ferramentas();
    const ex = await this._executarAtos({ plan, ctx, tools, idx, t, sussurro: null, d });
    for (const x of ex.tentativas) nb.attempt(d.id, { vez: (d.vezes || 0) + 1, ...x });
    // O LOSANGO DO FIM em SOMBRA (075, B15 reprovado): sem fato conferível, o Jev lê o que ele
    // acabou de saber; a resposta só é gravada ao lado da regra, sem efeito.
    if (((h.losangosJev || "sombra") !== "desligado") && (!d.fim || d.fim.familia === "nenhuma")) {
      try {
        const sombra = await H.ending.shadow({ decider: this._decider(), pergunta: this._prompt("c8d_fim").texto,
          desejo: palavras.join("; "), fim: d.fim, memoriasNovas: H.progress.newKnowledge(ctx, ex.ctxDepois || ctx) });
        if (sombra && t) t.caixa("C8D", { saida: { sombra: true }, sombra });
      } catch (e) { log("LOSANGO EM SOMBRA FALHOU (sem efeito)", e.message); }
    }

    // O fato desta vez: o do plano novo, se valer; senão o que já valia (um fato conferível não
    // se perde porque o plano desta vez não o repetiu).
    const fi = H.ending.fromPlan(plan.doneWhen, palavras, _textosDoPlano(plan), ctx);
    const fim = fi.fim.familia !== "nenhuma" ? fi.fim : (d.fim || fi.fim);
    const depoisCtx = ex.ctxDepois || ctx;
    const conferido = H.ending.isDone(fim, depoisCtx);
    const semAto = !plan.steps.some((x) => x.type === "ato");
    const reg = { ...base, depois: plan.later, defeitos: plan.defects,
                  fato: { texto: fi.fim.texto, valeu: fi.fim.familia !== "nenhuma",
                          motivo: fi.motivo || (plan.defects.includes("pronto_quando") ? "formato" : null) },
                  conferido: { antes: fimOk, depois: conferido } };
    let estado = "aberto";
    let desfecho = ex.andou ? "andou" : "sem_aceite";
    const extras = [];
    if (conferido === true) {
      await this._fecharPedido(d, "concluida");
      estado = "cumprido";
      extras.push(_fatoCumprido(fim));
    } else if (!plan.later.length && semAto) {
      // ELE DESISTIU (a decisão é dele, numa vez sem sussurro): a desistência vira lembrança.
      await this._fecharPedido(d, "abandonada", { lembrar: true });
      estado = "largado";
      this._emite("sistema", { texto: `Ele desiste do pedido ${_aspas(palavras)}.` });
    } else if (!plan.later.length && (!fim || fim.familia === "nenhuma") && ex.aceitos > 0) {
      await this._fecharPedido(d, "concluida");
      estado = "vontade";
      extras.push(_fatoCumprido(null));
    } else {
      const content = H.desire.formatContent(palavras, plan.later, fim && fim.texto);
      await this.mundo.atualizarIntencao(d.id, content);
      nb.regravar(d.id, { palavras, passos: plan.later, fim, content });
      nb.contarVez(d.id, ex.andou);
      const kSem = h.vezesSemAvanco || VEZES_SEM_AVANCO;
      if (ex.bloqueio || (d.vezes_sem_avanco || 0) >= kSem) {
        await this._abrirIntervencao(d, ex.bloqueio || "sem_avanco", ex, t);
        desfecho = "intervencao";
      }
      this._emitePlano(d);
    }
    pagar();
    if (t) t.pedido({ ...reg, desfecho, estado, vezes: (d.vezes || 0) + (estado === "aberto" ? 0 : 1) });
    this.ultimoTurnoAplicou = ex.desfechos.some((x) => x && x.ok);
    return this._fecharTurno(ex.desfechos, ctx, ex.naoAconteceu, t, extras);
  }

  // O SUSSURRO COM O PENSAR LIGADO (spec 077, research D7): o que o plano deixou para depois
  // ABRE o pedido (sem pedido aberto) ou o REGRAVA (com as palavras em sequência); "nada a
  // carregar" FECHA o que estava aberto, sem lembrança de desistência — quem mudou foi o
  // jogador. → os fatos extras da narração.
  async _pedidoDoSussurro({ texto, plan, ctx, ex, aberto, t, custoDoPlano = 0 }) {
    const nb = this._notebook();
    const palavras = aberto ? _palavrasDe(aberto).concat([texto]) : [texto];
    const fi = H.ending.fromPlan(plan.doneWhen, palavras, _textosDoPlano(plan), ctx);
    const depoisCtx = ex.ctxDepois || ctx;
    const conferido = H.ending.isDone(fi.fim, depoisCtx);
    const reg = { palavras, depois: plan.later, defeitos: plan.defects,
                  fato: { texto: fi.fim.texto, valeu: fi.fim.familia !== "nenhuma",
                          motivo: fi.motivo || (plan.defects.includes("pronto_quando") ? "formato" : null) },
                  conferido: { antes: null, depois: conferido } };
    if (aberto) {
      for (const x of ex.tentativas) nb.attempt(aberto.id, { vez: (aberto.vezes || 0) + 1, ...x });
      nb.pay(aberto.id, custoDoPlano);
      const base = { ...reg, id: aberto.id, origem: aberto.origem };
      if (conferido === true) {
        await this._fecharPedido(aberto, "concluida");
        if (t) t.pedido({ ...base, desfecho: ex.andou ? "andou" : "sem_aceite", estado: "cumprido",
                          vezes: (aberto.vezes || 0) + 1 });
        return [_fatoCumprido(fi.fim)];
      }
      if (!plan.later.length) {
        await this._fecharPedido(aberto, "abandonada");
        if (t) t.pedido({ ...base, desfecho: ex.andou ? "andou" : "sem_aceite", estado: "cancelado",
                          vezes: (aberto.vezes || 0) + 1 });
        return [];
      }
      const fim = fi.fim.familia !== "nenhuma" ? fi.fim : (aberto.fim || fi.fim);
      const content = H.desire.formatContent(palavras, plan.later, fim && fim.texto);
      await this.mundo.atualizarIntencao(aberto.id, content);
      nb.regravar(aberto.id, { palavras, passos: plan.later, fim, content });
      // a voz do jogador desfaz o travamento: o "andou?" recomeça daqui
      aberto.bloqueio = null;
      aberto.intervencao = null;
      aberto.vezes_sem_avanco = 0;
      aberto.step = null;
      nb.contarVez(aberto.id, ex.andou);
      this._emitePlano(aberto);
      if (t) t.pedido({ ...base, desfecho: ex.andou ? "andou" : "sem_aceite", estado: "aberto",
                        vezes: aberto.vezes });
      return [];
    }
    if (!plan.later.length || conferido === true) return [];
    // ABRE: o desejo nasce no mundo (a prosa) e o caderno o marca como pedido do jogador.
    const content = H.desire.formatContent(palavras, plan.later, fi.fim.texto);
    const antes = new Set(Object.keys(nb.dados.desejos));
    await this.mundo.criarIntencao(content);
    const ctx2 = await this.mundo.contexto();
    nb.sync((ctx2.self || {}).intentions);
    const novo = Object.values(nb.dados.desejos).find((x) => !antes.has(x.id)) || null;
    if (novo) {
      nb.marcarOrigem(novo.id, "pedido");
      nb.pay(novo.id, custoDoPlano);
      for (const x of ex.tentativas) nb.attempt(novo.id, { vez: 1, ...x });
      nb.contarVez(novo.id, ex.andou);
      novo.step = H.progress.newStep(H.progress.stateSignature(ctx2));
      nb.salvar();
      this._emitePlano(novo);
    }
    if (t) t.pedido({ ...reg, id: novo && novo.id, origem: "pedido", desfecho: "abriu", estado: "aberto",
                      vezes: 1 });
    return [];
  }

  // OS ATOS DE UM PLANO (specs 076 e 077, research D4), no sussurro e na vez do pedido: só o
  // passo ATO vai ao resolvedor, na ordem. Param no primeiro ato ACEITO que muda o lugar (os
  // seguintes eram da cena velha) e no primeiro que o MUNDO RECUSA (a recusa muda o plano: o
  // próximo a recebe como dado); o que sobe sem ir ao mundo não muda a cena e não para os
  // seguintes. Com um pedido (`d`), o "andou?" da 075 roda sobre o pedido inteiro.
  async _executarAtos({ plan, ctx, tools, idx, t, sussurro, d }) {
    const cfg = this._cfg();
    const r = { desfechos: [], naoAconteceu: [], tentativas: [], aceitos: 0, andou: false,
                parou: null, bloqueio: null, ctxDepois: null };
    let antes = ctx;
    let atos = 0;
    const lugar0 = _lugarDe(ctx);
    if (d && !d.step) d.step = H.progress.newStep(H.progress.stateSignature(ctx));
    for (const step of plan.steps) {
      if (step.type !== "ato") {
        if (t) t.passo(_stepRecord(step, step.type === "defeito" ? "defeito" : "narrado"));
        continue;
      }
      if (r.parou || atos >= MAX_OBJETIVOS) {
        if (t) t.passo({ ..._stepRecord(step, "nao_tentado"), ...(r.parou ? { motivo: r.parou } : {}) });
        continue;
      }
      atos += 1;
      const objetivo = H.objectives.actText(step);
      const res = _comoAto(await this._resolverEAgir({ objetivo, ctx: antes, tools, idx, t, sussurro,
                                                      noDesejo: d ? d.id : null }));
      if (t) t.passo(_stepRecord(step, _desfechoDoAto(res), res));
      if (res.out) r.desfechos.push(res.out);
      if (!res.chamada) {
        const m = motivoEmMundo(res.subiu, objetivo, res);
        if (m) r.naoAconteceu.push({ o_que_falhou: `${objetivo}: ${m}` });
        r.tentativas.push({ acao: step.action, tool: null, aceita: false, mundo: m || null });
        if (d) {
          const v = H.progress.after(d.step, { tool: "(nada)", args: { passo: objetivo }, aceita: false,
            recusa: res.subiu, estadoDepois: null, saber: false, cfg });
          if (v.veredito === "blocked") { r.bloqueio = v.motivo; r.parou = "bloqueio"; }
        }
        continue;
      }
      // FOI AO MUNDO: a cena é relida — o próximo ato, a conferência e o "andou?" leem a nova.
      let depois = antes;
      try { depois = await this.mundo.contexto(); } catch (_) { /* segue com a foto velha */ }
      r.tentativas.push({ acao: step.action, tool: res.chamada.tool, aceita: !!res.out.ok,
                          mundo: _mundoDisse(res.out) });
      const estadoDepois = H.progress.stateSignature(depois);
      const saber = H.progress.newKnowledge(antes, depois).length > 0;
      if (res.out.ok) {
        r.aceitos += 1;
        if (estadoDepois !== H.progress.stateSignature(antes) || saber) r.andou = true;
      }
      if (d) {
        const pre = H.progress.before(d.step, res.chamada.tool, res.chamada.args);
        const v = pre ? { veredito: "blocked", motivo: pre.bloqueio }
          : H.progress.after(d.step, { tool: res.chamada.tool, args: res.chamada.args, aceita: res.out.ok,
              recusa: res.out.erro, estadoDepois, saber, cfg });
        if (t) t.caixa("C8", { entrada: { acao: step.action, tool: res.chamada.tool },
                               saida: { veredito: v.veredito, motivo: v.motivo || null } });
        if (v.veredito === "progresso") r.andou = true;
        if (v.veredito === "blocked") { r.bloqueio = v.motivo; r.parou = "bloqueio"; }
      }
      antes = depois;
      if (!res.out.ok) r.parou = r.parou || "recusa";
      else if (_lugarDe(depois) !== lugar0) r.parou = r.parou || "lugar";
    }
    r.ctxDepois = antes;
    return r;
  }

  // O que ele já fez pelo pedido, em palavras de mundo, para o M2 (contrato `andamento.md`):
  // a ação do plano e o que o mundo disse. NUNCA nome de capacidade: a Mente não recebe schema
  // (invariante 1); tentativas antigas (da 075, sem `acao`) ficam de fora.
  _feito(d) {
    return ((d && d.tentativas) || []).filter((x) => x && x.acao).slice(-8).map((x) => {
      if (!x.tool) return `${x.acao} → nenhuma ação possível daqui${x.mundo ? ` (${x.mundo})` : ""}`;
      if (x.aceita) return `${x.acao} → deu certo${x.mundo ? `: ${x.mundo}` : ""}`;
      return `${x.acao} → o mundo recusou${x.mundo ? `: ${x.mundo}` : ""}`;
    });
  }

  // O PONTO DE INTERVENÇÃO (FR-009): sobe à tela em palavras de mundo — onde ele empacou e o
  // que o mundo disse por último — e a janela espera a voz do jogador.
  async _abrirIntervencao(d, motivo, ex, t) {
    const nb = this._notebook();
    d.bloqueio = { motivo, instante: new Date().toISOString() };
    d.intervencao = { ticks: 0 };
    nb.salvar();
    const ultima = [...((ex && ex.tentativas) || [])].reverse().find((x) => x.mundo);
    const texto = `Ele empacou no pedido ${_aspas(_palavrasDe(d))}`
      + (ultima ? `: ${_minusc(ultima.mundo)}.` : ": nada do que tentou adiantou.");
    this._emite("bloqueio", { texto, motivo, desejo: d.desejo });
    if (t) t.caixa("C8", { saida: { veredito: "blocked", motivo, intervencao: true } });
  }

  // Fecha o desejo no mundo (o mundo é a verdade) e realinha o caderno.
  async _fecharPedido(d, status, { lembrar = false } = {}) {
    await this.mundo.fecharIntencao(d.id, status, { lembrar });
    this._notebook().sync(((await this.mundo.contexto()).self || {}).intentions);
  }
}

// As palavras do jogador de um desejo (as linhas da prosa antes do que falta); o desejo que ele
// inventou tem uma só.
function _palavrasDe(d) {
  const p = (d && d.palavras) || [];
  return p.length ? p : [String((d && d.desejo) || "").trim()].filter(Boolean);
}

// O texto contra o qual o fato é aterrado: o que falta e as ações dos passos.
function _textosDoPlano(plan) {
  return ((plan && plan.later) || []).concat(((plan && plan.steps) || []).map((x) => x.action));
}

// Onde ele está: o lugar, ou a rota em que entrou (o trânsito também muda a cena).
function _lugarDe(ctx) {
  const lugar = ctx && ctx.scene && ctx.scene.place && ctx.scene.place.id;
  const tr = ctx && ctx.self && ctx.self.transit;
  return `${lugar || ""}|${tr ? (tr.to_id || tr.route_id || "transito") : ""}`;
}

// O que o mundo disse de um ato, numa linha: o que aconteceu, ou o motivo da recusa. Sem o
// "só valem: …" do corretor de campos, que é mecânica.
function _mundoDisse(out) {
  if (!out) return null;
  const t = out.ok ? (out.aconteceu || []).join(" ") : (out.erro || "");
  const linha = String(t || "").replace(/\s+/g, " ").trim();
  return linha ? (linha.length > 200 ? linha.slice(0, 199) + "…" : linha) : null;
}

// O fato extra da narração quando o pedido se cumpre: o FATO do mundo que fechou, em palavras de
// mundo. Citar as palavras do jogador fazia o narrador repetir o imperativo ("você conseguiu o que
// buscava: esquece isso") e inventar o resto (bateria do caso 3).
function _fatoCumprido(fim) {
  const alvo = fim && fim.alvo;
  switch (fim && fim.familia) {
    case "posse": return `ele tem ${alvo} consigo`;
    case "lugar": return `ele está em ${alvo}`;
    case "lembranca": return `ele sabe agora de ${alvo}`;
    case "necessidade":
      return alvo === "fome" ? "a fome dele passou" : alvo === "sede" ? "a sede dele passou" : "ele descansou";
    default: return "ele deu por feito o que queria";
  }
}

// As palavras do jogador entre aspas, para os recados de sistema (desistência, travamento).
function _aspas(palavras) {
  return `“${(palavras || []).join("; ")}”`;
}

function c4Rotulo(objetivo, idx) {
  return H.target.whereIs(objetivo, idx).nome ? "C4" : "C4_SEM";
}

// O passo do plano no REGISTRO (spec 076): como veio, mais o desfecho e, quando houve, a
// capacidade, o motivo da subida e se o mundo aceitou.
function _stepRecord(step, desfecho, r) {
  const p = { tipo: step.type, acao: step.action, com: step.with, espera: step.expects, desfecho };
  if (r) {
    const tool = (r.chamada && r.chamada.tool) || r.tool;
    if (tool) p.tool = tool;
    if (r.chamada) p.aceito = !!(r.out && r.out.ok);
    if (r.subiu && r.subiu !== "sem_tool") p.motivo = r.subiu;
  }
  return p;
}

// O ATO do plano que a C6 não ligou a capacidade nenhuma é SEM TOOL, com ou sem alvo citado.
// O "gesto" do resolvedor (NENHUMA e nada citado) vinha do tempo em que o objetivo não dizia o
// que era; agora o plano diz que é ato, e o que não achou capacidade é o sinal de tool
// ausente (e "não aconteceu" para a narração, nunca um gesto feito).
function _comoAto(r) {
  return r && r.subiu === "gesto" ? { ...r, subiu: "sem_tool" } : r;
}

function _desfechoDoAto(r) {
  if (r.chamada) return "executado";
  return r.subiu === "sem_tool" ? "sem_tool" : "subiu";
}

function _semProsa(args) {
  const o = {};
  for (const [k, v] of Object.entries(args || {})) if (k !== "prosa") o[k] = v;
  return o;
}

function _minusc(s) {
  const t = String(s || "").trim().replace(/\.$/, "");
  return t ? t[0].toLowerCase() + t.slice(1) : t;
}

// --------------------------------------------------------------------------- //
// O diff do que mudou ao redor enquanto o turno corria — o mundo é vivo, e o
// personagem repara nas coisas. Migrado de `client/app.js`.
// --------------------------------------------------------------------------- //

function diffTextual(velho, novo) {
  const eventos = [];
  if (!velho || !novo) return eventos;

  const nomes = (lista) => (lista || []).map((x) => x.name);
  const antes = nomes(velho.scene && velho.scene.characters);
  const agora = nomes(novo.scene && novo.scene.characters);
  agora.filter((n) => !antes.includes(n))
       .forEach((c) => eventos.push(`${c} chegou ao local.`));
  antes.filter((n) => !agora.includes(n))
       .forEach((c) => eventos.push(`${c} saiu do local.`));

  const itensAntes = nomes(velho.scene && velho.scene.items);
  const itensAgora = nomes(novo.scene && novo.scene.items);
  itensAgora.filter((n) => !itensAntes.includes(n))
            .forEach((i) => eventos.push(`Um(a) ${i} apareceu no chão.`));
  itensAntes.filter((n) => !itensAgora.includes(n))
            .forEach((i) => eventos.push(`Um(a) ${i} sumiu do chão.`));

  return eventos;
}

module.exports = { Laco, diffTextual, escopoDe, _MESA };
