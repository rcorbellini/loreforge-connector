// O LAÇO DO TURNO — o que era `runWhisper`/`runPropostas` em `client/app.js`.
//
// ESTA É A CISÃO (spec 044). Antes, quem encadeava os atos era a TELA: ela
// interpretava, propunha, narrava e desenhava. Agora quem encadeia é o conector,
// e a tela só assiste. Foi essa mudança de dono que tornou possível jogar sem
// aba aberta — e, com ela, tudo o que a vertente do "tunar a Mente" precisa.
//
// O laço NÃO DESENHA NADA. Ele EMITE, e quem escuta decide o que fazer com isso:
// o terminal imprime, o canal manda para a tela, o registro guarda. É o que
// permite o mesmo laço servir ao jogo com tela e ao modo headless sem nenhuma
// bifurcação.

"use strict";

const { log } = require("./log");


// A identidade de uma proposta: a capacidade MAIS os alvos. `take` da faca e
// `take` da corda são duas propostas; `take` da faca duas vezes é uma repetida.
const _chaveDe = (p) => `${p.capacidade}\u0000${JSON.stringify(p.alvos || {})}`;

// Quantos passos uma ÚNICA vez pode APLICAR antes de terminar (spec 060).
//
// NÃO é o teto de PROPOSTAS que o mantenedor recusou no 53.2 — aquele limitava o
// que A Mente pode QUERER numa resposta, e continua não existindo. Este limita
// quanto a vez DURA: sem ele, uma Mente que nunca se declare satisfeita segura o
// turno indefinidamente, e cada rodada custa uma chamada de modelo.
//
// Seis é folgado de propósito: as cadeias medidas em jogo têm dois ou três
// passos, então o orçamento é fim de linha, não régua de comportamento. Se ele
// começar a disparar com frequência, o número não é o problema — é sinal de que
// A Mente não está sabendo parar, e isso se investiga, não se aperta.
const MAX_PASSOS_APLICADOS = 6;


class Laco {
  constructor({ mundo, mente, extensoes, registro, emitir }) {
    this.mundo = mundo;
    this.mente = mente;
    this.extensoes = extensoes;
    this.registro = registro;
    this.emitir = emitir || (() => {});
    this.ocupado = false;
    this.ocupadoDesde = null;   // ms do início do turno em curso (ver `comTurno`)
    this.numeroTurno = 0;
  }

  // TODO EVENTO DIZ DE QUEM É, e isso não é enfeite: sem o dono, a tela pinta o
  // que voltar em quem estiver selecionado na hora. Um sussurro para o Coppo,
  // seguido de uma troca de personagem, fazia a resposta aparecer na boca de
  // outro — e os turnos autônomos do Coppo aterrissavam no log de quem você
  // estivesse olhando. O dono vai aqui, num lugar só, para nenhuma emissão
  // futura poder esquecer.
  _emite(evento, dados) {
    try {
      this.emitir(evento, { ...(dados || {}),
                            personagem: this.mundo.personagem });
    } catch (e) {
      log("OUVINTE DO LAÇO FALHOU (o turno segue)", e.message);
    }
  }

  // A trava do conector. NÃO substitui a do mundo — a autoritativa é a do
  // processo do server, e é ela que impede corrida de verdade (Princípio III).
  // Esta aqui só evita que o próprio conector se atropele.
  async comTurno(fn) {
    if (this.ocupado) {
      this._emite("sistema",
        { texto: "Uma ação já está em andamento — aguarde o desfecho." });
      return null;
    }
    this.ocupado = true;
    // DESDE QUANDO. Sem isto, "ocupado" não distingue um turno de 20 segundos de um
    // turno PENDURADO há vinte minutos — e é essa diferença que o jogador precisa
    // ver, porque um turno que não volta congela a autonomia e prende a
    // configuração adiada (o alvo só troca quando o turno acaba). Aconteceu de
    // verdade: o Ollama engasgou, o turno nunca fechou, e a troca de personagem
    // ficou no disco sem nunca entrar em vigor, sem um aviso em lugar nenhum.
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
  // O turno
  // ----------------------------------------------------------------------- //

  async sussurrar(texto, origem = "manual") {
    return this.comTurno(async () => {
      const t = this.registro ? this.registro.abrir() : null;
      if (t) this.mundo.turnoId = t.id;
      try {
        const contexto = await this.mundo.contexto();
        if (t) t.pretendia(contexto.intentions);
        // SUSSURRO MANUAL não tem racional de autonomia — quem decidiu foi o jogador.
        // (Uma substituição minha larga pôs `decidido.racional` aqui, variável que só
        // existe no tick autônomo: era `ReferenceError` em toda ação manual, e o
        // try/catch a transformava em "algo interrompeu a cena". Passou porque o jogo
        // roda sozinho e ninguém digitou nada.)
        if (t) t.sussurro(texto, origem);
        await this._turno(texto, contexto, origem, t);
      } catch (e) {
        this._emite("erro", { texto: `Algo interrompeu a cena: ${e.message}` });
        if (t) t.falha(e.message);
        // SEM FALLBACK (Princípio VIII): o modelo fora do ar interrompe o turno.
        // O mundo fica intacto — a verdade está nos arquivos, não aqui.
      } finally {
        if (t) await t.fechar();
      }
    });
  }

  async _turno(texto, contexto, origem, t) {
    this.numeroTurno += 1;

    let cena = { texto, contexto };
    cena = await this.extensoes.hook("antes_de_pensar", cena, t) || cena;

    // 1) A Mente interpreta. O rascunho da ação sai palavra a palavra: é a parte
    //    que mais deixava a tela muda, e ver nascer é o que tira a inércia.
    let intent;
    this._emite("intencao_inicio", {});
    try {
      intent = await this.mente.interpret(
        cena.texto, cena.contexto, (pedaco) => this._emite("intencao", { pedaco }),
        origem === "reflexao" ? { somente: ["set_intention"] } : {});
    } finally {
      this._emite("intencao_fim", {});
    }
    if (t) t.pensou(intent);

    // A SESSÃO, não uma lista: o `interpret` devolve as propostas E o fio da
    // conversa (`continuar`), para o desfecho de cada uma voltar a ela sem
    // remontagem.
    const propostas = Array.isArray(intent && intent.propostas)
      ? intent.propostas : null;
    if (propostas) return this._porPropostas(intent, cena.contexto, t);
    // SEM PROPOSTAS (spec 045): antes, isto caía no caminho de prosa legado —
    // um SEGUNDO motor de decisão, medido menos confiável que este. A Mente já
    // teve `MAX_RODADAS` chances (mente.js) nesta mesma sessão; se ainda assim
    // não decidiu nada, o turno termina no recado honesto — nunca troca de
    // motor no meio do caminho. `desfechos` vazio é exatamente o sinal que
    // `_fecharTurno` já sabe ler como "nada aconteceu", com a explicação certa
    // pra cena estreita (dormindo, caído) ou larga.
    return this._fecharTurno([], cena.contexto, [], t);
  }

  // O CAMINHO NOVO (spec 043): uma chamada por capacidade proposta, na ordem.
  //
  // A NARRAÇÃO É UMA, no fim, sobre o arco inteiro. Narrar por etapa faria a
  // Mente fazer o trabalho do beat — e pior: no ato 1 ela não sabe o desfecho do
  // ato 2, então narraria com confiança algo que o ato seguinte contradiz.
  // O beat conta o INSTANTE; a narração conta o ARCO.
  async _porPropostas(sessao, contexto, t) {
    const desfechos = [];
    const vistos = new Set();
    // O que JÁ FOI AO MUNDO nesta vez. Guarda a Mente de reenviar o passo que
    // acabou de ser barrado quando ela insiste — e conta só o que foi DESPACHADO:
    // a cauda que morreu com a recusa, nunca tentada, pode voltar no plano seguinte.
    const jaTentadas = new Set();
    let inventadas = [];
    let atual = sessao;
    // passos que de fato MUDARAM o mundo nesta vez, contra o orçamento abaixo
    let aplicados = 0;
    let aplicadosAntes = 0;

    // O PLANO MORRE COM O PASSO QUE FALHOU — e a Mente sabe disso NA MESMA CONVERSA.
    //
    // Uma sequência é encadeada: os passos de trás pressupõem os da frente. Se o do
    // meio não aconteceu, o de depois pede ao mundo algo cujo pré-requisito não
    // existe. A medição mostra isso na forma da curva: dentro de uma cadeia longa a
    // recusa cresce com a POSIÇÃO — 20% na 1ª, 41% na 2ª, 49% na 3ª, 62% da 6ª em
    // diante. Não é que as últimas sejam piores; é que rodam contra outro mundo.
    //
    // Antes, "repensar" era chamar o `interpret` DE NOVO, do zero: a Mente recebia a
    // cena remontada e nenhuma lembrança do que tinha pedido. Agora o desfecho de
    // cada proposta — o que aconteceu, ou o motivo da recusa em linguagem de mundo —
    // volta como RESULTADO DE FERRAMENTA na conversa que ela já estava tendo. Ela
    // segue de onde parou, sabendo o que fez.
    let antes = contexto;              // a foto contra a qual o diff é tirado
    while (atual) {
      let lista;
      ({ lista, inventadas } = this._peneira(atual.propostas, t, jaTentadas));
      if (!lista.length) break;
      const resultados = [];
      const parou = await this._executar(lista, atual, t, desfechos, vistos,
                                         jaTentadas, resultados);
      if (parou && parou.abortar) break;

      // O TURNO CONTINUA NO SUCESSO — e não só depois de um "não" (spec 060).
      //
      // Aqui havia `if (!parou) break;  // foi até o fim: nada a repensar`, e a
      // consequência era grande: quando o passo proposto DAVA CERTO, a vez
      // acabava ali e A Mente nunca era perguntada "e agora?". Um sussurro de
      // dois passos rendia um.
      //
      // MEDIDO antes de mexer: a Mente propõe UMA chamada por rodada, sempre —
      // 1.0 em 35 rodadas, e o controle de duas ferramentas INDEPENDENTES falha
      // igual ao de duas encadeadas, então não é encadear, é emitir a segunda.
      // Como ela não emite duas, alguém tem de perguntar de novo.
      //
      // E continuar é MAIS BARATO que recomeçar, não menos: dois turnos custam 4
      // chamadas e 36.863 tokens de entrada; um turno com duas rodadas custa 3 e
      // 20.726 (-44%), porque `system + user + tools` não mudam e o prefixo fica
      // no cache — a 2a rodada reavalia 2.288 tokens em vez de 18.354.
      //
      // Isto NÃO desfaz o conserto do 53.2: a recusa continua matando a cauda
      // logo abaixo. O que muda é que o SUCESSO também tem continuação.
      if (!parou) {
        aplicados += desfechos.filter((d) => d && d.ok).length - aplicadosAntes;
        aplicadosAntes = desfechos.filter((d) => d && d.ok).length;
        // O ORÇAMENTO É DE DURAÇÃO DA VEZ, NÃO DE VONTADE.
        //
        // A distinção não é sutil e precisa ficar escrita: o teto de PROPOSTAS
        // (quantas capacidades A Mente pode pedir de uma vez) foi proposto no
        // 53.2, o mantenedor recusou com razão, e ele não volta — `_peneira` não
        // corta por quantidade. Este teto é outra coisa: quantos passos uma
        // única vez pode APLICAR antes de terminar. Sem ele, uma Mente que nunca
        // se declare satisfeita segura o turno para sempre.
        if (aplicados >= MAX_PASSOS_APLICADOS) {
          log("ORÇAMENTO DE PASSOS ESGOTADO", `${aplicados} aplicados`);
          if (t) t.falhaDeExtensao("laco:orcamento-esgotado", `${aplicados} passos`);
          break;
        }
      }
      // Sem `continuar`, não há fio de conversa para devolver o desfecho — é o caso
      // do caminho de prosa e de qualquer Mente que só saiba propor uma vez. Aí a
      // recusa encerra a vez, como encerrava antes de existir a sessão.
      if (typeof atual.continuar !== "function") break;

      // O QUE MUDOU AO REDOR viaja junto do desfecho. `diffTextual` é DETERMINÍSTICO
      // — compara duas fotos do contexto e escreve a diferença em linguagem de mundo,
      // sem modelo nenhum. Vai aqui, e não em cada proposta, porque ele não descreve
      // o que a proposta CAUSOU (isso é o `aconteceu`, que o mundo já devolve): ele
      // descreve o mundo vivo em volta. E é neste instante que a Mente precisa saber
      // — ela está a ponto de refazer o plano contra uma cena que pode ter mudado.
      let depois = antes;
      try {
        depois = await this.mundo.contexto();
      } catch (_) { /* sem foto nova: segue com o desfecho puro */ }
      const aoRedor = diffTextual(antes, depois);
      antes = depois;
      if (aoRedor.length && resultados.length) {
        // pendurado no ÚLTIMO resultado: cada resultado tem de casar com uma chamada
        // (é o protocolo), e notícia do ambiente não é resposta a pedido nenhum.
        const fim = resultados[resultados.length - 1];
        fim.conteudo += `\n\nEnquanto isso, ao redor: ${aoRedor.join(" ")}`;
      }

      // devolve o "não" (e o que aconteceu antes dele) para dentro da conversa
      atual = await atual.continuar(resultados);
    }

    return this._fecharTurno(desfechos, contexto, inventadas, t);
  }

  // A PENEIRA — e ela existe porque o oposto foi visto jogando.
  //
  // O modelo local inventa nome de capacidade apesar de o prompt mandar usar
  // só a lista: 'comprar', 'pedir', 'ir', 'olhar'. Sem peneira, cada invenção
  // virava uma ida ao mundo, uma recusa "não existe capacidade 'comprar'", e
  // essa frase MECÂNICA aterrissava na tela do jogador — sete vezes seguidas,
  // porque nem repetição era filtrada.
  //
  // Três coisas erradas ali, e todas são desta camada:
  //   · o conector JÁ SABE o que existe na cena (ele leu `tools/list`);
  //   · nome inventado é falha DA MENTE, não recusa do mundo — o mundo nem
  //     chegou a julgar, então não há o que contar ao jogador em linguagem de
  //     mundo, e vocabulário de máquina na tela fere o isolamento narrativo;
  //   · proposta repetida é a mesma proposta.
  _peneira(entrada, t, jaTentadas) {
    const inventadas = [];
    const tentadas = jaTentadas || new Set();
    const nesta = new Set();
    const lista = (entrada || []).filter((p) => {
      if (!p || !p.capacidade) return false;
      // `conhece` só desmente quando SABE. Mundo que não implemente a consulta,
      // ou cena ainda não lida, devolve `null` — e aí a proposta segue para o
      // mundo julgar, que é quem tem a palavra final de qualquer forma.
      const existe = typeof this.mundo.conhece === "function"
                     ? this.mundo.conhece(p.capacidade) : null;
      if (existe === false) {
        inventadas.push(p.capacidade);
        return false;
      }
      const chave = _chaveDe(p);
      if (tentadas.has(chave) || nesta.has(chave)) return false;
      nesta.add(chave);
      return true;
    });

    if (inventadas.length) {
      // Fica no registro e no log, onde serve para melhorar o prompt. NUNCA na
      // tela: o jogador não tem o que fazer com o nome de uma engrenagem que a
      // Mente dele imaginou.
      log("A MENTE INVENTOU CAPACIDADE (não foi ao mundo)", inventadas);
      if (t) t.falhaDeExtensao("mente:capacidade-inexistente", inventadas.join(", "));
    }
    return { lista, inventadas };
  }

  // Executa a sequência NA ORDEM e PARA no primeiro passo que o mundo recusa.
  // Devolve `null` se foi até o fim, `{motivo}` se parou numa recusa, ou
  // `{abortar:true}` se o transporte caiu (aí não há o que replanejar).
  async _executar(lista, intent, t, desfechos, vistos, jaTentadas, resultados) {
    for (const p of lista) {
      if (!p || !p.capacidade) continue;
      if (jaTentadas) jaTentadas.add(_chaveDe(p));
      const corpo = {
        ...(p.alvos || {}),
        prosa: p.prosa || { acao: (intent && intent.pensamento) || "age" },
      };
      let r;
      try {
        r = await this.mundo.chamarCapacidade(p.capacidade, corpo);
      } catch (e) {
        this._emite("erro", { texto: `A cena não aceitou: ${e.message}` });
        if (t) t.falha(e.message);
        return { abortar: true };   // transporte caiu: não há o que replanejar
      }
      if (t) t.propos(p.capacidade, p.alvos, corpo.prosa, r);

      // O MUNDO NÃO CONSEGUIU JULGAR (item 52.1). Vira recado de SISTEMA, nunca
      // narração: o desfecho caiu no default de cada capacidade, e o jogador precisa
      // saber que foi PANE e não o personagem falhando. A Nerissa jogou 11 horas com
      // 148 dessas e o registro guardou UMA — ela repetiu a mesma pergunta 23 vezes a
      // uma capacidade que, sem juízo, não podia funcionar.
      const ji = r.sistema && r.sistema.juizo_indisponivel;
      if (ji) {
        const q = ji.quantas > 1 ? `${ji.quantas} vezes neste turno` : "neste turno";
        this._emite("sistema", { texto:
          `O mundo não conseguiu julgar ${q} — o desfecho caiu no padrão, e não é o ` +
          `personagem que falhou. Verifique o modelo do Árbitro (${ji.porque}).` });
        if (t) t.falhaDeExtensao("juizo", `indisponível ${ji.quantas}x: ${ji.porque}`);
      }

      const out = { ...(r.narrativa || {}), ok: !r.recusado,
                    erro: r.recusado ? r.texto : null };
      delete out.character_id;
      // A RECUSA VIRA MATÉRIA DE NARRAÇÃO (Princípio X: nunca um silêncio sem
      // causa). Sem isto, um turno só de recusas chegava à Mente com NADA e ela
      // inventava a cena inteira — aconteceu de verdade: uma entrega recusada
      // virou uma narração de chegada a um lugar onde ninguém chegou.
      if (!out.ok && out.erro && !(out.failed_effects || []).length) {
        out.failed_effects = [{ o_que_falhou: out.erro }];
      }
      desfechos.push(out);

      // O DESFECHO VOLTA À MENTE como resultado de ferramenta. É a frase de MUNDO,
      // a mesma que o jogador leu — nunca vocabulário de máquina. Sem isto ela
      // proporia no escuro: pediu, e não soube no que deu.
      if (resultados) {
        resultados.push({ id: p.id, conteudo: this._desfechoEmPalavras(out) });
      }

      if (!out.ok) {
        if (out.erro) this._emite("recusa", { texto: out.erro });
        // PARA AQUI. O resto da sequência pressupunha este passo — insistir é
        // pedir ao mundo coisas cujo pré-requisito não aconteceu. Quem decide o
        // que fazer agora é A Mente, com a cena já atualizada.
        return { motivo: out.erro || "o mundo não deixou" };
      }
      for (const frase of out.aconteceu || []) {
        if (vistos.has(frase)) continue;
        vistos.add(frase);
        this._emite("beat", { texto: frase });
      }
    }
    return null;
  }

  // O DESFECHO EM PALAVRAS, para a Mente ler como resultado de ferramenta.
  //
  // Só linguagem de mundo entra: o que aconteceu, o que falhou e por quê. Nada de
  // nome de regra nem de campo — o resultado de tool é ENTRADA DO MODELO, e
  // vocabulário de máquina ali contamina a narração dois passos depois.
  //
  // O material das consultivas (`lido`, `wares`, `falas` — item 52.3) entra aqui
  // também: era exatamente o que o conector recebia e jogava fora, e é o que faz
  // "examinei" render alguma coisa em vez de silêncio.
  _desfechoEmPalavras(out) {
    if (!out.ok) return out.erro || "o mundo não deixou.";
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


  // O fim do turno: ou o recado de por que nada houve, ou a narração do ARCO.
  async _fecharTurno(desfechos, contexto, inventadas, t) {
    if (!desfechos.length) {
      // Turno vazio. NÃO narramos: a narração recebe os fatos, e sem fato nenhum
      // ela preenche o vazio com cenário inventado — o pior erro possível, porque
      // o jogador passa a decidir sobre um mundo que não existe. Um recado curto
      // e honesto vale mais que um parágrafo bonito e falso.
      //
      // Mas "a Mente hesitou" sozinho é honesto e INÚTIL. Foi visto jogando: o
      // Coppo tinha adormecido no laço autônomo, a cena passou a oferecer UMA
      // coisa (acordar), a Mente insistiu em caminhar, e o jogador leu só que ela
      // hesitou — sem saber que o personagem estava dormindo.
      //
      // Quando a cena está ESTREITA, dizemos o que ela permite, com as palavras
      // do próprio mundo: a `descricao` da capacidade é prosa player-facing por
      // desenho (spec 043, fonte única). O NOME é mecânica e não sai daqui; a
      // descrição é o que o jogador deveria estar lendo.
      this._emite("sistema", { texto: this._porQueNada(contexto, inventadas) });
      return;
    }

    const juntar = (chave) => desfechos.flatMap((d) => d[chave] || []);
    // O HINT é uma STRING, não uma lista: `flatMap` sobre ela espalharia os
    // CARACTERES, e o `.length` de um hint qualquer virava truthy — o que fazia o
    // hint NUNCA chegar à narração.
    const hints = desfechos.map((d) => d.narrative_hint).filter(Boolean);

    // O `tools/call` não devolve mais o mundo (eram ~9 KB de ENTRADA do modelo).
    // Relemos o contexto aqui, que é de onde sai o diff do que mudou ao redor.
    let depois = contexto;
    try {
      depois = await this.mundo.contexto();
    } catch (_) { /* sem diff; a narração segue com o que já tem */ }

    await this._narrar({
      hint: hints.length ? hints[hints.length - 1] : null,
      contexto,
      falhas: juntar("failed_effects"),
      viradas: juntar("viradas"),
      aconteceu: juntar("aconteceu"),
      informes: juntar("informes"),
      reconhecimentos: juntar("reconhecimentos"),
      material: { lido: juntar("lido"), wares: juntar("wares"),
                  falas: juntar("falas") },
      paralelos: diffTextual(contexto, depois),
    }, t);
  }

  // Por que nada aconteceu — em linguagem de mundo sempre que der.
  //
  // A cena estreita é o caso que confunde: dormindo, caído, em viagem. Aí o que a
  // cena oferece É a explicação, e ela já vem escrita para o jogador ler. Cena
  // larga (dez, vinte capacidades) não se lista: viraria um cardápio de mecânica,
  // que é justamente o que o Princípio V proíbe na tela.
  _porQueNada(contexto, inventadas) {
    const caps = (contexto && contexto.capacidades) || [];
    const prosas = caps.map((c) => (c.descricao || "").trim()).filter(Boolean);
    if (caps.length && caps.length <= 3 && prosas.length) {
      return "Ele não fez nada. " + prosas.join(" ");
    }
    return inventadas.length
      ? "A Mente hesitou: nada do que ela pensou em fazer cabia nesta cena."
      : "Nada em que ele pudesse agir agora.";
  }

  async _narrar(arco, t) {
    const a = await this.extensoes.hook("antes_de_narrar", arco, t) || arco;
    this._emite("narracao_inicio", {});
    let prosa = "";
    try {
      prosa = await this.mente.narrate(
        a.hint, a.contexto, a.falhas, a.viradas, a.aconteceu, a.informes,
        a.reconhecimentos, a.paralelos, a.material,
        (pedaco) => this._emite("narracao", { pedaco }));
    } finally {
      this._emite("narracao_fim", { texto: prosa });
    }
    if (t) t.narrou(prosa);
  }

  // OLHAR não é agir: reconhecer (spec 018) é leitura, não gasta turno e não
  // toma a trava. Mas é NARRADO — o que se vê tecido com a vivência —, e narrar é
  // trabalho da Mente. Por isso a tela manda o pacote para cá em vez de narrar
  // sozinha: ela não tem com que narrar.
  async observar(pacote) {
    this._emite("narracao_inicio", {});
    let prosa = "";
    try {
      prosa = await this.mente.narrateObservation(
        pacote, { self: { name: pacote && pacote.observer } });
    } catch (e) {
      // sem Mente, o olhar não fica mudo — mas também não inventa vivência:
      // devolve o que o próprio mundo diz da coisa.
      prosa = ((pacote && pacote.description) || "").trim()
            || `${(pacote && pacote.name) || "aquilo"} não revela nada além do que se vê.`;
      log("OBSERVAR SEM MENTE (caiu no estático)", e.message);
    } finally {
      this._emite("narracao_fim", { texto: prosa });
    }
    return prosa;
  }

  // ----------------------------------------------------------------------- //
  // Autonomia — o personagem NUNCA fica parado (spec 026/033)
  // ----------------------------------------------------------------------- //

  // O RELÓGIO MUDOU DE DONO, e é essa a diferença que a cisão faz aqui. Ele
  // vivia na aba: fechar a tela era o personagem parar de existir. Agora vive no
  // conector — a Mente age porque está viva, não porque alguém está olhando.
  //
  // Tempo TRAVADO não conta (pedido explícito do mantenedor): enquanto um turno
  // corre, a contagem congela, em vez de queimar por baixo e disparar de novo
  // assim que o anterior terminar.
  iniciarAutonomia({ intervaloMs = 45000, passoMs = 500 } = {}) {
    const auto = {
      pausado: false,
      restante: intervaloMs,
      total: intervaloMs,
      // Emite CAMPOS ESCOLHIDOS, nunca o objeto inteiro: `auto` guarda o próprio
      // `Timeout`, e espalhá-lo fazia o SSE tentar serializar uma estrutura
      // circular — o evento morria e a barra da tela congelava sem dizer por quê.
      pausar: (p) => {
        auto.pausado = !!p;
        this._emite("autonomia", { pausado: auto.pausado,
                                   restante: auto.restante, total: auto.total });
      },
      parar: () => clearInterval(auto._t),
    };
    auto._t = setInterval(() => {
      if (!auto.pausado && !this.ocupado) {
        auto.restante = Math.max(0, auto.restante - passoMs);
        if (auto.restante <= 0) {
          auto.restante = intervaloMs;
          this.talvezAgirSozinho();
        }
      }
      this._emite("autonomia",
        { pausado: auto.pausado, restante: auto.restante, total: auto.total });
    }, passoMs);
    auto._t.unref && auto._t.unref();
    this.autonomia = auto;
    return auto;
  }

  async talvezAgirSozinho() {
    return this.comTurno(async () => {
      const t = this.registro ? this.registro.abrir() : null;
      if (t) this.mundo.turnoId = t.id;
      try {
        const contexto = await this.mundo.contexto();
        if (t) t.pretendia(contexto.intentions);
        // QUEM DORME FUNDO NÃO DECIDE. Na vida real ninguém fica avaliando de
        // minuto em minuto se já está na hora de levantar: dorme até se recuperar
        // ou ser acordado. A Mente nem é acionada — e é aqui, ANTES do
        // `deriveWhisper`, porque é essa a chamada ao modelo que se quer evitar.
        //
        // Não é economia teórica: na rodada da Elga (2026-08-20) 122 dos 654
        // turnos foram só deitar e levantar, 1,05M tokens, porque a face oferece
        // a quem dorme UMA capacidade (`wake_up`) e ela nunca falhava.
        //
        // Isto é GATE DE CLIENT, ou seja, UX. A autoridade continua no Motor, que
        // recusa `wake_up` em sono profundo por conta própria — este atalho só
        // evita pagar por uma resposta cujo desfecho o servidor já conhece.
        if (contexto && contexto.self && contexto.self.sono_profundo) {
          // Mesma saída do "nada a fazer agora" logo abaixo: turno descartado,
          // sem emitir `decidiu` — uma fala vazia viraria bolha vazia na tela.
          if (t) t.descartar();
          return;
        }
        const decidido = await this.mente.deriveWhisper(contexto);
        const texto = decidido && decidido.texto;
        // A ORIGEM diz QUAL rotina produziu o sussurro, e não só que foi
        // automático: é ela que faz a reflexão ser respondida com a face
        // recortada (item 53.6) em vez da cena inteira.
        const origem = decidido && decidido.rotina === "refletir"
                       ? "reflexao" : "autonoma";
        if (!texto) {
          // "nada a fazer agora" é saída VÁLIDA, não falha.
          if (t) t.descartar();
          return;
        }
        this._emite("decidiu", { texto });
        if (t) t.sussurro(texto, origem, decidido && decidido.racional);
        await this._turno(texto, contexto, origem, t);
      } catch (e) {
        this._emite("erro", { texto: `Algo interrompeu a cena: ${e.message}` });
        if (t) t.falha(e.message);
      } finally {
        if (t) await t.fechar();
      }
    });
  }
}

// --------------------------------------------------------------------------- //
// O diff do que mudou ao redor enquanto o turno corria — o mundo é vivo, e o
// personagem repara nas coisas. Migrado de `client/app.js`.
// --------------------------------------------------------------------------- //

function diffTextual(velho, novo) {
  const eventos = [];
  if (!velho || !novo) return eventos;

  const nomes = (lista) => (lista || []).map((x) => x.name);
  const antes = nomes(velho.characters_present);
  const agora = nomes(novo.characters_present);
  agora.filter((n) => !antes.includes(n))
       .forEach((c) => eventos.push(`${c} chegou ao local.`));
  antes.filter((n) => !agora.includes(n))
       .forEach((c) => eventos.push(`${c} saiu do local.`));

  const itensAntes = nomes(velho.items_present);
  const itensAgora = nomes(novo.items_present);
  itensAgora.filter((n) => !itensAntes.includes(n))
            .forEach((i) => eventos.push(`Um(a) ${i} apareceu no chão.`));
  itensAntes.filter((n) => !itensAgora.includes(n))
            .forEach((i) => eventos.push(`Um(a) ${i} sumiu do chão.`));

  return eventos;
}

// O movimento que a Mente pediu tem de apontar para uma rota QUE EXISTE. Prosa
// aponta para o que existe; não cria. Migrado de `client/app.js`.
function sanitizeMovement(intent, routes) {
  if (!intent) return;
  const mv = intent.movement;
  const querido = mv && (mv.enter_route || mv.route || mv.destino || mv.para);
  if (!querido) {
    intent.movement = null;
    return;
  }
  const w = String(querido).trim().toLowerCase();
  const igual = (a) => (a || "").trim().toLowerCase() === w;
  const contem = (a) => {
    const s = (a || "").trim().toLowerCase();
    return s && (s.includes(w) || w.includes(s));
  };
  const achou =
    routes.find((r) => igual(r.id)) ||
    routes.find((r) => igual(r.destination_name)) ||
    routes.find((r) => igual(r.name)) ||
    routes.find((r) => contem(r.destination_name)) ||
    routes.find((r) => contem(r.name));
  intent.movement = achou ? { enter_route: achou.id } : null;
}

module.exports = { Laco, diffTextual, sanitizeMovement };
