# NEXUS — GitHub Persistence Design

Data: 2026-10-02
Status: especificação para revisão
Branch de implementação: `nexus-control-dev`

## 1. Objetivo

Substituir completamente o Supabase por um repositório GitHub privado como fonte persistente do NEXUS, mantendo:

- site principal no Render;
- plugin privado `@NEXUS` no ChatGPT;
- modo público somente leitura;
- modo administrativo com senha;
- criação/edição de nós e conexões;
- upload, leitura, substituição e exclusão de arquivos;
- confirmação obrigatória antes de qualquer ação destrutiva;
- histórico/auditoria;
- possibilidade de compartilhamento multiusuário no futuro.

O projeto não pode depender de banco gratuito com data de expiração e não deve exigir Supabase.

## 2. Arquitetura

```text
ChatGPT @NEXUS                Navegador
      |                          |
      +------------+-------------+
                   v
          NEXUS API no Render
                   |
                   v
        GitHub privado NEXUS-DATA
        |- data/state.json
        |- data/public.json
        |- data/activity/*.json
        `- files/<file-id>/<name>
```

O Render é a única camada que conhece a credencial de escrita do GitHub. O navegador e o plugin nunca recebem essa credencial.

## 3. Repositório privado de dados

Será criado um repositório separado e privado chamado `NEXUS-DATA`.

Ele não será misturado ao repositório público `Industria-5.0`.

Estrutura inicial:

```text
NEXUS-DATA/
  data/
    state.json
    public.json
    activity/
      YYYY-MM-DD/<event-id>.json
  files/
    <file-id>/
      metadata.json
      <sanitized-file-name>
  README.md
```

## 4. Fonte de verdade

`data/state.json` é a fonte de verdade da aplicação.

Formato lógico:

```json
{
  "schemaVersion": 1,
  "workspace": {},
  "profiles": [],
  "members": [],
  "nodes": [],
  "edges": [],
  "files": [],
  "nodeFiles": [],
  "apiCredentials": [],
  "browserSessions": [],
  "adminSettings": {},
  "pendingDestructiveActions": []
}
```

Campos secretos nunca armazenam valor bruto. Somente hashes/identificadores revogáveis podem aparecer no estado.

`data/public.json` contém apenas a projeção necessária para modo visitante e é reescrito após cada alteração de conteúdo público.

## 5. Controle de concorrência

Toda leitura do estado retorna o blob SHA atual de `data/state.json`.

Toda escrita usa compare-and-swap:

1. ler `state.json` + SHA;
2. aplicar alteração localmente;
3. escrever usando o SHA conhecido;
4. se GitHub responder conflito/422 por SHA desatualizado, reler estado;
5. reaplicar a operação de domínio uma vez;
6. se ainda houver conflito, retornar `409 Conflict` ao cliente sem perder dados.

Nunca será feita escrita "last writer wins" silenciosa.

## 6. Commits e auditoria

Cada operação mutável gera um commit com mensagem estruturada, por exemplo:

- `nexus: create node Motor KNSU`
- `nexus: update node Robótica`
- `nexus: connect A -> B`
- `nexus: upload file relatorio.pdf`
- `nexus: soft-delete node Teste`

Além do histórico Git, cada escrita cria um evento em `data/activity/` com:

- actor id;
- origem (`web`, `chatgpt`, `system`);
- ação;
- alvo;
- before/after quando aplicável;
- timestamp.

O histórico Git é mecanismo adicional de recuperação, não substitui o `activity` consumido pela API.

## 7. Arquivos

Arquivos ficam no repositório privado sob `files/<file-id>/`.

Limite da primeira versão: **20 MB por arquivo**.

Para cada arquivo:

- metadata no `state.json`;
- `metadata.json` opcional para inspeção humana;
- conteúdo armazenado como blob Git;
- um arquivo pode estar ligado a vários nós por `nodeFiles`.

Ao remover um vínculo nó↔arquivo, o blob permanece enquanto houver outro vínculo ativo.

Exclusão definitiva de blob não ocorre na primeira ação. O fluxo continua sendo prepare/confirm e inicialmente usa soft-delete no estado; limpeza física pode ser uma manutenção posterior.

## 8. Autenticação

### Site

A senha administrativa continua com hash scrypt.

Sessões do navegador ficam persistidas em `state.json` apenas como identificador aleatório + expiração; não armazenam senha.

### ChatGPT

O painel administrativo gera uma credencial aleatória de proprietário.

- o valor bruto aparece apenas uma vez no navegador;
- somente o hash fica no `state.json`;
- a credencial pode ser revogada;
- o valor bruto é configurado como segredo do Site/plugin e nunca é salvo em Git ou enviado para a conversa.

### Credencial GitHub do Render

O Render recebe uma credencial GitHub com escopo mínimo para **somente `NEXUS-DATA`**.

A credencial deve permitir conteúdo do repositório e nada além do necessário.

Ela fica somente em variável secreta do Render.

## 9. API

A API `/api/v2` existente é preservada.

A troca é interna:

```text
SupabaseRepository  ->  GitHubRepository
SupabaseStorage     ->  GitHubBlobStore
```

Rotas públicas e administrativas não mudam de contrato, evitando reescrever frontend e plugin novamente.

## 10. Exclusões

Toda ação destrutiva continua em duas etapas:

1. `POST /api/v2/destructive/prepare`
2. usuário vê preview e confirma explicitamente;
3. `POST /api/v2/destructive/commit`

`confirmation_id` é de uso único, ligado a ator/workspace e expira em 10 minutos.

## 11. Migração do estado atual

Como o serviço antigo já sofreu reinícios do Render enquanto usava `MemoryStore`, a migração deve usar a melhor fonte disponível nesta ordem:

1. aba antiga do navegador ainda aberta sem refresh, se existir;
2. estado público atual recuperável de `/api/graph`;
3. último snapshot/seed conhecido;
4. reconstrução manual dos itens faltantes pelo usuário.

Antes do primeiro corte para GitHub:

- criar snapshot local;
- criar `NEXUS-DATA` privado;
- importar o snapshot;
- comparar contagem de nós/conexões/arquivos;
- testar leitura e escrita em serviço de staging;
- somente então alterar o serviço Render principal.

## 12. Rollback

Rollback deve funcionar em três níveis:

- aplicação: voltar Render para commit anterior;
- dados: restaurar `state.json` a partir de um commit Git anterior;
- plugin: revogar credencial do `@NEXUS` sem afetar o site.

Nenhuma migração apaga histórico antigo imediatamente.

## 13. Limites e compensações

GitHub é adequado para o NEXUS pessoal porque o volume esperado é baixo/moderado e o benefício de versionamento é alto.

Não será tratado como banco de alta frequência. Para evitar abuso e conflitos:

- movimentos de arrastar nó serão debounced e gravados apenas no fim do gesto;
- buscas leem um snapshot em memória com TTL curto;
- alterações agrupáveis fazem um único commit;
- o backend aplica rate limiting para escrita;
- arquivos permanecem limitados a 20 MB na v1.

Se futuramente o NEXUS tiver colaboração intensa, milhares de escritas por hora ou arquivos muito grandes, a camada `GitHubRepository` poderá ser trocada por outro backend sem mudar a API v2.

## 14. Testes de aceitação

- reiniciar Render e confirmar que dados continuam presentes;
- criar nó pelo site e vê-lo em chat novo via `@NEXUS`;
- criar nó pelo `@NEXUS` e vê-lo no site após refresh;
- duas escritas concorrentes não podem perder silenciosamente uma alteração;
- arquivo ligado a dois nós sobrevive à remoção de um vínculo;
- token revogado deixa de autenticar imediatamente;
- nenhuma credencial bruta aparece em Git, logs ou respostas públicas;
- modo visitante não vê hashes, sessões, membros ou ações pendentes;
- exclusão sem confirmação falha;
- restauração de `state.json` a partir de commit anterior recupera conteúdo.

## 15. Critério de conclusão

O trabalho só está concluído quando:

1. `NEXUS-DATA` privado existe;
2. Render usa `GitHubRepository` e `GitHubBlobStore`;
3. dados sobrevivem a restart/redeploy;
4. frontend opera integralmente pela API v2;
5. `@NEXUS` lê e escreve a mesma fonte de verdade;
6. exclusões exigem confirmação explícita;
7. auditoria e histórico Git são gerados;
8. nenhum segredo privilegiado está no frontend, repositório ou conversa;
9. testes automatizados e um teste real end-to-end passam.

## 16. Fora do escopo inicial

- Git LFS;
- banco SQL;
- Supabase;
- Postgres do Render;
- colaboração em tempo real;
- merges manuais de conflitos complexos;
- indexação vetorial;
- arquivos acima de 20 MB;
- publicação pública do plugin.
