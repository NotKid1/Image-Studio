/* Presentation adapter: move existing controls with their original handlers intact. */
(() => {
  const $ = id => document.getElementById(id);
  const left = document.querySelector('.left-panel');
  const right = document.querySelector('.right-panel');
  const leftSections = [...left.querySelectorAll(':scope > section')];
  const rightSections = [...right.querySelectorAll(':scope > section')];
  function group(title, open = false) {
    const el = document.createElement('details'); el.className = 'settings-group'; el.open = open;
    const summary = document.createElement('summary'); summary.textContent = title;
    const body = document.createElement('div'); body.className = 'group-body';
    el.append(summary, body); left.append(el); return body;
  }
  const top = document.querySelector('.topbar');
  top.querySelector('.brand').remove();
  const project = document.querySelector('.project-name');
  project.querySelector('span').textContent = '项目名称'; left.prepend(project);
  left.querySelector('.panel-title').remove();
  const tools = document.querySelector('.tool-group'); top.prepend(tools);
  const stageTools = document.querySelector('.stage-tools');
  const context = document.createElement('span'); context.id = 'studio-selection';
  stageTools.prepend(context);

  const data = group('数据导入', true);
  const imageHint = leftSections[0].querySelector('.hint');
  const volumeHint = leftSections[1].querySelector('.hint');
  data.append($('importBtn'), $('fileInput'), imageHint, $('volumeImportBtn'), $('volumeInput'), volumeHint,
    $('volumeList'), $('clearVolumes'), leftSections[4]);
  $('importBtn').textContent = '＋ 导入图片';
  $('volumeImportBtn').textContent = '＋ 导入 TIFF 体数据';
  const slices = group('切片与显示范围', true);
  slices.append(leftSections[1].querySelector('.slice-label'), leftSections[1].querySelector('.window-controls'),
    leftSections[1].querySelector('.window-target'), leftSections[1].querySelector('.two-button-row'));
  const structure = group('行列排列');
  structure.append(leftSections[0].querySelector('.section-head'), leftSections[0].querySelector('.two-col'), $('methodsAsRows').closest('label'));
  const labels = group('行列标签'); labels.append(leftSections[2], leftSections[3]);
  leftSections[0].remove(); leftSections[1].remove();

  right.querySelector('.panel-title').remove();
  const tabs = document.createElement('div'); tabs.className = 'property-tabs'; tabs.setAttribute('role','tablist');
  tabs.setAttribute('aria-label', '属性分类'); right.prepend(tabs);
  const panels = {};
  for (const [key, title, sections] of [['canvas','画布',[0,3,4]],['roi','ROI',[1]],['arrow','箭头',[2]]]) {
    const button = document.createElement('button'); button.textContent = title; button.id = 'property-tab-'+key;
    button.setAttribute('role','tab'); button.setAttribute('aria-controls','property-panel-'+key);
    const panel = document.createElement('div'); panel.id = 'property-panel-'+key; panel.setAttribute('role','tabpanel');
    panel.setAttribute('aria-labelledby',button.id); sections.forEach(i => panel.append(rightSections[i]));
    right.append(panel); tabs.append(button); panels[key] = {button,panel};
    button.onclick = () => {
      for (const [name, item] of Object.entries(panels)) {
        item.panel.hidden = name !== key; item.button.setAttribute('aria-selected',String(name === key));
        item.button.tabIndex = name === key ? 0 : -1;
      }
    };
    button.onkeydown = event => {
      const names = Object.keys(panels), index = names.indexOf(key);
      let next;
      if(event.key==='ArrowRight') next=names[(index+1)%names.length];
      if(event.key==='ArrowLeft') next=names[(index+names.length-1)%names.length];
      if(event.key==='Home') next=names[0]; if(event.key==='End') next=names[names.length-1];
      if(next){event.preventDefault();panels[next].button.click();panels[next].button.focus();}
    };
  }
  panels.roi.button.click();
  document.querySelector('[data-tool=roi]').addEventListener('click',()=>panels.roi.button.click());
  document.querySelector('[data-tool=arrow]').addEventListener('click',()=>panels.arrow.button.click());

  const empty = $('emptyState');
  empty.querySelector('strong').textContent = '导入图像，开始排版';
  empty.querySelector('span').textContent = '支持图片与 TIFF 体数据';
  const importVolume = document.createElement('button'); importVolume.textContent = '导入 TIFF 体数据';
  importVolume.onclick = () => $('volumeImportBtn').click();
  const example = document.createElement('button'); example.className = 'text-btn'; example.textContent = '查看示例';
  example.onclick = () => {document.body.classList.add('studio-example'); sync();};
  empty.append(importVolume, example);
  const leaveExample = document.createElement('button'); leaveExample.id = 'leave-example';
  leaveExample.textContent = '退出示例'; leaveExample.onclick = () => {document.body.classList.remove('studio-example');sync();};
  stageTools.append(leaveExample);
  function sync() {
    const noData = !empty.classList.contains('hidden');
    document.body.classList.toggle('studio-empty',noData);
    if(!noData) document.body.classList.remove('studio-example');
    leaveExample.hidden = !document.body.classList.contains('studio-example');
    const match = $('selectionText').textContent.match(/第 (\d+) 行 · 第 (\d+) 列/);
    if (noData) context.textContent = leaveExample.hidden ? '等待导入图像' : '示例预览 · 尚未导入数据';
    else if(match) {
      const row = $('rowLabels').value.split('\n')[Number(match[1])-1] || '第 '+match[1]+' 行';
      const col = $('colLabels').value.split('\n')[Number(match[2])-1] || '第 '+match[2]+' 列';
      context.textContent = '当前选中：'+col+' · '+row;
    }
  }
  const observer = new MutationObserver(sync);
  observer.observe(empty,{attributes:true,attributeFilter:['class']});
  observer.observe($('selectionText'),{childList:true,characterData:true,subtree:true});
  document.addEventListener('input',sync); document.addEventListener('change',sync);
  sync(); document.documentElement.dataset.studioLayout = 'ready';
})();
