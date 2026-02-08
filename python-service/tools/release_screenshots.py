#!/usr/bin/env python3
"""
Release Screenshot Tool
=======================
Captures annotated screenshots from production for the changelog.

Usage:
    # Capture all screenshots for a release
    python release_screenshots.py --config ../../release-notes/2026-02-08.json

    # Against local dev
    python release_screenshots.py --config ../../release-notes/2026-02-08.json --base-url http://localhost:3000

    # With visible browser for debugging
    python release_screenshots.py --config ../../release-notes/2026-02-08.json --headed

    # With auth cookie (grab from browser devtools)
    python release_screenshots.py --config ../../release-notes/2026-02-08.json --auth-cookie "eyJhbGci..."

Prerequisites:
    pip install -r requirements.txt
    playwright install chromium
"""

import asyncio
import json
import argparse
import math
import os
from io import BytesIO
from pathlib import Path
from typing import Optional

from playwright.async_api import async_playwright, Page
from PIL import Image, ImageDraw, ImageFont


# ---------------------------------------------------------------------------
# Annotation constants
# ---------------------------------------------------------------------------
RED = (239, 68, 68)
RED_A = (239, 68, 68, 200)
BADGE_BG = (239, 68, 68, 230)
LABEL_BG = (17, 24, 39, 210)       # gray-900 @ 82%
LABEL_TEXT = (255, 255, 255)
CIRCLE_STROKE = 3
ARROW_STROKE = 3


# ---------------------------------------------------------------------------
# Annotator
# ---------------------------------------------------------------------------
class Annotator:
    """Draws clean, consistent annotations on a screenshot."""

    def __init__(self, image: Image.Image):
        self.image = image.convert("RGBA")
        self.overlay = Image.new("RGBA", self.image.size, (0, 0, 0, 0))
        self.draw = ImageDraw.Draw(self.overlay)
        self._load_fonts()

    # -- fonts ---------------------------------------------------------------

    def _load_fonts(self):
        candidates = [
            "/System/Library/Fonts/Helvetica.ttc",
            "/System/Library/Fonts/SFNSText.ttf",
            "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
            "C:/Windows/Fonts/segoeui.ttf",
        ]
        loaded = False
        for fp in candidates:
            if os.path.exists(fp):
                try:
                    self.font = ImageFont.truetype(fp, 15)
                    self.font_label = ImageFont.truetype(fp, 17)
                    self.font_badge = ImageFont.truetype(fp, 14)
                    loaded = True
                    break
                except Exception:
                    continue
        if not loaded:
            self.font = ImageFont.load_default()
            self.font_label = self.font
            self.font_badge = self.font

    # -- primitives ----------------------------------------------------------

    def circle(self, bbox: tuple[int, int, int, int], label: str = "", padding: int = 14):
        """Red circle framing a bounding box [x, y, w, h]."""
        x, y, w, h = bbox
        cx, cy = x + w // 2, y + h // 2
        rx = w // 2 + padding
        ry = h // 2 + padding
        for offset in range(CIRCLE_STROKE):
            self.draw.ellipse(
                [cx - rx - offset, cy - ry - offset, cx + rx + offset, cy + ry + offset],
                outline=RED_A,
            )
        if label:
            self._label(label, cx, y - ry - 28)

    def arrow(self, start: tuple[int, int], end: tuple[int, int], label: str = ""):
        """Arrow from *start* to *end* with optional label near the start."""
        self.draw.line([start, end], fill=RED_A, width=ARROW_STROKE)
        # arrowhead
        angle = math.atan2(end[1] - start[1], end[0] - start[0])
        length, spread = 16, math.pi / 6
        left = (
            end[0] - length * math.cos(angle - spread),
            end[1] - length * math.sin(angle - spread),
        )
        right = (
            end[0] - length * math.cos(angle + spread),
            end[1] - length * math.sin(angle + spread),
        )
        self.draw.polygon([end, left, right], fill=RED_A)
        if label:
            lx = start[0] - 10
            ly = start[1] - 28
            self._label(label, lx, ly)

    def badge(self, position: tuple[int, int], number: int):
        """Numbered red circle badge."""
        x, y = position
        r = 14
        self.draw.ellipse([x - r, y - r, x + r, y + r], fill=BADGE_BG)
        text = str(number)
        bb = self.draw.textbbox((0, 0), text, font=self.font_badge)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        self.draw.text((x - tw // 2, y - th // 2 - 1), text, fill=(255, 255, 255), font=self.font_badge)

    def _label(self, text: str, x: int, y: int):
        """White text on a dark rounded-rect background."""
        bb = self.draw.textbbox((0, 0), text, font=self.font_label)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        pad = 7
        self.draw.rounded_rectangle(
            [x - tw // 2 - pad, y - pad, x + tw // 2 + pad, y + th + pad],
            radius=5,
            fill=LABEL_BG,
        )
        self.draw.text((x - tw // 2, y), text, fill=LABEL_TEXT, font=self.font_label)

    # -- output --------------------------------------------------------------

    def save(self, filepath: str):
        result = Image.alpha_composite(self.image, self.overlay).convert("RGB")
        os.makedirs(os.path.dirname(filepath), exist_ok=True)
        result.save(filepath, quality=92)
        print(f"    Saved: {filepath}")


# ---------------------------------------------------------------------------
# Screenshot capture
# ---------------------------------------------------------------------------
async def capture_feature(page: Page, base_url: str, feature: dict, output_path: str):
    """Navigate, perform actions, capture screenshot, annotate, save."""
    sc = feature.get("screenshot", {})
    vp = sc.get("viewport", {"width": 1400, "height": 900})
    await page.set_viewport_size(vp)

    url = base_url.rstrip("/") + sc.get("path", "/")
    print(f"    Navigating to {url}")
    await page.goto(url, wait_until="networkidle", timeout=30_000)

    # Pre-capture actions
    for action in sc.get("actions", []):
        atype = action["type"]
        if atype == "click":
            await page.click(action["selector"])
            await page.wait_for_timeout(500)
        elif atype == "wait":
            await page.wait_for_timeout(action.get("ms", 1000))
        elif atype == "scroll_to":
            await page.evaluate(
                f"document.querySelector('{action['selector']}')?.scrollIntoView({{behavior:'smooth',block:'center'}})"
            )
            await page.wait_for_timeout(600)
        elif atype == "wait_for":
            await page.wait_for_selector(action["selector"], timeout=10_000)

    # Settle
    await page.wait_for_timeout(800)

    # Capture
    raw = await page.screenshot(full_page=sc.get("full_page", False))
    img = Image.open(BytesIO(raw))
    annotator = Annotator(img)

    # Resolve annotations
    for ann in sc.get("annotations", []):
        # Resolve bounding box from selector or explicit bbox
        bbox = None
        if "selector" in ann:
            el = await page.query_selector(ann["selector"])
            if el:
                box = await el.bounding_box()
                if box:
                    bbox = (int(box["x"]), int(box["y"]), int(box["width"]), int(box["height"]))
                else:
                    print(f"    Warning: no bounding box for {ann['selector']}")
            else:
                print(f"    Warning: selector not found: {ann['selector']}")
        elif "bbox" in ann:
            bbox = tuple(ann["bbox"])

        atype = ann["type"]
        label = ann.get("label", "")

        if atype == "circle" and bbox:
            annotator.circle(bbox, label=label)
        elif atype == "arrow" and bbox:
            # Default arrow origin: above-left of the element
            start = tuple(ann.get("from", (bbox[0] - 80, bbox[1] - 60)))
            end = (bbox[0] + bbox[2] // 2, bbox[1] + bbox[3] // 2)
            annotator.arrow(start, end, label=label)
        elif atype == "badge":
            pos = ann.get("position") or (bbox[0] - 20 if bbox else 20, bbox[1] - 20 if bbox else 20)
            annotator.badge(pos, ann.get("number", 1))

    annotator.save(output_path)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
async def process_release(config_path: str, base_url: str, auth_cookie: str, headed: bool):
    with open(config_path) as f:
        release = json.load(f)

    date = release["date"]
    project_root = Path(config_path).resolve().parent.parent
    output_dir = project_root / "public" / "changelog" / date
    output_dir.mkdir(parents=True, exist_ok=True)

    features_with_screenshots = [f for f in release["features"] if f.get("screenshot")]
    if not features_with_screenshots:
        print("No features with screenshot configs found.")
        return

    print(f"Release: {release['title']}")
    print(f"Capturing {len(features_with_screenshots)} screenshot(s) from {base_url}")
    print(f"Output:  {output_dir}\n")

    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=not headed)
        context = await browser.new_context()

        # Auth
        if auth_cookie:
            domain = base_url.replace("https://", "").replace("http://", "").split(":")[0]
            is_secure = base_url.startswith("https")
            cookie_name = "__Secure-authjs.session-token" if is_secure else "authjs.session-token"
            await context.add_cookies([{
                "name": cookie_name,
                "value": auth_cookie,
                "domain": domain,
                "path": "/",
                "secure": is_secure,
                "httpOnly": True,
            }])

        page = await context.new_page()

        for feature in features_with_screenshots:
            fid = feature["id"]
            output_path = str(output_dir / f"{fid}.png")
            print(f"  [{fid}] {feature['title']}")
            try:
                await capture_feature(page, base_url, feature, output_path)
                # Update image path in the release JSON
                feature["image"] = f"/changelog/{date}/{fid}.png"
            except Exception as e:
                print(f"    ERROR: {e}")

        await browser.close()

    # Write updated JSON (with image paths filled in)
    with open(config_path, "w") as f:
        json.dump(release, f, indent=2)
        f.write("\n")

    print(f"\nDone. Updated {config_path} with image paths.")


def main():
    parser = argparse.ArgumentParser(
        description="Generate annotated release screenshots for the changelog"
    )
    parser.add_argument(
        "--config", required=True,
        help="Path to the release JSON file (e.g. ../../release-notes/2026-02-08.json)"
    )
    parser.add_argument(
        "--base-url", default="https://dr3-dashboard.com",
        help="Base URL to capture from (default: production)"
    )
    parser.add_argument(
        "--auth-cookie", default="",
        help="Session cookie value for authentication"
    )
    parser.add_argument(
        "--headed", action="store_true",
        help="Run with visible browser (for debugging)"
    )
    args = parser.parse_args()

    asyncio.run(process_release(args.config, args.base_url, args.auth_cookie, args.headed))


if __name__ == "__main__":
    main()
