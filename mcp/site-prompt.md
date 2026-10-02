# Prompt para criar o MCP NEXUS no ChatGPT Site

Adicione a este Site um servidor MCP chamado **NEXUS**. Ele controla um serviço NEXUS externo hospedado no Render. O MCP não mantém cópia autoritativa: toda leitura e escrita deve consultar a API NEXUS em tempo real.

## Segredos do Site

Crie dois segredos/configurações server-side, administrados somente pelo proprietário do Site:

- `NEXUS_API_BASE_URL`: URL HTTPS do NEXUS no Render, sem barra final.
- `NEXUS_API_TOKEN`: credencial gerada no próprio NEXUS em **Modo administrativo → Acesso ChatGPT**.

Nunca coloque `NEXUS_API_TOKEN`, senha administrativa, credencial GitHub do Render ou outra credencial em HTML, JavaScript do cliente, respostas de ferramenta, logs ou prompts. Todas as chamadas privadas devem adicionar `Authorization: Bearer <NEXUS_API_TOKEN>` no servidor do Site.

Use `mcp/nexus-tools.json` como contrato canônico.

## Mapeamento das ferramentas

- `nexus_get_graph` → `GET /api/v2/graph`
- `nexus_search` → `GET /api/v2/search?q=...`
- `nexus_get_node` → `GET /api/v2/nodes/:id`
- `nexus_get_activity` → `GET /api/v2/activity?limit=...`
- `nexus_list_files` → `GET /api/v2/nodes/:id/files`
- `nexus_create_node` → `POST /api/v2/nodes`; se houver `parentId`, após criar o nó chame `POST /api/v2/edges` com `source=parentId` e `target=<novo id>`.
- `nexus_update_node` → `PATCH /api/v2/nodes/:id`
- `nexus_move_node` → `PATCH /api/v2/nodes/:id` com `{x,y}`
- `nexus_connect_nodes` → `POST /api/v2/edges`
- `nexus_upload_file` → `POST /api/v2/files` com `data=dataBase64` e `nodeIds`.
- `nexus_replace_file` → `PUT /api/v2/files/:id` com `data=dataBase64`.
- `nexus_list_children` → carregue `GET /api/v2/graph` e retorne os nós cujo edge possui `source=nodeId`.
- `nexus_list_connections` → carregue `GET /api/v2/graph` e retorne edges onde `source` ou `target` seja `nodeId`, junto dos nós correspondentes.
- `nexus_prepare_delete_node` → `POST /api/v2/destructive/prepare` com `action=delete_node`.
- `nexus_prepare_delete_file` → mesmo endpoint com `action=delete_file`.
- `nexus_prepare_disconnect_nodes` → mesmo endpoint com `action=disconnect_edge` e `targetId=edgeId`.
- todas as ferramentas `nexus_confirm_*` → `POST /api/v2/destructive/commit` com `confirmationId`.

## Regras de segurança

Ferramentas `prepare_*` nunca removem nada; elas só retornam preview e `confirmationId`. Ferramentas `confirm_*` são destrutivas e só podem ser chamadas depois de uma confirmação explícita do usuário no chat. Não reaproveite `confirmationId`; eles são de uso único e expiram.

Se a API responder `401`, informe que a credencial do NEXUS precisa ser reconectada/atualizada no segredo do Site. Em `403`, informe que a identidade não tem a permissão necessária. Nunca tente contornar autorização.

Para uploads, não invente ou reconstrua bytes que o host não tenha recebido. Se um anexo não puder ser convertido com segurança em `dataBase64`, explique que o upload pelo plugin não está disponível para aquele anexo e oriente o usuário a enviá-lo pelo site NEXUS.
