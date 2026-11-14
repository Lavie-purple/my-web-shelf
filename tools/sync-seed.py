#!/usr/bin/env python3
"""把 data.json 同步进 index.html 的内嵌 seed 块 + 首屏默认皮肤。

线上（GitHub Pages）永远以 data.json 为准；内嵌 seed 只在用 file://
直接双击 index.html 时兜底。改完 data.json 跑一次这个脚本，
本地双击预览就能看到同样的内容。

同时把 settings.skin 写进 <body data-skin="...">，让站点默认外观在
JS 加载前就生效，避免访客首屏闪一下旧皮肤。
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HTML = ROOT / "index.html"
DATA = ROOT / "data.json"


def main():
    obj = json.loads(DATA.read_text(encoding="utf-8"))
    seed = json.dumps(obj, ensure_ascii=False, separators=(",", ":"))
    if "</script" in seed.lower():
        sys.exit("data.json 里含有 </script，无法安全内嵌")

    text = HTML.read_text(encoding="utf-8")
    pattern = r'(<script\s+type="application/json"\s+id="seed">)(.*?)(</script>)'
    new, count = re.subn(
        pattern,
        lambda m: m.group(1) + seed + m.group(3),
        text,
        count=1,
        flags=re.S | re.I,
    )
    if count != 1:
        sys.exit("没在 index.html 里找到 seed 块")

    skin = obj.get("settings", {}).get("skin", "wood")
    if skin not in ("wood", "gallery", "glass", "editorial", "terminal"):
        skin = "wood"
    new, skin_count = re.subn(
        r'(<body\b[^>]*\bdata-skin=")[^"]*(")',
        lambda m: m.group(1) + skin + m.group(2),
        new,
        count=1,
        flags=re.S | re.I,
    )
    if skin_count != 1:
        sys.exit("没在 index.html 的 <body> 上找到 data-skin 属性")

    HTML.write_text(new, encoding="utf-8")
    total = sum(len(g.get("items", [])) for g in obj.get("groups", []))
    print(f"已同步：{len(obj.get('groups', []))} 个分组 / {total} 个网页 → index.html 内嵌 seed")
    print(f"首屏默认外观：{skin} → <body data-skin=\"{skin}\">")


if __name__ == "__main__":
    main()
