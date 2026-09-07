# Builds tictactoe.nes. Requires the cc65 suite (ca65, ld65) and python3.
BUILD   := build
ROM     := tictactoe.nes
CHR     := $(BUILD)/tiles.chr

.PHONY: all clean

all: $(ROM)

$(BUILD):
	mkdir -p $(BUILD)

$(CHR): tools/make_chr.py | $(BUILD)
	python3 tools/make_chr.py $@

$(BUILD)/tictactoe.o: src/tictactoe.s $(CHR) | $(BUILD)
	ca65 -g --bin-include-dir $(BUILD) -o $@ $<

$(ROM): $(BUILD)/tictactoe.o nes.cfg
	ld65 -C nes.cfg -o $@ --dbgfile $(BUILD)/tictactoe.dbg $<

clean:
	rm -rf $(BUILD) $(ROM)
