import {createViewport,clamp} from './graph.js';
import {createAdminUi} from './admin-ui.js';

let graph={nodes:[],edges:[]};
let view=createViewport();
let admin=false;
let selected=null;
let pointers=new Map();
let gesture=null;
let raf=0;

const MAX_FILE_BYTES=20*1024*1024;
const $=s=>document.querySelector(s);
const world=$('#world');
const edgesSvg=$('#edges');
const viewport=$('#viewport');
const sheet=$('#sheet');
const details=$('#details');

async function api(url,opt={}){
  const headers={...(opt.headers||{})};
  if(opt.body!==undefined&&!headers['content-type'])headers['content-type']='application/json';
  const response=await fetch(url,{credentials:'same-origin',...opt,headers});
  let data=null;
  try{data=await response.json()}catch{}
  if(!response.ok)throw new Error(data?.error||`Erro ${response.status}`);
  return data;
}

function toast(text){
  const el=$('#toast');
  el.textContent=text;
  el.classList.add('on');
  setTimeout(()=>el.classList.remove('on'),1800);
}

function esc(value){
  return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

function node(id){return graph.nodes.find(n=>n.id===id)}
function edgeBetween(a,b){return graph.edges.find(e=>(e.source===a&&e.target===b)||(e.source===b&&e.target===a))}

function schedule(){
  if(!raf)raf=requestAnimationFrame(()=>{raf=0;render()});
}

function render(){
  const transform=`translate(${view.x}px,${view.y}px) scale(${view.scale})`;
  world.style.transform=transform;
  edgesSvg.style.transform=transform;
  world.innerHTML='';
  edgesSvg.innerHTML='';
  for(const edge of graph.edges){
    const a=node(edge.source),b=node(edge.target);
    if(!a||!b)continue;
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    line.setAttribute('x1',a.x);line.setAttribute('y1',a.y);
    line.setAttribute('x2',b.x);line.setAttribute('y2',b.y);
    line.classList.add('edge');
    edgesSvg.append(line);
  }
  for(const n of graph.nodes){
    const el=document.createElement('div');
    el.className=`node ${n.type||''}`;
    el.dataset.id=n.id;
    el.style.left=`${n.x}px`;
    el.style.top=`${n.y}px`;
    el.innerHTML=`<strong>${esc(n.name)}</strong><small>${esc(n.meta||'')}</small>`;
    el.onpointerdown=e=>nodeDown(e,n);
    world.append(el);
  }
  applySearch($('#search').value);
}

async function refreshGraph(){
  graph=await api(admin?'/api/v2/graph':'/api/v2/public/graph');
  render();
  return graph;
}

function nodeDown(event,n){
  event.stopPropagation();
  if(!admin){openNode(n);return}
  event.currentTarget.setPointerCapture(event.pointerId);
  gesture={kind:'node',id:n.id,sx:event.clientX,sy:event.clientY,ox:n.x,oy:n.y,moved:false};
}

viewport.onpointerdown=event=>{
  if(event.target.closest('.node'))return;
  pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  viewport.setPointerCapture(event.pointerId);
  if(pointers.size===1){
    gesture={kind:'pan',sx:event.clientX,sy:event.clientY,ox:view.x,oy:view.y};
  }else if(pointers.size===2){
    const [a,b]=[...pointers.values()];
    gesture={kind:'pinch',dist:Math.hypot(a.x-b.x,a.y-b.y),scale:view.scale};
  }
};

viewport.onpointermove=event=>{
  if(gesture?.kind==='node'){
    const n=node(gesture.id);if(!n)return;
    n.x=gesture.ox+(event.clientX-gesture.sx)/view.scale;
    n.y=gesture.oy+(event.clientY-gesture.sy)/view.scale;
    gesture.moved=true;schedule();return;
  }
  if(pointers.has(event.pointerId))pointers.set(event.pointerId,{x:event.clientX,y:event.clientY});
  if(gesture?.kind==='pan'&&pointers.size===1){
    view.x=gesture.ox+event.clientX-gesture.sx;
    view.y=gesture.oy+event.clientY-gesture.sy;
    schedule();
  }else if(gesture?.kind==='pinch'&&pointers.size===2){
    const [a,b]=[...pointers.values()];
    view.scale=clamp(gesture.scale*Math.hypot(a.x-b.x,a.y-b.y)/gesture.dist,.35,2.2);
    schedule();
  }
};

const pointerUp=async event=>{
  pointers.delete(event.pointerId);
  const finished=gesture;
  gesture=null;
  if(finished?.kind==='node'){
    const n=node(finished.id);
    if(!n)return;
    if(!finished.moved){openNode(n);return}
    try{
      await api(`/api/v2/nodes/${encodeURIComponent(n.id)}`,{method:'PATCH',body:JSON.stringify({x:n.x,y:n.y})});
    }catch(error){
      n.x=finished.ox;n.y=finished.oy;render();toast(error.message);
    }
  }
};
viewport.onpointerup=pointerUp;
viewport.onpointercancel=pointerUp;
viewport.onwheel=event=>{event.preventDefault();view.scale=clamp(view.scale*(event.deltaY>0?.9:1.1),.35,2.2);schedule()};

async function listNodeFiles(n){
  const base=admin?'/api/v2':'/api/v2/public';
  return api(`${base}/nodes/${encodeURIComponent(n.id)}/files`);
}

function fileContentUrl(fileId){
  const base=admin?'/api/v2':'/api/v2/public';
  return `${base}/files/${encodeURIComponent(fileId)}/content`;
}

function filesHtml(files){
  if(!files.length)return '<p><small>Nenhum arquivo ligado a este bloco.</small></p>';
  return `<div>${files.map(f=>`<div class="actions" data-file="${esc(f.id)}"><a href="${fileContentUrl(f.id)}" target="_blank" rel="noopener"><button>Visualizar / baixar: ${esc(f.name)}</button></a>${admin?'<button class="replace-file">Substituir arquivo</button><button class="danger delete-file">Excluir</button>':''}</div>`).join('')}</div>`;
}

async function openNode(n){
  selected=n.id;
  sheet.classList.add('open');
  details.innerHTML=`<h2>${esc(n.name)}</h2><p>${esc(n.note||'Sem descrição.')}</p><p><small>Carregando arquivos…</small></p>${admin?editorHtml(n):''}`;
  if(admin)bindEditor(n);
  try{
    const files=await listNodeFiles(n);
    const current=node(n.id)||n;
    details.innerHTML=`<h2>${esc(current.name)}</h2><p>${esc(current.note||'Sem descrição.')}</p>${filesHtml(files)}${admin?editorHtml(current):''}`;
    if(admin){bindEditor(current);bindFileActions(current,files)}
  }catch(error){toast(error.message)}
}

function editorHtml(n){
  return `<div><input class="field" id="name" value="${esc(n.name)}"><input class="field" id="meta" value="${esc(n.meta||'')}"><textarea class="field" id="note">${esc(n.note||'')}</textarea><div class="actions"><button id="save">Salvar</button><button id="sub">Adicionar subbloco</button><button id="link">Gerenciar conexões</button>${n.type==='root'?'':'<button class="danger" id="del">Excluir</button>'}<button id="pass">Alterar senha</button></div></div>`;
}

function bindEditor(n){
  if(!admin)return;
  $('#save')?.addEventListener('click',async()=>{
    try{
      const patch={name:$('#name').value.trim()||n.name,meta:$('#meta').value.trim(),note:$('#note').value.trim()};
      const updated=await api(`/api/v2/nodes/${encodeURIComponent(n.id)}`,{method:'PATCH',body:JSON.stringify(patch)});
      Object.assign(n,updated);render();await openNode(n);toast('Salvo');
    }catch(error){toast(error.message)}
  });
  $('#sub')?.addEventListener('click',async()=>{
    const name=prompt('Nome do subbloco');if(!name)return;
    try{
      const child=await api('/api/v2/nodes',{method:'POST',body:JSON.stringify({name,type:'project',x:n.x+160,y:n.y+120,meta:n.name,note:''})});
      await api('/api/v2/edges',{method:'POST',body:JSON.stringify({source:n.id,target:child.id})});
      await refreshGraph();toast('Subbloco criado');
    }catch(error){toast(error.message)}
  });
  $('#link')?.addEventListener('click',()=>adminUi.connectionModal(n));
  $('#del')?.addEventListener('click',()=>adminUi.deleteNode(n));
  $('#pass')?.addEventListener('click',adminUi.passwordModal);
}

function bindFileActions(n,files){
  for(const row of details.querySelectorAll('[data-file]')){
    const file=files.find(f=>f.id===row.dataset.file);if(!file)continue;
    row.querySelector('.replace-file')?.addEventListener('click',()=>replaceFile(n,file));
    row.querySelector('.delete-file')?.addEventListener('click',()=>adminUi.deleteFile(n,file));
  }
}

function readFileBase64(file){
  return new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(String(r.result).split(',')[1]);r.onerror=reject;r.readAsDataURL(file)});
}

async function replaceFile(n,file){
  const input=document.createElement('input');input.type='file';
  input.onchange=async()=>{
    const picked=input.files?.[0];if(!picked)return;
    if(picked.size>MAX_FILE_BYTES)return toast('Limite de 20 MB');
    try{
      const data=await readFileBase64(picked);
      await api(`/api/v2/files/${encodeURIComponent(file.id)}`,{method:'PUT',body:JSON.stringify({name:picked.name,mime:picked.type||'application/octet-stream',data})});
      await openNode(n);toast('Arquivo substituído');
    }catch(error){toast(error.message)}
  };
  input.click();
}

let adminUi;

adminUi=createAdminUi({api,$,esc,toast,getGraph:()=>graph,edgeBetween,refreshGraph,sheet,openNode,getAdmin:()=>admin,setAdmin:value=>{admin=value}});
$('#chatgptAccess').onclick=()=>adminUi.chatgptAccessModal();
$('#adminBtn').onclick=()=>adminUi.toggleAdmin();

$('#close').onclick=()=>sheet.classList.remove('open');

$('#addNode').onclick=async()=>{
  const name=prompt('Nome do novo nó');if(!name)return;
  try{await api('/api/v2/nodes',{method:'POST',body:JSON.stringify({name,type:'project',x:0,y:0,meta:'',note:''})});await refreshGraph();toast('Nó criado')}catch(error){toast(error.message)}
};

$('#upload').onclick=()=>$('#file').click();
$('#file').onchange=async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  if(file.size>MAX_FILE_BYTES)return toast('Limite de 20 MB');
  try{
    const fileNode=await api('/api/v2/nodes',{method:'POST',body:JSON.stringify({name:file.name,type:'file',x:100,y:100,meta:'Arquivo',note:''})});
    const data=await readFileBase64(file);
    await api('/api/v2/files',{method:'POST',body:JSON.stringify({name:file.name,mime:file.type||'application/octet-stream',data,nodeIds:[fileNode.id]})});
    await refreshGraph();toast('Arquivo enviado');
  }catch(error){toast(error.message)}
};

function applySearch(value){
  const q=String(value||'').toLowerCase();
  document.querySelectorAll('.node').forEach(el=>{const n=node(el.dataset.id);el.style.opacity=!q||n?.name?.toLowerCase().includes(q)?'1':'.18'});
}
$('#search').oninput=event=>applySearch(event.target.value);

(async()=>{
  await adminUi.status();
  await refreshGraph();
})().catch(error=>toast(error.message));
