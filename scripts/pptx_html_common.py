#!/usr/bin/env python3
"""Convert a PPTX template into a standalone, text-editable HTML slide deck.

Visual strategy: render a text-free copy of every slide as the visual backdrop,
then rebuild ordinary PPT text boxes as positioned HTML contenteditable layers.
This keeps master graphics, EMF artwork and complex freeforms faithful while
leaving ordinary text editable. See README.md for supported editing boundaries.
"""
from __future__ import annotations

import argparse
import base64
import copy
import html
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
from typing import Iterable

import fitz  # PyMuPDF
from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.dml import MSO_COLOR_TYPE
from pptx.enum.shapes import MSO_SHAPE_TYPE
from pptx.oxml.ns import qn

CANVAS_W = 1280
CANVAS_H = 720


def find_office() -> str:
    exe = shutil.which("libreoffice") or shutil.which("soffice")
    if not exe:
        raise RuntimeError("需要 LibreOffice：请安装 libreoffice-impress，并确保 libreoffice 在 PATH 中。")
    return exe


def emu(value: int, total: int, pixels: int) -> float:
    return value / total * pixels


def esc(value: object) -> str:
    return html.escape(str(value), quote=True)


def rgb_hex(rgb: RGBColor) -> str:
    return f"#{rgb}"


def apply_luminance(hex_color: str, lum_mod: int | None, lum_off: int | None) -> str:
    if lum_mod is None and lum_off is None:
        return hex_color
    raw = hex_color.lstrip("#")
    values = [int(raw[i:i + 2], 16) for i in (0, 2, 4)]
    mod = (lum_mod if lum_mod is not None else 100000) / 100000
    off = (lum_off if lum_off is not None else 0) / 100000
    values = [round(max(0, min(1, channel / 255 * mod + off)) * 255) for channel in values]
    return "#" + "".join(f"{v:02X}" for v in values)


def xml_color(element, default: str = "#000000") -> str:
    """Read DrawingML RGB/scheme color, including the common luminance modifiers."""
    if element is None:
        return default
    solid = element.find(qn("a:solidFill"))
    if solid is None:
        return default
    rgb = solid.find(qn("a:srgbClr"))
    if rgb is not None:
        return apply_luminance(
            "#" + rgb.get("val", "000000"),
            _child_int(rgb, "a:lumMod"),
            _child_int(rgb, "a:lumOff"),
        )
    scheme = solid.find(qn("a:schemeClr"))
    if scheme is not None:
        theme = {
            "bg1": "#FFFFFF", "lt1": "#FFFFFF", "tx1": "#000000", "dk1": "#000000",
            "bg2": "#E7E6E6", "lt2": "#E7E6E6", "tx2": "#44546A", "dk2": "#44546A",
            "accent1": "#4472C4", "accent2": "#ED7D31", "accent3": "#A5A5A5",
            "accent4": "#FFC000", "accent5": "#5B9BD5", "accent6": "#70AD47",
        }
        base = theme.get(scheme.get("val", "tx1"), "#000000")
        return apply_luminance(base, _child_int(scheme, "a:lumMod"), _child_int(scheme, "a:lumOff"))
    return default


def _child_int(element, tag: str) -> int | None:
    child = element.find(qn(tag))
    return int(child.get("val")) if child is not None else None


def run_style(run, paragraph) -> str:
    font = run.font
    rpr = run._r.get_or_add_rPr()
    # East Asian typeface matters for Chinese text even when python-pptx returns the Latin font.
    ea = rpr.find(qn("a:ea"))
    typeface = (ea.get("typeface") if ea is not None else None) or font.name or "Microsoft YaHei"
    size = font.size.pt if font.size else None
    if size is None:
        size = inherited_font_size(paragraph) or 18
    color = "#000000"
    try:
        if font.color.type == MSO_COLOR_TYPE.RGB:
            color = rgb_hex(font.color.rgb)
        elif font.color.type is not None:
            color = xml_color(rpr)
        else:
            color = xml_color(rpr, xml_color(inherited_rpr(paragraph), "#000000"))
    except (AttributeError, TypeError):
        color = xml_color(rpr, "#000000")
    styles = [
        f'font-family:"{esc(typeface)}","Microsoft YaHei","Noto Sans CJK SC",Arial,sans-serif',
        f"font-size:{size * 96 / 72:.3f}px",
        f"color:{color}",
        f"font-weight:{700 if font.bold else 400}",
        f"font-style:{'italic' if font.italic else 'normal'}",
    ]
    if font.underline:
        styles.append("text-decoration:underline")
    return ";".join(styles)


def inherited_rpr(paragraph):
    level = paragraph.level + 1
    tx_body = paragraph._p.getparent()
    list_style = tx_body.find(qn("a:lstStyle"))
    if list_style is not None:
        level_props = list_style.find(qn(f"a:lvl{level}pPr"))
        if level_props is not None:
            rpr = level_props.find(qn("a:defRPr"))
            if rpr is not None:
                return rpr
    ppr = paragraph._p.find(qn("a:pPr"))
    return ppr.find(qn("a:defRPr")) if ppr is not None else None


def inherited_font_size(paragraph) -> float | None:
    rpr = inherited_rpr(paragraph)
    if rpr is not None and rpr.get("sz"):
        return int(rpr.get("sz")) / 100
    return None


def paragraph_html(paragraph) -> str:
    align_map = {1: "left", 2: "center", 3: "right", 4: "justify"}
    align = align_map.get(int(paragraph.alignment) if paragraph.alignment is not None else None, "left")
    line = paragraph.line_spacing if isinstance(paragraph.line_spacing, float) else 1.15
    pieces = []
    for run in paragraph.runs:
        # br elements are not represented as runs; normal template paragraphs are covered here.
        pieces.append(f'<span style="{esc(run_style(run, paragraph))}">{esc(run.text)}</span>')
    if not pieces:
        pieces.append("<br>")
    return f'<p style="text-align:{align};line-height:{line:.3f}">' + "".join(pieces) + "</p>"


def iter_text_shapes(shapes) -> Iterable:
    for shape in shapes:
        if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
            yield from iter_text_shapes(shape.shapes)
        elif getattr(shape, "has_text_frame", False) and shape.text.strip():
            yield shape


def text_layer(shape, slide_w: int, slide_h: int, shape_id: int) -> str:
    frame = shape.text_frame
    left = emu(shape.left, slide_w, CANVAS_W)
    top = emu(shape.top, slide_h, CANVAS_H)
    width = emu(shape.width, slide_w, CANVAS_W)
    height = emu(shape.height, slide_h, CANVAS_H)
    padding = [
        emu(frame.margin_top or 0, slide_h, CANVAS_H),
        emu(frame.margin_right or 0, slide_w, CANVAS_W),
        emu(frame.margin_bottom or 0, slide_h, CANVAS_H),
        emu(frame.margin_left or 0, slide_w, CANVAS_W),
    ]
    anchor = str(frame.vertical_anchor or "TOP").split()[0]
    justify = {"MIDDLE": "center", "BOTTOM": "flex-end"}.get(anchor, "flex-start")
    rotation = f"rotate({shape.rotation}deg)" if shape.rotation else "none"
    paragraphs = "".join(paragraph_html(p) for p in frame.paragraphs)
    return (
        f'<div class="ppt-text" data-shape-id="{shape_id}" data-source-name="{esc(shape.name)}" '
        f'contenteditable="true" spellcheck="false" '
        f'style="left:{left:.3f}px;top:{top:.3f}px;width:{width:.3f}px;height:{height:.3f}px;'
        f'padding:{padding[0]:.3f}px {padding[1]:.3f}px {padding[2]:.3f}px {padding[3]:.3f}px;'
        f'justify-content:{justify};transform:{rotation}">'
        f'<div class="ppt-text-body">{paragraphs}</div></div>'
    )


def strip_text_and_notes(prs: Presentation, strip_pictures: bool = False) -> None:
    """Remove visible text from slide shapes only, retaining graphics and master/layout content."""
    for slide in prs.slides:
        for text in slide._element.findall(".//" + qn("a:t")):
            text.text = ""
        if strip_pictures:
            for picture in list(slide._element.findall(".//" + qn("p:pic"))):
                picture.getparent().remove(picture)
        # Do not carry speaker notes into the rendered backdrop or exported HTML.


def render_backdrops(source: Path, work: Path, prs: Presentation, strip_pictures: bool = False) -> list[str]:
    blank = copy.deepcopy(prs)
    strip_text_and_notes(blank, strip_pictures)
    blank_path = work / "visual-backdrops.pptx"
    blank.save(blank_path)
    subprocess.run(
        [find_office(), "--headless", "--convert-to", "pdf", "--outdir", str(work), str(blank_path)],
        check=True, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, timeout=180,
    )
    pdf_path = work / "visual-backdrops.pdf"
    if not pdf_path.exists():
        raise RuntimeError("LibreOffice 未生成 PDF，无法制作高保真背景。")
    document = fitz.open(pdf_path)
    if len(document) != len(prs.slides):
        raise RuntimeError(f"页数不一致：PPT {len(prs.slides)} 页，PDF {len(document)} 页。")
    images = []
    for index, page in enumerate(document, 1):
        pixmap = page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False)
        png_path = work / f"slide-{index}.png"
        pixmap.save(png_path)
        encoded = base64.b64encode(png_path.read_bytes()).decode("ascii")
        images.append("data:image/png;base64," + encoded)
    return images


