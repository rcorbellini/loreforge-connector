// O CANAL — por onde as telas da SALA veem o que o conector fez (spec 044, 072).
//
// Assimétrico de propósito: um sussurro ocasional sobe, muitos tokens descem. É a forma
// para a qual SSE existe, e por isso não há socket bidirecional aqui.
//
// AQUI MORA A ÚNICA PERNA DE NAVEGADOR QUE SOBROU. Antes da cisão, a página buscava o
// modelo do jogador direto e apanhava: medido contra o Ollama em uso, `Origin` do túnel
// devolvia 403, e sem `Origin` — cliente que não é navegador — 200. Restrição de origem é
// imposta pelo NAVEGADOR, e o conector é um processo: aquela perna deixou de existir.
// Sobrou esta, e ela é tratável porque OS DOIS LADOS SÃO NOSSOS.
//
// O QUE A SPEC 072 MUDOU AQUI, e é a mudança de identidade do arquivo inteiro:
//
//   antes: "este conector pertence a UM jogador" (a guarda de `cfg.authSub`)
//   agora: "este conector é uma SALA" — N membros, N assentos, uma fila
//
// Três guardas, e elas não se misturam (contracts/conector-http.md):
//   G-MEMBRO   o JWT que chegou é de um membro ATIVO desta sala?
//   G-POSSE    este personagem é do membro que chamou?
//   G-MAQUINA  o pedido vem da máquina onde o conector roda?  (inalterada)

"use strict";

const http = require("http");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { log } = require("./log");
const pareamento = require("./pareamento");

function servir({ porta, sala, fila, cfg, expor, painel,
                  permitirConfigRemota, mundo, configuracao, authAtivo,
                  onPareado }) {
  // CADA OUVINTE CARREGA DE QUEM ELE É (spec 072). Era um `Set` de `res`; virou um `Set`
  // de `{res, sub}`, com o `sub` colhido no `/eventos` — que JÁ autentica. Nenhuma
  // autenticação nova nasce aqui: o que nasce é a memória de quem está do outro lado.
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

  // --- as três guardas ----------------------------------------------------- //

  // G-MEMBRO. Duas perguntas, nesta ordem: o JWT é autêntico (pergunta ao server — o
  // conector nunca guarda o `auth.secret` pra conferir sozinho, e por isso NUNCA pode
  // assinar um em nome de outro jogador), e quem ele diz ser é MEMBRO ATIVO desta sala.
  //
  // A segunda pergunta é a que mudou. Antes era `quem.sub !== cfg.authSub` — "o dono do
  // processo" —, e o comentário de então explicava por quê: sem ela, qualquer jogador do
  // mesmo server usaria este conector. A guarda não sumiu; ela passou a consultar o
  // roster em vez de um campo único.
  async function gMembro(req, url) {
    if (!authAtivo) {
      // modo legado (mundo sem `auth.secret`): sala de um membro só, sem pareamento.
      return { ok: true, sub: sala.anfitriao || "local" };
    }
    const cabecalho = req.headers.authorization || "";
    const token = /^Bearer\s+/i.test(cabecalho)
      ? cabecalho.replace(/^Bearer\s+/i, "")
      : (url.searchParams.get("token") || "");
    if (!token) return { ok: false, status: 401, erro: "autenticação necessária" };
    const quem = await mundo.validarToken(token);
    if (!quem) return { ok: false, status: 401, erro: "token inválido" };
    if (!sala.membro(quem.sub)) {
      return { ok: false, status: 403,
               erro: "você não está nesta sala — peça um código de pareamento ao anfitrião" };
    }
    if (!sala.ehMembroAtivo(quem.sub)) {
      return { ok: false, status: 401,
               erro: "o mundo deixou de aceitar sua identidade — pareie de novo" };
    }
    return { ok: true, sub: quem.sub, quem };
  }

  // G-POSSE. Recusa ANTES de qualquer chamada de modelo: um "não" que custa uma consulta
  // ao roster não pode custar um turno de LLM.
  function gPosse(sub, personagem) {
    if (!personagem) {
      return { ok: false, status: 400, erro: "informe 'personagem'" };
    }
    const assento = sala.assentoDe(personagem);
    if (!assento) {
      return { ok: false, status: 404, erro: "este personagem não está na sala" };
    }
    if (assento.dono !== sub) {
      return { ok: false, status: 403, erro: "este personagem é de outro jogador" };
    }
    return { ok: true, assento };
  }

  // G-MAQUINA — a autoridade do anfitrião (spec 072, FR-035).
  //
  // ESCREVER SÓ DA PRÓPRIA MÁQUINA. Com `--expor` ligado, qualquer aparelho da rede
  // alcança este processo — e mandar na mesa inclui expulsar gente e bloquear autonomia.
  // LER de fora é o que faz conferir do celular funcionar; MANDAR, não.
  //
  // "PRÓPRIA MÁQUINA" NÃO É "127.0.0.1". A primeira versão disto comparava com o
  // endereço de loopback e pronto — e trancava o dono para fora do próprio conector
  // assim que ele abrisse o painel pelo IP da rede (o que é natural: é o endereço que
  // ele já usa para a tela). Agora vale QUALQUER endereço desta máquina.
  //
  // ELA DISTINGUE MÁQUINAS, NÃO PESSOAS — e isso está registrado nos riscos da spec:
  // quem senta no computador do anfitrião manda na sala. É a mesma propriedade que
  // `/api/config` e `/api/reiniciar` já têm, herdada de propósito em vez de inventar um
  // sistema de papéis que ninguém pediu.
  const MEUS = new Set(["127.0.0.1", "::1"]);
  for (const ifaces of Object.values(os.networkInterfaces() || {})) {
    for (const i of ifaces || []) MEUS.add(i.address);
  }
  function daPropriaMaquina(req) {
    if (permitirConfigRemota) return true;
    const ip = (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
    return MEUS.has(ip);
  }

  // --- utilidades ---------------------------------------------------------- //

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

  const responder = (res, status, corpo) => {
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(corpo));
  };

  // --- a emissão, com as duas faixas --------------------------------------- //

  // QUEM DECLARA O ESCOPO É O LAÇO; QUEM APLICA É AQUI (research R2).
  //
  // A informação está repartida e cada lado só tem metade: o laço não sabe quem está
  // ligado, o canal não sabe o que é uma narração. Se o canal tivesse de adivinhar a
  // faixa pelo NOME do evento, quebraria em silêncio no dia em que nascesse um evento
  // novo — que é o modo de falha real, não o vazamento deliberado.
  function emitir(evento, dados) {
    const d = dados || {};
    const bloco = `event: ${evento}\ndata: ${JSON.stringify(d)}\n\n`;
    const paraMesa = d.escopo === "mesa";
    const dono = d.personagem ? sala.dono(d.personagem) : null;
    for (const o of ouvintes) {
      // Faixa do DONO: só quem é o dono daquele personagem. Um evento sem personagem e
      // sem escopo de mesa não tem destinatário definível — não vai para ninguém, em vez
      // de ir para todos. Errar para o lado do silêncio é recuperável.
      if (!paraMesa && (!dono || o.sub !== dono)) continue;
      try {
        o.res.write(bloco);
      } catch (_) {
        ouvintes.delete(o);   // tela fechada no meio: não é erro, é a vida
      }
    }
  }

  // Manda um evento a UM membro específico, sem passar pela faixa (a expulsão, que
  // precisa alcançar alguém que está deixando de ser membro neste instante).
  function emitirPara(sub, evento, dados) {
    const bloco = `event: ${evento}\ndata: ${JSON.stringify(dados || {})}\n\n`;
    for (const o of ouvintes) {
      if (o.sub !== sub) continue;
      try { o.res.write(bloco); } catch (_) { ouvintes.delete(o); }
    }
  }

  function fecharOuvintesDe(sub) {
    for (const o of [...ouvintes]) {
      if (o.sub !== sub) continue;
      ouvintes.delete(o);
      try { o.res.end(); } catch (_) {}
    }
  }

  // UM ERRO AQUI DENTRO NÃO PODE PENDURAR O SOCKET.
  //
  // Sem isto, uma exceção no meio de um `async` handler vira promessa rejeitada e a
  // resposta simplesmente NUNCA sai: o `fetch` do outro lado espera para sempre, sem
  // erro, sem log, sem nada. Foi assim que a primeira versão da sala travou a suíte
  // inteira em vez de falhar — e um `fetch` pendurado é bem pior de diagnosticar do que
  // um 500 com a mensagem certa.
  const servidor = http.createServer((req, res) => {
    tratar(req, res).catch((e) => {
      log("O CANAL FALHOU AO TRATAR UM PEDIDO", `${req.method} ${req.url}: ${e.message}`);
      try { responder(res, 500, { erro: `o conector falhou: ${e.message}` }); }
      catch (_) { try { res.end(); } catch (__) {} }
    });
  });

  async function tratar(req, res) {
    const origem = req.headers.origin;
    cabecalhos(res, origem);
    const url = new URL(req.url, "http://localhost");

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      return res.end();
    }

    // ------------------------------------------------------------------- //
    // A sala
    // ------------------------------------------------------------------- //

    // O roster, a fila e quem joga agora. NUNCA carrega credencial (FR-002/SC-011): a
    // tela não tem o que fazer com um token, e esta resposta viaja pela rede de casa.
    if (req.method === "GET" && url.pathname === "/sala") {
      const v = await gMembro(req, url);
      if (!v.ok) return responder(res, v.status, { erro: v.erro });
      return responder(res, 200, { ...sala.paraTela(), ...fila.estado(),
                                   mundo: cfg.mundoPublico || cfg.mundo,
                                   voce: v.sub });
    }

    // Um conector que ainda não conhece ninguém precisa poder dizer isso SEM autenticar
    // — senão o cliente não tem como distinguir "sala cheia que me recusa" de "sala
    // vazia esperando o primeiro". Só o mínimo, e nada de roster.
    if (req.method === "GET" && url.pathname === "/estado") {
      return responder(res, 200, {
        ok: true, sala: sala.nome,
        // O ENDEREÇO DO MUNDO QUE A TELA DEVE USAR — não o que este processo usa.
        // Um convidado noutra máquina não alcança o `localhost` do anfitrião; quem sabe
        // o endereço público é quem hospeda, e é ele que o publica aqui.
        mundo: cfg.mundoPublico || cfg.mundo,
        temAnfitriao: !!sala.anfitriao, authAtivo: !!authAtivo,
        membros: sala.membros.size, assentos: sala.assentos.size,
      });
    }

    if (req.method === "GET" && url.pathname === "/eventos") {
      const v = await gMembro(req, url);
      if (!v.ok) return responder(res, v.status, { erro: v.erro });
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      const ouvinte = { res, sub: v.sub };
      res.write(`event: sala\ndata: ${JSON.stringify(
        { ...sala.paraTela(), ...fila.estado(), escopo: "mesa" })}\n\n`);
      ouvintes.add(ouvinte);
      req.on("close", () => ouvintes.delete(ouvinte));
      return;
    }

    if (req.method === "POST" && url.pathname === "/sala/entrar") {
      const v = await gMembro(req, url);
      if (!v.ok) return responder(res, v.status, { erro: v.erro });
      const corpo = await corpoDe(req);
      const personagem = String(corpo.personagem || "").trim();
      if (!personagem) return responder(res, 400, { erro: "informe 'personagem'" });

      // A POSSE É CONFERIDA COM O JWT DE QUEM ESTÁ ENTRANDO (FR-017), nunca com o do
      // anfitrião: perguntar com o token errado devolveria a lista errada, e o assento
      // nasceria com o dono errado — daí em diante todo `tools/call` daquele personagem
      // tomaria 403 do `_authorize_character` do server.
      if (authAtivo) {
        let minhas = [];
        try {
          minhas = await mundo.personagensDe(sala.jwtDe(v.sub));
        } catch (e) {
          return responder(res, 502, { erro: `não consegui falar com o mundo: ${e.message}` });
        }
        const eDele = minhas.some((c) => (c.id || c) === personagem);
        if (!eDele) {
          return responder(res, 403, {
            erro: "este personagem não está associado à sua conta" });
        }
      }
      const r = await sala.assentar({ personagem, sub: v.sub });
      if (r.erro) return responder(res, 409, { erro: r.erro });
      salvarSala();
      return responder(res, 200, { ok: true, ...sala.paraTela() });
    }

    if (req.method === "POST" && url.pathname === "/sala/sair") {
      const v = await gMembro(req, url);
      if (!v.ok) return responder(res, v.status, { erro: v.erro });
      const corpo = await corpoDe(req);
      const p = gPosse(v.sub, String(corpo.personagem || "").trim());
      if (!p.ok) return responder(res, p.status, { erro: p.erro });
      fila.removerPersonagem(corpo.personagem);
      sala.desassentar(corpo.personagem);
      salvarSala();
      return responder(res, 200, { ok: true });
    }

    // ------------------------------------------------------------------- //
    // O pareamento — agora ACRESCENTA MEMBRO (spec 072, FR-002)
    // ------------------------------------------------------------------- //

    if (req.method === "POST" && url.pathname === "/api/parear/gerar") {
      if (!daPropriaMaquina(req)) {
        return responder(res, 403, { erro:
          "gerar código só da máquina onde o conector roda" });
      }
      const { codigo, expiraEm } = gerarCodigoPareamento();
      return responder(res, 200, {
        codigo, expiraEmSegundos: Math.round((expiraEm - Date.now()) / 1000) });
    }

    if (req.method === "POST" && url.pathname === "/parear") {
      const corpo = await corpoDe(req);
      if (!pareamentoPendente) {
        return responder(res, 404, {
          erro: "nenhum pareamento em aberto — gere um código no conector antes" });
      }
      if (Date.now() > pareamentoPendente.expiraEm) {
        pareamentoPendente = null;
        return responder(res, 410, { erro: "código expirado" });
      }
      if (String(corpo.codigo || "").toUpperCase() !== pareamentoPendente.codigo) {
        return responder(res, 403, { erro: "código não confere" });
      }
      const quem = await mundo.validarToken(corpo.jwt);
      if (!quem) {
        return responder(res, 401, {
          erro: "token inválido — faça login de novo no client" });
      }
      const primeiro = !sala.anfitriao;
      sala.acrescentarMembro({ sub: quem.sub, email: quem.email, nome: quem.name,
                               jwt: corpo.jwt });
      salvarSala();
      pareamentoPendente = null;
      responder(res, 200, {
        ok: true, email: quem.email, ehAnfitriao: primeiro,
        // O AVISO É OBRIGATÓRIO (FR-042), e não é formalidade: o achado da Fase 0 é que
        // o JWT do mundo NÃO TEM `exp` (`auth.py`) e o mundo não tem revogação
        // individual. Quem entra numa sala está deixando uma credencial permanente na
        // máquina de outra pessoa, e tem de saber disso na hora — não depois.
        aviso: "Este conector vai guardar sua credencial de mundo para poder jogar seu " +
               "personagem quando sua tela estiver fechada. Ela não expira, e só sai " +
               "daqui se você for removido da sala.",
      });
      if (onPareado) onPareado(quem);
      return;
    }

    // ------------------------------------------------------------------- //
    // O jogo
    // ------------------------------------------------------------------- //

    if (req.method === "POST" && url.pathname === "/sussurro") {
      const v = await gMembro(req, url);
      if (!v.ok) return responder(res, v.status, { erro: v.erro });
      const corpo = await corpoDe(req);
      const personagem = String(corpo.personagem || "").trim();
      const p = gPosse(v.sub, personagem);
      if (!p.ok) return responder(res, p.status, { erro: p.erro });
      const texto = String(corpo.texto || "").trim();
      if (!texto) return responder(res, 400, { erro: "informe 'texto'" });

      // Responde JÁ: o turno corre e se conta pelo canal de eventos, não pela resposta
      // desta chamada — que ficaria pendurada por dezenas de segundos. O que mudou com a
      // sala é que agora há uma POSIÇÃO a devolver: o jogador precisa saber que está na
      // fila, senão lê a espera como travamento.
      const r = fila.enfileirar({ personagem, classe: "manual", texto, quem: v.sub });
      if (r.erro && !r.jaTem) return responder(res, 409, { erro: r.erro });
      return responder(res, 202, { aceito: true, posicao: r.posicao || null });
    }

    // Observar: a tela leu o pacote do mundo e nao tem com que narra-lo.
    // FORA DA FILA de propósito: reconhecer é leitura, não gasta a vez e não toma a
    // trava (spec 018). Numa sala isso vale ainda mais — olhar não pode custar a vez de
    // ninguém.
    if (req.method === "POST" && url.pathname === "/observar") {
      const v = await gMembro(req, url);
      if (!v.ok) return responder(res, v.status, { erro: v.erro });
      const corpo = await corpoDe(req);
      const p = gPosse(v.sub, String(corpo.personagem || "").trim());
      if (!p.ok) return responder(res, p.status, { erro: p.erro });
      responder(res, 202, { aceito: !!corpo.observacao });
      if (corpo.observacao) {
        p.assento.laco.observar(corpo.observacao)
          .catch((e) => log("OBSERVAR FALHOU", e.message));
      }
      return;
    }

    // O INTERRUPTOR DO DONO — só o bit `ligado` (FR-029).
    //
    // Era global e sem dono: `/autonomia` pausava o conector inteiro. Numa sala isso é
    // um jogador pausando os outros, e por isso o caminho antigo não sobrevive.
    if (req.method === "POST" && url.pathname === "/autonomia") {
      const v = await gMembro(req, url);
      if (!v.ok) return responder(res, v.status, { erro: v.erro });
      const corpo = await corpoDe(req);
      const personagem = String(corpo.personagem || "").trim();
      const p = gPosse(v.sub, personagem);
      if (!p.ok) return responder(res, p.status, { erro: p.erro });

      const r = sala.ligarAutonomia(personagem, !!corpo.ligado);
      if (r.erro) {
        // A tela nem deveria ter deixado clicar (FR-038) — e a rota não confia nisso.
        return responder(res, r.bloqueado ? 409 : 400, { erro: r.erro });
      }
      if (!r.autonomia.ligado) fila.removerPersonagem(personagem);
      salvarSala();
      return responder(res, 200, { ok: true, autonomia: r.autonomia });
    }

    // ------------------------------------------------------------------- //
    // A autoridade do anfitrião — G-MAQUINA (spec 072, US5)
    // ------------------------------------------------------------------- //

    if (req.method === "POST" && url.pathname === "/sala/autonomia-permitida") {
      if (!daPropriaMaquina(req)) {
        return responder(res, 403, { erro:
          "mandar na sala só da máquina onde o conector roda (ou suba com --config-remota)" });
      }
      const corpo = await corpoDe(req);
      const personagem = String(corpo.personagem || "").trim();
      const permitido = !!corpo.permitido;
      if (!permitido && !String(corpo.motivo || "").trim()) {
        // Bloqueio sem motivo é silêncio, e silêncio é o que o Princípio VIII proíbe:
        // o jogador veria o botão morrer sem saber por quê.
        return responder(res, 400, { erro: "diga o motivo do bloqueio" });
      }
      const r = sala.permitirAutonomia(personagem, permitido, corpo.motivo);
      if (r.erro) return responder(res, 404, { erro: r.erro });
      if (!permitido) fila.removerPersonagem(personagem);
      salvarSala();
      return responder(res, 200, { ok: true, autonomia: r.autonomia });
    }

    // OS AJUSTES DA MESA — nome, cadeiras e tetos. G-MAQUINA, como todo controle.
    if (req.method === "POST" && url.pathname === "/sala/config") {
      if (!daPropriaMaquina(req)) {
        return responder(res, 403, { erro:
          "mandar na sala só da máquina onde o conector roda (ou suba com --config-remota)" });
      }
      const corpo = await corpoDe(req);
      if (typeof corpo.nome === "string" && corpo.nome.trim()) {
        sala.nome = corpo.nome.trim().slice(0, 60);
      }
      // O endereço público do mundo é do MESMO formulário: quem batiza a mesa é quem
      // sabe por onde ela é alcançável de fora.
      if (typeof corpo.mundoPublico === "string") {
        cfg.mundoPublico = corpo.mundoPublico.trim();
        configuracao.gravar(cfg);
      }
      // ZERO OU VAZIO = SEM LIMITE, e é preciso poder voltar a isso: um teto que só sobe
      // é uma armadilha para quem experimentou um número pequeno.
      const numero = (v) => {
        if (v === null || v === "" || typeof v === "undefined") return null;
        const n = Number(v);
        return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
      };
      if ("maxAssentos" in corpo) sala.maxAssentos = numero(corpo.maxAssentos);
      if ("maxPorJogador" in corpo) sala.maxPorJogador = numero(corpo.maxPorJogador);
      if ("tetoCustoTokens" in corpo) {
        sala.tetoCustoTokens = numero(corpo.tetoCustoTokens);
        sala.pausadaPorCusto = false;   // mexer no teto é justamente destravar a mesa
      }
      salvarSala();
      sala.emitir("sala", sala.paraTela());
      return responder(res, 200, { ok: true, ...sala.paraTela(),
                                   mundoPublico: cfg.mundoPublico || "" });
    }

    if (req.method === "POST" && url.pathname === "/sala/expulsar") {
      if (!daPropriaMaquina(req)) {
        return responder(res, 403, { erro:
          "mandar na sala só da máquina onde o conector roda (ou suba com --config-remota)" });
      }
      const corpo = await corpoDe(req);
      const alvo = String(corpo.sub || "").trim();
      // A ORDEM É O CONTRATO (FR-040). Tirar da fila ANTES de tirar o assento, senão a
      // fila fica com ponteiro para assento morto; e apagar a chave SEMPRE.
      fila.removerDe(alvo);
      const r = sala.expulsar(alvo);
      if (r.erro) return responder(res, 403, { erro: r.erro });
      salvarSala();
      responder(res, 200, { ok: true, personagens: r.personagens });
      // O EXPULSO SABE POR QUÊ antes do fluxo fechar. Sem isto ele vê uma tela de erro
      // de conexão e conclui que o conector caiu (SC-012).
      emitirPara(alvo, "expulso", {
        escopo: "dono",
        texto: String(corpo.motivo || "").trim()
               || "O anfitrião removeu você desta sala." });
      setTimeout(() => fecharOuvintesDe(alvo), 250);
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
      return responder(res, 200, { ...dados,
                                   sala: { ...sala.paraTela(), ...fila.estado() },
                                   podeEscrever: daPropriaMaquina(req) });
    }

    if (req.method === "POST" && url.pathname === "/api/config") {
      if (!daPropriaMaquina(req)) {
        return responder(res, 403, { erro:
          "configurar só da máquina onde o conector roda. Abra o painel lá, ou suba o conector com --config-remota se quiser configurar de fora." });
      }
      const corpo = await corpoDe(req);
      const saida = await painel.salvar(corpo);
      return responder(res, saida.erro ? 400 : 200, saida);
    }

    // REINICIAR O CONECTOR. Mesma guarda do `/api/config`, e pelo mesmo motivo: é
    // controle do processo, não jogada. Quem alcança esta rota derruba e sobe o
    // processo que guarda a credencial dos jogadores — então vale a regra mais estrita
    // que já existe aqui, sem exceção para "é só um reinício".
    if (req.method === "POST" && url.pathname === "/api/reiniciar") {
      if (!daPropriaMaquina(req)) {
        return responder(res, 403, { erro:
          "reiniciar só da máquina onde o conector roda. Abra o painel lá, ou suba o conector com --config-remota." });
      }
      const saida = await painel.reiniciar();
      return responder(res, 200, saida);
    }

    if (req.method === "POST" && url.pathname === "/api/prompt") {
      if (!daPropriaMaquina(req)) {
        return responder(res, 403, { erro: "editar prompt só da máquina onde o conector roda (ou suba com --config-remota)" });
      }
      const corpo = await corpoDe(req);
      const saida = painel.gravarPrompt(corpo.nome, corpo.texto);
      return responder(res, saida.erro ? 400 : 200, saida);
    }

    return responder(res, 404, { erro: "rota não encontrada" });
  }

  function salvarSala() {
    try {
      configuracao.gravarSala(cfg, sala);
    } catch (e) {
      log("ROSTER NÃO GRAVOU (a sala segue)", e.message);
    }
  }

  return new Promise((resolve) => {
    // 127.0.0.1 POR PADRÃO, e não 0.0.0.0: este processo guarda as credenciais dos
    // jogadores e não tem por que estar visível na rede de ninguém.
    //
    // `expor` abre para a rede local, e é preciso para o caso REAL de jogar a tela de
    // outro aparelho — e, com a sala, para os outros jogadores alcançarem a mesa. Isso é
    // topologia, não configuração: nenhum cabeçalho conserta. Quem liga aceita o preço,
    // que está escrito no aviso.
    const iface = expor ? "0.0.0.0" : "127.0.0.1";
    servidor.listen(porta, iface, () => resolve({
      servidor, emitir, emitirPara, ouvintes, gerarCodigoPareamento,
      // FECHAR DE VERDADE. `servidor.close()` sozinho só para de ACEITAR conexão
      // nova e espera as abertas drenarem — e a tela mantém um `text/event-stream`
      // aberto de propósito, que nunca drena. Um `await fechar()` ficaria pendurado
      // para sempre, e quem esperava a porta livre (o reinício, que precisa dela
      // para o processo novo escutar) nunca seria atendido. Então: despede-se dos
      // ouvintes, derruba o que sobrou, e só aí fecha.
      fechar: () => new Promise((r) => {
        for (const o of ouvintes) {
          try { o.res.end(); } catch (_) {}
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
