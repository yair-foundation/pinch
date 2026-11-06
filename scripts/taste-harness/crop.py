# Pinch-style package images for one take: marked copy (numbered boxes) and a dimmed close-up
# per note, plus each note's "Where" line (place, text under the spot, main colours), as Export gives.
# usage: python3 -I crop.py <render.png> <render-text.json> <take.json> <outdir>
import json, sys, os
from collections import Counter
from PIL import Image, ImageDraw, ImageEnhance

png, textf, takef, out = sys.argv[1:5]
img = Image.open(png).convert("RGB")
W, H = img.size
texts = json.load(open(textf))
take = json.load(open(takef))
os.makedirs(os.path.join(out, "close-ups"), exist_ok=True)
os.makedirs(os.path.join(out, "marked"), exist_ok=True)
os.makedirs(os.path.join(out, "screens"), exist_ok=True)
img.save(os.path.join(out, "screens", "1.png"))

def place(b):
    cx, cy = b["x"] + b["w"] / 2, b["y"] + b["h"] / 2
    v = "top" if cy < 1/3 else "bottom" if cy > 2/3 else "middle"
    h = "left" if cx < 1/3 else "right" if cx > 2/3 else "centre"
    return "the whole screen" if b["w"] > 0.9 and b["h"] > 0.9 else (f"{v} {h}" if (v, h) != ("middle", "centre") else "centre")

def colours(b):
    box = (int(b["x"]*W), int(b["y"]*H), int((b["x"]+b["w"])*W), int((b["y"]+b["h"])*H))
    c = Counter(img.crop(box).resize((60, 60)).quantize(8).convert("RGB").getdata())
    return ", ".join("#%02x%02x%02x" % k for k, _ in c.most_common(2))

def text_in(b):
    words = [t["t"] for t in texts if t["x"] >= b["x"] - .01 and t["y"] >= b["y"] - .01 and t["x"] + t["w"] <= b["x"] + b["w"] + .01 and t["y"] + t["h"] <= b["y"] + b["h"] + .01]
    s = " ".join(words)
    return s[:120] + ("…" if len(s) > 120 else "")

marked = img.copy(); d = ImageDraw.Draw(marked)
lines = []
for i, n in enumerate(take["notes"], 1):
    b = n["box"]
    x0, y0, x1, y1 = int(b["x"]*W), int(b["y"]*H), int((b["x"]+b["w"])*W), int((b["y"]+b["h"])*H)
    d.rectangle((x0, y0, x1, y1), outline=(255, 0, 90), width=4)
    d.rectangle((x0, y0 - 34, x0 + 34, y0), fill=(255, 0, 90)); d.text((x0 + 10, y0 - 30), str(i), fill="white")
    pad = 120
    cx0, cy0, cx1, cy1 = max(0, x0 - pad), max(0, y0 - pad), min(W, x1 + pad), min(H, y1 + pad)
    crop = img.crop((cx0, cy0, cx1, cy1))
    dim = ImageEnhance.Brightness(crop).enhance(0.45)
    dim.paste(crop.crop((x0 - cx0, y0 - cy0, x1 - cx0, y1 - cy0)), (x0 - cx0, y0 - cy0))
    dim.save(os.path.join(out, "close-ups", f"1-{i}.png"))
    t = text_in(b)
    lines.append({"n": i, "where": f"Where: {place(b)}" + (f', on "{t}"' if t else "") + f". Colours: {colours(b)}."})
marked.save(os.path.join(out, "marked", "1.png"))
json.dump(lines, open(os.path.join(out, "where.json"), "w"))
