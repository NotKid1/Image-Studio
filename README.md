# Image Studio

一个 Windows 桌面窗口，两个独立模块：**数据预处理**、**结果图排版**。

由原 ROI Figure Studio 与 EvilImageProcess 合并而来。支持深色、浅色和跟随系统主题，全部图像处理在本机完成。

![Image Studio 结果图排版界面](docs/roi-workspace.png)

完成下方构建后，双击 `dist/ImageStudio/ImageStudio.exe`。
复制到其他电脑时请复制整个发布文件夹，包括 `_internal`；不用安装 Python。
需要 Microsoft Edge WebView2 Runtime。

## 模块切换

顶部标签切换。两个模块各自选择文件、各自输出，不自动互相导入数据。
右上角“主题”支持深色、浅色、跟随系统，自动记住上次选择。两个模块同步切换界面配色；图像像素、ROI 画布背景设置和导出图片不受主题影响。ROI 原文件保持不变，浅色外观由独立样式文件提供。
切换标签不会清空 ROI 的图像和排版；关闭软件后，ROI 内存中的未导出内容不保留，与原工具相同。

## 数据预处理

1. 选择物体 EVI、空气 EVI。默认使用附带的 `maskplus.raw`（1=坏点）。
2. 选择体层模式或单张平均模式，设置输出目录。
3. 点击“开始处理”；需要 RAW 时另外勾选，默认只输出 TIFF 图像。

使用原 EvilImageProcess 的计算代码：物体、空气分别删除首帧、上下各裁两行、逐帧插值；空气始终平均；物体按模式保留体层或插值后平均。postlog 使用原有带 `1e-10` 数值保护的自然对数公式。

每次生成一个独立目录，包括 `object_corrected.tif`、`air_mean_corrected.tif`、`postlog.tif` 和 `report.json`。开启 RAW 选项才额外输出 RAW。原始文件不修改。

预览直接读取真实 EVI/TIFF。默认预览原始输入的第二帧（首帧一般近黑），不会改变处理规则。滚动切换帧、调整显示范围、点击全图定位、拖动/缩放局部。显示操作只影响预览，不改数据。预览保留图像真实长宽比，5120×64 探测器图像会呈长条。

处理完成后，可在预处理页右上角选择预览物体插值结果、平均空气或 postlog；这些数据不会自动进入 ROI 模块。

## 结果图排版

沿用原 ROI Figure Studio 的处理与排版脚本，通过独立界面层整理现有控件：顶部工具栏、左侧可折叠分组，以及右侧“画布 / ROI / 箭头”页签。文字样式和间距设置位于“画布”页签。未导入时可点击“查看示例”；示例不是实际导入数据。

- PNG/JPG/WebP 导入与替换；多页 TIFF 导入、多方法排序、删减。
- Z 层选择、每层显示范围、行列方向、标签、编号。
- 精确 ROI 像素坐标、同行/同列同步、局部放大、箭头和连接线。
- 撤销/重做、预览、PNG 导出。导出时选择本地保存位置。

格式限制也保持原样：标准、未压缩、单通道 TIFF，8/16/32 位整数或 float32；不新增压缩 TIFF / BigTIFF 支持。

## 合并方式与源码

- `desktop.py`：本地桌面窗口、文件对话框、预处理调用与真实图像预览。
- `web/index.html`、`studio.css`、`studio.js`：按选定效果图制作的统一界面。
- `web/roi/index.html`、`app.js`、`styles.css`：从原 ROI 项目逐字节复制，未修改功能。
- `web/roi-layout.js`、`roi-layout.css`：统一布局层，移动原控件并保留其事件处理；`roi-theme.css` 提供浅色外观。
- `pipeline.py`、`preprocess.py`、`flat_field.py`：沿用原预处理计算核心。
- `docs/source_integrity.json`：原 ROI 源文件 SHA-256 校验值。

旧的 `ROI_figure` 和 `EvilImageProcess` 项目不受影响。Image Studio 使用原 EvilImageProcess 的透明人物图标。

## 开发和构建

Windows 上安装 Python 3.12，然后在项目目录执行：

```powershell
py -3.12 -m venv .build_env
.\.build_env\Scripts\python.exe -m pip install -r requirements.txt
.\.build_env\Scripts\python.exe desktop.py
.\.build_env\Scripts\python.exe -m unittest -v test_pipeline.py test_flat_field.py test_preprocess.py
.\build.ps1
```

仓库包含源码、默认坏点 mask 和界面资源；不包含实验原始数据、处理输出、Python 环境或打包产物。构建生成完整的 `dist/ImageStudio` 文件夹，分发时请保留其中的依赖文件。

可运行 `python desktop.py --self-test <结果目录>` 进行原生窗口集成检查。若需要同时验证真实 EVI 预处理，设置环境变量 `IMAGE_STUDIO_QA_DATA` 指向包含 `纵1_TE.EVI` 和 `air_TE.EVI` 的本地测试目录；未设置时仅检查界面和合成 TIFF 数据。集成检查会自动操作并关闭测试窗口。

图标来自用户提供的图片。界面工具图标使用 Bootstrap Icons（MIT），许可证位于 `web/assets/icons/LICENSE`。
桌面容器使用 pywebview：[官方 API 文档](https://pywebview.flowrl.com/api/)。
