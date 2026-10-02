export function createAdminUi({api,$,esc,toast,getGraph,edgeBetween,refreshGraph,sheet,openNode,getAdmin,setAdmin}){
  function destructivePreviewText(prepared){
    const p=prepared.preview||{};
    if(p.action==='delete_node')return `Excluir “${p.node?.name||'este nó'}”? ${p.edges?.length||0} conexão(ões) e ${p.fileLinks?.length||0} vínculo(s) de arquivo serão removidos.`;
    if(p.action==='delete_file')return `Excluir o arquivo “${p.file?.name||'selecionado'}”? Ele será desvinculado de ${p.fileLinks?.length||0} bloco(s).`;
    if(p.action==='disconnect_edge')return 'Remover esta conexão entre os blocos?';
    return 'Confirmar esta ação destrutiva?';
  }
  async function confirmDestructive(action,targetId){
    const prepared=await api('/api/v2/destructive/prepare',{method:'POST',body:JSON.stringify({action,targetId})});
    if(!confirm(destructivePreviewText(prepared)))return false;
    await api('/api/v2/destructive/commit',{method:'POST',body:JSON.stringify({confirmationId:prepared.confirmationId})});
    return true;
  }
  async function deleteNode(n){
    try{if(!await confirmDestructive('delete_node',n.id))return;sheet.classList.remove('open');await refreshGraph();toast('Nó excluído')}catch(error){toast(error.message)}
  }
  async function deleteFile(n,file){
    try{if(!await confirmDestructive('delete_file',file.id))return;await openNode(n);toast('Arquivo excluído')}catch(error){toast(error.message)}
  }
  function connectionModal(n){
    const others=getGraph().nodes.filter(x=>x.id!==n.id);
    $('#modal').innerHTML=`<form><h2>Conexões de ${esc(n.name)}</h2>${others.map(x=>`<label style="display:block;padding:8px"><input type="checkbox" data-id="${esc(x.id)}" ${edgeBetween(n.id,x.id)?'checked':''}> ${esc(x.name)}</label>`).join('')}<button>Salvar conexões</button></form>`;
    $('#modal form').onsubmit=async event=>{
      event.preventDefault();
      try{
        const wanted=new Set([...$('#modal').querySelectorAll('input:checked')].map(c=>c.dataset.id));
        const current=new Map(others.map(x=>[x.id,edgeBetween(n.id,x.id)]).filter(([,edge])=>edge));
        for(const other of others)if(wanted.has(other.id)&&!current.has(other.id))await api('/api/v2/edges',{method:'POST',body:JSON.stringify({source:n.id,target:other.id})});
        for(const [otherId,edge] of current)if(!wanted.has(otherId)){const removed=await confirmDestructive('disconnect_edge',edge.id);if(!removed)wanted.add(otherId)}
        $('#modal').innerHTML='';await refreshGraph();toast('Conexões atualizadas');
      }catch(error){toast(error.message)}
    };
  }
  function authModal(setup=false){
    $('#modal').innerHTML=`<form><h2>${setup?'Criar administrador':'Acessar modo administrativo'}</h2><p>${setup?'Escolha uma senha com pelo menos 12 caracteres.':'Digite sua senha administrativa.'}</p><input class="field" id="pw" type="password" minlength="12" required autocomplete="${setup?'new-password':'current-password'}"><button>${setup?'Criar acesso':'Entrar'}</button></form>`;
    $('#modal form').onsubmit=async event=>{event.preventDefault();try{await api(setup?'/api/auth/setup':'/api/auth/login',{method:'POST',body:JSON.stringify({password:$('#pw').value})});$('#modal').innerHTML='';await status();await refreshGraph();toast('Modo administrativo ativado')}catch(error){toast(error.message)}};
  }
  function passwordModal(){
    $('#modal').innerHTML='<form><h2>Alterar senha</h2><input class="field" id="pw" type="password" minlength="12" required autocomplete="new-password"><button>Salvar nova senha</button></form>';
    $('#modal form').onsubmit=async event=>{event.preventDefault();try{await api('/api/auth/password',{method:'PUT',body:JSON.stringify({password:$('#pw').value})});$('#modal').innerHTML='';toast('Senha alterada')}catch(error){toast(error.message)}};
  }
  async function status(){
    const s=await api('/api/auth/status');setAdmin(!!s.admin);
    $('#mode').textContent=getAdmin()?'Modo administrativo':'Visualização';
    $('#adminBtn').textContent=getAdmin()?'Sair do modo administrativo':'Acessar modo administrativo';
    $('#addNode').hidden=!getAdmin();$('#upload').hidden=!getAdmin();$('#chatgptAccess').hidden=!getAdmin();
    return s;
  }
  async function chatgptAccessModal(){
    try{
      const credentials=await api('/api/auth/plugin-credentials');
      $('#modal').innerHTML=`<form><h2>Acesso ChatGPT</h2><p>As credenciais abaixo podem controlar o NEXUS. Gere uma nova apenas quando for conectar um Site/plugin.</p>${credentials.length?credentials.map(c=>`<div class="actions"><span>${esc(c.label||'ChatGPT NEXUS')}</span><button type="button" class="danger revoke-credential" data-id="${esc(c.id)}">Revogar</button></div>`).join(''):'<p><small>Nenhuma credencial ativa.</small></p>'}<input class="field" id="credentialLabel" placeholder="Nome, ex.: ChatGPT principal"><button type="button" id="generateCredential">Gerar nova credencial</button><button type="button" id="closeCredentialModal">Fechar</button></form>`;
      $('#closeCredentialModal').onclick=()=>$('#modal').innerHTML='';
      for(const button of $('#modal').querySelectorAll('.revoke-credential'))button.onclick=async()=>{if(!confirm('Revogar este acesso do ChatGPT? Ele deixará de funcionar imediatamente.'))return;try{await api(`/api/auth/plugin-credentials/${encodeURIComponent(button.dataset.id)}/revoke`,{method:'POST',body:'{}'});await chatgptAccessModal();toast('Acesso revogado')}catch(error){toast(error.message)}};
      $('#generateCredential').onclick=async()=>{try{const label=$('#credentialLabel').value.trim()||'ChatGPT NEXUS';const created=await api('/api/auth/plugin-token',{method:'POST',body:JSON.stringify({label})});$('#modal').innerHTML=`<form><h2>Credencial criada</h2><p>Copie este valor agora. Depois que fechar esta janela, o NEXUS não mostrará esta credencial novamente.</p><textarea class="field" id="generatedToken" readonly>${esc(created.token)}</textarea><button type="button" id="copyGeneratedToken">Copiar credencial</button><button type="button" id="doneGeneratedToken">Concluído</button></form>`;$('#copyGeneratedToken').onclick=async()=>{try{await navigator.clipboard.writeText($('#generatedToken').value);toast('Credencial copiada')}catch{toast('Selecione e copie a credencial manualmente')}};$('#doneGeneratedToken').onclick=()=>{$('#generatedToken').value='';$('#modal').innerHTML=''}}catch(error){toast(error.message)}};
    }catch(error){toast(error.message)}
  }
  async function toggleAdmin(){
    try{const s=await status();if(getAdmin()){await api('/api/auth/logout',{method:'POST'});await status();sheet.classList.remove('open');await refreshGraph();toast('Modo administrativo encerrado')}else authModal(!s.configured)}catch(error){toast(error.message)}
  }
  return {confirmDestructive,deleteNode,deleteFile,connectionModal,passwordModal,status,chatgptAccessModal,toggleAdmin};
}
