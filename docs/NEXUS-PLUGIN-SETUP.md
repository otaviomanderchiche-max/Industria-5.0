# NEXUS — instalação do plugin no ChatGPT

1. Com a API `/api/v2` persistente validada, crie um Site privado `NEXUS Control`.
2. Peça ao ChatGPT/Codex do Site para adicionar um MCP usando `mcp/site-prompt.md` e `mcp/nexus-tools.json`.
3. Configure a autenticação server-side pelo fluxo de conexão/segredo do Site; nunca cole a credencial em código público.
4. Teste leitura, busca, criação e `prepare_delete` (que não pode apagar nada).
5. Publique o Site para criar/atualizar o plugin, selecione **Install** e conclua **Connect**.
6. Em um chat novo use `@NEXUS procure tudo que tenho sobre PID` ou `@NEXUS crie um bloco Motor KNSU dentro de MOBFOG`.
7. Exclusões sempre mostram impacto primeiro; só uma confirmação explícita autoriza `confirm_*`.

Em contas pessoais/Plus, plugins hospedados em Sites atualmente não podem ser compartilhados diretamente com outros usuários pessoais por convite/link; Business/Enterprise suportam compartilhamento no workspace conforme permissões.
