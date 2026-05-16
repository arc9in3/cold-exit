"""One-shot palette recolor for the low_poly_guns_fbx pack. Every weapon
in the pack samples a single shared uv_palette.png. Killing the green
accent here recolors every weapon at once.

Input/output paths are hardcoded — this is meant to be re-runnable.
"""
from PIL import Image
import shutil
import os

SRC = '.mc/lpg-extract/low_poly_guns_fbx/uv_palette.png'
BACKUP = '.mc/lpg-extract/low_poly_guns_fbx/uv_palette.original.png'


def is_green_ish(r, g, b):
    # The pack's accent greens are all "G dominates R + B by a wide margin."
    # The yellow-green (171, 222, 69) also counts — G is higher than R + B - 20.
    if g <= 80:
        return False  # too dark to be the bright accent
    return g > r + 20 and g > b + 20


def to_gray(r, g, b):
    # Luminance, then pulled down so the recolored region doesn't end
    # up brighter than the gun body gray (~180-210). Maps the brightest
    # accent (240G) to ~140 gray, leaving the body gray reading as
    # lighter than the accent regions — preserves the surface
    # differentiation without the chroma.
    y = int(0.299 * r + 0.587 * g + 0.114 * b)
    y = max(60, min(150, y - 30))
    return y


def main():
    if not os.path.exists(BACKUP):
        shutil.copy2(SRC, BACKUP)
        print(f'backed up palette to {BACKUP}')
    img = Image.open(BACKUP).convert('RGBA')
    px = img.load()
    swapped = 0
    for y in range(img.height):
        for x in range(img.width):
            r, g, b, a = px[x, y]
            if is_green_ish(r, g, b):
                gv = to_gray(r, g, b)
                px[x, y] = (gv, gv, gv, a)
                swapped += 1
    img.save(SRC)
    print(f'recolored {swapped} green-ish pixels -> gray in {SRC}')


if __name__ == '__main__':
    main()
