# Instalar

Dois caminhos. **Nenhum deles exige editar código**, e os dois levam ao mesmo
programa — o segundo existe para quem não tem Node instalado.

---

## 1. Pegar o código e rodar

Para quem quer ler antes de confiar a chave. É o caminho recomendado, e não custa
mais que o outro.

```bash
git clone <repo> && cd connector
node --version          # precisa ser 20 ou mais novo
node bin/conector.js --configurar --mundo <url> --personagem <id>
node bin/conector.js
```

Não há `npm install`: o conector **não tem dependências**. Isso não é economia — é o
que torna "leia antes de rodar" possível de verdade. Uma árvore de dependências não
se audita numa sentada.

---

## 2. Executável único

Para quem não tem Node e não quer instalar. Usa o recurso de *single executable
application* do próprio Node — sem ferramenta de terceiro no meio.

```bash
node --experimental-sea-config sea-config.json          # gera conector.blob

# Linux
cp "$(command -v node)" loreforge
npx postject loreforge NODE_SEA_BLOB conector.blob \
    --sentinel-fuse NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2

./loreforge --configurar --mundo <url> --personagem <id>
./loreforge
```

No macOS é preciso remover e refazer a assinatura (`codesign --remove-signature` e
depois `codesign --sign -`); no Windows, o equivalente com `signtool`, se você
assinar binários.

> **Nota honesta:** este é o caminho que o Node oferece hoje, e ele ainda pede o
> `postject` como passo de empacotamento — que é a única ferramenta externa em todo
> o processo, e não entra no programa que você roda. Se isso incomodar, use o
> caminho 1: o resultado é o mesmo.

---

## Primeira execução

Rodando sem configuração, o conector **diz o que falta e como preencher** — não
falha em silêncio nem manda ler código.

```
Falta configurar antes de jogar:

  • o endereço do mundo
      --mundo http://localhost:8777
  • qual personagem esta Mente joga
      --personagem <id>  (use --personagens para listar)
```

Depois, `--verificar` confere as três coisas que podem estar erradas — mundo
alcançável, personagem existente, modelo respondendo — e diz qual delas falhou, em
vez de deixar você descobrir no meio de um turno.

---

## Onde fica a sua configuração

`~/.loreforge/conector.json`, com permissão `600`. É onde a credencial do seu modelo
vive, e ela não sai daí — ver o README.

Para mudar o lugar: `LOREFORGE_CONFIG=/outro/caminho.json`.
