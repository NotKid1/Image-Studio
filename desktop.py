"""Image Studio: independent preprocessing and unchanged ROI web application."""
import base64
import io
import json
import os
from pathlib import Path
import sys
import threading

import numpy as np
from PIL import Image
import tifffile
import webview

from pipeline import Cancelled, process
from preprocess import read_evi


ROOT = Path(getattr(sys, '_MEIPASS', Path(__file__).resolve().parent))
INSTALL = Path(sys.executable).parent if getattr(sys, 'frozen', False) else ROOT


class StudioAPI:
    def __init__(self):
        self._window = None
        self._lock = threading.Lock()
        self._cancel = threading.Event()
        self._state = {'state': 'idle', 'progress': 0, 'message': '请选择物体和空气 EVI 文件。', 'result': None}

    def defaults(self):
        return {'mask': str(ROOT/'maskplus.raw'), 'output': str(INSTALL/'output')}

    def theme_preference(self, value=None):
        path = Path(os.environ.get('LOCALAPPDATA', str(Path.home())))/'ImageStudio'/'theme.json'
        try:
            with self._lock:
                if value is not None:
                    if value not in ('dark', 'light', 'system'):
                        raise ValueError('未知主题')
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text(json.dumps({'theme': value}), encoding='utf-8')
                saved = json.loads(path.read_text(encoding='utf-8')) if path.exists() else {}
                theme = saved.get('theme', 'dark')
                return {'theme': theme if theme in ('dark', 'light', 'system') else 'dark'}
        except Exception as exc:
            return {'theme': 'dark', 'error': str(exc)}

    def browse(self, kind):
        if kind not in ('object', 'air', 'mask', 'output'):
            return {'error': '未知文件类型'}
        try:
            if kind == 'output':
                selected = self._window.create_file_dialog(webview.FileDialog.FOLDER)
            else:
                filters = ('RAW mask (*.raw)',) if kind == 'mask' else ('EVI 图像 (*.evi;*.EVI)',)
                selected = self._window.create_file_dialog(webview.FileDialog.OPEN, file_types=filters)
            return {'path': selected[0] if selected else None}
        except Exception as exc:
            return {'error': str(exc)}

    def status(self):
        with self._lock:
            return dict(self._state)

    def start_job(self, config):
        try:
            for key in ('object', 'air', 'mask'):
                if not Path(config.get(key, '')).is_file():
                    raise ValueError(f'请选择有效的 {key} 文件。')
            if not str(config.get('output', '')).strip():
                raise ValueError('请选择输出目录。')
            if config.get('mode') not in ('volume', 'mean'):
                raise ValueError('请选择处理模式。')
            with self._lock:
                if self._state['state'] == 'running':
                    raise ValueError('已有任务正在处理。')
                self._state = {'state': 'running', 'progress': 0, 'message': '正在检查输入…', 'result': None}
                self._cancel.clear()
            threading.Thread(target=self._work, args=(dict(config),), daemon=True).start()
            return {'ok': True}
        except Exception as exc:
            return {'error': str(exc)}

    def _work(self, config):
        def progress(percent, message):
            with self._lock:
                self._state.update(progress=percent, message=message)
        try:
            result, report = process(config['object'], config['air'], config['mask'], config['output'],
                                     config['mode'], progress=progress, cancel=self._cancel,
                                     export_raw=bool(config.get('export_raw', False)))
            with self._lock:
                self._state.update(state='complete', progress=100, message='处理完成，输出已验证。',
                                   result=str(result), report=report)
        except Exception as exc:
            with self._lock:
                self._state.update(state='cancelled' if isinstance(exc, Cancelled) else 'error', message=str(exc))

    def cancel_job(self):
        self._cancel.set()
        return {'ok': True}

    def open_result(self):
        result = self.status().get('result')
        if result and Path(result).is_dir():
            os.startfile(result)
        return {'ok': bool(result)}

    def preview(self, path, index=0, low=None, high=None):
        """Display conversion only. Never modifies input or processing values."""
        try:
            source = Path(path)
            if not source.is_file():
                raise ValueError('请先选择图像文件。')
            if source.suffix.lower() == '.evi':
                data, _ = read_evi(source)
            elif source.suffix.lower() in ('.tif', '.tiff'):
                data = tifffile.memmap(source)
            else:
                raise ValueError('预览支持 EVI / TIFF。')
            depth = data.shape[0] if data.ndim == 3 else 1
            index = max(0, min(int(index), depth - 1))
            frame = np.array(data[index] if data.ndim == 3 else data, dtype=np.float32, copy=True)
            # Closing only our owned TIFF mmap; EVI backing is owned by ndarray base.
            if isinstance(data, np.memmap):
                data._mmap.close()
            if frame.ndim != 2:
                raise ValueError('只支持单通道图像预览。')
            finite = frame[np.isfinite(frame)]
            if not finite.size:
                raise ValueError('图像无有效像素。')
            if low is None or high is None:
                low, high = map(float, np.percentile(finite, [1, 99]))
                if high <= low:
                    high = low + 1
            low, high = float(low), float(high)
            if not np.isfinite([low, high]).all() or high <= low:
                raise ValueError('显示上限必须大于下限。')
            grey = (np.clip(np.nan_to_num((frame.astype(np.float64)-low)/(high-low)), 0, 1)*255).astype(np.uint8)
            buf = io.BytesIO()
            Image.fromarray(grey).save(buf, format='PNG')
            return {'url': 'data:image/png;base64,' + base64.b64encode(buf.getvalue()).decode('ascii'),
                    'width': frame.shape[1], 'height': frame.shape[0], 'depth': depth, 'index': index,
                    'low': low, 'high': high, 'name': source.name}
        except Exception as exc:
            return {'error': str(exc)}

    def _closing(self):
        if self.status()['state'] == 'running':
            if not self._window.create_confirmation_dialog('正在处理', '退出将取消当前处理。确定退出吗？'):
                return False
            self._cancel.set()
        return True


def main():
    api = StudioAPI()
    webview.settings['ALLOW_DOWNLOADS'] = True
    webview.settings['OPEN_DEVTOOLS_IN_DEBUG'] = False
    webview.settings['OPEN_EXTERNAL_LINKS_IN_BROWSER'] = False
    window = webview.create_window('Image Studio', str(ROOT/'web/index.html'), js_api=api,
                                  width=1440, height=980, min_size=(1080, 720),
                                  background_color='#0e131a', text_select=True)
    api._window = window
    window.events.closing += api._closing
    def native_icon():
        # Windows taskbar/window icon as well as embedded executable icon.
        try:
            from System.Drawing import Icon
            from System import Action
            window.native.Invoke(Action(lambda: setattr(window.native, 'Icon', Icon(str(ROOT/'web/assets/app_icon_transparent.ico')))))
        except Exception:
            pass
    window.events.shown += native_icon
    if '--self-test' in sys.argv:
        from qa_smoke import run
        webview.start(run, (window, api, Path(sys.argv[sys.argv.index('--self-test') + 1])), gui='edgechromium', private_mode=False)
    else:
        webview.start(gui='edgechromium', private_mode=False)


if __name__ == '__main__':
    main()
