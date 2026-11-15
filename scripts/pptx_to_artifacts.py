#!/usr/bin/env python3
"""Convert PPTX to native, editable DSH Artifacts HTML-PPT.

Ordinary text boxes and pictures become selectable/positionable HTML elements.
Master artwork and complex vector shapes stay in a faithful per-slide backdrop.
All assets are embedded as data URLs; the result needs no sidecar files.
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile

from PIL import Image, ImageChops
from pptx import Presentation
from pptx.enum.shapes import MSO_SHAPE_TYPE

from pptx_html_common import (
    CANVAS_H, CANVAS_W, emu, esc, find_office, iter_text_shapes,
    render_backdrops, text_layer,
)


def data_url(data: bytes, mime: str = "image/png") -> str:
    return f"data:{mime};base64," + base64.b64encode(data).decode("ascii")


def trim_white(image: Image.Image) -> Image.Image:
    rgba = image.convert("RGBA")
    white = Image.new("RGBA", rgba.size, (255, 255, 255, 255))
    difference = ImageChops.difference(rgba, white).convert("RGB")
    bounds = difference.getbbox()
    return rgba.crop(bounds) if bounds else rgba


def picture_bytes(shape, work: Path, cache: dict[str, bytes]) -> bytes:
    source = shape.image.blob
    crop = (shape.crop_left, shape.crop_top, shape.crop_right, shape.crop_bottom)
    key = hashlib.sha256(source + repr(crop).encode()).hexdigest()
    if key in cache:
        return cache[key]
    try:
        image = Image.open(io.BytesIO(source))
        image.load()
    except Exception:
        # Browsers cannot render EMF/WMF. LibreOffice Draw rasterizes them locally.
        suffix = Path(shape.image.filename).suffix or ".emf"
        vector = work / f"vector-{key[:16]}{suffix}"
        vector.write_bytes(source)
        subprocess.run(
            [find_office(), "--headless", "--convert-to", "png", "--outdir", str(work), str(vector)],
            check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, timeout=90,
        )
        converted = vector.with_suffix(".png")
        if not converted.exists():
            raise RuntimeError(f"无法转换图片 {shape.name}")
        image = trim_white(Image.open(converted))
    if any(abs(value) > 0.000001 for value in crop):
        left, top, right, bottom = crop
        width, height = image.size
        box = (
            max(0, round(width * left)), max(0, round(height * top)),
            min(width, round(width * (1 - right))), min(height, round(height * (1 - bottom))),
        )
        if box[2] <= box[0] or box[3] <= box[1]:
            raise RuntimeError(f"图片 {shape.name} 的裁剪区域无效")
        image = image.crop(box)
    output = io.BytesIO()
    if image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA")
    image.save(output, format="PNG", optimize=True)
    cache[key] = output.getvalue()
    return cache[key]


def iter_objects(shapes):
    for shape in shapes:
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from iter_objects(shape.shapes)
        else:
            yield shape


def picture_layer(shape, slide_w: int, slide_h: int, work: Path, cache: dict[str, bytes], z_index: int) -> str:
    position = (
        f"left:{emu(shape.left, slide_w, CANVAS_W):.3f}px;"
        f"top:{emu(shape.top, slide_h, CANVAS_H):.3f}px;"
        f"width:{emu(shape.width, slide_w, CANVAS_W):.3f}px;"
        f"height:{emu(shape.height, slide_h, CANVAS_H):.3f}px"
    )
    rotation = f"rotate({shape.rotation}deg)" if shape.rotation else "none"
    source = data_url(picture_bytes(shape, work, cache))
    return (
        f'<img class="ppt-picture" data-ppt-role="picture" data-source-name="{esc(shape.name)}" '
        f'alt="{esc(shape.name)}" draggable="false" src="{source}" '
        f'style="{position};transform:{rotation};z-index:{z_index}">'
    )


NATIVE_CSS = """
html,body{margin:0;padding:0;width:100%;height:100%;background:#fff}
.slides,.slide{width:1280px;height:720px}
.slide{position:relative;overflow:hidden;background:#fff;page-break-after:always}
.ppt-backdrop{position:absolute;inset:0;width:1280px;height:720px;object-fit:fill;pointer-events:none;user-select:none;z-index:0}
.ppt-text,.ppt-picture{position:absolute;box-sizing:border-box}
.ppt-text{display:flex;align-items:stretch;overflow:visible;white-space:normal}
.ppt-text-body{width:100%;min-height:1em}
.ppt-text p{margin:0;padding:0;min-height:1em}
.ppt-text span{white-space:pre-wrap}
.ppt-picture{object-fit:fill;user-select:none}
@media print{@page{size:13.333333in 7.5in;margin:0}.slide{width:1280px;height:720px}}
@media screen and (max-width:1280px){body{overflow:auto}}
"""


def native_html(source: Path, prs: Presentation, backdrops: list[str], work: Path) -> str:
    cache: dict[str, bytes] = {}
    pages = []
    editable_text = 0
    editable_pictures = 0
    for page_number, (slide, backdrop) in enumerate(zip(prs.slides, backdrops), 1):
        elements = []
        # A stable z-index preserves the relative order of editable text and pictures.
        for z_index, shape in enumerate(iter_objects(slide.shapes), 1):
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                elements.append(picture_layer(shape, prs.slide_width, prs.slide_height, work, cache, z_index))
                editable_pictures += 1
            elif getattr(shape, "has_text_frame", False) and shape.text.strip():
                layer = text_layer(shape, prs.slide_width, prs.slide_height, z_index)
                layer = layer.replace('class="ppt-text"', 'class="ppt-text" data-ppt-role="text"', 1)
                layer = layer.replace("contenteditable=\"true\"", "contenteditable=\"false\"")
                layer = layer.replace("transform:none\">", f"transform:none;z-index:{z_index}\">")
                layer = layer.replace(f"transform:rotate({shape.rotation}deg)\">", f"transform:rotate({shape.rotation}deg);z-index:{z_index}\">")
                elements.append(layer)
                editable_text += 1
        title = next((shape.text.strip().splitlines()[0] for shape in iter_text_shapes(slide.shapes) if shape.text.strip()), f"第 {page_number} 页")
        pages.append(
            f'<section class="slide" data-slide="{page_number}" data-title="{esc(title)}" aria-label="第 {page_number} 页：{esc(title)}">'
            f'<img class="ppt-backdrop" data-ppt-role="backdrop" alt="" draggable="false" src="{backdrop}">'
            + "".join(elements) + "</section>"
        )
    metadata = esc(json.dumps({
        "source": source.name, "slides": len(prs.slides), "canvas": [CANVAS_W, CANVAS_H],
        "editableTextBoxes": editable_text, "editablePictures": editable_pictures,
        "converter": "dsh-artifacts/pptx_to_artifacts.py",
    }, ensure_ascii=False))
    return (
        '<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<meta name="dsh-artifacts-pptx" content="{metadata}">'
        f'<title>{esc(source.stem)}</title><style>{NATIVE_CSS}</style></head>'
        '<body><main class="slides">' + "".join(pages) + "</main></body></html>"
    )


def convert(source: Path, output: Path) -> dict:
    source = source.resolve()
    output = output.resolve()
    if source.suffix.lower() != ".pptx":
        raise ValueError("只支持 .pptx 文件；请先将旧版 .ppt 另存为 .pptx")
    if not source.is_file():
        raise FileNotFoundError(f"PPTX 文件不存在：{source}")
    if output.suffix.lower() not in (".html", ".htm"):
        raise ValueError("输出文件必须使用 .html 或 .htm 后缀")
    if source == output:
        raise ValueError("输出文件不能覆盖源 PPTX")
    prs = Presentation(source)
    if not prs.slides:
        raise ValueError("PPTX 没有幻灯片")
    with tempfile.TemporaryDirectory(prefix="dsh-pptx-") as temporary:
        work = Path(temporary)
        backdrops = render_backdrops(source, work, prs, strip_pictures=True)
        result = native_html(source, prs, backdrops, work)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(result, encoding="utf-8")
    return {
        "slides": len(prs.slides),
        "textBoxes": result.count('data-ppt-role="text"'),
        "pictures": result.count('data-ppt-role="picture"'),
        "bytes": len(result.encode("utf-8")),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="PPTX → DSH Artifacts 原生可编辑 HTML-PPT")
    parser.add_argument("input", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--overwrite", action="store_true")
    args = parser.parse_args()
    if args.output.exists() and not args.overwrite:
        raise FileExistsError(f"输出文件已存在：{args.output}；如需覆盖请使用 --overwrite")
    stats = convert(args.input, args.output)
    print(json.dumps({"ok": True, "output": str(args.output.resolve()), **stats}, ensure_ascii=False))


if __name__ == "__main__":
    try:
        main()
    except Exception as cause:
        print(json.dumps({"ok": False, "error": str(cause)}, ensure_ascii=False), file=sys.stderr)
        raise SystemExit(1) from cause
