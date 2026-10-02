# NEXUS — instalar e usar o plugin no ChatGPT

## 1. Preparar o acesso no NEXUS

1. Abra o NEXUS no Render e entre em **Acessar modo administrativo**.
2. Clique em **Acesso ChatGPT**.
3. Clique em **Gerar nova credencial**.
4. Copie o valor exibido. Ele aparece uma única vez; o NEXUS guarda somente o hash no repositório privado de dados.
5. Não envie essa credencial em uma conversa. Ela será colada diretamente na configuração de segredo do ChatGPT Site.

Se uma credencial vazar ou deixar de ser necessária, volte a **Acesso ChatGPT** e use **Revogar**.

## 2. Criar o Site que hospeda o MCP

1. No ChatGPT, abra **Work** e crie um Site privado chamado `NEXUS Control` (ou use `@Sites`, quando essa entrada estiver disponível na sua conta).
2. Peça ao ChatGPT/Codex do Site para adicionar um servidor MCP usando `mcp/site-prompt.md` e `mcp/nexus-tools.json`.
3. Nas configurações do Site, como proprietário, configure os segredos server-side:
   - `NEXUS_API_BASE_URL` = URL do NEXUS no Render.
   - `NEXUS_API_TOKEN` = credencial copiada no passo 1.
4. Não coloque o token no código público do Site.
5. Teste primeiro `nexus_get_graph`, `nexus_search` e `nexus_get_activity`.
6. Teste uma criação não destrutiva com `nexus_create_node`.
7. Teste `nexus_prepare_delete_node` e confirme que essa etapa apenas mostra o impacto.
8. Publique o Site. Ao publicar/republicar depois de adicionar as ferramentas MCP, o ChatGPT cria ou atualiza o plugin associado.
9. Revise o card do plugin, instale-o e conclua a conexão/configuração solicitada.

## 3. Usar em um chat novo

Exemplos:

`@NEXUS procure tudo que tenho sobre PID`

`@NEXUS crie um bloco Motor KNSU dentro de MOBFOG`

`@NEXUS conecte Motor KNSU com Mecânica dos Fluidos`

`@NEXUS mostre as últimas alterações do meu NEXUS`

Para apagar:

`@NEXUS apague o nó Teste`

O plugin deve primeiro retornar o impacto. Somente depois de você confirmar explicitamente ele poderá chamar a ferramenta `confirm_*`.

## 4. Permissões recomendadas

Para o plugin NEXUS, use uma configuração que permita leituras sem confirmação e solicite confirmação antes de mudanças. Além disso, as ferramentas `confirm_*` permanecem marcadas como destrutivas.

## 5. Arquivos

O site NEXUS aceita arquivos de até 20 MB. O plugin também possui ferramentas de upload/substituição em base64, mas a capacidade de transportar um anexo grande diretamente de uma conversa depende dos limites e recursos do host do plugin. Quando o anexo não puder ser entregue ao MCP, faça o upload pelo site NEXUS; depois o `@NEXUS` já conseguirá localizar e trabalhar com o arquivo vinculado.

## 6. Atualizar o plugin

Altere o MCP no Site, teste as ferramentas e publique o Site novamente. A republicação atualiza o plugin associado.

## 7. Compartilhamento futuro

A API já preserva os papéis `owner`, `editor` e `viewer`. Nesta primeira versão o token representa o proprietário. Quando o NEXUS for compartilhado, a autenticação pode evoluir para OAuth mantendo o mesmo contrato das ferramentas, sem alterar a persistência GitHub.

## 8. Persistência GitHub do NEXUS

O backend no Render usa um repositório privado separado chamado `NEXUS-DATA`. Configure somente no Render, nunca no frontend:

- `NEXUS_GITHUB_OWNER`
- `NEXUS_GITHUB_REPO=NEXUS-DATA`
- `NEXUS_GITHUB_BRANCH=main`
- `NEXUS_GITHUB_TOKEN` com acesso mínimo de conteúdo ao repositório `NEXUS-DATA`
- `NEXUS_WORKSPACE_ID`
- `NEXUS_OWNER_USER_ID`

`data/state.json` é a fonte autoritativa. `data/public.json` é apenas a projeção pública e não contém sessões, hashes ou confirmações destrutivas.
