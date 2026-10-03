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
//   MENTE (paga)      C3  o que eu quero agora, em prosa, sem schema de tool
//   RESOLVEDOR (local, 0 token pago)
//                     C4  onde está o alvo · C6 qual tool · C7 cada parâmetro
//   MUNDO             M2  executa, aceita ou recusa com motivo
//   HARNESS (regra)   C8  andou? · C8D acabou?
//   MENTE (paga)      C3P planejar · C3R replanejar · C9 narrar
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

// No máximo quantos objetivos um sussurro vira no mundo (o C3 raramente passa de 3).
const MAX_OBJETIVOS = 6;
// No tick, no máximo quantos atos concretizam um passo.
const MAX_ATOS_POR_PASSO = 2;

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
  constructor({ mundo, mente, extensoes, registro, emitir, decider, notebook }) {
    this.mundo = mundo;
    this.mente = mente;
    this.extensoes = extensoes || { hook: async (_p, d) => d, prompts: {} };
    this.registro = registro;
    this.emitir = emitir || (() => {});
    this._deciderInjetado = decider || null;
    this._notebookInjetado = notebook || null;
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
        // O SUSSURRO DURANTE UM BLOQUEIO é a intervenção do jogador (FR-009c): ela
        // fecha a janela e vira dado do próximo replanejamento.
        const nb = this._notebook();
        const d = nb.sync((contexto.self || {}).intentions);
        if (d && d.intervencao && !d.intervencao.sussurro_recebido) {
          d.intervencao.sussurro_recebido = texto;
          nb.salvar();
        }
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

    // C3 · o PLANO do turno (spec 076): só o passo ATO vai ao resolvedor; fala e gesto são o
    // que ele diz e expressa, e nunca chegam ao mundo.
    const c3 = await this._planC3({ ctx, instrucao: cena.texto, t, entrada: { instrucao: cena.texto } });

    const desfechos = [];
    const naoAconteceu = [];
    const subidasParaPlano = [];
    let atos = 0;
    for (const step of c3.steps) {
      if (step.type !== "ato") {
        if (t) t.passo(_stepRecord(step, step.type === "defeito" ? "defeito" : "narrado"));
        continue;
      }
      if (atos >= MAX_OBJETIVOS) {
        if (t) t.passo(_stepRecord(step, "nao_tentado"));
        continue;
      }
      atos += 1;
      const objetivo = H.objectives.actText(step);
      const r = _comoAto(await this._resolverEAgir({ objetivo, ctx, tools: c1.tools, idx: c1.idx, t,
                                                    sussurro: cena.texto }));
      if (t) t.passo(_stepRecord(step, _desfechoDoAto(r), r));
      if (r.out) desfechos.push(r.out);
      if (r.subiu) {
        const m = motivoEmMundo(r.subiu, objetivo, r);
        if (m) naoAconteceu.push({ o_que_falhou: `${objetivo}: ${m}` });
        if (r.subiu === "alvo_longe" || r.subiu === "alvo_desconhecido") subidasParaPlano.push(objetivo);
      }
    }

    // O QUE NÃO SE RESOLVE AQUI SOBE PARA O PLANO (contrato 01): o alvo está longe ou
    // ele não sabe onde está — isso é um DESEJO, e o harness o assume (C3P).
    if (subidasParaPlano.length) {
      const nb = this._notebook();
      if (!nb.ativo()) {
        await this._criarDesejo(subidasParaPlano[0], ctx, c1.idx, t);
      }
    }

    // O turno que mudou alguma coisa (spec 072, FR-032) — a sala lê para decidir se o
    // assento está girando à toa.
    this.ultimoTurnoAplicou = desfechos.some((d) => d && d.ok);
    return this._fecharTurno(desfechos, ctx, naoAconteceu, t);
  }

  // C3 · O PLANO DO TURNO (spec 076, PAGO, sem tools), para o sussurro e para o passo
  // abstrato de um desejo. A Mente devolve o contrato M; o registro guarda o plano inteiro e o
  // racional sobe à camada visível. Plano fora do contrato LANÇA (`PlanContractError`) e o
  // turno falha honesto em `_falhou`, sem fallback (Princípio VIII).
  async _planC3({ ctx, instrucao, t, entrada }) {
    const p3 = this._prompt("objetivos");
    this._emite("rotina_ativa", { rotina: "objetivos", titulo: this._tituloDaRotina("objetivos") });
    let c3, d3;
    try {
      [c3, d3] = await this._caixa(t, "C3", () => H.objectives.objectives({
        mente: this.mente, ctx, instrucao, system: p3.texto }),
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
    // SEM ALVO NENHUM citado e a tool pede referência: escolher no enum inteiro seria
    // a TROCA SILENCIOSA (pediram a caneca que não existe, beberia do cantil). Sobe.
    // Regra da montagem (`v1/montagem/rodar.py`: `not cit and t not in SEM_ALVO`).
    if (!alvos.length && Object.keys(H.tool.refsOf(tool)).length) {
      // a subida vai ao REGISTRO como caixa C7 (sem ela, o relatório não a veria)
      if (t) t.caixa("C7", { entrada: { objetivo, tool: c6.tool }, saida: { subiu: "alvo_desconhecido" } });
      this._bastidor("C7", { objetivo, tool: c6.tool, subiu: "alvo_desconhecido" });
      return { subiu: "alvo_desconhecido", tool: c6.tool };
    }

    // C7 · os parâmetros
    const p7 = this._prompt("c7_param");
    const [c7, d7] = await this._caixa(t, "C7", () => H.params.fillParams({
      texto: objetivo, tool, citados: c4.citados, ctx, decider: this._decider(), pergunta: p7.texto }),
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
        partes.push(typeof m === "string" ? m : JSON.stringify(m));
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

  // C3P · planeja o desejo e o GRAVA no world (create). → desejo do caderno, ou null
  async _criarDesejo(desejoTexto, ctx, idx, t) {
    const pp = this._prompt("planejar");
    this._emite("rotina_ativa", { rotina: "planejar", titulo: this._tituloDaRotina("planejar") });
    let pl, dp;
    try {
      const prosaCena = await this._prosaCena(ctx);
      [pl, dp] = await this._caixa(t, "C3P", () => H.plan.plan({
        mente: this.mente, ctx, idx, desejo: desejoTexto, system: pp.texto, prosaCena }),
      { prompt: pp, rotulo: label("C3P") });
    } finally {
      this._emite("rotina_ociosa", { stopReason: "end_turn" });
    }
    if (t) t.caixa("C3P", { ...dp, entrada: { desejo: desejoTexto },
                            saida: { passos: pl.passos, fim: pl.fim, problemas: pl.problemas,
                                     tentativas_de_plano: pl.tentativasDePlano } });
    if (!pl.passos.length) return null;
    const fim = H.ending.groundEnding(H.ending.extractEnding(pl.fim), desejoTexto, pl.passos);
    const content = H.desire.formatContent(desejoTexto, pl.passos, fim.texto);
    await this.mundo.criarIntencao(content);
    // o world é a verdade: relê e sincroniza o caderno com o id que nasceu lá
    const ctx2 = await this.mundo.contexto();
    const nb = this._notebook();
    const d = nb.sync((ctx2.self || {}).intentions);
    if (d) {
      nb.pay(d.id, _soma(dp.custo_pago));
      this._emitePlano(d);
    }
    return d;
  }

  _emitePlano(d) {
    if (!d) return;
    this._emite("plano", {
      desejo: d.desejo,
      entries: d.passos.map((p, i) => ({
        content: p,
        status: i < d.passo_atual ? "completed" : i === d.passo_atual ? "in_progress" : "pending" })),
    });
  }

  // O TICK AUTÔNOMO (contrato 01). O relógio é da SALA (spec 072); aqui só se JOGA o
  // turno quando mandam, e se diz se ele mudou alguma coisa.
  async talvezAgirSozinho() {
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
        // EM TRÂNSITO: a viagem leva ticks; o desejo ESPERA a chegada (research R6).
        if (self.transit) {
          const destino = self.transit.journey_to_name || self.transit.to_name || "";
          this._emite("harness", { box: "C8", texto: label("TRANSITO", { destino }) });
          if (t) t.descartar("transito");
          return;
        }
        const nb = this._notebook();
        const d = nb.sync(self.intentions);
        if (t) t.sussurro(null, "autonoma");
        const idx = sceneIndex(ctx);
        if (!d) {
          await this._tickSemDesejo(ctx, idx, t);
          return;
        }
        if (t) t.desejo(nb.foto(d.id));
        await this._tickDesejo(d, ctx, idx, t);
      } catch (e) {
        this._falhou(e, t);
      } finally {
        if (t) await t.fechar();
      }
    });
  }

  // Sem desejo: "o que eu quero agora?" (C3P · querer) e o plano. Nada age no mundo
  // neste tick — o próximo já anda.
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
    await this._criarDesejo(desejo, ctx, idx, t);
  }

  async _tickDesejo(d, ctx, idx, t) {
    const nb = this._notebook();
    const cfg = this._cfg();
    const h = cfg.harness || {};
    const mente0 = this.mente.custoDoTurno ? _soma(this.mente.custoDoTurno()) : 0;
    const pagar = () => {
      if (!this.mente.custoDoTurno) return;
      const agora = _soma(this.mente.custoDoTurno());
      nb.pay(d.id, agora - (pagar._ja || mente0));
      pagar._ja = agora;
    };

    // C8D · acabou? (regra; o losango do Jev só em sombra)
    const [fimOk, dfd] = await this._caixa(t, "C8D", async () => H.ending.isDone(d.fim, ctx),
      { rotulo: label("C8D") });
    if (t) t.caixa("C8D", { ...dfd, entrada: { fim: d.fim }, saida: { cumprido: fimOk } });
    if (fimOk === true) {
      await this.mundo.fecharIntencao(d.id, "concluida");
      nb.sync(((await this.mundo.contexto()).self || {}).intentions);
      this.ultimoTurnoAplicou = true;
      return this._fecharTurno([], ctx, [], t, [`o desejo de ${_minusc(d.desejo)} se cumpriu`]);
    }

    // BLOQUEIO com a janela de intervenção aberta: espera o jogador (0 token)
    if (d.bloqueio && d.intervencao && !d.intervencao.sussurro_recebido
        && (d.intervencao.ticks || 0) < (h.janelaIntervencaoTicks || 1)) {
      d.intervencao.ticks = (d.intervencao.ticks || 0) + 1;
      nb.salvar();
      if (t) t.descartar("intervencao");
      return;
    }
    if (d.bloqueio) {
      await this._replanejar(d, ctx, idx, t);
      pagar();
      return;
    }

    // O TETO DE CUSTO (FR-009b)
    if (H.progress.overBudget(d.tokens_pagos, cfg)) {
      return this._bloquear(d, "custo", t);
    }

    // DESEJO SEM PLANO (escrito à mão pelo dono no client, ou por outro conector): o
    // harness planeja antes de andar (C3P) e grava o plano no world.
    if (!d.passos.length) {
      await this._planejarDesejo(d, ctx, idx, t);
      pagar();
      return;
    }

    const passo = d.passos[d.passo_atual];
    if (!passo) {
      // O plano acabou. Fim conferível ainda falso → replaneja; sem fim conferível,
      // o fim é por vontade: o plano cumprido É o desejo cumprido.
      if (fimOk === false) {
        d.bloqueio = { motivo: "plano_acabou", passo: d.passo_atual, instante: new Date().toISOString() };
        nb.salvar();
        await this._replanejar(d, ctx, idx, t);
        pagar();
        return;
      }
      await this.mundo.fecharIntencao(d.id, "concluida");
      nb.sync(((await this.mundo.contexto()).self || {}).intentions);
      return this._fecharTurno([], ctx, [], t, [`ele deu por cumprido o que queria: ${_minusc(d.desejo)}`]);
    }
    this._emitePlano(d);

    // O PASSO É CONCRETO? (C4 = aqui no próprio passo) → resolvedor direto, 0 token pago.
    // Abstrato → o C3 concretiza (pago), com o passo como instrução.
    const concreto = H.target.cited(passo, idx).some((a) => a.onde === "aqui");
    let linhas = [passo];
    let plano = null;            // os passos do plano (spec 076), quando o C3 rodou
    const doPlano = new Map();   // texto do ato → passo do plano
    const resolvidos = new Map(); // passo do plano → o que o resolvedor devolveu
    const tools = await this._ferramentas();
    if (!concreto) {
      plano = await this._planC3({ ctx, instrucao: passo, t, entrada: { passo } });
      const atos = plano.steps.filter((s) => s.type === "ato").slice(0, MAX_ATOS_POR_PASSO);
      for (const s of atos) doPlano.set(H.objectives.actText(s), s);
      linhas = [...doPlano.keys()];
    }
    if (!d.step) d.step = H.progress.newStep(H.progress.stateSignature(ctx));

    const desfechos = [];
    const naoAconteceu = [];
    let veredito = null;
    let antes = ctx;
    for (const linha of linhas.slice(0, MAX_ATOS_POR_PASSO)) {
      const r = _comoAto(await this._resolverEAgir({ objetivo: linha, ctx: antes, tools, idx, t,
                                                     sussurro: null, noDesejo: d.id }));
      if (doPlano.has(linha)) resolvidos.set(doPlano.get(linha), r);
      if (!r.chamada) {
        const m = motivoEmMundo(r.subiu, linha, r);
        if (m) naoAconteceu.push({ o_que_falhou: `${linha}: ${m}` });
        veredito = H.progress.after(d.step, { tool: "(nada)", args: { passo: linha }, aceita: false,
          recusa: r.subiu, estadoDepois: null, saber: false, cfg });
        nb.attempt(d.id, { passo: d.passo_atual, tool: null, objetivo: linha, subiu: r.subiu, progresso: false });
        if (veredito.veredito === "blocked") break;
        continue;
      }
      const pre = H.progress.before(d.step, r.chamada.tool, r.chamada.args);
      desfechos.push(r.out);
      // C8 · andou?
      const [c8, d8] = await this._caixa(t, "C8", async () => {
        let depois = antes;
        try { depois = await this.mundo.contexto(); } catch (_) { /* segue com a foto velha */ }
        const saber = H.progress.newKnowledge(antes, depois);
        const estadoDepois = H.progress.stateSignature(depois);
        const v = pre ? { veredito: "blocked", motivo: pre.bloqueio }
          : H.progress.after(d.step, { tool: r.chamada.tool, args: r.chamada.args, aceita: r.out.ok,
              recusa: r.out.erro, estadoDepois, saber: saber.length > 0, cfg });
        let sombra = null;
        if ((h.losangosJev || "sombra") !== "desligado") {
          try {
            const mudou = diffTextual(antes, depois).concat(r.out.aconteceu || []).join(" ");
            sombra = await H.progress.shadow({ decider: this._decider(), pergunta: this._prompt("c8_passo").texto,
                                              passo, mudou: estadoDepois !== d.step.vistos[0] ? mudou : "" });
            if (d.fim && d.fim.familia === "nenhuma") {
              const s2 = await H.ending.shadow({ decider: this._decider(), pergunta: this._prompt("c8d_fim").texto,
                                                desejo: d.desejo, fim: d.fim, memoriasNovas: saber });
              if (s2) sombra = [sombra, s2].filter(Boolean);
            }
          } catch (e) { log("LOSANGO EM SOMBRA FALHOU (sem efeito)", e.message); }
        }
        antes = depois;
        return { v, saber, estadoDepois, sombra };
      }, { rotulo: label("C8") });
      if (t) t.caixa("C8", { ...d8, entrada: { passo, tool: r.chamada.tool },
                             saida: { veredito: c8.v.veredito, motivo: c8.v.motivo || null,
                                      saber_novo: c8.saber.length }, sombra: c8.sombra });
      if (c8.sombra) { d.sombra = (d.sombra || []).concat([].concat(c8.sombra)).slice(-40); }
      nb.attempt(d.id, { passo: d.passo_atual, tool: r.chamada.tool, args: _semProsa(r.chamada.args),
                         aceita: r.out.ok, motivo: r.out.erro, progresso: c8.v.veredito === "progresso" });
      veredito = c8.v;
      if (veredito.veredito !== "sem_progresso") break;
    }
    // os passos do plano, na ORDEM, com o desfecho de cada um (spec 076)
    if (t && plano) {
      for (const s of plano.steps) {
        if (s.type !== "ato") t.passo(_stepRecord(s, s.type === "defeito" ? "defeito" : "narrado"));
        else if (resolvidos.has(s)) t.passo(_stepRecord(s, _desfechoDoAto(resolvidos.get(s)), resolvidos.get(s)));
        else t.passo(_stepRecord(s, "nao_tentado"));
      }
    }
    this.ultimoTurnoAplicou = desfechos.some((x) => x && x.ok);

    if (veredito && veredito.veredito === "progresso") {
      d.passo_atual += 1;
      d.step = null;
      nb.salvar();
      this._emitePlano(d);
    } else if (veredito && veredito.veredito === "blocked") {
      nb.salvar();
      await this._bloquear(d, veredito.motivo, t, true);
    } else {
      nb.salvar();
    }
    pagar();
    return this._fecharTurno(desfechos, ctx, naoAconteceu, t);
  }

  async _planejarDesejo(d, ctx, idx, t) {
    const nb = this._notebook();
    const pp = this._prompt("planejar");
    this._emite("rotina_ativa", { rotina: "planejar", titulo: this._tituloDaRotina("planejar") });
    let pl, dp;
    try {
      const prosaCena = await this._prosaCena(ctx);
      [pl, dp] = await this._caixa(t, "C3P", () => H.plan.plan({
        mente: this.mente, ctx, idx, desejo: d.desejo, system: pp.texto, prosaCena }),
      { prompt: pp, rotulo: label("C3P") });
    } finally {
      this._emite("rotina_ociosa", { stopReason: "end_turn" });
    }
    if (t) t.caixa("C3P", { ...dp, entrada: { desejo: d.desejo, sem_plano: true },
                            saida: { passos: pl.passos, fim: pl.fim, problemas: pl.problemas } });
    if (!pl.passos.length) return;
    // o fim já declarado (o `pronto_quando` legado, ou o "Pronto quando" escrito à mão)
    // vale mais que o que o C3P sugeriu agora
    const fim = d.fim && d.fim.familia !== "nenhuma" ? d.fim
      : H.ending.groundEnding(H.ending.extractEnding(pl.fim), d.desejo, pl.passos);
    const content = H.desire.formatContent(d.desejo, pl.passos, fim.texto);
    await this.mundo.atualizarIntencao(d.id, content);
    nb.replan(d.id, pl.passos, fim, content);
    this._emitePlano(nb.get(d.id));
  }

  // BLOCKED sobe ao front como PONTO DE INTERVENÇÃO (FR-009c) e abre a janela.
  async _bloquear(d, motivo, t, semNarrar) {
    const nb = this._notebook();
    d.bloqueio = { motivo, passo: d.passo_atual, instante: new Date().toISOString() };
    d.intervencao = { ticks: 0, sussurro_recebido: null };
    nb.salvar();
    const passo = d.passos[d.passo_atual] || d.desejo;
    const texto = motivo === "custo"
      ? `Isto está custando esforço demais sem render: ${_minusc(d.desejo)}. Ele vai repensar.`
      : `Ele desiste de ${_minusc(passo)} desse jeito — vai tentar outro caminho.`;
    this._emite("bloqueio", { texto, motivo, desejo: d.desejo });
    if (t) t.caixa("C8", { saida: { veredito: "blocked", motivo, intervencao: true } });
    if (!semNarrar) this._emite("sistema", { texto });
  }

  // C3R · replaneja com as tentativas do passo como dado; ou desiste do desejo.
  async _replanejar(d, ctx, idx, t) {
    const nb = this._notebook();
    const pp = this._prompt("planejar");
    const tentativas = d.tentativas.filter((x) => x.passo === d.bloqueio.passo)
      .slice(-6).map((x) => (x.tool
        ? `${x.tool} ${Object.values(x.args || {}).join(", ")} → "${x.aceita ? "aceito, sem mudar nada" : (x.motivo || "recusado")}"`
        : `"${x.objetivo}" → nenhuma ação possível daqui`));
    if (d.intervencao && d.intervencao.sussurro_recebido) {
      tentativas.push(`o jogador sugeriu: "${d.intervencao.sussurro_recebido}"`);
    }
    if (d.bloqueio.motivo === "custo") tentativas.push("isto já custou esforço demais sem render");
    this._emite("rotina_ativa", { rotina: "planejar", titulo: this._tituloDaRotina("planejar") });
    let pl, dp;
    try {
      const prosaCena = await this._prosaCena(ctx);
      [pl, dp] = await this._caixa(t, "C3R", () => H.plan.plan({
        mente: this.mente, ctx, idx, desejo: d.desejo, tentativas, system: pp.texto, prosaCena }),
      { prompt: pp, rotulo: label("C3R") });
    } finally {
      this._emite("rotina_ociosa", { stopReason: "end_turn" });
    }
    if (t) t.caixa("C3R", { ...dp, entrada: { desejo: d.desejo, bloqueio: d.bloqueio, tentativas },
                            saida: { passos: pl.passos, fim: pl.fim, problemas: pl.problemas } });
    // DESISTIR é decisão do personagem, e a desistência vira memória (spec 073, FR-015):
    // plano vazio, ou o teto de custo estourado de novo depois de um replanejamento.
    const desiste = !pl.passos.length
      || (d.bloqueio.motivo === "custo" && d.replanejamentos_por_custo >= 1);
    if (desiste) {
      await this.mundo.fecharIntencao(d.id, "abandonada", { lembrar: true });
      nb.sync(((await this.mundo.contexto()).self || {}).intentions);
      this._emite("sistema", { texto: `Ele larga o que queria: ${_minusc(d.desejo)}.` });
      return;
    }
    const porCusto = d.bloqueio.motivo === "custo";
    if (porCusto) d.replanejamentos_por_custo = (d.replanejamentos_por_custo || 0) + 1;
    const fim = d.fim && d.fim.familia !== "nenhuma" && d.fim.fonte === "pronto_quando" ? d.fim
      : H.ending.groundEnding(H.ending.extractEnding(pl.fim), d.desejo, pl.passos);
    const content = H.desire.formatContent(d.desejo, pl.passos, fim.texto);
    await this.mundo.atualizarIntencao(d.id, content);
    nb.replan(d.id, pl.passos, fim, content);
    // o teto é por PLANO: um plano novo, depois de estourar, recomeça a conta (e se
    // estourar de novo, ele desiste — acima)
    if (porCusto) nb.get(d.id).tokens_pagos = 0;
    nb.salvar();
    this._emitePlano(nb.get(d.id));
  }
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
