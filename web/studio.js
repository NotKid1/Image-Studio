(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const view = {image:null, meta:null, zoom:8, cx:.5, cy:.5, drag:null, request:0, running:false, result:null, state:'idle'};
  let api = null, previewTimer = null;
  function toast(message){$('toast').textContent=message;$('toast').hidden=false;clearTimeout(toast.timer);toast.timer=setTimeout(()=>$('toast').hidden=true,5000);}
  function error(e){toast(e.message||String(e));}
  function switchTab(name){
    const roi=name==='roi';$('preprocess').hidden=roi;$('roi').hidden=!roi;
    $('preprocess-statusbar').hidden=roi;
    for(const key of ['preprocess','roi']){const b=$('tab-'+key);b.classList.toggle('active',name===key);b.setAttribute('aria-selected',String(name===key));}
    if(!roi)requestAnimationFrame(render);
  }
  $('tab-preprocess').onclick=()=>switchTab('preprocess');$('tab-roi').onclick=()=>switchTab('roi');
  async function browse(kind){
    if(!api)return toast('正在连接本地处理服务…');
    const result=await api.browse(kind);if(result.error)return toast(result.error);
    if(result.path){$(kind+'-path').value=result.path;if(kind==='object'||kind==='air'){
      $('preview-source').value=kind;await loadPreview(true,1);
    }}
  }
  document.querySelectorAll('[data-browse]').forEach(b=>b.onclick=()=>browse(b.dataset.browse).catch(error));
  $('empty-browse').onclick=()=>browse('object').catch(error);
  for(const key of ['object','air'])$(key+'-path').onchange=()=>{ $('preview-source').value=key;loadPreview(true,1).catch(error); };
  function sourcePath(){const key=$('preview-source').value;return ['object','air'].includes(key)?$(key+'-path').value:(view.result?view.result+'/'+key+'.tif':'');}
  async function loadPreview(auto=false,indexOverride=null){
    if(!api)return;
    const path=sourcePath();if(!path.trim())return;
    const request=++view.request;
    const low=auto||$('window-low').value===''?null:Number($('window-low').value);
    const high=auto||$('window-high').value===''?null:Number($('window-high').value);
    const index=indexOverride===null?Math.max(0,Number($('frame').value)-1):indexOverride;
    $('image-name').textContent='正在读取预览…';
    const data=await api.preview(path,index,low,high);
    if(request!==view.request)return;
    if(data.error)return toast(data.error);
    const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=data.url;});
    if(request!==view.request)return;
    view.image=image;view.meta=data;
    $('empty-preview').hidden=true;$('image-workspace').hidden=false;
    $('image-name').textContent=data.name;$('image-size').textContent=`${data.width} × ${data.height}`;
    $('frame').max=data.depth;$('frame').value=data.index+1;$('frame').disabled=data.depth<=1;
    $('frame-label').textContent=`${data.index+1} / ${data.depth}`;
    $('window-low').value=Number(data.low.toPrecision(7));$('window-high').value=Number(data.high.toPrecision(7));
    requestAnimationFrame(render);
  }
  function setupCanvas(canvas){const rect=canvas.getBoundingClientRect();const dpr=window.devicePixelRatio||1;canvas.width=Math.max(1,Math.round(rect.width*dpr));canvas.height=Math.max(1,Math.round(rect.height*dpr));const ctx=canvas.getContext('2d');ctx.scale(dpr,dpr);ctx.clearRect(0,0,rect.width,rect.height);return {ctx,w:rect.width,h:rect.height};}
  function crop(){const m=view.meta;const w=Math.max(4,m.width/view.zoom),h=Math.min(m.height,w*$('detail').clientHeight/Math.max(1,$('detail').clientWidth));return {x:Math.max(0,Math.min(m.width-w,view.cx*m.width-w/2)),y:Math.max(0,Math.min(m.height-h,view.cy*m.height-h/2)),w,h};}
  function render(){
    if(!view.image||$('preprocess').hidden)return;
    const m=view.meta,c=crop(),over=setupCanvas($('overview')),s=Math.min(over.w/m.width,over.h/m.height),x=(over.w-m.width*s)/2,y=(over.h-m.height*s)/2;
    over.ctx.drawImage(view.image,x,y,m.width*s,m.height*s);over.ctx.strokeStyle='#4b98ff';over.ctx.lineWidth=1.5;over.ctx.strokeRect(x+c.x*s,y+c.y*s,c.w*s,Math.max(2,c.h*s));
    const detail=setupCanvas($('detail')),scale=Math.min(detail.w/c.w,detail.h/c.h),dw=c.w*scale,dh=c.h*scale;
    detail.ctx.imageSmoothingEnabled=false;detail.ctx.drawImage(view.image,c.x,c.y,c.w,c.h,(detail.w-dw)/2,(detail.h-dh)/2,dw,dh);
    $('crop-size').textContent=`${Math.round(c.w)} × ${Math.round(c.h)} px`;$('zoom-label').textContent=`局部 ${view.zoom.toFixed(1)}×`;
  }
  $('overview').onpointerdown=e=>{if(!view.meta)return;const b=e.currentTarget.getBoundingClientRect(),m=view.meta,s=Math.min(b.width/m.width,b.height/m.height);view.cx=Math.max(0,Math.min(1,(e.clientX-b.left-(b.width-m.width*s)/2)/(m.width*s)));view.cy=Math.max(0,Math.min(1,(e.clientY-b.top-(b.height-m.height*s)/2)/(m.height*s)));render();};
  $('detail').onpointerdown=e=>{if(!view.meta)return;e.currentTarget.setPointerCapture(e.pointerId);view.drag={x:e.clientX,y:e.clientY,cx:view.cx,cy:view.cy,crop:crop()};};
  $('detail').onpointermove=e=>{if(!view.drag)return;const d=view.drag,b=e.currentTarget.getBoundingClientRect(),scale=Math.min(b.width/d.crop.w,b.height/d.crop.h);view.cx=Math.max(0,Math.min(1,d.cx-(e.clientX-d.x)/scale/view.meta.width));view.cy=Math.max(0,Math.min(1,d.cy-(e.clientY-d.y)/scale/view.meta.height));render();};
  $('detail').onpointerup=$('detail').onpointercancel=()=>view.drag=null;
  function zoom(factor){view.zoom=Math.max(1,Math.min(128,view.zoom*factor));render();}
  $('zoom-in').onclick=()=>zoom(1.5);$('zoom-out').onclick=()=>zoom(1/1.5);$('fit').onclick=()=>{view.zoom=1;view.cx=view.cy=.5;render();};
  $('actual').onclick=()=>{if(view.meta){view.zoom=Math.max(1,view.meta.width/Math.max(1,$('detail').clientWidth));render();}};
  $('pan-tool').onclick=()=>toast('拖动局部图像可平移；点击上方全图可定位。');
  $('detail').onwheel=e=>{if(!view.meta)return;e.preventDefault();zoom(e.deltaY<0?1.2:1/1.2);};
  new ResizeObserver(()=>render()).observe($('preview-body'));
  $('preview-source').onchange=()=>{ $('frame').value=1;loadPreview(true).catch(error); };
  $('frame').oninput=()=>{clearTimeout(previewTimer);previewTimer=setTimeout(()=>loadPreview(false).catch(error),120);};
  $('window-low').onchange=$('window-high').onchange=()=>loadPreview(false).catch(error);
  $('auto-window').onclick=()=>loadPreview(true).catch(error);
  function setRunning(running){view.running=running;$('config-fields').disabled=running;$('start').disabled=running;$('cancel').hidden=!running;$('job-progress').hidden=!running;}
  $('process-form').onsubmit=async e=>{e.preventDefault();if(!api)return toast('本地处理服务尚未连接。');
    const config={};for(const key of ['object','air','mask','output'])config[key]=$(key+'-path').value.trim();
    config.mode=document.querySelector('input[name=mode]:checked').value;config.export_raw=$('export-raw').checked;
    setRunning(true);view.result=null;$('open-result').hidden=true;
    try{const r=await api.start_job(config);if(r.error){setRunning(false);toast(r.error);}else{view.state='running';$('status').textContent='正在检查输入…';}}catch(e){setRunning(false);error(e);}
  };
  $('cancel').onclick=async()=>{await api.cancel_job();$('status').textContent='正在取消…';};
  $('open-result').onclick=()=>api.open_result();
  async function poll(){if(!api)return;try{const s=await api.status();$('status').textContent=s.message;$('job-progress').value=s.progress;
    if(s.state!==view.state){view.state=s.state;setRunning(s.state==='running');
      if(s.state==='complete'){
        view.result=s.result;$('open-result').hidden=false;
        for(const [value,label] of [['object_corrected','物体插值结果'],['air_mean_corrected','平均空气'],['postlog','postlog']]){
          if(!$('preview-source').querySelector(`option[value="${value}"]`))$('preview-source').add(new Option(label,value));
        }
        $('preview-source').value='postlog';$('frame').value=1;await loadPreview(true);
        if(s.report?.warnings?.length)toast(s.report.warnings.join('；'));
      }else if(s.state==='error'||s.state==='cancelled')toast(s.message);
    }
  }catch(e){console.error(e);}}
  window.addEventListener('pywebviewready',async()=>{api=window.pywebview.api;const d=await api.defaults();$('mask-path').value=d.mask;$('output-path').value=d.output;$('status').textContent='准备就绪';setInterval(poll,400);});
})();
