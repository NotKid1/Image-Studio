"""Exercise the real WebView2 host without changing the vendored ROI code."""
import base64
import io
import json
import os
from pathlib import Path
import time
import traceback

import numpy as np
from PIL import Image
import tifffile


def run(window, api, target):
    target = target.resolve()
    target.mkdir(parents=True, exist_ok=True)
    result = {'checks': []}
    def check(name, value):
        if not value:
            raise AssertionError(name)
        result['checks'].append(name)
    def js(code):
        return window.evaluate_js(code)
    def until(code, timeout=30):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            if js(code):
                return
            time.sleep(.12)
        raise TimeoutError(code)
    def capture(name):
        from System import Action
        from System.IO import FileStream, FileMode, FileAccess
        from Microsoft.Web.WebView2.Core import CoreWebView2CapturePreviewImageFormat
        stream = FileStream(str(target/name), FileMode.Create, FileAccess.Write)
        tasks = []
        window.native.Invoke(Action(lambda: tasks.append(window.native.webview.CoreWebView2.CapturePreviewAsync(CoreWebView2CapturePreviewImageFormat.Png, stream))))
        tasks[0].Wait()
        stream.Close()
    try:
        window.events.loaded.wait(40)
        until("document.getElementById('mask-path').value.length > 0")
        until("document.getElementById('roi-frame').contentWindow.document.getElementById('figureCanvas') !== null")
        js("window.__qaErrors=[];window.addEventListener('error',e=>window.__qaErrors.push(e.message));window.addEventListener('unhandledrejection',e=>window.__qaErrors.push(String(e.reason)));window.roiWin=document.getElementById('roi-frame').contentWindow;window.rd=roiWin.document;roiWin.addEventListener('error',e=>window.__qaErrors.push(e.message));")
        check('title', js("document.title === 'Image Studio'"))
        check('RAW default unchecked', js("!document.getElementById('export-raw').checked"))
        check('all app images load', js("Array.from(document.images).every(i=>i.complete&&i.naturalWidth>0)"))
        capture('preprocess_empty.png')
        source = Path(os.environ['IMAGE_STUDIO_QA_DATA']) if os.environ.get('IMAGE_STUDIO_QA_DATA') else None
        if source is not None and source.is_dir():
            paths = {'object': str(source/'纵1_TE.EVI'), 'air': str(source/'air_TE.EVI'), 'output': str(target/'processing')}
            js('window.qaPaths='+json.dumps(paths)+';for(const [k,v] of Object.entries(qaPaths)){document.getElementById(k+"-path").value=v;}document.getElementById("object-path").dispatchEvent(new Event("change"));')
            until("!document.getElementById('image-workspace').hidden")
            # Use the first valid input slice for actual preview.
            js("document.getElementById('frame').value=2;document.getElementById('frame').dispatchEvent(new Event('input'));")
            until("document.getElementById('frame-label').textContent.startsWith('2 /')")
            capture('preprocess_loaded.png')
            js("document.querySelector('input[value=mean]').checked=true;document.getElementById('process-form').requestSubmit();")
            until("!document.getElementById('open-result').hidden",60)
            check('mean preprocessing through UI',api.status()['state']=='complete')
            check('default produces no RAW',not list(Path(api.status()['result']).glob('*.raw')))
            check('default three TIFF',len(list(Path(api.status()['result']).glob('*.tif')))==3)
            js("document.querySelector('input[value=volume]').checked=true;document.getElementById('export-raw').checked=true;document.getElementById('process-form').requestSubmit();")
            time.sleep(.2)
            until("!document.getElementById('open-result').hidden",60)
            check('volume preprocessing through UI',api.status()['report']['mode']=='volume')
            check('RAW optional enabled',len(list(Path(api.status()['result']).glob('*.raw')))==3)
        js("document.getElementById('tab-roi').click()")
        until("!document.getElementById('roi').hidden")
        check('ROI original controls present',js("['volumeImportBtn','applySlices','applyRoiPixels','exportBtn','undoBtn','redoBtn','syncRow','syncCol','methodsAsRows'].every(id=>rd.getElementById(id))"))
        # Synthetic deterministic TIFF fixtures only, labelled as tests.
        y,x=np.mgrid[:128,:128]
        phantom=np.maximum(0,1-((x-64)**2+(y-64)**2)/3000).astype(np.float32)
        stack=np.stack([phantom,phantom*.8,phantom*.6])
        stream=io.BytesIO();tifffile.imwrite(stream,stack,photometric='minisblack',metadata=None)
        encoded=base64.b64encode(stream.getvalue()).decode('ascii')
        js("window.testTiff="+json.dumps(encoded)+";const bytes=Uint8Array.from(atob(testTiff),c=>c.charCodeAt(0));const dt=new roiWin.DataTransfer();for(const name of ['测试 A.tif','测试 B.tif'])dt.items.add(new roiWin.File([bytes],name,{type:'image/tiff'}));rd.getElementById('volumeInput').files=dt.files;rd.getElementById('volumeInput').dispatchEvent(new roiWin.Event('change'));")
        until("rd.getElementById('volumeList').querySelectorAll('button[data-action=remove]').length===2 && !rd.getElementById('volumeImportBtn').disabled")
        check('TIFF imports render three slices / two methods',js("rd.getElementById('rowsInput').value==='3' && rd.getElementById('colsInput').value==='2'"))
        js("rd.getElementById('sliceIndices').value='1, 3';rd.getElementById('applySlices').click();rd.getElementById('roiX').value=20;rd.getElementById('roiY').value=22;rd.getElementById('roiWidth').value=32;rd.getElementById('roiHeight').value=24;rd.getElementById('applyRoiPixels').click();")
        check('precise ROI applied',js("rd.getElementById('roiWidth').value==='32' && rd.getElementById('roiHeight').value==='24'"))
        js("rd.getElementById('undoBtn').click()")
        check('undo ROI',js("rd.getElementById('roiWidth').value!=='32'"))
        js("rd.getElementById('redoBtn').click()")
        check('redo ROI',js("rd.getElementById('roiWidth').value==='32'"))
        js("rd.getElementById('windowMin').value=0;rd.getElementById('windowMax').value=1;rd.getElementById('windowMax').dispatchEvent(new roiWin.Event('change'));")
        check('window range retained',js("rd.getElementById('windowMax').value==='1'"))
        js("rd.getElementById('methodsAsRows').checked=true;rd.getElementById('methodsAsRows').dispatchEvent(new roiWin.Event('change'));")
        check('methods as rows',js("rd.getElementById('rowLabels').value.includes('测试 A')"))
        js("document.getElementById('tab-preprocess').click();document.getElementById('tab-roi').click()")
        check('ROI state survives module switching',js("rd.getElementById('methodsAsRows').checked && rd.getElementById('roiWidth').value==='32'"))
        capture('roi_loaded.png')
        # Exercise native WebView2 blob download; bypass only the save-path picker.
        from System import Action
        native=window.native.browser
        destination=target/'roi_export.png'
        def save_download(sender,args):
            args.ResultFilePath=str(destination)
            args.Handled=True
        def install_download_test():
            native.webview.CoreWebView2.DownloadStarting -= native.on_download_starting
            native.webview.CoreWebView2.DownloadStarting += save_download
        window.native.Invoke(Action(install_download_test))
        js("rd.getElementById('exportBtn').click()")
        deadline=time.monotonic()+25
        while time.monotonic()<deadline:
            try:
                with Image.open(destination) as img:
                    img.load()
                    check('native PNG export size',img.size==(1600,1200))
                break
            except (FileNotFoundError,OSError):
                time.sleep(.2)
        else:
            raise TimeoutError('native PNG export')
        check('no captured JavaScript errors',js('window.__qaErrors.length===0'))
        result['passed']=True
        result['viewport']=js('({width:innerWidth,height:innerHeight,dpr:devicePixelRatio})')
    except Exception:
        result['passed']=False
        result['error']=traceback.format_exc()
        try:
            capture('failure.png')
        except Exception:
            pass
    finally:
        (target/'result.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8')
        window.destroy()
