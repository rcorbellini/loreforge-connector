# O conector da Mente

**A inteligência do seu personagem roda aqui, na sua máquina, com o seu modelo e a
sua chave.** Este programa existe por um motivo só: para que você não precise colar
a sua credencial de LLM num site de terceiro.

Ele é pequeno de propósito, e **não tem nenhuma dependência** além do Node — dá para
ler inteiro numa sentada antes de rodar. Se você não puder auditar, não confie.

---

## Para onde vão as coisas

| o quê | vai para onde |
|---|---|
| a sua **credencial** de modelo | **lugar nenhum.** Fica em `~/.loreforge/conector.json`, com permissão `600` |
| o que você **sussurra** | ao seu modelo, e ao mundo como *proposta* |
| a **proposta** e o desfecho | ao mundo — é o jogo acontecendo |
| o **racional da Mente** | ao mundo, como registro — **sempre** |

Sobre o último, e é bom saber antes de jogar: o mundo guarda o que a Mente pensou —
o sussurro, o raciocínio nas palavras do modelo, cada capacidade escolhida com alvo
e prosa, as recusas e a narração. **Não é opção; é a regra da casa de um mundo
hospedado.** Quem hospeda precisa medir como as Mentes jogam para melhorar os
prompts, e telemetria voluntária é telemetria que não existe.

O registro não muda o jogo: nenhum caminho de arbitragem o lê, e há teste que
garante. Ele serve à análise depois, não à partida agora.

A credencial é guardada como propriedade **não-enumerável** (`config.js`): um
`JSON.stringify` distraído não a leva junto. Há teste que afirma isso
(`test/credencial.test.js`), porque vazamento de chave acontece por descuido, e
descuido não lê README.

---

## Rodar

Precisa de **Node 20 ou mais novo** (`node --version`).

```bash
# 1. configure uma vez
node bin/conector.js --configurar \
     --mundo http://localhost:8777 \
     --personagem <id>          # --personagens lista quem existe

# se o seu modelo pede chave (Anthropic / OpenRouter):
node bin/conector.js --configurar --runtime remote --chave sk-ant-...

# 2. confira antes de jogar
node bin/conector.js --verificar

# 3. jogue
node bin/conector.js
```

Rodando sem configuração nenhuma, ele diz o que falta e como preencher.

### Os três modos

```bash
node bin/conector.js                      # você sussurra pelo terminal
node bin/conector.js --headless --turnos 50   # a Mente joga sozinha, sem tela
node bin/conector.js --canal 8899         # a tela web fala com este processo
```

O **headless** não é um extra: é o modo nativo. O personagem age porque está vivo,
não porque alguém está com uma aba aberta.

---

## Configurar pela página

Com `--canal`, o conector serve o próprio painel:

```
http://127.0.0.1:8899/
```

Ali se ajusta o mundo, **quem esta Mente joga** (troca ao vivo, sem reiniciar), o
modelo e a chave, o laço automático e os quatro prompts — e se lê, por extenso, o
que fica registrado a cada turno.

**Duas coisas que o painel nunca faz**, e as duas são propositais:

- **não devolve a sua credencial** — nem para preencher o próprio campo. Ele diz
  apenas que existe uma chave gravada. Campo vazio ao salvar significa *manter*;
- **não grava código.** Prompt é arquivo de **texto** (`.txt`). Ferramentas e hooks
  continuam sendo `.js` que você coloca na pasta — o painel lista, não escreve.

Com `--expor` ligado, **ler** o painel funciona de qualquer aparelho da rede (é o
que permite conferir do celular), mas **escrever só da máquina onde o conector
roda** — por qualquer endereço dela, seja `127.0.0.1` ou o IP da LAN. Requisição
de outro aparelho recebe 403 e a página se desabilita sozinha.

Se você quiser mesmo configurar de outro aparelho, `--config-remota` libera — e
aí quem alcançar a porta troca o seu modelo e os seus prompts.

## Tunar a Mente

Se você quer *ensinar a sua LLM a jogar melhor este jogo*, o conector é um harness.
Jogar normalmente é o mesmo programa com a configuração de fábrica — não há duas
versões.

```
extensoes/
├── prompts/    troque o que a Mente lê antes de pensar
├── tools/      ferramentas de RACIOCÍNIO que só a sua Mente tem
└── hooks/      quatro pontos onde você entra no meio do turno
```

### Prompts

Quatro rotinas: `interpretar` (escolher a ação, com capacidades nativas),
`interpretar_prosa` (o mesmo, quando o modelo não devolve tool call), `autonomia`
(decidir agir sozinho) e `narrar` (contar o que aconteceu).

Pela página, ou à mão:

```
extensoes/prompts/narrar.txt      ← texto puro, e só
```

Esvaziar o arquivo (ou o campo, na página) volta ao padrão.

O conjunto em uso ganha um identificador que vai no registro. Sem ele, comparar
duas corridas seria chute.

### Ferramentas locais

```js
// extensoes/tools/bloco.js
module.exports = {
  nome: "consultar_bloco",
  descricao: "lê as próprias anotações sobre a cidade",
  parametros: { type: "object", properties: { sobre: { type: "string" } } },
  executar: async (args) => ({ nota: minhasNotas[args.sobre] }),
};
```

**Elas raciocinam; não agem.** Uma ferramenta local nunca muda o mundo: o que muda
o mundo continua sendo proposta, e quem julga é o mundo. Declarar uma ferramenta
local com o nome de uma capacidade do mundo **não a sequestra** — o roteamento é
pela origem, não pelo nome, e há teste que afirma isso.

É essa fronteira que torna seguro abrir o conector inteiro: não há o que trapacear
do lado de fora.

### Hooks

```js
// extensoes/hooks/meu.js
module.exports = {
  antes_de_pensar:     (cena) => cena,     // enriquecer/filtrar o que a Mente vê
  antes_de_propor:     (lista) => lista,   // vetar, reordenar, anotar
  depois_do_desfecho:  (d) => d,           // reagir, medir
  antes_de_narrar:     (arco) => arco,     // ajustar tom
};
```

São **quatro**, e são poucos de propósito: cada um vira contrato público no dia em
que alguém tunar contra ele. Um hook que estoura ou demora **não derruba o turno** e
não altera o desfecho já julgado pelo mundo — a falha fica anotada no registro.

---

## Testes

```bash
node --test
```

Os que mais importam não são os do caminho feliz:

- `credencial.test.js` — a chave não sai daqui, nem por descuido
- `roteamento.test.js` — ferramenta local não sequestra capacidade do mundo
- `laco.test.js` — **recusa nunca é silenciosa**
- `fronteira.test.js` — o conector não alcança código de fora da própria pasta
- `painel.test.js` — a página não devolve a chave, e nunca grava código

---

## Por que uma pasta separada

O destino desta pasta é um repositório próprio. O teste de fronteira existe para que
essa mudança seja um `git mv`, e não uma cirurgia — sem ele, a separação apodrece no
primeiro dia de pressa.
