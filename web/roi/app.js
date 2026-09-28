(() => {
  'use strict';
  const $ = (id) => document.getElementById(id);
  const canvas = $('figureCanvas');
  const ctx = canvas.getContext('2d');
  const state = {
    rows: 4, cols: 5, width: 1600, height: 1200,
    images: [], volumes: [], activeSlices: [], sliceWindows: {}, selected: 0, tool: 'select', dragging: null,
    rowLabels: ['切片1','切片2','切片3','切片4'],
    colLabels: ['原图','Neighbor2Neighbor','Noise2Void','Noise2Sim','本方法'],
    rois: [], colRois: [], cellRois: [], globalRoi: {x:.14,y:.26,w:.18,h:.18}, arrows: [],
    bg: '#000000', roiColor: '#d7dc35', roiStroke: 2, insetScale: .30,
    arrowColor: '#ff2d25', arrowSize: 18, textColor: '#f4f5f7', fontSize: 24,
    showNumbers: true, showConnectors: true, showArrow: true, syncRow: true, syncCol: false, methodsAsRows: false,
    verticalRows: true, gap: 16, history: [], future: []
  };
  const defaults = () => {
    state.rois = Array.from({length: state.rows}, (_,i) => state.rois[i] || {x:.14,y:.26,w:.18,h:.18});
    state.colRois = Array.from({length: state.cols}, (_,i) => state.colRois[i] || {x:.14,y:.26,w:.18,h:.18});
    state.cellRois = Array.from({length: state.rows*state.cols}, (_,i) => state.cellRois[i] || null);
    state.arrows = Array.from({length: state.rows}, (_,i) => state.arrows[i] || {x:.68,y:.63});
  };
  defaults();

  function snapshot() {
    return JSON.stringify({rows:state.rows, cols:state.cols, selected:state.selected, rowLabels:state.rowLabels, colLabels:state.colLabels, rois:state.rois, colRois:state.colRois, cellRois:state.cellRois, globalRoi:state.globalRoi, sliceWindows:state.sliceWindows, arrows:state.arrows, bg:state.bg, roiColor:state.roiColor, roiStroke:state.roiStroke, insetScale:state.insetScale, arrowColor:state.arrowColor, arrowSize:state.arrowSize, textColor:state.textColor, fontSize:state.fontSize, showNumbers:state.showNumbers, showConnectors:state.showConnectors, showArrow:state.showArrow, syncRow:state.syncRow, syncCol:state.syncCol, methodsAsRows:state.methodsAsRows, verticalRows:state.verticalRows, gap:state.gap});
  }
  function pushHistory() { state.history.push(snapshot()); if(state.history.length>40) state.history.shift(); state.future=[]; }
  function applySnapshot(s) { Object.assign(state, JSON.parse(s)); syncControls(); render(); }
  function toast(msg) { const t=$('toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(toast.t); toast.t=setTimeout(()=>t.classList.remove('show'),1800); }
  function clamp(v,a,b){ return Math.max(a,Math.min(b,v)); }
  function letters(i){ return String.fromCharCode(97 + (i % 26)); }

  function layout() {
    const left = state.verticalRows ? 88 : 140;
    const top = 70, right = 26, bottom = 24;
    const cw = (state.width-left-right)/state.cols;
    const ch = (state.height-top-bottom)/state.rows;
    return {left,top,right,bottom,cw,ch};
  }
  function cellRect(index) {
    const {left,top,cw,ch}=layout(); const r=Math.floor(index/state.cols), c=index%state.cols;
    const outer={x:left+c*cw,y:top+r*ch,w:cw,h:ch,r,c};
    const pad=state.gap/2;
    const image={x:outer.x+pad+5,y:outer.y+pad+4,w:outer.w-pad*2-10,h:outer.h*.67-pad};
    const insetSize=Math.min(outer.w*state.insetScale,outer.h*.36);
    const inset={x:outer.x+outer.w-insetSize-pad-5,y:outer.y+outer.h-insetSize-pad-6,w:insetSize,h:insetSize};
    return {outer,image,inset,r,c};
  }
  function imageWidth(img) { return img.naturalWidth || img.width; }
  function imageHeight(img) { return img.naturalHeight || img.height; }
  function fitImageRect(img, box) {
    const ar=imageWidth(img)/imageHeight(img), br=box.w/box.h; let w,h;
    if(ar>br){w=box.w;h=w/ar;}else{h=box.h;w=h*ar;}
    return {x:box.x+(box.w-w)/2,y:box.y+(box.h-h)/2,w,h};
  }
  function mainRect(index){ const cr=cellRect(index); const img=state.images[index]; return img ? fitImageRect(img,cr.image) : cr.image; }
  function insetRect(cr,mr) {
    const roi=getRoi(cr.r*state.cols+cr.c), aspect=(roi.w*mr.w)/(roi.h*mr.h);
    const box=cr.inset, w=aspect>=1?box.w:box.h*aspect, h=aspect>=1?box.w/aspect:box.h;
    const inset={x:box.x+box.w-w,y:box.y+box.h-h,w,h};
    if(cr.outer.w<=cr.outer.h*2)return inset;
    return {...inset,x:Math.min(inset.x,mr.x+mr.w+Math.max(18,state.gap)),y:mr.y+mr.h-inset.h};
  }
  function getRoi(index) {
    const row=Math.floor(index/state.cols),col=index%state.cols;
    const raw=state.syncRow&&state.syncCol?state.globalRoi:state.syncRow?state.rois[row]:state.syncCol?state.colRois[col]:state.cellRois[index]||state.rois[row];
    const img=state.images[index];if(!img)return raw;
    const iw=imageWidth(img),ih=imageHeight(img),w=clamp(Math.round(raw.w*iw),1,iw),h=clamp(Math.round(raw.h*ih),1,ih);
    const x=clamp(Math.round(raw.x*iw),0,iw-w),y=clamp(Math.round(raw.y*ih),0,ih-h);
    return {x:x/iw,y:y/ih,w:w/iw,h:h/ih};
  }
  function syncRoiPixels(){
    const img=state.images[state.selected],ids=['roiX','roiY','roiWidth','roiHeight'];
    ids.forEach(id=>$(id).disabled=!img);$('applyRoiPixels').disabled=!img;
    if(!img){$('roiPixelInfo').textContent='导入图片后可精确调整 ROI';return;}
    const iw=imageWidth(img),ih=imageHeight(img),roi=getRoi(state.selected);
    const vals=[Math.round(roi.x*iw),Math.round(roi.y*ih),Math.round(roi.w*iw),Math.round(roi.h*ih)];
    ids.forEach((id,i)=>{$(id).value=vals[i];$(id).max=i%2===0?iw:ih;});
    $('roiPixelInfo').textContent=`原图 ${iw} × ${ih} px · ROI ${vals[2]} × ${vals[3]} px`;
  }
  $('applyRoiPixels').onclick=()=>{
    const img=state.images[state.selected];if(!img)return;
    const vals=['roiX','roiY','roiWidth','roiHeight'].map(id=>$(id).value.trim());
    if(vals.some(v=>v===''||!Number.isInteger(Number(v))))return toast('ROI 位置和尺寸必须是整数像素');
    const [x,y,w,h]=vals.map(Number),iw=imageWidth(img),ih=imageHeight(img);
    if(x<0||y<0||w<1||h<1||x+w>iw||y+h>ih)return toast(`ROI 必须位于 ${iw} × ${ih} 像素图像内`);
    pushHistory();setRoi(state.selected,{x:x/iw,y:y/ih,w:w/iw,h:h/ih});render();
  };
  function setRoi(index, roi) { const row=Math.floor(index/state.cols),col=index%state.cols;if(state.syncRow&&state.syncCol)state.globalRoi=roi;else if(state.syncRow)state.rois[row]=roi;else if(state.syncCol)state.colRois[col]=roi;else state.cellRois[index]=roi; }

  function drawPlaceholder(rect, index) {
    ctx.save(); ctx.beginPath(); ctx.ellipse(rect.x+rect.w/2,rect.y+rect.h/2,rect.w*.42,rect.h*.46,0,0,Math.PI*2); ctx.clip();
    const g=ctx.createRadialGradient(rect.x+rect.w*.52,rect.y+rect.h*.48,5,rect.x+rect.w/2,rect.y+rect.h/2,rect.w*.46);
    g.addColorStop(0,'#d7d7d7');g.addColorStop(.42,'#989898');g.addColorStop(.8,'#555');g.addColorStop(1,'#171717');ctx.fillStyle=g;ctx.fillRect(rect.x,rect.y,rect.w,rect.h);
    ctx.fillStyle='#1d1d1d';ctx.beginPath();ctx.ellipse(rect.x+rect.w*.52,rect.y+rect.h*.23,rect.w*.10,rect.h*.055,0,0,Math.PI*2);ctx.fill();
    ctx.strokeStyle='#e7e7e7';ctx.lineWidth=5;ctx.beginPath();ctx.arc(rect.x+rect.w*.5,rect.y+rect.h*.64,rect.w*.07,0,Math.PI*2);ctx.stroke();
    ctx.fillStyle='#bbb'; for(let k=0;k<16;k++){ const a=k*2.41+index, rr=(k%5)/6; ctx.beginPath();ctx.arc(rect.x+rect.w*(.5+Math.cos(a)*rr*.32),rect.y+rect.h*(.48+Math.sin(a)*rr*.25),2+(k%4),0,Math.PI*2);ctx.fill(); }
    ctx.restore(); ctx.strokeStyle='#444';ctx.lineWidth=1;ctx.beginPath();ctx.ellipse(rect.x+rect.w/2,rect.y+rect.h/2,rect.w*.42,rect.h*.46,0,0,Math.PI*2);ctx.stroke();
  }
  function drawImage(index, rect) { const img=state.images[index]; if(img) ctx.drawImage(img,rect.x,rect.y,rect.w,rect.h); else drawPlaceholder(rect,index); }
  function drawCropped(index, inset, roi) {
    const img=state.images[index];
    ctx.save(); ctx.beginPath();ctx.rect(inset.x,inset.y,inset.w,inset.h);ctx.clip();
    if(img){ const iw=imageWidth(img),ih=imageHeight(img),sx=roi.x*iw,sy=roi.y*ih,sw=roi.w*iw,sh=roi.h*ih; ctx.imageSmoothingEnabled=true;ctx.imageSmoothingQuality='high';ctx.drawImage(img,sx,sy,sw,sh,inset.x,inset.y,inset.w,inset.h); }
    else { drawPlaceholder({x:inset.x-inset.w*1.4,y:inset.y-inset.h*1.2,w:inset.w*3.3,h:inset.h*3.3},index); }
    ctx.restore();
  }
  function drawArrow(inset, point) {
    const tx=inset.x+point.x*inset.w, ty=inset.y+point.y*inset.h;
    const len=state.arrowSize*2.1, ang=Math.atan2(-.72,-.72); const sx=tx-Math.cos(ang)*len, sy=ty-Math.sin(ang)*len;
    ctx.strokeStyle=state.arrowColor;ctx.fillStyle=state.arrowColor;ctx.lineWidth=Math.max(2,state.arrowSize/7);ctx.lineCap='round';
    ctx.beginPath();ctx.moveTo(sx,sy);ctx.lineTo(tx,ty);ctx.stroke();
    const a=Math.atan2(ty-sy,tx-sx), hs=state.arrowSize;ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(tx-Math.cos(a-.55)*hs,ty-Math.sin(a-.55)*hs);ctx.lineTo(tx-Math.cos(a+.55)*hs,ty-Math.sin(a+.55)*hs);ctx.closePath();ctx.fill();
  }
  function drawFigure() {
    ctx.save();ctx.fillStyle=state.bg;ctx.fillRect(0,0,state.width,state.height);
    ctx.fillStyle=state.textColor;ctx.textAlign='center';ctx.textBaseline='middle';ctx.font=`600 ${state.fontSize}px "Microsoft YaHei",sans-serif`;
    const {left,top,cw}=layout(); state.colLabels.forEach((s,c)=>{if(c<state.cols)ctx.fillText(s,left+c*cw+cw/2,top/2);});
    state.rowLabels.forEach((s,r)=>{if(r>=state.rows)return; const y=top+r*((state.height-top-24)/state.rows)+((state.height-top-24)/state.rows)/2; ctx.save();ctx.translate(state.verticalRows?34:65,y);if(state.verticalRows)ctx.rotate(-Math.PI/2);ctx.fillText(s,0,0);ctx.restore();});
    for(let i=0;i<state.rows*state.cols;i++){
      const cr=cellRect(i), mr=mainRect(i), inset=insetRect(cr,mr), roi=getRoi(i);
      drawImage(i,mr);
      const rr={x:mr.x+roi.x*mr.w,y:mr.y+roi.y*mr.h,w:roi.w*mr.w,h:roi.h*mr.h};
      if(state.showConnectors){ctx.strokeStyle='#aeb4bd';ctx.lineWidth=1;ctx.setLineDash([3,3]);ctx.beginPath();ctx.moveTo(rr.x,rr.y+rr.h);ctx.bezierCurveTo(rr.x,inset.y,inset.x,inset.y,inset.x,inset.y);ctx.moveTo(rr.x+rr.w,rr.y+rr.h);ctx.bezierCurveTo(rr.x+rr.w,inset.y+inset.h,inset.x,inset.y+inset.h,inset.x,inset.y+inset.h);ctx.stroke();ctx.setLineDash([]);}
      ctx.strokeStyle=state.roiColor;ctx.lineWidth=state.roiStroke;ctx.strokeRect(rr.x,rr.y,rr.w,rr.h);
      drawCropped(i,inset,roi);ctx.strokeStyle=state.roiColor;ctx.lineWidth=state.roiStroke;ctx.strokeRect(inset.x,inset.y,inset.w,inset.h);
      if(state.showArrow)drawArrow(inset,state.arrows[cr.r]);
      if(state.showNumbers){ctx.fillStyle=state.textColor;ctx.textAlign='left';ctx.font=`${Math.max(14,state.fontSize*.72)}px Georgia,serif`;ctx.fillText(`(${letters(cr.r)}${cr.c+1})`,cr.outer.x+8,cr.outer.y+cr.outer.h-17);}
      if(i===state.selected){ctx.strokeStyle='#4f8cff';ctx.lineWidth=2;ctx.setLineDash([7,5]);ctx.strokeRect(cr.outer.x+2,cr.outer.y+2,cr.outer.w-4,cr.outer.h-4);ctx.setLineDash([]);}
    }
    ctx.restore();
  }
  function render(){ canvas.width=state.width;canvas.height=state.height;drawFigure();$('sizeStatus').textContent=`${state.width} × ${state.height} px`;$('matrixCount').textContent=`${state.images.filter(Boolean).length} / ${state.rows*state.cols}`;$('emptyState').classList.toggle('hidden',state.images.filter(Boolean).length>0); const r=Math.floor(state.selected/state.cols)+1,c=state.selected%state.cols+1;$('selectionText').textContent=`第 ${r} 行 · 第 ${c} 列`;syncWindowControls();syncRoiPixels(); }

  function point(ev){ const b=canvas.getBoundingClientRect();return{x:(ev.clientX-b.left)*canvas.width/b.width,y:(ev.clientY-b.top)*canvas.height/b.height}; }
  function hitCell(p){ const l=layout(); if(p.x<l.left||p.y<l.top)return -1;const c=Math.floor((p.x-l.left)/l.cw),r=Math.floor((p.y-l.top)/l.ch);return r>=0&&r<state.rows&&c>=0&&c<state.cols?r*state.cols+c:-1; }
  canvas.addEventListener('pointerdown',ev=>{
    const p=point(ev),idx=hitCell(p);if(idx<0)return; pushHistory();state.selected=idx;const cr=cellRect(idx),mr=mainRect(idx),inset=insetRect(cr,mr),row=Math.floor(idx/state.cols);canvas.setPointerCapture(ev.pointerId);
    if(state.tool==='roi'){
      const x=clamp((p.x-mr.x)/mr.w,0,1),y=clamp((p.y-mr.y)/mr.h,0,1);setRoi(idx,{x,y,w:.001,h:.001});state.dragging={type:'draw-roi',index:idx,start:{x,y}};
    } else if(state.tool==='arrow' && p.x>=inset.x&&p.x<=inset.x+inset.w&&p.y>=inset.y&&p.y<=inset.y+inset.h){state.arrows[row]={x:clamp((p.x-inset.x)/inset.w,.05,.95),y:clamp((p.y-inset.y)/inset.h,.05,.95)};
    } else { const roi=getRoi(idx),rr={x:mr.x+roi.x*mr.w,y:mr.y+roi.y*mr.h,w:roi.w*mr.w,h:roi.h*mr.h};if(p.x>=rr.x&&p.x<=rr.x+rr.w&&p.y>=rr.y&&p.y<=rr.y+rr.h)state.dragging={type:'move-roi',index:idx,dx:(p.x-rr.x)/mr.w,dy:(p.y-rr.y)/mr.h}; }
    render();
  });
  canvas.addEventListener('pointermove',ev=>{ if(!state.dragging)return;const p=point(ev),d=state.dragging,idx=d.index,mr=mainRect(idx),x=clamp((p.x-mr.x)/mr.w,0,1),y=clamp((p.y-mr.y)/mr.h,0,1);
    if(d.type==='draw-roi'){const img=state.images[idx],minW=img?1/imageWidth(img):.001,minH=img?1/imageHeight(img):.001;const w=Math.max(minW,Math.abs(x-d.start.x)),h=Math.max(minH,Math.abs(y-d.start.y));setRoi(idx,{x:Math.min(1-w,d.start.x,x),y:Math.min(1-h,d.start.y,y),w,h});}
    else {const current=getRoi(idx),roi={...current};roi.x=clamp(x-d.dx,0,1-roi.w);roi.y=clamp(y-d.dy,0,1-roi.h);setRoi(idx,roi);}render(); });
  canvas.addEventListener('pointerup',()=>state.dragging=null);

  function parseTiff(buffer, fileName) {
    const dv=new DataView(buffer); if(dv.byteLength<8)throw new Error('文件过小，不是有效 TIFF');
    const order=String.fromCharCode(dv.getUint8(0),dv.getUint8(1));
    const le=order==='II'; if(!le&&order!=='MM')throw new Error('TIFF 字节序标记无效');
    const u16=o=>dv.getUint16(o,le), u32=o=>dv.getUint32(o,le);
    if(u16(2)!==42)throw new Error('暂不支持 BigTIFF，仅支持标准多页 TIFF');
    const typeSize={1:1,2:1,3:2,4:4,5:8,6:1,7:1,8:2,9:4,10:8,11:4,12:8};
    function values(entry,type,count){
      const size=typeSize[type];if(!size)throw new Error(`不支持的 TIFF 字段类型 ${type}`);
      const base=size*count<=4?entry+8:u32(entry+8);const out=[];
      for(let i=0;i<count;i++){const o=base+i*size;if(o+size>dv.byteLength)throw new Error('TIFF 字段越界');
        if(type===3)out.push(u16(o));else if(type===4)out.push(u32(o));else if(type===8)out.push(dv.getInt16(o,le));else if(type===9)out.push(dv.getInt32(o,le));else if(type===11)out.push(dv.getFloat32(o,le));else if(type===12)out.push(dv.getFloat64(o,le));else out.push(dv.getUint8(o));
      } return out;
    }
    const frames=[];let ifd=u32(4),guard=0,meta=null;
    while(ifd&&guard++<10000){
      if(ifd+2>dv.byteLength)throw new Error('TIFF IFD 地址越界');const count=u16(ifd),tags={};
      for(let i=0;i<count;i++){const e=ifd+2+i*12;if(e+12>dv.byteLength)throw new Error('TIFF IFD 项越界');const tag=u16(e),type=u16(e+2),n=u32(e+4);tags[tag]=values(e,type,n);}
      const width=tags[256]?.[0],height=tags[257]?.[0],bits=tags[258]?.[0]||8,compression=tags[259]?.[0]||1,photo=tags[262]?.[0]??1,samples=tags[277]?.[0]||1,sampleFormat=tags[339]?.[0]||1;
      const offsets=tags[273]||tags[324],byteCounts=tags[279]||tags[325];
      if(!width||!height||!offsets||!byteCounts)throw new Error('TIFF 缺少宽高或像素条带信息');
      if(compression!==1)throw new Error(`当前仅支持未压缩 TIFF；该文件压缩类型为 ${compression}`);
      if(samples!==1)throw new Error(`当前仅支持单通道灰度 TIFF；该文件通道数为 ${samples}`);
      if(![8,16,32].includes(bits))throw new Error(`暂不支持 ${bits} 位 TIFF`);
      const frame=new Float32Array(width*height),bytes=bits/8;let pos=0;
      const readPixel=o=>sampleFormat===3&&bits===32?dv.getFloat32(o,le):sampleFormat===2?(bits===8?dv.getInt8(o):bits===16?dv.getInt16(o,le):dv.getInt32(o,le)):(bits===8?dv.getUint8(o):bits===16?dv.getUint16(o,le):dv.getUint32(o,le));
      for(let s=0;s<offsets.length;s++){const start=offsets[s],end=Math.min(start+(byteCounts[s]??byteCounts[0]),dv.byteLength);for(let o=start;o+bytes<=end&&pos<frame.length;o+=bytes)frame[pos++]=readPixel(o);}
      if(pos<frame.length)throw new Error(`第 ${frames.length+1} 层像素不完整`);
      frames.push(frame);meta={width,height,bits,sampleFormat,photo};
      const nextPos=ifd+2+count*12;ifd=nextPos+4<=dv.byteLength?u32(nextPos):0;
    }
    if(!frames.length)throw new Error('TIFF 中没有可读取的图像层');
    const total=frames.length*meta.width*meta.height,step=Math.max(1,Math.floor(total/180000)),sample=[];let global=0;
    for(const frame of frames)for(let i=(step-global%step)%step;i<frame.length;i+=step){const v=frame[i];if(Number.isFinite(v))sample.push(v);global+=frame.length;}
    sample.sort((a,b)=>a-b);
    return {name:fileName.replace(/\.tiff?$/i,''),frames,...meta,sample};
  }
  function percentile(sorted,p){if(!sorted.length)return 0;const x=clamp(p,0,100)/100*(sorted.length-1),a=Math.floor(x),b=Math.ceil(x);return sorted[a]+(sorted[b]-sorted[a])*(x-a);}
  function sliceCanvas(volume,z,center,width){
    const out=document.createElement('canvas');out.width=volume.width;out.height=volume.height;const oc=out.getContext('2d'),im=oc.createImageData(out.width,out.height),frame=volume.frames[clamp(z,0,volume.frames.length-1)];
    const low=center-width/2,high=center+width/2,scale=255/width,invert=volume.photo===0;
    for(let i=0,j=0;i<frame.length;i++,j+=4){let g=clamp(Math.round((frame[i]-low)*scale),0,255);if(invert)g=255-g;im.data[j]=im.data[j+1]=im.data[j+2]=g;im.data[j+3]=255;}oc.putImageData(im,0,0);return out;
  }
  function parsedSlices(){
    const tokens=$('sliceIndices').value.trim().split(/[，,;；\s]+/).filter(Boolean),depth=state.volumes.length?Math.min(...state.volumes.map(v=>v.frames.length)):Infinity;
    const numbers=tokens.map(Number);
    if(!numbers.length||numbers.some(z=>!Number.isInteger(z)||z<1||z>depth))return [];
    return numbers.map(z=>z-1);
  }
  function currentSliceOrdinal(){if(!state.volumes.length)return 0;const selected=clamp(state.selected,0,Math.max(0,state.rows*state.cols-1));return state.methodsAsRows?selected%state.cols:Math.floor(selected/state.cols);}
  function currentSlice(){if(!state.volumes.length)return null;const zs=state.activeSlices;if(!zs.length)return null;const selected=clamp(state.selected,0,Math.max(0,state.rows*state.cols-1));return (state.methodsAsRows?zs[selected%state.cols]:zs[Math.floor(selected/state.cols)])??null;}
  function autoSliceWindow(z){
    const sample=[];for(const v of state.volumes){const frame=v.frames[clamp(z,0,v.frames.length-1)],step=Math.max(1,Math.floor(frame.length/70000));for(let i=0;i<frame.length;i+=step){const x=frame[i];if(Number.isFinite(x))sample.push(x);}}
    sample.sort((a,b)=>a-b);const low=percentile(sample,1),high=percentile(sample,99);return {center:(low+high)/2,width:Math.max(Number.EPSILON,high-low)};
  }
  function ensureSliceWindows(zs,force=false){zs.forEach(z=>{if(force||!state.sliceWindows[z])state.sliceWindows[z]=autoSliceWindow(z);});}
  function syncWindowControls(){const z=currentSlice();if(z===null)return;$('windowTarget').textContent=`切片${currentSliceOrdinal()+1}`;const w=state.sliceWindows[z];if(!w||document.activeElement===$('windowMin')||document.activeElement===$('windowMax'))return;$('windowMin').value=formatWindow(w.center-w.width/2);$('windowMax').value=formatWindow(w.center+w.width/2);}
  function showVolumes(){
    const host=$('volumeList');host.replaceChildren();$('clearVolumes').hidden=!state.volumes.length;
    if(!state.volumes.length){const empty=document.createElement('span');empty.className='muted';empty.textContent='尚未导入体数据';host.append(empty);return;}
    state.volumes.forEach((v,i)=>{const item=document.createElement('div');item.className='volume-item';item.title=v.name;
      const cube=document.createElement('span');cube.className='cube';cube.textContent='▦';const name=document.createElement('span');name.className='name';name.textContent=v.label||v.name;const shape=document.createElement('span');shape.className='shape';shape.textContent=`${v.frames.length}×${v.height}×${v.width}`;
      const actions=document.createElement('span');actions.className='volume-actions';actions.innerHTML=`<button data-action="up" data-index="${i}" title="上移">↑</button><button data-action="down" data-index="${i}" title="下移">↓</button><button class="remove" data-action="remove" data-index="${i}" title="删除">×</button>`;item.append(cube,name,shape,actions);host.append(item);});
  }
  function formatWindow(v){return Number(v.toPrecision(7)).toString();}
  function applyVolumes(){
    if(!state.volumes.length)return toast('请先导入 TIFF 体数据');const zs=parsedSlices();if(!zs.length)return toast(`请输入 1～${Math.min(...state.volumes.map(v=>v.frames.length))} 之间的整数层号`);
    ensureSliceWindows(zs);pushHistory();state.activeSlices=zs;const previousSelected=state.selected;
    state.methodsAsRows=$('methodsAsRows').checked;
    if(state.methodsAsRows){
      state.rows=state.volumes.length;state.cols=zs.length;state.images=Array(state.rows*state.cols);
      for(let r=0;r<state.rows;r++)for(let c=0;c<state.cols;c++){const v=state.volumes[r],z=clamp(zs[c],0,v.frames.length-1),w=state.sliceWindows[zs[c]];state.images[r*state.cols+c]=sliceCanvas(v,z,w.center,w.width);}
      state.rowLabels=state.volumes.map(v=>v.label||v.name);state.colLabels=zs.map((_,i)=>`切片${i+1}`);
    }else{
      state.rows=zs.length;state.cols=state.volumes.length;state.images=Array(state.rows*state.cols);
      for(let r=0;r<state.rows;r++)for(let c=0;c<state.cols;c++){const v=state.volumes[c],z=clamp(zs[r],0,v.frames.length-1),w=state.sliceWindows[zs[r]];state.images[r*state.cols+c]=sliceCanvas(v,z,w.center,w.width);}
      state.rowLabels=zs.map((_,i)=>`切片${i+1}`);state.colLabels=state.volumes.map(v=>v.label||v.name);
    }
    state.selected=clamp(previousSelected,0,state.rows*state.cols-1);defaults();
    $('rowsInput').value=state.rows;$('colsInput').value=state.cols;$('rowLabels').value=state.rowLabels.join('\n');$('colLabels').value=state.colLabels.join('\n');render();toast(`已生成 ${state.rows} 行 × ${state.cols} 列`);
  }
  $('volumeImportBtn').onclick=()=>$('volumeInput').click();
  $('volumeInput').onchange=async e=>{
    const files=[...e.target.files];if(!files.length)return;const btn=$('volumeImportBtn');btn.disabled=true;btn.textContent='正在解析体数据…';
    try{const wasEmpty=!state.volumes.length;for(const file of files){btn.textContent=`正在解析 ${file.name}`;const v=parseTiff(await file.arrayBuffer(),file.name);v.label=v.name;state.volumes.push(v);}showVolumes();if(wasEmpty){const minDepth=Math.min(...state.volumes.map(v=>v.frames.length));const count=Math.min(4,minDepth),auto=Array.from({length:count},(_,i)=>1+Math.round(i*(minDepth-1)/Math.max(1,count-1)));$('sliceIndices').value=auto.join(', ');}ensureSliceWindows(parsedSlices(),true);applyVolumes();}
    catch(err){console.error(err);toast(`TIFF 读取失败：${err.message}`);}finally{btn.disabled=false;btn.textContent='＋ 追加 TIFF 体数据（可多选）';e.target.value='';}
  };
  function commitCurrentWindow(){const z=currentSlice(),min=Number($('windowMin').value),max=Number($('windowMax').value);if(z===null)return;if(!Number.isFinite(min)||!Number.isFinite(max)||max<=min)return toast('范围上下限必须是数值，且上限要大于下限');state.sliceWindows[z]={center:(min+max)/2,width:max-min};applyVolumes();}
  $('applySlices').onclick=applyVolumes;$('windowMin').onchange=commitCurrentWindow;$('windowMax').onchange=commitCurrentWindow;$('autoWindow').onclick=()=>{const z=currentSlice();if(z===null)return;const label=`切片${currentSliceOrdinal()+1}`;state.sliceWindows[z]=autoSliceWindow(z);applyVolumes();toast(`已自动调整${label}范围`);};$('autoAllWindows').onclick=()=>{ensureSliceWindows(parsedSlices(),true);applyVolumes();toast('已自动调整全部切片范围');};$('methodsAsRows').onchange=applyVolumes;
  $('volumeList').onclick=e=>{const b=e.target.closest('button[data-action]');if(!b)return;const i=Number(b.dataset.index),a=b.dataset.action;if(a==='remove')state.volumes.splice(i,1);else if(a==='up'&&i>0)[state.volumes[i-1],state.volumes[i]]=[state.volumes[i],state.volumes[i-1]];else if(a==='down'&&i<state.volumes.length-1)[state.volumes[i+1],state.volumes[i]]=[state.volumes[i],state.volumes[i+1]];showVolumes();if(state.volumes.length)applyVolumes();else{state.images=[];state.cols=1;state.rows=1;$('colsInput').value=1;$('rowsInput').value=1;render();}};
  $('clearVolumes').onclick=()=>{state.volumes=[];state.images=[];state.cols=1;state.rows=1;showVolumes();$('colsInput').value=1;$('rowsInput').value=1;render();toast('体数据已清空');};

  function loadFiles(files, replaceIndex=null){ const list=[...files]; if(!list.length)return; let loaded=0; list.forEach((file,j)=>{const fr=new FileReader();fr.onload=()=>{const img=new Image();img.onload=()=>{const idx=replaceIndex===null?j:replaceIndex;state.images[idx]=img;loaded++;if(loaded===list.length){state.selected=replaceIndex===null?0:replaceIndex;render();toast(`已载入 ${list.length} 张图片`);}};img.src=fr.result;};fr.readAsDataURL(file);}); }
  $('importBtn').onclick=$('emptyImport').onclick=()=>$('fileInput').click(); $('fileInput').onchange=e=>{pushHistory();loadFiles(e.target.files);e.target.value='';};
  $('replaceBtn').onclick=()=>$('replaceInput').click();$('replaceInput').onchange=e=>{if(e.target.files[0])loadFiles(e.target.files,state.selected);e.target.value='';};
  document.querySelectorAll('.tool').forEach(b=>b.onclick=()=>{state.tool=b.dataset.tool;document.querySelectorAll('.tool').forEach(x=>x.classList.toggle('active',x===b));$('toolTip').textContent=state.tool==='roi'?'在主图上拖拽绘制 ROI；同一行会共享位置':'arrow'===state.tool?'点击放大框内的目标位置放置箭头':'点击单元格选择，拖动 ROI 框可调整位置';});
  function bind(id,key,kind='value',transform=v=>v){const el=$(id);el.addEventListener('pointerdown',pushHistory);el.addEventListener('input',e=>{state[key]=transform(kind==='checked'?e.target.checked:e.target.value);render();});}
  bind('bgColor','bg');bind('roiColor','roiColor');bind('roiStroke','roiStroke','value',Number);bind('insetScale','insetScale','value',v=>Number(v)/100);bind('showNumbers','showNumbers','checked');bind('showConnectors','showConnectors','checked');bind('arrowColor','arrowColor');bind('arrowSize','arrowSize','value',Number);bind('showArrow','showArrow','checked');bind('fontSize','fontSize','value',Number);bind('textColor','textColor');bind('verticalRows','verticalRows','checked');bind('gap','gap','value',Number);
  function changeSync(axis,checked){const current={...getRoi(Math.max(0,state.selected))},wasBoth=state.syncRow&&state.syncCol;if(axis==='row')state.syncRow=checked;else state.syncCol=checked;
    if(state.syncRow&&state.syncCol)state.globalRoi=current;else if(state.syncRow){if(wasBoth)state.rois=state.rois.map(()=>({...current}));else state.rois[Math.floor(Math.max(0,state.selected)/state.cols)]={...current};}else if(state.syncCol){if(wasBoth)state.colRois=state.colRois.map(()=>({...current}));else state.colRois[Math.max(0,state.selected)%state.cols]={...current};}else state.cellRois[Math.max(0,state.selected)]={...current};render();}
  ['syncRow','syncCol'].forEach(id=>{const el=$(id);el.addEventListener('pointerdown',pushHistory);el.addEventListener('change',()=>changeSync(id==='syncRow'?'row':'col',el.checked));});
  [['roiStroke','roiStrokeValue',v=>`${v} px`],['insetScale','insetScaleValue',v=>`${v}%`],['arrowSize','arrowSizeValue',v=>`${v} px`],['fontSize','fontSizeValue',v=>`${v} px`],['gap','gapValue',v=>`${v} px`]].forEach(([a,b,f])=>$(a).addEventListener('input',()=>$(b).textContent=f($(a).value)));
  function structure(){pushHistory();const oldCols=state.cols;state.rows=clamp(Number($('rowsInput').value)||1,1,10);state.cols=clamp(Number($('colsInput').value)||1,1,10);state.selected=clamp(state.selected,0,state.rows*state.cols-1);defaults(); if(oldCols!==state.cols)toast('列数已更新，请确认图片顺序');render();}
  $('rowsInput').onchange=structure;$('colsInput').onchange=structure;
  $('rowLabels').oninput=e=>{state.rowLabels=e.target.value.split('\n');if(state.methodsAsRows)state.volumes.forEach((v,i)=>{if(state.rowLabels[i])v.label=state.rowLabels[i];});showVolumes();render();};$('colLabels').oninput=e=>{state.colLabels=e.target.value.split('\n');if(!state.methodsAsRows)state.volumes.forEach((v,i)=>{if(state.colLabels[i])v.label=state.colLabels[i];});showVolumes();render();};
  $('autoRows').onclick=()=>{$('rowLabels').value=Array.from({length:state.rows},(_,i)=>`切片${i+1}`).join('\n');$('rowLabels').dispatchEvent(new Event('input'));};
  $('autoCols').onclick=()=>{$('colLabels').value=Array.from({length:state.cols},(_,i)=>i===0?'原图':`方法${i}`).join('\n');$('colLabels').dispatchEvent(new Event('input'));};
  function resize(){state.width=clamp(Number($('canvasWidth').value)||1600,800,6000);state.height=clamp(Number($('canvasHeight').value)||1200,600,6000);render();} $('canvasWidth').onchange=resize;$('canvasHeight').onchange=resize;
  $('undoBtn').onclick=()=>{if(!state.history.length)return;state.future.push(snapshot());applySnapshot(state.history.pop());};$('redoBtn').onclick=()=>{if(!state.future.length)return;state.history.push(snapshot());applySnapshot(state.future.pop());};
  $('previewBtn').onclick=()=>{document.body.classList.toggle('preview-mode');$('previewBtn').textContent=document.body.classList.contains('preview-mode')?'退出预览':'预览';setTimeout(render,50);};
  $('fitBtn').onclick=()=>{$('canvasWrap').scrollTo({left:0,top:0});toast('画布已适应窗口');};
  $('resetLayout').onclick=()=>{pushHistory();state.rois=Array.from({length:state.rows},()=>({x:.14,y:.26,w:.18,h:.18}));state.colRois=Array.from({length:state.cols},()=>({x:.14,y:.26,w:.18,h:.18}));state.globalRoi={x:.14,y:.26,w:.18,h:.18};state.cellRois=Array.from({length:state.rows*state.cols},()=>null);state.arrows=Array.from({length:state.rows},()=>({x:.68,y:.63}));render();toast('布局已恢复');};
  $('exportBtn').onclick=()=>{ const old=state.selected;state.selected=-1;drawFigure();canvas.toBlob(blob=>{const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=(`${$('projectName').value||'ROI-figure'}`).replace(/[\\/:*?"<>|]/g,'-')+'.png';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);state.selected=old;render();toast('高清 PNG 已导出');},'image/png'); };
  function syncControls(){ $('rowsInput').value=state.rows;$('colsInput').value=state.cols;$('rowLabels').value=state.rowLabels.join('\n');$('colLabels').value=state.colLabels.join('\n');['bg','roiColor','roiStroke','arrowColor','arrowSize','textColor','fontSize','gap'].forEach(k=>{const map={bg:'bgColor'};$(map[k]||k).value=state[k];});$('insetScale').value=state.insetScale*100;['showNumbers','showConnectors','syncRow','syncCol','showArrow','verticalRows','methodsAsRows'].forEach(k=>$(k).checked=state[k]); }
  window.addEventListener('keydown',e=>{if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='z'){e.preventDefault();e.shiftKey?$('redoBtn').click():$('undoBtn').click();}});
  render();
})();
