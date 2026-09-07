# Tic-Tac-Toe (NES)

A Tic-Tac-Toe game for the Nintendo Entertainment System, written in 6502
assembly. The prebuilt ROM is `tictactoe.nes` (iNES format, mapper 0 / NROM),
which runs in any NES emulator (Mesen, FCEUX, Nestopia, puNES, ...) and on
flash carts.

## Playing

| Screen | Button | Action |
| ------ | ------ | ------ |
| Title  | Up / Down / Select | Choose **1 Player** (vs CPU) or **2 Players** |
| Title  | Start / A | Begin |
| Game   | D-pad | Move the cursor (wraps around) |
| Game   | A | Place your mark |
| Game   | Select | Back to the title screen |
| Game over | Start / A | Next round (scores are kept) |
| Game over | Select | Back to the title screen |

X always moves first. In 1-player mode you are X and the CPU is O. The winning
line is highlighted in yellow and a running score is shown under the board.

## Building

Requires the [cc65](https://cc65.github.io/) suite (`ca65`, `ld65`) and Python 3.

```sh
make          # produces tictactoe.nes
make clean
```

`tools/make_chr.py` generates the 8 KB CHR-ROM (font, X/O pieces, grid,
cursor) from ASCII art and a few formulas; `make` runs it automatically.

## Layout

```
src/tictactoe.s     game code and data (ca65 syntax)
tools/make_chr.py   CHR-ROM (tile graphics) generator
nes.cfg             ld65 linker configuration (NROM-128)
Makefile
tictactoe.nes       prebuilt ROM
```

## Implementation notes

- 16 KB PRG-ROM, 8 KB CHR-ROM, vertical mirroring, no battery.
- Main loop syncs to NMI. Game logic queues nametable/attribute writes into a
  RAM buffer that the NMI handler flushes during vblank, so the screen is
  never written while the PPU is rendering.
- Each board cell is a 3x3 tile block aligned to one attribute byte, so X, O
  and the winning-line highlight each get their own palette.
- The board is drawn at nametable column 12 and shifted 12 pixels left with
  the scroll register to centre it.
- The CPU opponent wins if it can, blocks if it must, then prefers the centre,
  a random corner and finally a random side.
- Simple pulse-channel sound effects for menu, placement, win and draw.
