"""Extract Rune’s observed green matte while keeping every other source RGB sample."""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent
original = ROOT / "provider-original.png"
rgb = np.asarray(Image.open(original).convert("RGB"), dtype=np.int16)
border = rgb[:, :9].reshape(-1, 3)
matte = np.median(border, axis=0)
assert matte[0] < 35 and matte[1] > 200 and matte[2] < 35
flat = (np.abs(rgb - matte).max(axis=2) <= 32)
r, g, b = np.moveaxis(rgb, 2, 0)
hue = (g > r + 35) & (g > b + 35) & (g > 100)
# Correct only distinct saturated green mixtures near measured flat matte.
# Preserve olive armor and the blue, lower-green pilot paint.
near_matte = np.asarray(Image.fromarray(flat.astype("uint8") * 255).filter(ImageFilter.MaxFilter(9))) > 0
mixed = hue & ~flat & near_matte
background = flat | mixed
rgba = np.dstack((rgb, np.full(rgb.shape[:2], 255, dtype=np.int16))).astype("uint8")
rgba[background] = 0
assert np.array_equal(rgba[:, :, :3][~background], rgb[~background])
Image.fromarray(rgba).save(ROOT / "source.png")
Image.fromarray(mixed.astype("uint8") * 255).save(ROOT / "perimeter-matte-mask.png")
data = {
    "provider": "Built-in ImageGen",
    "providerSourceSHA256": hashlib.sha256(original.read_bytes()).hexdigest(),
    "sourceSHA256": hashlib.sha256((ROOT / "source.png").read_bytes()).hexdigest(),
    "sourceType": "Derived RGBA sheet for review; provider RGB original is preserved.",
    "measuredMatteRGB": matte.tolist(),
    "flatMatteThreshold": 32,
    "observedFlatMatteSamples": int(flat.sum()),
    "additionalGreenMatteMixtureSamples": int(mixed.sum()),
    "additionalMaskScope": "Saturated green within four native pixels of the flat matte. Neutral steel and blue pilot paint are retained.",
    "retainedRGBUnchanged": True,
}
(ROOT / "source.json").write_text(json.dumps(data, indent=2) + "\n")
print(data)
