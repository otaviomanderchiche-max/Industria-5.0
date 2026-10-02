# Prompt para criar o MCP NEXUS no ChatGPT Site

Adicione a este Site um servidor MCP chamado **NEXUS** que controle a API externa do NEXUS hospedada no Render. Toda leitura e escrita deve ir para a API; o Site não é a fonte autoritativa.

Nunca inclua token, senha ou chave privilegiada em HTML, JavaScript público, respostas ou logs. Use conexão server-side.

Mapeamento: `nexus_get_graph` -> GET `/api/v2/graph`; `nexus_search` -> GET `/api/v2/search?q=...`; `nexus_get_node` -> GET `/api/v2/nodes/:id`; `nexus_create_node` -> POST `/api/v2/nodes`; update/move -> PATCH `/api/v2/nodes/:id`; connect -> POST `/api/v2/edges`; `prepare_*` -> POST `/api/v2/destructive/prepare`; `confirm_*` -> POST `/api/v2/destructive/commit`.

As ferramentas `confirm_*` são destrutivas e exigem aprovação explícita. `prepare_*` deve apenas mostrar impacto e `confirmationId`.
