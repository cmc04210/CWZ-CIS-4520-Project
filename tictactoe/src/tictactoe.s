; =============================================================================
; TIC-TAC-TOE for the Nintendo Entertainment System
; Mapper 0 (NROM-128), 16 KB PRG-ROM, 8 KB CHR-ROM, vertical mirroring.
; Assemble with ca65/ld65 (cc65 suite) - see Makefile.
;
; Controls:
;   Title:  Up/Down/Select - choose 1 or 2 players, Start - begin
;   Game:   D-pad - move cursor, A - place mark, Select - back to title
;   Over:   Start - next round (scores kept), Select - back to title
; =============================================================================

; ---- Hardware registers -----------------------------------------------------
PPUCTRL   = $2000
PPUMASK   = $2001
PPUSTATUS = $2002
OAMADDR   = $2003
PPUSCROLL = $2005
PPUADDR   = $2006
PPUDATA   = $2007
OAMDMA    = $4014
JOY1      = $4016
SQ1_VOL   = $4000
SQ1_SWEEP = $4001
SQ1_LO    = $4002
SQ1_HI    = $4003
DMC_FREQ  = $4010
SND_CHN   = $4015
APU_FRAME = $4017

; ---- Controller bits --------------------------------------------------------
BTN_A      = $80
BTN_B      = $40
BTN_SELECT = $20
BTN_START  = $10
BTN_UP     = $08
BTN_DOWN   = $04
BTN_LEFT   = $02
BTN_RIGHT  = $01

; ---- Game constants ---------------------------------------------------------
MARK_NONE   = 0
MARK_X      = 1
MARK_O      = 2

STATE_TITLE = 0
STATE_PLAY  = 1
STATE_OVER  = 2

MODE_1P     = 0
MODE_2P     = 1

; The board is drawn at nametable columns 12-22 and shifted left by 12 pixels
; with the scroll register so that it is centred on the screen.
SCROLL_X    = 12

; Tiles
TILE_BLANK  = $00
TILE_X      = $01       ; 9 tiles
TILE_O      = $0A       ; 9 tiles
TILE_VBAR   = $13
TILE_HBAR   = $14
TILE_CROSS  = $15
TILE_CURSOR = $60

; ---- iNES header ------------------------------------------------------------
.segment "HEADER"
    .byte "NES", $1A
    .byte 1             ; 1 x 16 KB PRG-ROM
    .byte 1             ; 1 x 8 KB CHR-ROM
    .byte $01           ; mapper 0, vertical mirroring
    .byte $00
    .res 8, $00

; ---- Zero page --------------------------------------------------------------
.segment "ZEROPAGE"
nmi_count:      .res 1  ; incremented every NMI, used for frame sync / timing
ppu_ctrl_sh:    .res 1  ; shadow of PPUCTRL written each NMI
ppu_mask_sh:    .res 1  ; shadow of PPUMASK written each NMI
buttons:        .res 1  ; currently held buttons
buttons_prev:   .res 1
buttons_new:    .res 1  ; buttons pressed this frame
state:          .res 1
mode:           .res 1  ; MODE_1P / MODE_2P
menu_sel:       .res 1
turn:           .res 1  ; MARK_X or MARK_O
cursor:         .res 1  ; 0-8
moves:          .res 1  ; marks placed this round
wipe_step:      .res 1  ; 0-8 while the board is being cleared, 9 = idle
cpu_timer:      .res 1  ; frames until the CPU makes its move
rng:            .res 1
buf_pos:        .res 1  ; write index into vram_buf
buf_len:        .res 1  ; scratch for buf_begin
win_a:          .res 1  ; cells of the winning line
win_b:          .res 1
win_c:          .res 1
score:          .res 4  ; X tens, X ones, O tens, O ones
ptr:            .res 2
temp0:          .res 1
temp1:          .res 1
temp2:          .res 1
temp3:          .res 1
cur_tile:       .res 1
tile_step:      .res 1
mark_tmp:       .res 1
board:          .res 9

.segment "OAM"
oam:            .res 256

.segment "BSS"
vram_buf:       .res 256 ; [addr_hi][addr_lo][len][data...] ... [0]
score_text:     .res 11

; ---- Macros -----------------------------------------------------------------
.macro SET_PTR addr
    lda #<addr
    sta ptr
    lda #>addr
    sta ptr+1
.endmacro

.segment "CODE"

; =============================================================================
; Reset / initialisation
; =============================================================================
.proc reset
    sei
    cld
    ldx #$40
    stx APU_FRAME           ; disable APU frame IRQ
    ldx #$FF
    txs
    inx
    stx PPUCTRL             ; NMI off
    stx PPUMASK             ; rendering off
    stx DMC_FREQ            ; DMC IRQ off
    bit PPUSTATUS
:   bit PPUSTATUS           ; first vblank
    bpl :-

    lda #0
    tax
:   sta $0000,x
    sta $0100,x
    sta $0300,x
    sta $0400,x
    sta $0500,x
    sta $0600,x
    sta $0700,x
    inx
    bne :-
    lda #$F0                ; park every sprite off-screen
:   sta oam,x
    inx
    bne :-

:   bit PPUSTATUS           ; second vblank - PPU is now stable
    bpl :-

    jsr load_palettes
    jsr clear_nametables
    jsr draw_static_screen

    lda #$01
    sta SND_CHN             ; enable pulse 1
    lda #$08
    sta SQ1_SWEEP           ; sweep off (negate set so low notes are not muted)

    lda #1
    sta rng
    lda #MODE_1P
    sta mode
    jsr enter_title

    lda #$1E                ; show BG + sprites (applied by the first NMI)
    sta ppu_mask_sh
    lda #$80                ; NMI on, BG+sprites from pattern table 0
    sta ppu_ctrl_sh
    sta PPUCTRL

main_loop:
    jsr wait_frame
    jsr read_joypad
    jsr update_rng
    jsr run_wipe

    lda state
    cmp #STATE_PLAY
    beq @play
    cmp #STATE_OVER
    beq @over
    jsr update_title
    jmp @done
@play:
    jsr update_play
    jmp @done
@over:
    jsr update_over
@done:
    jsr update_cursor_sprites
    jmp main_loop
.endproc

; =============================================================================
; NMI: upload OAM, flush queued VRAM writes, then restore scroll.
; =============================================================================
.proc nmi
    pha
    txa
    pha
    tya
    pha

    inc nmi_count

    lda #0
    sta OAMADDR
    lda #>oam
    sta OAMDMA

    jsr flush_vram_buffer

    bit PPUSTATUS
    lda ppu_ctrl_sh
    sta PPUCTRL
    lda #SCROLL_X
    sta PPUSCROLL
    lda #0
    sta PPUSCROLL
    lda ppu_mask_sh
    sta PPUMASK

    pla
    tay
    pla
    tax
    pla
    rti
.endproc

.proc irq
    rti
.endproc

.proc wait_frame
    lda nmi_count
:   cmp nmi_count
    beq :-
    rts
.endproc

; =============================================================================
; VRAM update buffer
; =============================================================================
.proc flush_vram_buffer
    ldx #0
@entry:
    lda vram_buf,x
    beq @end
    sta PPUADDR
    inx
    lda vram_buf,x
    sta PPUADDR
    inx
    ldy vram_buf,x
    inx
@data:
    lda vram_buf,x
    sta PPUDATA
    inx
    dey
    bne @data
    jmp @entry
@end:
    sta vram_buf            ; A = 0: reset terminator
    sta buf_pos
    rts
.endproc

; Start a buffer entry. A = address high, X = address low, Y = length.
.proc buf_begin
    sty buf_len
    ldy buf_pos
    sta vram_buf,y
    iny
    txa
    sta vram_buf,y
    iny
    lda buf_len
    sta vram_buf,y
    iny
    sty buf_pos
    rts
.endproc

; Append one data byte (A) to the current entry and keep the terminator.
.proc buf_put
    ldy buf_pos
    sta vram_buf,y
    iny
    sty buf_pos
    lda #0
    sta vram_buf,y
    rts
.endproc

; Queue an 11-character string (ptr) on text line Y (0-2).
.proc draw_text_line
    lda line_addr_hi,y
    ldx line_addr_lo,y
    ldy #11
    jsr buf_begin
    ldy #0
    ldx buf_pos
@copy:
    lda (ptr),y
    sta vram_buf,x
    inx
    iny
    cpy #11
    bne @copy
    stx buf_pos
    lda #0
    sta vram_buf,x
    rts
.endproc

; Queue the 3x3 tiles and the attribute byte for one cell.
; A = cell (0-8), X = mark (MARK_NONE / MARK_X / MARK_O)
.proc draw_piece
    sta temp2
    stx mark_tmp
    lda piece_base,x
    sta cur_tile
    lda piece_step,x
    sta tile_step
    ldx temp2
    lda cell_addr_lo,x
    sta temp0
    lda cell_addr_hi,x
    sta temp1
    lda #0
    sta temp3
@row:
    lda temp1
    ldx temp0
    ldy #3
    jsr buf_begin
    ldx #3
@col:
    lda cur_tile
    jsr buf_put
    lda cur_tile
    clc
    adc tile_step
    sta cur_tile
    dex
    bne @col
    lda temp0
    clc
    adc #32
    sta temp0
    bcc :+
    inc temp1
:   inc temp3
    lda temp3
    cmp #3
    bne @row

    ldy temp2
    ldx cell_attr_lo,y
    lda #$23
    ldy #1
    jsr buf_begin
    ldx mark_tmp
    lda piece_attr,x
    jmp buf_put
.endproc

; Recolour one cell (A) with palette 3 to highlight the winning line.
.proc highlight_cell
    tay
    ldx cell_attr_lo,y
    lda #$23
    ldy #1
    jsr buf_begin
    lda #$FF
    jmp buf_put
.endproc

; Clears one cell per frame until the whole board is blank.
.proc run_wipe
    lda wipe_step
    cmp #9
    bcs @done
    ldx #MARK_NONE
    jsr draw_piece
    inc wipe_step
@done:
    rts
.endproc

; =============================================================================
; One-time screen setup (rendering off)
; =============================================================================
.proc load_palettes
    lda #$3F
    sta PPUADDR
    lda #$00
    sta PPUADDR
    ldx #0
:   lda palette,x
    sta PPUDATA
    inx
    cpx #32
    bne :-
    rts
.endproc

.proc clear_nametables
    lda #$20
    sta PPUADDR
    lda #$00
    sta PPUADDR
    lda #0
    ldx #8                  ; 8 x 256 = 2048 bytes ($2000-$27FF)
    ldy #0
:   sta PPUDATA
    iny
    bne :-
    dex
    bne :-
    rts
.endproc

.proc draw_static_screen
    ; Title
    lda #$20
    sta PPUADDR
    lda #$4C
    sta PPUADDR
    ldx #0
:   lda txt_title,x
    sta PPUDATA
    inx
    cpx #11
    bne :-
    ; Title colour: attribute bytes for rows 0-3, columns 12-23 -> palette 3
    lda #$23
    sta PPUADDR
    lda #$C3
    sta PPUADDR
    lda #$FF
    sta PPUDATA
    sta PPUDATA
    sta PPUDATA

    ; Vertical grid lines (PPU address increment = 32)
    lda #$04
    sta PPUCTRL
    lda #$21
    sta PPUADDR
    lda #$0F                ; row 8, column 15
    sta PPUADDR
    jsr @vline
    lda #$21
    sta PPUADDR
    lda #$13                ; row 8, column 19
    sta PPUADDR
    jsr @vline
    lda #$00
    sta PPUCTRL

    ; Horizontal grid lines
    lda #$21
    sta PPUADDR
    lda #$6C                ; row 11, column 12
    sta PPUADDR
    jsr @hline
    lda #$21
    sta PPUADDR
    lda #$EC                ; row 15, column 12
    sta PPUADDR
    jsr @hline
    rts

@vline:
    ldx #0
:   lda grid_vline,x
    sta PPUDATA
    inx
    cpx #11
    bne :-
    rts
@hline:
    ldx #0
:   lda grid_hline,x
    sta PPUDATA
    inx
    cpx #11
    bne :-
    rts
.endproc

; =============================================================================
; Input / RNG
; =============================================================================
.proc read_joypad
    lda buttons
    sta buttons_prev
    lda #1
    sta JOY1
    sta buttons
    lsr a
    sta JOY1
:   lda JOY1
    lsr a
    rol buttons
    bcc :-
    lda buttons_prev
    eor #$FF
    and buttons
    sta buttons_new
    rts
.endproc

.proc update_rng
    lda rng
    asl a
    bcc :+
    eor #$39
:   clc
    adc nmi_count
    adc buttons
    sta rng
    rts
.endproc

; =============================================================================
; Title screen
; =============================================================================
.proc enter_title
    lda #STATE_TITLE
    sta state
    lda mode
    sta menu_sel
    lda #0
    sta wipe_step
    jsr draw_menu
    SET_PTR txt_press_start
    ldy #2
    jmp draw_text_line
.endproc

.proc draw_menu
    lda menu_sel
    bne @two
    SET_PTR txt_menu1_sel
    ldy #0
    jsr draw_text_line
    SET_PTR txt_menu2
    ldy #1
    jmp draw_text_line
@two:
    SET_PTR txt_menu1
    ldy #0
    jsr draw_text_line
    SET_PTR txt_menu2_sel
    ldy #1
    jmp draw_text_line
.endproc

.proc update_title
    lda wipe_step
    cmp #9
    bcc @done
    lda buttons_new
    and #(BTN_UP | BTN_DOWN | BTN_SELECT)
    beq :+
    lda menu_sel
    eor #1
    sta menu_sel
    jsr draw_menu
    lda #<NOTE_MENU
    ldx #>NOTE_MENU
    jsr play_note
:   lda buttons_new
    and #(BTN_START | BTN_A)
    beq @done
    lda menu_sel
    sta mode
    lda #0
    sta score
    sta score+1
    sta score+2
    sta score+3
    lda #<NOTE_START
    ldx #>NOTE_START
    jsr play_note
    jmp enter_play
@done:
    rts
.endproc

; =============================================================================
; Gameplay
; =============================================================================
.proc enter_play
    lda #STATE_PLAY
    sta state
    lda #0
    ldx #8
:   sta board,x
    dex
    bpl :-
    sta moves
    sta wipe_step
    lda #MARK_X
    sta turn
    lda #4
    sta cursor
    jsr draw_turn_text
    SET_PTR txt_blank
    ldy #1
    jsr draw_text_line
    jmp draw_score
.endproc

.proc draw_turn_text
    lda mode
    bne @two_player
    lda turn
    cmp #MARK_X
    bne :+
    SET_PTR txt_your_turn
    jmp @draw
:   SET_PTR txt_cpu_turn
    jmp @draw
@two_player:
    lda turn
    cmp #MARK_X
    bne :+
    SET_PTR txt_x_turn
    jmp @draw
:   SET_PTR txt_o_turn
@draw:
    ldy #0
    jmp draw_text_line
.endproc

.proc draw_win_text
    lda mode
    bne @two_player
    lda turn
    cmp #MARK_X
    bne :+
    SET_PTR txt_you_win
    jmp @draw
:   SET_PTR txt_cpu_wins
    jmp @draw
@two_player:
    lda turn
    cmp #MARK_X
    bne :+
    SET_PTR txt_x_wins
    jmp @draw
:   SET_PTR txt_o_wins
@draw:
    ldy #0
    jmp draw_text_line
.endproc

.proc update_play
    lda wipe_step
    cmp #9
    bcc @done
    lda buttons_new
    and #BTN_SELECT
    beq :+
    jmp enter_title
:   lda mode
    bne @human
    lda turn
    cmp #MARK_O
    bne @human
    ; CPU's move
    dec cpu_timer
    bne @done
    jsr cpu_choose_move
    jmp place_mark

@human:
    lda buttons_new
    and #BTN_LEFT
    beq :+
    ldx cursor
    lda move_left,x
    sta cursor
:   lda buttons_new
    and #BTN_RIGHT
    beq :+
    ldx cursor
    lda move_right,x
    sta cursor
:   lda buttons_new
    and #BTN_UP
    beq :+
    ldx cursor
    lda move_up,x
    sta cursor
:   lda buttons_new
    and #BTN_DOWN
    beq :+
    ldx cursor
    lda move_down,x
    sta cursor
:   lda buttons_new
    and #BTN_A
    beq @done
    ldx cursor
    lda board,x
    beq :+
    lda #<NOTE_ERROR        ; cell already taken
    ldx #>NOTE_ERROR
    jmp play_note
:   lda cursor
    jmp place_mark
@done:
    rts
.endproc

; Place the current player's mark in cell A and advance the game.
.proc place_mark
    tax
    lda turn
    sta board,x
    txa
    ldx turn
    jsr draw_piece
    inc moves

    lda turn
    jsr check_win
    bcc @no_win
    lda win_a
    jsr highlight_cell
    lda win_b
    jsr highlight_cell
    lda win_c
    jsr highlight_cell
    ldx #0
    lda turn
    cmp #MARK_X
    beq :+
    ldx #2
:   jsr inc_score
    jsr draw_win_text
    jsr draw_score
    lda #<NOTE_WIN
    ldx #>NOTE_WIN
    jsr play_note
    jmp game_over

@no_win:
    lda moves
    cmp #9
    bne @next_turn
    SET_PTR txt_draw
    ldy #0
    jsr draw_text_line
    lda #<NOTE_DRAW
    ldx #>NOTE_DRAW
    jsr play_note
    jmp game_over

@next_turn:
    lda turn
    cmp #MARK_X
    bne :+
    lda #<NOTE_PLACE_X
    ldx #>NOTE_PLACE_X
    jsr play_note
    jmp :++
:   lda #<NOTE_PLACE_O
    ldx #>NOTE_PLACE_O
    jsr play_note
:   lda turn
    eor #(MARK_X ^ MARK_O)
    sta turn
    lda rng
    and #$1F
    clc
    adc #30                 ; CPU "thinks" for 30-61 frames
    sta cpu_timer
    jmp draw_turn_text
.endproc

.proc game_over
    lda #STATE_OVER
    sta state
    SET_PTR txt_press_start
    ldy #1
    jmp draw_text_line
.endproc

.proc update_over
    lda buttons_new
    and #(BTN_START | BTN_A)
    beq :+
    jmp enter_play
:   lda buttons_new
    and #BTN_SELECT
    beq :+
    jmp enter_title
:   rts
.endproc

; Check whether mark A has three in a row. Returns carry set on a win and
; stores the winning cells in win_a/win_b/win_c.
.proc check_win
    sta temp0
    ldx #0
@line:
    ldy lines,x
    lda board,y
    cmp temp0
    bne @next
    ldy lines+1,x
    lda board,y
    cmp temp0
    bne @next
    ldy lines+2,x
    lda board,y
    cmp temp0
    bne @next
    lda lines,x
    sta win_a
    lda lines+1,x
    sta win_b
    lda lines+2,x
    sta win_c
    sec
    rts
@next:
    inx
    inx
    inx
    cpx #24
    bne @line
    clc
    rts
.endproc

; X = 0 for player X, 2 for player O. Two decimal digits, capped at 99.
.proc inc_score
    inc score+1,x
    lda score+1,x
    cmp #10
    bne @done
    lda #0
    sta score+1,x
    inc score,x
    lda score,x
    cmp #10
    bne @done
    lda #9
    sta score,x
    sta score+1,x
@done:
    rts
.endproc

.proc draw_score
    ldx #10
:   lda txt_score_tpl,x
    sta score_text,x
    dex
    bpl :-
    lda score
    ora #'0'
    sta score_text+2
    lda score+1
    ora #'0'
    sta score_text+3
    lda score+2
    ora #'0'
    sta score_text+7
    lda score+3
    ora #'0'
    sta score_text+8
    SET_PTR score_text
    ldy #2
    jmp draw_text_line
.endproc

; =============================================================================
; CPU opponent (plays O). Returns the chosen cell in A.
;   1. win if possible   2. block the player   3. centre
;   4. a random free corner   5. a random free side
; =============================================================================
.proc cpu_choose_move
    lda #MARK_O
    jsr find_winning_move
    bcs @found
    lda #MARK_X
    jsr find_winning_move
    bcs @found
    lda board+4
    bne :+
    lda #4
    rts
:   lda rng
    and #3
    sta temp3
    ldx #4
@corner:
    ldy temp3
    lda corners,y
    tay
    lda board,y
    bne :+
    tya
    rts
:   inc temp3
    lda temp3
    and #3
    sta temp3
    dex
    bne @corner
    lda rng
    lsr a
    lsr a
    and #3
    sta temp3
    ldx #4
@side:
    ldy temp3
    lda sides,y
    tay
    lda board,y
    bne :+
    tya
    rts
:   inc temp3
    lda temp3
    and #3
    sta temp3
    dex
    bne @side
    ldx #0                  ; fallback: first free cell
@any:
    lda board,x
    beq :+
    inx
    cpx #9
    bne @any
    ldx #0
:   txa
@found:
    rts
.endproc

; Find a cell where mark A completes a line. Carry set + cell in A if found.
.proc find_winning_move
    sta temp2
    ldx #0
@loop:
    lda board,x
    bne @next
    lda temp2
    sta board,x
    txa
    pha
    lda temp2
    jsr check_win
    pla
    tax
    lda #MARK_NONE
    sta board,x
    bcs @found
@next:
    inx
    cpx #9
    bne @loop
    clc
    rts
@found:
    txa
    sec
    rts
.endproc

; =============================================================================
; Cursor sprites: four corner brackets around the selected cell.
; =============================================================================
.proc update_cursor_sprites
    lda state
    cmp #STATE_PLAY
    bne @hide
    lda wipe_step
    cmp #9
    bcc @hide
    ldx cursor
    lda cell_px_x,x
    sta temp0
    lda cell_px_y,x
    sta temp1
    lda nmi_count
    lsr a
    lsr a
    lsr a
    lsr a
    and #1                  ; blink between two palettes
    sta temp2

    lda temp1
    sta oam+0
    sta oam+4
    clc
    adc #16
    sta oam+8
    sta oam+12
    lda #TILE_CURSOR
    sta oam+1
    sta oam+5
    sta oam+9
    sta oam+13
    lda temp2
    sta oam+2
    ora #$40                ; flip horizontally
    sta oam+6
    lda temp2
    ora #$80                ; flip vertically
    sta oam+10
    ora #$40
    sta oam+14
    lda temp0
    sta oam+3
    sta oam+11
    clc
    adc #16
    sta oam+7
    sta oam+15
    rts
@hide:
    lda #$F0
    sta oam+0
    sta oam+4
    sta oam+8
    sta oam+12
    rts
.endproc

; =============================================================================
; Sound: a single decaying pulse note. A = period low, X = period high.
; =============================================================================
.proc play_note
    sta SQ1_LO
    lda #$87                ; 50% duty, envelope decay, rate 7
    sta SQ1_VOL
    txa
    ora #$40                ; length counter index 8
    sta SQ1_HI
    rts
.endproc

NOTE_MENU    = $00A8        ; E5
NOTE_START   = $007E        ; A5
NOTE_PLACE_X = $00D4        ; C5
NOTE_PLACE_O = $00A8        ; E5
NOTE_WIN     = $0069        ; C6
NOTE_DRAW    = $01FB        ; A3
NOTE_ERROR   = $03F8        ; A2

; =============================================================================
; Data
; =============================================================================
.segment "RODATA"

palette:
    ; Background: colour 1 = text/piece colour, colour 3 = grid (white)
    .byte $0F, $30, $10, $30    ; 0: white text
    .byte $0F, $16, $10, $30    ; 1: X (red)
    .byte $0F, $21, $10, $30    ; 2: O (blue)
    .byte $0F, $28, $10, $30    ; 3: title / winning line (yellow)
    ; Sprites
    .byte $0F, $2A, $30, $16    ; 0: cursor (green)
    .byte $0F, $1A, $30, $16    ; 1: cursor (dark green, blink)
    .byte $0F, $2A, $30, $16
    .byte $0F, $2A, $30, $16

; Top-left nametable address of each cell's 3x3 tile block.
cell_addr_hi:
    .byte $21, $21, $21, $21, $21, $21, $22, $22, $22
cell_addr_lo:
    .byte $0C, $10, $14, $8C, $90, $94, $0C, $10, $14
; Attribute byte for each cell (high byte is always $23).
cell_attr_lo:
    .byte $D3, $D4, $D5, $DB, $DC, $DD, $E3, $E4, $E5
; Screen position of each cell for the cursor sprites.
cell_px_x:
    .byte 84, 116, 148, 84, 116, 148, 84, 116, 148
cell_px_y:
    .byte 63, 63, 63, 95, 95, 95, 127, 127, 127

piece_base:     .byte TILE_BLANK, TILE_X, TILE_O
piece_step:     .byte 0, 1, 1
piece_attr:     .byte $00, $55, $AA

move_left:      .byte 2, 0, 1, 5, 3, 4, 8, 6, 7
move_right:     .byte 1, 2, 0, 4, 5, 3, 7, 8, 6
move_up:        .byte 6, 7, 8, 0, 1, 2, 3, 4, 5
move_down:      .byte 3, 4, 5, 6, 7, 8, 0, 1, 2

lines:
    .byte 0, 1, 2,  3, 4, 5,  6, 7, 8      ; rows
    .byte 0, 3, 6,  1, 4, 7,  2, 5, 8      ; columns
    .byte 0, 4, 8,  2, 4, 6                ; diagonals

corners:        .byte 0, 2, 8, 6
sides:          .byte 1, 5, 7, 3

grid_vline:
    .byte TILE_VBAR, TILE_VBAR, TILE_VBAR, TILE_CROSS
    .byte TILE_VBAR, TILE_VBAR, TILE_VBAR, TILE_CROSS
    .byte TILE_VBAR, TILE_VBAR, TILE_VBAR
grid_hline:
    .byte TILE_HBAR, TILE_HBAR, TILE_HBAR, TILE_CROSS
    .byte TILE_HBAR, TILE_HBAR, TILE_HBAR, TILE_CROSS
    .byte TILE_HBAR, TILE_HBAR, TILE_HBAR

; Text lines: rows 21, 23 and 25, column 12
line_addr_hi:   .byte $22, $22, $23
line_addr_lo:   .byte $AC, $EC, $2C

; All strings are exactly 11 characters (tile indices = ASCII codes).
txt_title:       .byte "TIC-TAC-TOE"
txt_menu1_sel:   .byte "> 1 PLAYER "
txt_menu1:       .byte "  1 PLAYER "
txt_menu2_sel:   .byte "> 2 PLAYERS"
txt_menu2:       .byte "  2 PLAYERS"
txt_press_start: .byte "PRESS START"
txt_x_turn:      .byte "  X'S TURN "
txt_o_turn:      .byte "  O'S TURN "
txt_your_turn:   .byte " YOUR TURN "
txt_cpu_turn:    .byte " CPU'S TURN"
txt_x_wins:      .byte "  X WINS!  "
txt_o_wins:      .byte "  O WINS!  "
txt_you_win:     .byte "  YOU WIN! "
txt_cpu_wins:    .byte " CPU WINS! "
txt_draw:        .byte "   DRAW!   "
txt_blank:       .byte "           "
txt_score_tpl:   .byte "X 00 - 00 O"

; =============================================================================
.segment "VECTORS"
    .addr nmi, reset, irq

.segment "CHARS"
    .incbin "tiles.chr"
