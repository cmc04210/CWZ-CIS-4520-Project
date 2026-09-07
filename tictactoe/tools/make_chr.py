#!/usr/bin/env python3
"""Generate the 8 KB CHR-ROM (pattern tables) for the Tic-Tac-Toe NES ROM.

Tile map (pattern table 0, shared by background and sprites):
  $00        blank
  $01-$09    X piece (3x3 tiles, row-major)
  $0A-$12    O piece (3x3 tiles, row-major)
  $13        grid: vertical bar
  $14        grid: horizontal bar
  $15        grid: intersection
  $20-$5F    font, indexed by ASCII code (only the glyphs we use are drawn)
  $60        cursor corner (top-left; other corners use sprite flipping)
Pattern table 1 is left empty.
"""
import sys

TILE_BYTES = 16
TABLE_TILES = 256

# 5x7 font. '#' = colour 1. Glyphs are placed at columns 1-5, rows 0-6.
FONT = {
    "A": ".###.|#...#|#...#|#####|#...#|#...#|#...#",
    "B": "####.|#...#|#...#|####.|#...#|#...#|####.",
    "C": ".####|#....|#....|#....|#....|#....|.####",
    "D": "####.|#...#|#...#|#...#|#...#|#...#|####.",
    "E": "#####|#....|#....|####.|#....|#....|#####",
    "F": "#####|#....|#....|####.|#....|#....|#....",
    "G": ".####|#....|#....|#.###|#...#|#...#|.####",
    "H": "#...#|#...#|#...#|#####|#...#|#...#|#...#",
    "I": "#####|..#..|..#..|..#..|..#..|..#..|#####",
    "J": "..###|...#.|...#.|...#.|...#.|#..#.|.##..",
    "K": "#...#|#..#.|#.#..|##...|#.#..|#..#.|#...#",
    "L": "#....|#....|#....|#....|#....|#....|#####",
    "M": "#...#|##.##|#.#.#|#.#.#|#...#|#...#|#...#",
    "N": "#...#|##..#|#.#.#|#..##|#...#|#...#|#...#",
    "O": ".###.|#...#|#...#|#...#|#...#|#...#|.###.",
    "P": "####.|#...#|#...#|####.|#....|#....|#....",
    "Q": ".###.|#...#|#...#|#...#|#.#.#|#..#.|.##.#",
    "R": "####.|#...#|#...#|####.|#.#..|#..#.|#...#",
    "S": ".####|#....|#....|.###.|....#|....#|####.",
    "T": "#####|..#..|..#..|..#..|..#..|..#..|..#..",
    "U": "#...#|#...#|#...#|#...#|#...#|#...#|.###.",
    "V": "#...#|#...#|#...#|#...#|.#.#.|.#.#.|..#..",
    "W": "#...#|#...#|#...#|#.#.#|#.#.#|##.##|#...#",
    "X": "#...#|#...#|.#.#.|..#..|.#.#.|#...#|#...#",
    "Y": "#...#|#...#|.#.#.|..#..|..#..|..#..|..#..",
    "Z": "#####|....#|...#.|..#..|.#...|#....|#####",
    "0": ".###.|#...#|#..##|#.#.#|##..#|#...#|.###.",
    "1": "..#..|.##..|..#..|..#..|..#..|..#..|.###.",
    "2": ".###.|#...#|....#|...#.|..#..|.#...|#####",
    "3": "#####|...#.|..#..|...#.|....#|#...#|.###.",
    "4": "...#.|..##.|.#.#.|#..#.|#####|...#.|...#.",
    "5": "#####|#....|####.|....#|....#|#...#|.###.",
    "6": "..###|.#...|#....|####.|#...#|#...#|.###.",
    "7": "#####|....#|...#.|..#..|.#...|.#...|.#...",
    "8": ".###.|#...#|#...#|.###.|#...#|#...#|.###.",
    "9": ".###.|#...#|#...#|.####|....#|...#.|###..",
    "!": "..#..|..#..|..#..|..#..|..#..|.....|..#..",
    "'": ".##..|..#..|.#...|.....|.....|.....|.....",
    "-": ".....|.....|.....|#####|.....|.....|.....",
    ":": ".....|.##..|.##..|.....|.##..|.##..|.....",
    ">": "#....|.#...|..#..|...#.|..#..|.#...|#....",
    "?": ".###.|#...#|....#|...#.|..#..|.....|..#..",
    " ": ".....|.....|.....|.....|.....|.....|.....",
}


def blank_tile():
    return [[0] * 8 for _ in range(8)]


def encode_tile(pixels):
    """Convert an 8x8 grid of colour indices (0-3) into 16 CHR bytes."""
    plane0 = bytearray(8)
    plane1 = bytearray(8)
    for y in range(8):
        for x in range(8):
            c = pixels[y][x]
            if c & 1:
                plane0[y] |= 0x80 >> x
            if c & 2:
                plane1[y] |= 0x80 >> x
    return bytes(plane0 + plane1)


def font_tile(glyph):
    tile = blank_tile()
    for y, row in enumerate(glyph.split("|")):
        for x, ch in enumerate(row):
            if ch == "#":
                tile[y][x + 1] = 1
    return tile


def piece_x():
    """24x24 X drawn with colour 1: two 3px-thick diagonals with a 2px margin."""
    img = [[0] * 24 for _ in range(24)]
    for y in range(2, 22):
        for x in range(2, 22):
            if abs(x - y) <= 1 or abs(x + y - 23) <= 1:
                img[y][x] = 1
    return img


def piece_o():
    """24x24 ring drawn with colour 1."""
    img = [[0] * 24 for _ in range(24)]
    cx = cy = 11.5
    for y in range(24):
        for x in range(24):
            d2 = (x - cx) ** 2 + (y - cy) ** 2
            if 6.5 ** 2 <= d2 <= 9.6 ** 2:
                img[y][x] = 1
    return img


def slice_3x3(img):
    tiles = []
    for ty in range(3):
        for tx in range(3):
            tiles.append([row[tx * 8:tx * 8 + 8] for row in img[ty * 8:ty * 8 + 8]])
    return tiles


def grid_tile(vertical, horizontal):
    tile = blank_tile()
    for i in range(8):
        if vertical:
            tile[i][3] = tile[i][4] = 3
        if horizontal:
            tile[3][i] = tile[4][i] = 3
    return tile


def cursor_tile():
    tile = blank_tile()
    for i in range(5):
        tile[0][i] = tile[1][i] = 1
        tile[i][0] = tile[i][1] = 1
    return tile


def build_table():
    tiles = [blank_tile() for _ in range(TABLE_TILES)]
    for i, t in enumerate(slice_3x3(piece_x())):
        tiles[0x01 + i] = t
    for i, t in enumerate(slice_3x3(piece_o())):
        tiles[0x0A + i] = t
    tiles[0x13] = grid_tile(True, False)
    tiles[0x14] = grid_tile(False, True)
    tiles[0x15] = grid_tile(True, True)
    for ch, glyph in FONT.items():
        tiles[ord(ch)] = font_tile(glyph)
    tiles[0x60] = cursor_tile()
    return b"".join(encode_tile(t) for t in tiles)


def main():
    out = sys.argv[1] if len(sys.argv) > 1 else "tiles.chr"
    table0 = build_table()
    table1 = bytes(TABLE_TILES * TILE_BYTES)
    data = table0 + table1
    assert len(data) == 8192
    with open(out, "wb") as f:
        f.write(data)


if __name__ == "__main__":
    main()
