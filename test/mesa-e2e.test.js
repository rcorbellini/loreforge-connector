// A MESA DE PONTA A PONTA — sem um dublê sequer do lado do conector (spec 072).
//
// POR QUE ESTE ARQUIVO EXISTE. Todos os outros testes da 072 usam laço falso: eles
// provam o roster, a ordem da fila e a estanqueidade das faixas, e nenhum deles executa
// um TURNO. A lição registrada é exatamente essa (`[[fechar-grep-e-subir-processo-real]]`,
// `[[medir-com-a-mente-real-nao-so-suite]]`): suíte verde não é evidência de que o
// processo faz o que promete.
//
// Aqui sobem um MUNDO falso e um OLLAMA falso — os dois lados de FORA —, e o conector
// inteiro é o de produção: `Sala`, `Fila`, `Laco`, `Mente`, `Mundo`, `registro`.
//
// O que só este teste alcança:
//
//  · a FÁBRICA DE ASSENTO montando `Mundo` + `Mente` + `Laco` por personagem;
//  · **cada chamada ao mundo saindo com o JWT do PRÓPRIO dono** — o invariante da
//    FR-004, e o defeito que faria o server responder 403 em todo turno de convidado;
//  · a linha de registro carregando `sala` e `membro`;
//  · as duas faixas carimbadas num turno de verdade, não num evento fabricado;
//  · um turno por vez, medido pelos `estado` que o laço emite.

"use strict";

const test = require("node:test");
const assert = require("node:assert");
const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");

const SP = fs.mkdtempSync(path.join(os.tmpdir(), "mesa-e2e-"));

// ---------------------------------------------------------------- mundo falso
const registros = [];
const chamadas = [];
const TOOLS = [{
  name: "take",
  description: "Pegar alguma coisa que esteja ao alcance.",
  inputSchema: { type: "object",
    properties: { alvo: { type: "string", enum: ["corda-velha"] },
                  prosa: { type: "object", properties: { acao: { type: "string" } } } },
    required: ["alvo"] },
}];
const CTX = (id) => ({
  self: { id, name: id === "elga" ? "Elga" : "Draven", prose: "Alguém.",
          needs: {}, inventory: [], memories: [], intentions: [], known_elsewhere: [] },
  scene: { place: { id: "taverna", name: "Taverna" },
           characters: [{ id, name: id === "elga" ? "Elga" : "Draven", state: "self" }],
           items: [{ id: "corda-velha", name: "Corda Velha" }],
           objects: [], exits: [] },
  capacidades: [{ nome: "take", descricao: "Pegar.", alvos: { alvo: ["corda-velha"] },
                  exige: ["alvo"] }],
});

const mundo = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => { corpo += c; });
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const j = (o) => { res.writeHead(200, { "Content-Type": "application/json" });
                       res.end(JSON.stringify(o)); };
    if (u.pathname === "/api/auth/config") return j({});
    if (u.pathname === "/api/characters") return j([{ id: "elga" }, { id: "draven" }]);
    if (u.pathname === "/api/context") return j(CTX(u.searchParams.get("character_id")));
    if (u.pathname === "/api/registro") { registros.push(JSON.parse(corpo)); return j({ ok: true }); }
    if (u.pathname === "/api/mcp") {
      const m = JSON.parse(corpo);
      chamadas.push({ metodo: m.method, quem: u.searchParams.get("character_id"),
                      turno: u.searchParams.get("turno_id"),
                      auth: req.headers.authorization || null, params: m.params });
      if (m.method === "tools/list") return j({ jsonrpc: "2.0", id: m.id,
                                                result: { tools: TOOLS } });
      if (m.method === "tools/call") {
        return j({ jsonrpc: "2.0", id: m.id, result: {
          content: [{ type: "text", text: "Você pega a corda." }],
          _narrativa: { aconteceu: ["Alguém pegou a Corda Velha."],
                        narrative_hint: "a corda agora está na mão" } } });
      }
      return j({ jsonrpc: "2.0", id: m.id, result: {} });
    }
    res.writeHead(404); res.end("{}");
  });
});

// --------------------------------------------------------------- ollama falso
let rodada = 0;
const ollama = http.createServer((req, res) => {
  let corpo = "";
  req.on("data", (c) => { corpo += c; });
  req.on("end", () => {
    const u = new URL(req.url, "http://x");
    const j = (o) => { res.writeHead(200, { "Content-Type": "application/json" });
                       res.end(JSON.stringify(o)); };
    if (u.pathname === "/api/tags") return j({ models: [{ name: "llama3.1:8b" }] });
    if (u.pathname === "/api/chat") {
      const body = JSON.parse(corpo);
      // com `tools` é a chamada de ESCOLHA; sem, é a narração
      if (body.tools && body.tools.length) {
        rodada++;
        // primeira rodada propõe; as seguintes encerram (senão o laço continua)
        if (rodada % 2 === 1) {
          return j({ message: { content: "",
            tool_calls: [{ function: { name: "take",
              arguments: { alvo: "Corda Velha", prosa: { acao: "estica a mão" } } } }] },
            prompt_eval_count: 100, eval_count: 20 });
        }
        return j({ message: { content: "" }, prompt_eval_count: 50, eval_count: 5 });
      }
      return j({ message: { content: "Você fecha a mão na corda áspera." },
                 prompt_eval_count: 80, eval_count: 12 });
    }
    res.writeHead(404); res.end("{}");
  });
});

// ------------------------------------------------------------------- o teste
test("072: dois turnos REAIS pela fila, cada um com o JWT do seu dono", async () => {
  await new Promise((r) => mundo.listen(0, "127.0.0.1", r));
  await new Promise((r) => ollama.listen(0, "127.0.0.1", r));
  const pMundo = mundo.address().port, pOllama = ollama.address().port;

  const cfgPath = path.join(SP, "e2e.json");
  fs.writeFileSync(cfgPath, JSON.stringify({
    mundo: `http://127.0.0.1:${pMundo}`, canal: 0, runtime: "local",
    endpoint: `http://127.0.0.1:${pOllama}`, model: "llama3.1:8b" }), "utf8");
  process.env.LOREFORGE_CONFIG = cfgPath;
  process.env.LOREFORGE_LOG = "0";

  const configuracao = require("../config");
  const Mente = require("../mente");
  const { Mundo } = require("../mundo");
  const { Laco } = require("../laco");
  const { Sala } = require("../sala");
  const { Fila } = require("../fila");
  const extensoes = require("../extensoes");
  const registro = require("../registro");

  const cfg = configuracao.carregar(true);
  const ext = extensoes.criar(path.join(__dirname, "..", "extensoes"));
  const eventos = [];
  const emitir = (ev, d) => eventos.push({ ev, ...d });

  const sala = Sala.deConfig(null, {
    credenciais: configuracao.credenciais(cfg),
    fabricas: {
      assento: async ({ personagem, dono, jwt }) => {
        const meuMundo = new Mundo(cfg.mundo, personagem);
        meuMundo.jwt = jwt || null;
        const minhaMente = Mente.criarMente({ mundo: meuMundo, extensoes: ext });
        const reg = registro.criar({ mundo: meuMundo, cfg: { ...cfg, personagem },
                                     extensoes: ext, mente: minhaMente,
                                     sala: sala.nome, membro: dono });
        return { mundo: meuMundo, mente: minhaMente, nome: personagem,
                 laco: new Laco({ mundo: meuMundo, mente: minhaMente, extensoes: ext,
                                  registro: reg, emitir }) };
      },
    },
    emitir: (ev, d) => emitir(ev, { ...d, escopo: (d && d.escopo) || "mesa" }),
  });
  sala.acrescentarMembro({ sub: "sub-A", nome: "A", jwt: "jwt-de-A" });
  sala.acrescentarMembro({ sub: "sub-B", nome: "B", jwt: "jwt-de-B" });
  await sala.assentar({ personagem: "elga", sub: "sub-A" });
  await sala.assentar({ personagem: "draven", sub: "sub-B" });

  const fila = new Fila({ sala, emitir });
  fila.enfileirar({ personagem: "elga", classe: "manual", texto: "pegue a corda",
                    quem: "sub-A" });
  fila.enfileirar({ personagem: "draven", classe: "manual", texto: "pegue a corda",
                    quem: "sub-B" });

  await new Promise((r) => setTimeout(r, 4000));
  fila.parar();
  await new Promise((r) => mundo.close(r));
  await new Promise((r) => ollama.close(r));

  // ------------------------------------------------------------- o veredito

  const calls = chamadas.filter((c) => c.metodo === "tools/call");
  assert.ok(calls.length >= 2, `turnos que chegaram ao mundo: ${calls.length}`);

  // O INVARIANTE DA FR-004. Mandar o token do anfitrião por conta de personagem alheio
  // é o defeito mais fácil de introduzir aqui e o mais caro: 403 em todo turno de
  // convidado, silencioso deste lado.
  const porQuem = Object.fromEntries(calls.map((c) => [c.quem, c.auth]));
  assert.strictEqual(porQuem.elga, "Bearer jwt-de-A");
  assert.strictEqual(porQuem.draven, "Bearer jwt-de-B");

  assert.ok(registros.length >= 2, `linhas de registro: ${registros.length}`);
  assert.strictEqual(registros[0].sala, "Sala");
  assert.ok(registros[0].membro, "registro sem membro");
  assert.ok(registros[0].custo.chamadas > 0, "registro sem custo");
  const membros = registros.map((r) => r.membro);
  assert.ok(membros.includes("sub-A") && membros.includes("sub-B"),
            `membros nos registros: ${membros.join(", ")}`);

  const semEscopo = eventos.filter((e) => !e.escopo);
  assert.deepStrictEqual(semEscopo.map((e) => e.ev), [],
                         "evento sem escopo num turno real");

  const beats = eventos.filter((e) => e.ev === "beat");
  assert.ok(beats.length >= 2, `beats: ${beats.length}`);
  assert.ok(beats.every((b) => b.escopo === "mesa"), "beat que não é de mesa");

  const narr = eventos.filter((e) => e.ev === "narracao_fim");
  assert.ok(narr.length >= 2, `narrações: ${narr.length}`);
  assert.ok(narr.every((n) => n.escopo === "dono"), "narração vazou para a mesa");
  assert.ok(narr.every((n) => !!n.personagem), "narração sem dono carimbado");

  // UM TURNO POR VEZ, medido pelos `estado` que o laço emite: eles têm de se alternar,
  // nunca empilhar.
  let abertos = 0, maxAbertos = 0;
  for (const e of eventos.filter((x) => x.ev === "estado")) {
    abertos += e.ocupado ? 1 : -1;
    maxAbertos = Math.max(maxAbertos, abertos);
  }
  assert.strictEqual(maxAbertos, 1, `dois turnos correram juntos (máx ${maxAbertos})`);

  // A FATURA É POR JOGADOR, e é a razão de a `Mente` ter deixado de ser singleton.
  assert.ok(sala.assentoDe("elga").custo.chamadas > 0);
  assert.ok(sala.assentoDe("draven").custo.chamadas > 0);
});
