(() => {
  const select = document.getElementById('theme-select');
  const frame = document.getElementById('roi-frame');
  const system = matchMedia('(prefers-color-scheme: dark)');
  let preference = 'dark';
  function apply() {
    const theme = preference === 'system' ? (system.matches ? 'dark' : 'light') : preference;
    document.documentElement.dataset.theme = theme;
    const doc = frame.contentDocument;
    if (doc?.head) {
      if (!doc.getElementById('studio-theme')) {
        const link = doc.createElement('link');
        link.id = 'studio-theme'; link.rel = 'stylesheet';
        link.href = new URL('roi-theme.css', location.href).href;
        doc.head.appendChild(link);
      }
      doc.documentElement.dataset.theme = theme;
      if (doc.getElementById('figureCanvas') && !doc.getElementById('studio-roi-layout')) {
        const css = doc.createElement('link'); css.rel = 'stylesheet';
        css.href = new URL('roi-layout.css', location.href).href; doc.head.appendChild(css);
        const script = doc.createElement('script'); script.id = 'studio-roi-layout';
        script.src = new URL('roi-layout.js', location.href).href; doc.body.appendChild(script);
      }
    }
  }
  frame.addEventListener('load', apply);
  system.addEventListener('change', () => { if (preference === 'system') apply(); });
  select.addEventListener('change', async () => {
    preference = select.value; apply();
    select.disabled = true;
    try {
      const result = await window.pywebview.api.theme_preference(preference);
      if (result.error) throw new Error(result.error);
    } catch (error) { alert('主题已切换，但未能保存设置：' + error.message); }
    finally { select.disabled = false; }
  });
  window.addEventListener('pywebviewready', async () => {
    try {
      const result = await window.pywebview.api.theme_preference();
      preference = result.theme || 'dark';
      select.value = preference; apply();
    } finally { select.disabled = false; }
  });
  apply();
})();
