# Meu Arquivo Pessoal

Um arquivo pessoal na internet: coisas que estou fazendo, aprendendo e construindo.

## Estrutura

```
apps/
├── blog/     → Site público (Astro)
└── writer/   → Editor local com acesso aos arquivos Markdown e ao Git

content/
├── posts/    → Publicações
└── projects/ → Sistemas de RPG, histórias, capítulos e complementos
```

O Markdown versionado no Git é a fonte da verdade. O site público é gerado a partir desses arquivos pelo Astro e publicado no GitHub Pages.

## Requisitos

- Node.js 22
- npm compatível com o lockfile do repositório
- Git configurado na máquina para operações de publicação pelo Writer

## Instalação

Na raiz do repositório:

```bash
npm ci
```

## Blog (desenvolvimento)

```bash
npm run dev
```

Com o `BASE_PATH` padrão, abra [http://localhost:4321/blog/](http://localhost:4321/blog/).

Para validar o build de produção:

```bash
npm run check
npm run check:writer
npm run test:writer
npm run build
npm run check:site
```

## Writer (local)

```bash
npm run writer
```

Abra [http://localhost:4322](http://localhost:4322). O Writer deve permanecer acessível apenas pela máquina local; não exponha sua porta à rede.

Comandos adicionais:

```bash
npm run check:writer
npm run test:writer
npm run build --workspace=apps/writer
```

## Publicar conteúdo

1. Confira a branch Git ativa antes de editar ou publicar.
2. Crie ou edite o post, projeto ou documento no Writer.
3. Salve e revise a prévia.
4. Publique apenas quando tiver certeza de que está na branch desejada.
5. O workflow do GitHub Actions gera e publica o blog quando as alterações chegam à `main`.

O Writer usa o Git local e as credenciais já configuradas. Publicar pelo Writer pode criar commits e enviar alterações para o remoto; não use a ferramenta em um workspace ou branch que não queira modificar.

## Licença

MIT
