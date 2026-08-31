// O CANAL — por onde a tela vê o que o conector fez.
//
// Assimétrico de propósito: um sussurro ocasional sobe, muitos tokens descem. É
// a forma para a qual SSE existe, e por isso não há socket bidirecional aqui.
//
// AQUI MORA A ÚNICA PERNA DE NAVEGADOR QUE SOBROU. Antes da cisão, a página
// buscava o modelo do jogador direto e apanhava: medido contra o Ollama em uso,
// `Origin` do túnel devolvia 403, e sem `Origin` — cliente que não é navegador —
// 200. Restrição de origem é imposta pelo NAVEGADOR, e o conector é um processo:
// aquela perna deixou de existir. Sobrou esta, e ela é tratável porque OS DOIS
// LADOS SÃO NOSSOS — o conector manda os cabeçalhos que um modelo de terceiro
// nunca poderia mandar.
//
// O que ainda não está medido, e precisa de navegador real: o preflight de rede
// privada / prompt de permissão de rede local dos navegadores recentes. Os
// cabeçalhos abaixo respondem ao que dá para responder do lado do servidor.

"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { log } = require("./log");
const pareamento = require("./pareamento");

function servir({ porta, laco, cfg, expor, painel,
                  permitirConfigRemota, mundo, configuracao, authAtivo,
                  onPareado }) {
  const ouvintes = new Set();
  // Codigo de pareamento em aberto (spec 056, US4) — vive so na MEMORIA deste
  // processo, igual a trava de turno: reiniciou, o codigo morreu junto, e o
  // jogador gera outro. Nunca e persistido porque e de uso unico.
  let pareamentoPendente = null;   // { codigo, expiraEm }

  function gerarCodigoPareamento() {
    pareamentoPendente = { codigo: pareamento.gerarCodigo(),
                            expiraEm: Date.now() + pareamento.VALIDADE_MS };
    return pareamentoPendente;
  }

  // A GUARDA DE IDENTIDADE (spec 056, FR-021/022). Duas perguntas, nesta
  // ordem: o JWT e autentico (pergunta ao server — o conector nunca guarda o
  // `auth.secret` pra conferir sozinho, e por isso NUNCA pode assinar um em
  // nome de outro jogador), e o `sub` dele bate com o dono deste conector (o
  // pareamento). A primeira sem a segunda deixaria QUALQUER jogador do MESMO
  // server usar este conector; a segunda sem a primeira aceitaria qualquer
  // string que alegasse o `sub` certo.
  async function autorizarJogador(req, url) {
    if (!authAtivo) return { ok: true };   // mundo sem auth.secret: modo legado
    if (!cfg.jwt || !cfg.authSub) {
      return { ok: false, status: 401,
               erro: "conector não pareado — rode `loreforge --parear`" };
    }
    const cabecalho = req.headers.authorization || "";
    const token = /^Bearer\s+/i.test(cabecalho)
      ? cabecalho.replace(/^Bearer\s+/i, "")
      : (url.searchParams.get("token") || "");
    if (!token) return { ok: false, status: 401, erro: "autenticação necessária" };
    const quem = await mundo.validarToken(token);
    if (!quem) return { ok: false, status: 401, erro: "token inválido" };
    if (quem.sub !== cfg.authSub) {
      return { ok: false, status: 403, erro: "este conector pertence a outro jogador" };
    }
    return { ok: true, quem };
  }

  // ESCREVER SÓ DA PRÓPRIA MÁQUINA. Com `--expor` ligado, qualquer aparelho da
  // rede alcança este processo — e configurar a Mente inclui trocar o modelo e
  // gravar prompts. LER de fora é o que faz conferir do celular funcionar;
  // ESCREVER, não.
  //
  // "PRÓPRIA MÁQUINA" NÃO É "127.0.0.1". A primeira versão disto comparava com o
  // endereço de loopback e pronto — e trancava o dono para fora do próprio
  // conector assim que ele abrisse o painel pelo IP da rede (o que é natural: é
  // o endereço que ele já usa para a tela). O pedido chega com o IP da LAN mesmo
  // vindo de casa. Agora vale QUALQUER endereço desta máquina.
  const MEUS = new Set(["127.0.0.1", "::1"]);
  for (const ifaces of Object.values(os.networkInterfaces() || {})) {
    for (const i of ifaces || []) MEUS.add(i.address);
  }
  function daPropriaMaquina(req) {
    if (permitirConfigRemota) return true;
    const ip = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    return MEUS.has(ip);
  }

  function corpoDe(req) {
    return new Promise((resolve) => {
      let bruto = "";
      req.on("data", (c) => { bruto += c; });
      req.on("end", () => {
        try { resolve(JSON.parse(bruto || "{}")); } catch (_) { resolve({}); }
      });
    });
  }

  function cabecalhos(res, origem) {
    res.setHeader("Access-Control-Allow-Origin", origem || "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    // "Authorization" entrou com o JWT do jogador (spec 056) — sem ele aqui, o
    // preflight do navegador barra a requisição ANTES dela sair, e o `fetch`
    // falha silencioso ("Failed to fetch") sem nenhum log deste lado pra caçar.
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    // a resposta ao preflight de rede privada: a página vem de origem pública e
    // quer alcançar um endereço local. Sem isto, nem chega a tentar.
    res.setHeader("Access-Control-Allow-Private-Network", "true");
  }

  function emitir(evento, dados) {
    const bloco = `event: ${evento}\ndata: ${JSON.stringify(dados || {})}\n\n`;
    for (const res of ouvintes) {
      try {
        res.write(bloco);
      } catch (_) {
        ouvintes.delete(res);   // tela fechada no meio: não é erro, é a vida
      }
    }
  }

  const servidor = http.createServer(async (req, res) => {
    const origem = req.headers.origin;
    cabecalhos(res, origem);
    const url = new URL(req.url, "http://localhost");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    // O que a tela precisa saber para se orientar: quem está sendo jogado, contra
    // que mundo, e se há turno em andamento.
    if (req.method === "GET" && url.pathname === "/estado") {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        ok: true, personagem: cfg.personagem, mundo: cfg.mundo,
        ocupado: laco.ocupado, turnos: laco.numeroTurno,
      }));
    }

    if (req.method === "GET" && url.pathname === "/eventos") {
      const veredito = await autorizarJogador(req, url);
      if (!veredito.ok) {
        res.writeHead(veredito.status, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ erro: veredito.erro }));
      }
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write(`event: estado\ndata: ${JSON.stringify(
        { ocupado: laco.ocupado, personagem: cfg.personagem })}\n\n`);
      ouvintes.add(res);
      req.on("close", () => ouvintes.delete(res));
      return;
    }

    // O PAREAMENTO (spec 056, US4) — codigo gerado por ESTE processo
    // (terminal ou painel, sempre da propria maquina) e resgatado aqui pelo
    // client, que traz o codigo de volta junto com o JWT do jogador.
    if (req.method === "POST" && url.pathname === "/api/parear/gerar") {
      if (!daPropriaMaquina(req)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ erro:
          "gerar código só da máquina onde o conector roda" }));
      }
      const { codigo, expiraEm } = gerarCodigoPareamento();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({
        codigo, expiraEmSegundos: Math.round((expiraEm - Date.now()) / 1000) }));
    }

    if (req.method === "POST" && url.pathname === "/parear") {
      const corpo = await corpoDe(req);
      if (!pareamentoPendente) {
        res.writeHead(404, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          erro: "nenhum pareamento em aberto — gere um código no conector antes" }));
      }
      if (Date.now() > pareamentoPendente.expiraEm) {
        pareamentoPendente = null;
        res.writeHead(410, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ erro: "código expirado" }));
      }
      if (String(corpo.codigo || "").toUpperCase() !== pareamentoPendente.codigo) {
        res.writeHead(403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ erro: "código não confere" }));
      }
      const quem = await mundo.validarToken(corpo.jwt);
      if (!quem) {
        res.writeHead(401, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({
          erro: "token inválido — faça login de novo no client" }));
      }
      cfg.jwt = corpo.jwt;
      cfg.authSub = quem.sub;
      cfg.authEmail = quem.email;
      cfg.authName = quem.name;
      configuracao.gravar(cfg);
      mundo.jwt = cfg.jwt;
      pareamentoPendente = null;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true, email: quem.email }));
      if (onPareado) onPareado(quem);
      return;
    }

    if (req.method === "POST" && url.pathname === "/sussurro") {
      const veredito = await autorizarJogador(req, url);
      if (!veredito.ok) {
        res.writeHead(veredito.status, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ erro: veredito.erro }));
      }
      let corpo = "";
      req.on("data", (c) => { corpo += c; });
      req.on("end", () => {
        let texto = "";
        try { texto = (JSON.parse(corpo || "{}").texto || "").trim(); } catch (_) {}
        if (!texto) {
          res.writeHead(400, { "Content-Type": "application/json" });
          return res.end(JSON.stringify({ erro: "informe 'texto'" }));
        }
        // Responde JÁ: o turno corre e se conta pelo canal de eventos, não pela
        // resposta desta chamada — que ficaria pendurada por dezenas de segundos.
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ aceito: true }));
        laco.sussurrar(texto, "manual").catch((e) =>
          log("SUSSURRO FALHOU", e.message));
      });
      return;
    }

    // Observar: a tela leu o pacote do mundo e nao tem com que narra-lo.
    if (req.method === "POST" && url.pathname === "/observar") {
      const veredito = await autorizarJogador(req, url);
      if (!veredito.ok) {
        res.writeHead(veredito.status, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ erro: veredito.erro }));
      }
      let corpo = "";
      req.on("data", (c) => { corpo += c; });
      req.on("end", () => {
        let obs = null;
        try { obs = JSON.parse(corpo || "{}").observacao; } catch (_) {}
        res.writeHead(202, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ aceito: !!obs }));
        if (obs) laco.observar(obs).catch((e) => log("OBSERVAR FALHOU", e.message));
      });
      return;
    }

    // A AUTONOMIA continua sendo do conector — a tela só pede pausa/retomada.
    // O relógio mora aqui porque quem age é a Mente: se ele vivesse na aba, o
    // personagem voltaria a depender de alguém estar olhando, que é exatamente o
    // que esta cisão desfaz.
    if (req.method === "POST" && url.pathname === "/autonomia") {
      let corpo = "";
      req.on("data", (c) => { corpo += c; });
      req.on("end", () => {
        let pausado = null;
        try { pausado = JSON.parse(corpo || "{}").pausado; } catch (_) {}
        if (typeof pausado === "boolean" && laco.autonomia) {
          laco.autonomia.pausar(pausado);
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ pausado: laco.autonomia
                                 ? laco.autonomia.pausado : true }));
      });
      return;
    }

    // ------------------------------------------------------------------- //
    // O PAINEL — a configuração da Mente, servida pelo próprio conector.
    //
    // Ela mora AQUI, e não na tela do jogo, porque tudo o que se ajusta é estado
    // deste processo. Se morasse lá, a tela teria de intermediar cada ajuste — e
    // voltaria a saber de coisas que a cisão tirou dela. E há a coerência que
    // justifica o conector existir: o que configura a SUA Mente vem do programa
    // que você baixou e leu, não do site de outra pessoa.
    // ------------------------------------------------------------------- //

    if (req.method === "GET" && (url.pathname === "/" ||
                                 url.pathname === "/index.html")) {
      const pagina = path.join(__dirname, "painel.html");
      return fs.readFile(pagina, (erro, dados) => {
        if (erro) {
          res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
          return res.end("painel.html não encontrado");
        }
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8",
                             "Cache-Control": "no-cache" });
        res.end(dados);
      });
    }

    if (req.method === "GET" && url.pathname === "/api/config") {
      const dados = await painel.ler();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify({ ...dados, podeEscrever: daPropriaMaquina(req) }));
    }

    if (req.method === "POST" && url.pathname === "/api/config") {
      if (!daPropriaMaquina(req)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ erro:
          "configurar só da máquina onde o conector roda. Abra o painel lá, ou suba o conector com --config-remota se quiser configurar de fora." }));
      }
      const corpo = await corpoDe(req);
      const saida = await painel.salvar(corpo);
      res.writeHead(saida.erro ? 400 : 200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(saida));
    }

    // REINICIAR O CONECTOR. Mesma guarda do `/api/config`, e pelo mesmo motivo: é
    // controle do processo, não jogada. Quem alcança esta rota derruba e sobe o
    // processo que guarda a credencial do jogador — então vale a regra mais estrita
    // que já existe aqui, sem exceção para "é só um reinício".
    if (req.method === "POST" && url.pathname === "/api/reiniciar") {
      if (!daPropriaMaquina(req)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ erro:
          "reiniciar só da máquina onde o conector roda. Abra o painel lá, ou suba o conector com --config-remota." }));
      }
      const saida = await painel.reiniciar();
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(saida));
    }

    if (req.method === "POST" && url.pathname === "/api/prompt") {
      if (!daPropriaMaquina(req)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ erro: "editar prompt só da máquina onde o conector roda (ou suba com --config-remota)" }));
      }
      const corpo = await corpoDe(req);
      const saida = painel.gravarPrompt(corpo.nome, corpo.texto);
      res.writeHead(saida.erro ? 400 : 200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(saida));
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ erro: "rota não encontrada" }));
  });

  return new Promise((resolve) => {
    // 127.0.0.1 POR PADRÃO, e não 0.0.0.0: este processo guarda a credencial do
    // jogador e não tem por que estar visível na rede dele.
    //
    // `expor` abre para a rede local, e é preciso para o caso REAL de jogar a
    // tela de outro aparelho — o endereço local do navegador é o do aparelho
    // dele, não o desta máquina. Isso é topologia, não configuração: nenhum
    // cabeçalho conserta. Quem liga aceita o preço, que está escrito no aviso.
    const iface = expor ? "0.0.0.0" : "127.0.0.1";
    servidor.listen(porta, iface, () => resolve({
      servidor, emitir, ouvintes, gerarCodigoPareamento,
      // FECHAR DE VERDADE. `servidor.close()` sozinho só para de ACEITAR conexão
      // nova e espera as abertas drenarem — e a tela mantém um `text/event-stream`
      // aberto de propósito, que nunca drena. Um `await fechar()` ficaria pendurado
      // para sempre, e quem esperava a porta livre (o reinício, que precisa dela
      // para o processo novo escutar) nunca seria atendido. Então: despede-se dos
      // ouvintes, derruba o que sobrou, e só aí fecha.
      fechar: () => new Promise((r) => {
        for (const res of ouvintes) {
          try { res.end(); } catch (_) {}
        }
        ouvintes.clear();
        if (typeof servidor.closeAllConnections === "function") {
          servidor.closeAllConnections();
        }
        servidor.close(r);
      }),
    }));
  });
}

module.exports = { servir };
