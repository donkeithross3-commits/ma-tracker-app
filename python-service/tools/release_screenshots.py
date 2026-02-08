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

from playwright.async_api import async_playwright, Page
from PIL import Image, ImageDraw, ImageFont


# ---------------------------------------------------------------------------
# Annotation constants (base values at 1x — scaled by DPR at runtime)
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
    """Draws clean, consistent annotations on a screenshot.

    All coordinate inputs are in CSS pixels.  The constructor detects the
    device-pixel-ratio (DPR) by comparing the actual image size to the
    expected CSS viewport size and scales everything automatically.
    """

    def __init__(self, image: Image.Image, css_viewport: dict[str, int]):
        self.image = image.convert("RGBA")
        self.overlay = Image.new("RGBA", self.image.size, (0, 0, 0, 0))
        self.draw = ImageDraw.Draw(self.overlay)

        # Detect DPR from actual image dimensions vs CSS viewport
        self.dpr = image.width / css_viewport["width"] if css_viewport["width"] else 1
        if self.dpr < 0.9 or self.dpr > 3.1:
            print(f"    Warning: unusual DPR={self.dpr:.2f} "
                  f"(image {image.width}x{image.height}, viewport {css_viewport})")
        elif self.dpr != 1.0:
            print(f"    DPR detected: {self.dpr:.1f}x "
                  f"(image {image.width}x{image.height})")

        self._load_fonts()

    # -- helpers -------------------------------------------------------------

    def _s(self, v: int | float) -> int:
        """Scale a CSS-pixel value to image pixels."""
        return int(v * self.dpr)

    def _s_pair(self, x: int | float, y: int | float) -> tuple[int, int]:
        return (self._s(x), self._s(y))

    def _s_bbox(self, bbox: tuple) -> tuple[int, int, int, int]:
        """Scale a (x, y, w, h) bbox from CSS to image pixels."""
        return (self._s(bbox[0]), self._s(bbox[1]),
                self._s(bbox[2]), self._s(bbox[3]))

    # -- fonts ---------------------------------------------------------------

    def _load_fonts(self):
        # Scale font sizes by DPR so text looks the same relative to image
        base_font = int(15 * self.dpr)
        base_label = int(17 * self.dpr)
        base_badge = int(14 * self.dpr)

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
                    self.font = ImageFont.truetype(fp, base_font)
                    self.font_label = ImageFont.truetype(fp, base_label)
                    self.font_badge = ImageFont.truetype(fp, base_badge)
                    loaded = True
                    break
                except Exception:
                    continue
        if not loaded:
            self.font = ImageFont.load_default()
            self.font_label = self.font
            self.font_badge = self.font

    # -- primitives ----------------------------------------------------------

    def circle(self, bbox_css: tuple[int, int, int, int], label: str = "", padding: int = 14):
        """Red circle framing a bounding box [x, y, w, h] in CSS pixels."""
        x, y, w, h = self._s_bbox(bbox_css)
        pad = self._s(padding)
        stroke = max(2, self._s(CIRCLE_STROKE))

        cx, cy = x + w // 2, y + h // 2
        rx = w // 2 + pad
        ry = h // 2 + pad
        for offset in range(stroke):
            self.draw.ellipse(
                [cx - rx - offset, cy - ry - offset, cx + rx + offset, cy + ry + offset],
                outline=RED_A,
            )
        if label:
            self._label(label, cx, y - ry - self._s(28))

    def arrow(self, start_css: tuple, end_css: tuple, label: str = ""):
        """Arrow from *start* to *end* (both in CSS pixels)."""
        start = self._s_pair(*start_css)
        end = self._s_pair(*end_css)
        stroke = max(2, self._s(ARROW_STROKE))

        self.draw.line([start, end], fill=RED_A, width=stroke)

        # Arrowhead
        angle = math.atan2(end[1] - start[1], end[0] - start[0])
        length = self._s(16)
        spread = math.pi / 6
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
            lx = start[0] - self._s(10)
            ly = start[1] - self._s(28)
            self._label_at_image_px(label, lx, ly)

    def badge(self, position_css: tuple[int, int], number: int):
        """Numbered red circle badge at CSS-pixel position."""
        x, y = self._s_pair(*position_css)
        r = self._s(14)
        self.draw.ellipse([x - r, y - r, x + r, y + r], fill=BADGE_BG)
        text = str(number)
        bb = self.draw.textbbox((0, 0), text, font=self.font_badge)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        self.draw.text((x - tw // 2, y - th // 2 - 1), text,
                       fill=(255, 255, 255), font=self.font_badge)

    def _label(self, text: str, x_img: int, y_img: int):
        """White text on dark background — coords already in image pixels."""
        self._label_at_image_px(text, x_img, y_img)

    def _label_at_image_px(self, text: str, x: int, y: int):
        bb = self.draw.textbbox((0, 0), text, font=self.font_label)
        tw, th = bb[2] - bb[0], bb[3] - bb[1]
        pad = self._s(7)
        self.draw.rounded_rectangle(
            [x - tw // 2 - pad, y - pad, x + tw // 2 + pad, y + th + pad],
            radius=self._s(5),
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

    # Create annotator — it auto-detects DPR from image vs viewport
    annotator = Annotator(img, css_viewport=vp)

    # Resolve annotations (all coordinates are in CSS pixels)
    for ann in sc.get("annotations", []):
        bbox = None

        if "selector" in ann:
            el = await page.query_selector(ann["selector"])
            if el:
                box = await el.bounding_box()
                if box:
                    # Playwright returns CSS pixels — perfect, annotator handles scaling
                    bbox = (box["x"], box["y"], box["width"], box["height"])
                else:
                    print(f"    Warning: no bounding box for {ann['selector']}")
            else:
                print(f"    Warning: selector not found: {ann['selector']}")
        elif "bbox" in ann:
            bbox = tuple(ann["bbox"])  # Expected in CSS pixels

        atype = ann["type"]
        label = ann.get("label", "")

        if atype == "circle" and bbox:
            annotator.circle(bbox, label=label)
        elif atype == "arrow" and bbox:
            # Arrow end = center of the target element
            end = (bbox[0] + bbox[2] / 2, bbox[1] + bbox[3] / 2)
            # Arrow start: explicit "from", or relative "from_offset", or default
            if "from" in ann:
                start = tuple(ann["from"])
            elif "from_offset" in ann:
                off = ann["from_offset"]
                start = (end[0] + off[0], end[1] + off[1])
            else:
                start = (bbox[0] - 80, bbox[1] - 60)
            annotator.arrow(start, end, label=label)
        elif atype == "badge":
            pos = ann.get("position") or (
                bbox[0] - 20 if bbox else 20,
                bbox[1] - 20 if bbox else 20,
            )
            annotator.badge(pos, ann.get("number", 1))

    annotator.save(output_path)


# ---------------------------------------------------------------------------
# Login
# ---------------------------------------------------------------------------
async def login_via_form(page: Page, base_url: str, email: str, password: str):
    """Log in by filling the /login form with Playwright."""
    login_url = base_url.rstrip("/") + "/login"
    print(f"  Logging in as {email} via {login_url} ...")
    await page.goto(login_url, wait_until="networkidle", timeout=20_000)

    await page.fill('input[name="email"]', email)
    await page.fill('input[name="password"]', password)
    await page.click('button[type="submit"]')

    try:
        await page.wait_for_url(lambda url: "/login" not in url, timeout=15_000)
        print(f"  Logged in successfully (redirected to {page.url})")
    except Exception:
        error_el = await page.query_selector('.bg-red-50')
        if error_el:
            error_text = await error_el.inner_text()
            raise RuntimeError(f"Login failed: {error_text}")
        raise RuntimeError(f"Login timed out. Current URL: {page.url}")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
async def process_release(
    config_path: str,
    base_url: str,
    auth_cookie: str,
    email: str,
    password: str,
    headed: bool,
):
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

        # Auth — prefer form login, fall back to cookie
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

        if email and password:
            await login_via_form(page, base_url, email, password)

        for feature in features_with_screenshots:
            fid = feature["id"]
            output_path = str(output_dir / f"{fid}.png")
            print(f"  [{fid}] {feature['title']}")
            try:
                await capture_feature(page, base_url, feature, output_path)
                feature["image"] = f"/changelog/{date}/{fid}.png"
            except Exception as e:
                print(f"    ERROR: {e}")

        await browser.close()

    with open(config_path, "w") as f:
        json.dump(release, f, indent=2)
        f.write("\n")

    print(f"\nDone. Updated {config_path} with image paths.")


def main():
    parser = argparse.ArgumentParser(
        description="Generate annotated release screenshots for the changelog"
    )
    parser.add_argument("--config", required=True,
                        help="Path to the release JSON file")
    parser.add_argument("--base-url", default="https://dr3-dashboard.com",
                        help="Base URL to capture from (default: production)")
    parser.add_argument("--auth-cookie", default="",
                        help="Session cookie value for authentication")
    parser.add_argument("--email", default="",
                        help="Login email (alternative to --auth-cookie)")
    parser.add_argument("--password", default="",
                        help="Login password (alternative to --auth-cookie)")
    parser.add_argument("--headed", action="store_true",
                        help="Run with visible browser (for debugging)")
    args = parser.parse_args()

    asyncio.run(process_release(
        args.config, args.base_url, args.auth_cookie,
        args.email, args.password, args.headed,
    ))


if __name__ == "__main__":
    main()
