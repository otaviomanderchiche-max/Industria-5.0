# NEXUS v2 — Controle por ChatGPT / Plugin privado

Data: 2026-10-02
Status: especificação para revisão
Branch: `nexus-v2`

## 1. Objetivo

Permitir que qualquer conversa nova da conta do usuário no ChatGPT possa ler e alterar o NEXUS ao vivo, usando um plugin privado chamado **NEXUS**, sem depender desta conversa específica e sem exigir que o site esteja aberto.

O NEXUS continua hospedado no Render como interface principal. O plugin atua como uma porta de controle adicional sobre a mesma fonte de dados persistente.

Requisitos já aprovados:

- uso somente pelo proprietário no início;
- arquitetura preparada para compartilhamento futuro;
- NEXUS permanece no Render;
- exclusões sempre exigem confirmação explícita;
- dados não podem depender da memória efêmera da instância Render;
- alterações feitas pelo site e pelo ChatGPT devem aparecer uma para a outra imediatamente após nova leitura/atualização;
- segredos nunca ficam em JavaScript público, GitHub ou mensagens do ChatGPT.

## 2. Estado atual e risco de migração

O backend atual cai em `MemoryStore` quando `NEXUS_DATA_FILE` não está definido. Portanto o estado vivo atual pode ser perdido em restart, sleep ou novo deploy.

Antes de qualquer deploy desta evolução será obrigatório:

1. exportar `GET /api/graph` do serviço vivo atual;
2. identificar referências de arquivos existentes no grafo;
3. baixar, quando possível, todos os arquivos atualmente referenciados;
4. salvar um snapshot de migração versionado fora da instância viva;
5. validar a contagem de nós, conexões e arquivos antes de substituir o armazenamento.

Nenhum deploy de migração poderá ocorrer sem esse snapshot.

## 3. Arquitetura escolhida

```text
ChatGPT (qualquer chat)
        |
        | @NEXUS
        v
Plugin privado NEXUS
        |
        v
MCP hospedado no ChatGPT Sites
        |
        | HTTPS autenticado
        v
NEXUS API no Render
        |
        v
Supabase
  |- Postgres
  |- Auth
  `- Storage
        |
        v
NEXUS web no Render
```

### Motivo da escolha

O ChatGPT permite hospedar ferramentas MCP em ChatGPT Sites e usá-las por meio de um plugin; plugins hospedados em Sites podem ser criados em contas Plus. O plugin pode então ser mencionado com `@NEXUS` em novas conversas.

O Render continua responsável pela aplicação web existente e por uma API de domínio do NEXUS. O Supabase passa a ser a fonte única de verdade para dados e arquivos.

## 4. Estratégia de autenticação

### Fase 1 — proprietário único

A primeira versão terá somente o proprietário.

- O plugin se conecta ao NEXUS com uma credencial individual do proprietário.
- A credencial é armazenada somente em camada server-side/conexão segura, nunca no frontend e nunca no repositório.
- No banco, a credencial é armazenada apenas como hash/identificador revogável.
- Cada chamada é resolvida para `user_id`, `workspace_id` e papel `owner`.

### Fase 2 — compartilhamento futuro

A API e o banco já serão multiusuário desde o início. Quando o produto for compartilhado, a autenticação migra para Supabase Auth/OAuth 2.1 sem alterar o contrato das ferramentas.

Papéis previstos:

- `owner`: controle total;
- `editor`: leitura e escrita, sem administração de membros;
- `viewer`: somente leitura.

O Supabase suporta OAuth 2.1 e autenticação de agentes/MCP, permitindo posteriormente emitir tokens por usuário e aplicar RLS por identidade.

## 5. Modelo de dados

### `workspaces`

- `id uuid pk`
- `name text`
- `owner_user_id uuid`
- `created_at timestamptz`
- `updated_at timestamptz`

### `profiles`

- `id uuid pk` — associado ao usuário autenticado
- `display_name text`
- `created_at timestamptz`

### `workspace_members`

- `workspace_id uuid`
- `user_id uuid`
- `role text` (`owner`, `editor`, `viewer`)
- chave única `(workspace_id, user_id)`

### `nodes`

- `id uuid pk`
- `workspace_id uuid`
- `legacy_id text null`
- `name text`
- `type text`
- `meta text`
- `note text`
- `x double precision`
- `y double precision`
- `created_by uuid`
- `created_at timestamptz`
- `updated_at timestamptz`
- `deleted_at timestamptz null`

### `edges`

- `id uuid pk`
- `workspace_id uuid`
- `source_node_id uuid`
- `target_node_id uuid`
- `edge_type text default 'related'`
- `created_by uuid`
- `created_at timestamptz`
- `deleted_at timestamptz null`

### `files`

- `id uuid pk`
- `workspace_id uuid`
- `node_id uuid null`
- `name text`
- `storage_path text`
- `mime_type text`
- `size_bytes bigint`
- `sha256 text null`
- `created_by uuid`
- `created_at timestamptz`
- `updated_at timestamptz`
- `deleted_at timestamptz null`

### `activity_log`

- `id uuid pk`
- `workspace_id uuid`
- `actor_user_id uuid`
- `source text` (`web`, `chatgpt`, `system`)
- `action text`
- `target_type text`
- `target_id uuid null`
- `before_data jsonb null`
- `after_data jsonb null`
- `created_at timestamptz`

### `api_credentials` — fase 1

- `id uuid pk`
- `user_id uuid`
- `workspace_id uuid`
- `token_hash text`
- `label text`
- `last_used_at timestamptz null`
- `revoked_at timestamptz null`
- `created_at timestamptz`

### `pending_destructive_actions`

- `id uuid pk`
- `workspace_id uuid`
- `actor_user_id uuid`
- `action text`
- `payload jsonb`
- `preview jsonb`
- `expires_at timestamptz`
- `consumed_at timestamptz null`

## 6. Segurança e RLS

Todas as tabelas expostas terão RLS ativado.

Políticas devem validar participação no workspace, não apenas `TO authenticated`.

Regras:

- `viewer`: SELECT no workspace autorizado;
- `editor`: SELECT/INSERT/UPDATE no workspace autorizado;
- `owner`: mesmas permissões + operações administrativas;
- DELETE físico não será usado para conteúdo normal; exclusões usam `deleted_at` primeiro;
- Storage terá políticas equivalentes ao workspace;
- `service_role`/secret key nunca será exposta no browser;
- funções privilegiadas, se necessárias, ficam fora de schema público e terão validação explícita de identidade;
- nenhuma autorização dependerá de `user_metadata` editável pelo usuário;
- logs nunca armazenam tokens completos, senhas ou conteúdo secreto.

## 7. API de domínio do NEXUS no Render

A API existente será reorganizada para operar sobre o repositório persistente.

Endpoints de leitura:

- `GET /api/v2/me`
- `GET /api/v2/workspaces/:workspaceId/graph`
- `GET /api/v2/nodes/:id`
- `GET /api/v2/search?q=`
- `GET /api/v2/nodes/:id/files`
- `GET /api/v2/activity`

Endpoints de escrita:

- `POST /api/v2/nodes`
- `PATCH /api/v2/nodes/:id`
- `POST /api/v2/edges`
- `PATCH /api/v2/files/:id`
- `POST /api/v2/files`

Exclusões usam duas etapas:

1. `POST /api/v2/destructive/prepare`
2. `POST /api/v2/destructive/commit`

A etapa `prepare` retorna exatamente o que será removido e um `confirmation_id` curto, de uso único e com expiração. A etapa `commit` só funciona após confirmação explícita no ChatGPT.

## 8. Ferramentas do plugin `@NEXUS`

Ferramentas de leitura:

- `nexus_get_graph`
- `nexus_search`
- `nexus_get_node`
- `nexus_list_children`
- `nexus_list_connections`
- `nexus_list_files`
- `nexus_get_activity`

Ferramentas de escrita não destrutiva:

- `nexus_create_node`
- `nexus_update_node`
- `nexus_move_node`
- `nexus_connect_nodes`
- `nexus_update_connection`
- `nexus_upload_file`
- `nexus_replace_file`

Ferramentas destrutivas:

- `nexus_prepare_delete_node`
- `nexus_confirm_delete_node`
- `nexus_prepare_delete_file`
- `nexus_confirm_delete_file`
- `nexus_prepare_disconnect_nodes`
- `nexus_confirm_disconnect_nodes`

As ferramentas `confirm_*` nunca serão chamadas sem uma confirmação explícita do usuário após o preview.

## 9. Comportamento esperado no ChatGPT

Exemplos:

- `@NEXUS procure tudo que tenho sobre PID`
- `@NEXUS crie Motor KNSU dentro de Foguete > MOBFOG`
- `@NEXUS conecte Motor KNSU com Mecânica dos Fluidos`
- `@NEXUS coloque este arquivo no projeto do atacante`
- `@NEXUS apague o nó Teste`

No último caso, o plugin primeiro responde com o impacto da remoção, por exemplo:

- nó: `Teste`;
- 3 conexões serão removidas;
- 1 arquivo ficará órfão ou será movido para lixeira;

Somente depois de `Confirmo` a segunda ferramenta destrutiva é chamada.

## 10. Sincronização site ↔ ChatGPT

Não haverá cache autoritativo no Render.

- o site lê do Supabase/API;
- o plugin lê da mesma API;
- qualquer escrita confirma no banco antes de responder sucesso;
- o frontend faz nova leitura após alterações;
- atualização em tempo real via Supabase Realtime é opcional para uma fase posterior; v1 pode usar refresh/re-fetch sem comprometer consistência.

## 11. Migração dos dados atuais

Ordem obrigatória:

1. congelar deploys do NEXUS atual;
2. capturar snapshot vivo do grafo;
3. capturar arquivos referenciados quando acessíveis;
4. criar Supabase;
5. criar schema + RLS + Storage;
6. criar workspace inicial;
7. importar nós mantendo `legacy_id`;
8. converter edges para UUIDs;
9. importar arquivos;
10. comparar contagens e amostras;
11. atualizar backend para Supabase;
12. validar site em leitura;
13. validar escrita manual;
14. só então habilitar plugin/MCP.

## 12. Testes mínimos de aceitação

### Persistência

- criar nó pelo site;
- reiniciar/redeployar Render;
- nó continua existindo.

### Sincronização

- criar nó pelo ChatGPT;
- abrir/atualizar NEXUS;
- nó aparece;
- editar no site;
- nova consulta do ChatGPT retorna edição atualizada.

### Segurança

- chamada sem credencial: 401;
- credencial revogada: 401;
- viewer tentando escrever: 403;
- usuário A não acessa workspace B;
- token nunca aparece nos logs;
- Storage bloqueia arquivo fora do workspace autorizado.

### Exclusão

- `prepare` não exclui nada;
- `commit` sem `confirmation_id`: falha;
- id expirado: falha;
- id reutilizado: falha;
- confirmação válida: soft-delete + activity log.

### Plugin

- plugin instalado aparece em Plugins > Personal;
- `@NEXUS` funciona em um chat novo;
- busca funciona;
- criação funciona;
- exclusão exige confirmação;
- alteração pode ser confirmada visualmente no NEXUS.

## 13. Implantação e rollback

A migração será feita sem remover o serviço anterior até a validação final.

Rollback deve permitir:

- voltar o Render ao commit anterior;
- restaurar o snapshot inicial;
- manter o banco Supabase intacto para inspeção;
- desativar/revogar a credencial do plugin sem afetar o site.

## 14. Fora do escopo da primeira versão

- compartilhamento entre contas pessoais do ChatGPT;
- colaboração simultânea avançada;
- versionamento Git de cada alteração do conteúdo;
- indexação semântica/vector search;
- agentes autônomos em background;
- automações recorrentes;
- edição colaborativa em tempo real;
- publicação pública do plugin.

A estrutura deixa essas extensões possíveis sem alterar o modelo central.

## 15. Dependências e pré-requisitos

- criar/selecionar uma organização e projeto Supabase;
- manter NEXUS no Render;
- ChatGPT Sites disponível na conta;
- Plugin Creator/Plugins disponível na conta;
- escolher a credencial inicial do proprietário via fluxo seguro — nunca pela conversa;
- configurar segredos apenas em ambientes server-side.

## 16. Referências verificadas em 2026-10-02

- OpenAI — Plugins in ChatGPT: https://help.openai.com/en/articles/20001256-plugins-in-chatgpt
- OpenAI — Hosting a plugin with ChatGPT Sites: https://help.openai.com/en/articles/20001547-hosting-a-plugin-with-chatgpt-sites
- OpenAI — Creating and using ChatGPT Sites: https://help.openai.com/en/articles/20001339-creating-and-using-chatgpt-sites
- Supabase — OAuth 2.1 Server: https://supabase.com/docs/guides/auth/oauth-server
- Supabase — MCP Authentication: https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication
- Supabase — Deploy MCP servers: https://supabase.com/docs/guides/ai-tools/byo-mcp

## 17. Critério de conclusão

O projeto só será considerado concluído quando:

1. o NEXUS sobreviver a restart/redeploy sem perder dados;
2. o estado atual tiver sido migrado e conferido;
3. site e ChatGPT operarem sobre a mesma fonte de verdade;
4. `@NEXUS` funcionar em uma conversa nova;
5. leitura e escrita não destrutiva funcionarem;
6. toda exclusão exigir confirmação explícita;
7. auditoria registrar alterações feitas pelo site e pelo ChatGPT;
8. nenhum segredo privilegiado estiver no frontend ou repositório.
