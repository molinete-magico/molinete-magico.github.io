# Conteúdo

Documentação sobre a estrutura e organização do conteúdo.

## Estrutura

```
content/
└── posts/   → artigos, tutoriais, reflexões (gerenciados pelo Writer)
```

## Posts

### Arquivo simples

Para posts sem imagens:

```
content/posts/2026-09-20-fedora.md
```

### Pasta com imagens

Para posts com imagens:

```
content/posts/2026-09-17-comecando/
├── index.md
├── banner.png
└── diagrama.png
```

### Frontmatter

```yaml
---
title: "Título do post"
description: "Descrição curta para SEO e cards"
pubDate: 2026-09-17
tags:
  - pessoal
  - programação
draft: false
---
```

| Campo | Tipo | Obrigatório | Descrição |
|-------|------|-------------|-----------|
| `title` | string | Sim | Título do post |
| `description` | string | Sim | Descrição curta |
| `pubDate` | date | Sim | Data de publicação |
| `tags` | array | Não | Tags para categorização |
| `draft` | boolean | Não | Se `true`, não é publicado |

## Tags

Tags são usadas para agrupar conteúdo relacionado.

- Use letras minúsculas
- Use hífen para múltiplas palavras: `ci-cd`
- Seja consistente

Exemplos de tags:

```
pessoal, programação, linux, git, astro, projeto, faculdade, pesquisa
```

## Drafts

Posts com `draft: true` **não aparecem** no site público.

O Writer mostra claramente se um documento é rascunho ou publicado.

## Imagens

### Regras

1. Imagens ficam na mesma pasta do post
2. Use formatos modernos quando possível (WebP, PNG)
3. Nomes descritivos em minúsculas: `banner.png`, `diagrama-arquitetura.png`
4. Para uma imagem de capa automática, use o nome `banner.webp`, `banner.png`, `banner.jpg` ou `banner.jpeg`
5. O banner é detectado automaticamente e aparece no topo do post; não é necessário referenciá-lo no Markdown
6. Para imagens comuns do conteúdo, referencie com caminho relativo: `![alt](imagem.png)`

### Exemplo

```
content/posts/2026-09-17-comecando/
├── index.md           → post principal
├── banner.png         → capa automática
└── screenshot.png     → imagem no conteúdo
```

O arquivo `banner.png` é reconhecido automaticamente como capa e aparece no topo do post. Ele não precisa estar escrito no `index.md`.

As demais imagens continuam sendo inseridas normalmente no Markdown:

```markdown
# Título

...

![Screenshot](screenshot.png)
```

## Portabilidade

Todo o conteúdo é Markdown puro com frontmatter YAML.

Isso significa:

- Pode ser migrado para qualquer gerador de sites
- Pode ser lido em qualquer editor
- Pode ser versionado com Git
- Não depende de nenhuma plataforma
